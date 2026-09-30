/**
 * pi tool: hand a browser agent a free-form request and let it work the page.
 *
 * The user states what they need in natural language. The reasoning model
 * interprets it, the controller builds a finite set of executable actions from
 * live page state, Jev picks one, playwright-cli performs it, and code verifies
 * progress. No domain schema, no per-website workflow.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
	clampThinkingLevel,
	type Model,
	type ModelThinkingLevel,
	type ThinkingLevel,
} from "@earendil-works/pi-ai";
import {
	type ExtensionAPI,
	type ExtensionContext,
	getAgentDir,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { Type } from "typebox";
import { runAgent } from "./agent";
import { createPlaywrightBrowser } from "./browser";
import { createJev } from "./jev";
import { Recorder } from "./metrics";
import { createPlanner, type Reasoner } from "./planner";
import { createBrowserPool, type Loan } from "./pool";
import {
	type BrowserToolDetails,
	resultEvidence,
	toolDisplay,
} from "./presentation";
import type { AgentResult } from "./types";

const execFileAsync = promisify(execFile);
const KEYCHAIN_SERVICE = "pi-personal-ext.typesafe";
/** A plan or a verdict is a small JSON object; anything longer is the model
 * writing prose nobody reads, and output tokens are what the wait is made of. */
const REASONING_MAX_TOKENS = 700;
/** Idle browsers kept warm for the next run; a browser is a process with a cost. */
const IDLE_BROWSERS = 2;
/** Fast models to fall back on when pi has no configured default model. */
const FAST_MODEL = /flash|mini|haiku|lite|small|fast|nano/i;

async function apiKey(ctx: ExtensionContext): Promise<string> {
	if (process.env.TYPESAFE_API_KEY) return process.env.TYPESAFE_API_KEY;

	try {
		const { stdout } = await execFileAsync("security", [
			"find-generic-password",
			"-s",
			KEYCHAIN_SERVICE,
			"-w",
		]);

		return stdout.trim();
	} catch {
		if (!ctx.hasUI) throw new Error("TypeSafe API key is not configured");

		const key = await ctx.ui.input("TypeSafe API key", "ts_…");
		if (!key) throw new Error("TypeSafe API key setup cancelled");

		await execFileAsync("security", [
			"add-generic-password",
			"-U",
			"-a",
			process.env.USER ?? "",
			"-s",
			KEYCHAIN_SERVICE,
			"-w",
			key,
		]);

		return key;
	}
}

/** The model pi is configured to use: project settings first, then global. */
function configuredModel(ctx: ExtensionContext): Model<string> | undefined {
	const settings = SettingsManager.create(ctx.cwd, getAgentDir());

	for (const scope of [
		settings.getProjectSettings(),
		settings.getGlobalSettings(),
	]) {
		const provider = scope.defaultProvider;
		const id = scope.defaultModel;
		if (!provider || !id) continue;

		const model = ctx.modelRegistry.find(provider, id);
		if (model && ctx.modelRegistry.hasConfiguredAuth(model)) {
			return model as Model<string>;
		}
	}

	return ctx.model as Model<string> | undefined;
}

/**
 * The model that does the reasoning: whatever pi is configured with, and only
 * failing that a small fast model, because planning is a bounded job that does
 * not need the strongest model available.
 */
function plannerModel(ctx: ExtensionContext): Model<string> {
	const configured = configuredModel(ctx);
	if (configured) return configured;

	const available = ctx.modelRegistry.getAvailable();
	const model =
		available.find((entry) => FAST_MODEL.test(entry.id)) ?? available[0];
	if (!model) {
		throw new Error(
			"No model with configured auth is available to reason with",
		);
	}

	return model as Model<string>;
}

/**
 * The lowest thinking level the model supports, in pi's own request convention:
 * pi omits the reasoning option entirely for "off", and providers read that as
 * no thinking at all.
 */
function lowestThinking(model: Model<string>): {
	option: ThinkingLevel | undefined;
	label: ModelThinkingLevel;
} {
	const level = clampThinkingLevel(model, "off");

	return { option: level === "off" ? undefined : level, label: level };
}

/**
 * Runs one completion on the chosen model through the runtime's own streaming
 * path.
 *
 * Going through `ctx.modelRegistry.streamSimple` rather than calling a provider
 * directly is what keeps provider-specific request handling intact, including
 * the per-conversation routing header that opencode models require. It also
 * carries the session id, so the call is attributed to this conversation.
 */
/** What the reasoning call sent, so its shape is visible instead of assumed. */
type CallShape = { system: number; user: number; calls: number };

function createReasoner(
	ctx: ExtensionContext,
	model: Model<string>,
	reasoning: ThinkingLevel | undefined,
	shape: CallShape,
): Reasoner {
	return async ({ system, user, signal }) => {
		// The request is this extension's own system prompt and one user message.
		// No pi system prompt, no tools, no MCP, no project files: a plain model
		// call that answers a plain question.
		shape.system = system.length;
		shape.user = user.length;
		shape.calls += 1;

		const message = await ctx.modelRegistry
			.streamSimple(
				model,
				{
					systemPrompt: system,
					messages: [{ role: "user", content: user, timestamp: Date.now() }],
				},
				{
					sessionId: ctx.sessionManager.getSessionId(),
					maxTokens: REASONING_MAX_TOKENS,
					// Planning is not a reasoning puzzle. Thinking is the largest
					// single cost in a run, and the lowest level is enough for a
					// small JSON plan.
					reasoning,
					signal,
				},
			)
			.result();

		const text = message.content
			.filter((block) => block.type === "text")
			.map((block) => block.text)
			.join("")
			.trim();

		if (!text) {
			// Never hide the provider's answer behind "no text": a model that only
			// thought, hit a token limit, or errored looks identical otherwise.
			throw new Error(
				`${model.provider}/${model.id} returned no text ` +
					`(stop=${message.stopReason}` +
					`${message.errorMessage ? `, error=${message.errorMessage}` : ""}` +
					`, blocks=${message.content.map((block) => block.type).join("+") || "none"}` +
					`, output=${message.usage?.output ?? 0} tokens)`,
			);
		}

		return text;
	};
}

type Acquire = (recorder: Recorder) => Promise<Loan>;

type RunOptions = {
	request: string;
	url?: string;
	headed: boolean;
	maxSteps?: number;
	signal?: AbortSignal;
	onProgress?: (message: string) => void;
	acquire: Acquire;
};

/** Everything one run needs, wired from the session's model and credentials. */
async function run(
	ctx: ExtensionContext,
	{ request, url, headed, maxSteps, signal, onProgress, acquire }: RunOptions,
): Promise<AgentResult> {
	const recorder = new Recorder();
	const model = plannerModel(ctx);
	const thinking = lowestThinking(model);
	const shape: CallShape = { system: 0, user: 0, calls: 0 };

	onProgress?.(
		`reasoning with ${model.provider}/${model.id}, thinking ${thinking.label}`,
	);

	const { browser, release } = await acquire(recorder);

	try {
		const result = await runAgent({
			recorder,
			request,
			url,
			headed,
			maxSteps,
			signal,
			deps: {
				browser,
				jev: createJev(
					new TypeSafeClient({ apiKey: await apiKey(ctx) }),
					recorder,
				),
				planner: createPlanner(
					createReasoner(ctx, model, thinking.option, shape),
					recorder,
				),
				askUser: ctx.hasUI
					? (question) => ctx.ui.input("Browser agent question", question)
					: undefined,
				confirm: ctx.hasUI
					? (action) =>
							ctx.ui.confirm(
								"Consequential action",
								`${action.description}. Allow it?`,
							)
					: undefined,
				onProgress: (event) =>
					onProgress?.(`Step ${event.step}: ${event.message}`),
			},
		});

		return {
			...result,
			planner:
				`planner: ${model.provider}/${model.id} (thinking ${thinking.label}), ` +
				`${shape.calls} calls, last prompt: system ${shape.system} + user ${shape.user} chars, tools none`,
		};
	} finally {
		await release();
	}
}

export function registerJevBrowser(pi: ExtensionAPI, executeRun = run) {
	const pool = createBrowserPool({
		create: (session, recorder) =>
			createPlaywrightBrowser({ session, recorder }),
		// A timestamp, short enough for the socket path playwright-cli builds
		// from the session name, and unique per run so parallel runs cannot clash.
		name: () => `jev-${Date.now().toString(36)}`,
		maxIdle: IDLE_BROWSERS,
		alive: async (browser) => {
			try {
				await browser.observe();
				return true;
			} catch {
				return false;
			}
		},
	});

	const acquire: Acquire = (recorder) => pool.acquire(recorder);

	pi.on("session_shutdown", async () => {
		await pool.closeAll();
	});

	pi.registerTool({
		name: "jev_browser",
		label: "Jev Browser",
		description:
			"Autonomous browser agent. Give it what the user wants in plain language; it resolves the details, drives a real browser, and reports what it found. Use for reading or researching a site when no API is available. Add the url to start a task that must run on a specific site. Never performs purchases, payments, or anything irreversible without asking.",
		parameters: Type.Object({
			request: Type.String({
				description:
					"What the user wants, in natural language, including any values they named.",
			}),
			url: Type.Optional(
				Type.String({
					description:
						"Page to start on when the task must run on a specific site. Omit to let the agent choose.",
				}),
			),
			headed: Type.Optional(
				Type.Boolean({
					description: "Show the browser window. Default: hidden.",
				}),
			),
			maxSteps: Type.Optional(
				Type.Integer({
					minimum: 1,
					maximum: 100,
					description: "Action budget.",
				}),
			),
		}),
		executionMode: "sequential",
		async execute(_id, params, signal, onUpdate, ctx) {
			const progress: string[] = [];
			const result = await executeRun(ctx, {
				request: params.request,
				url: params.url,
				headed: params.headed ?? false,
				maxSteps: params.maxSteps,
				signal,
				acquire,
				onProgress: (message) => {
					progress.push(message);
					onUpdate?.({
						content: [{ type: "text", text: message }],
						details: { progress: [...progress] } satisfies BrowserToolDetails,
					});
				},
			}).catch((error: unknown) => {
				pi.appendEntry("jev-browser-error", {
					request: params.request,
					progress,
					error: error instanceof Error ? error.message : String(error),
				});
				throw error;
			});

			return {
				content: [{ type: "text" as const, text: resultEvidence(result) }],
				details: { progress, result } satisfies BrowserToolDetails,
			};
		},
		renderResult(result, { expanded }) {
			const details = result.details as
				| BrowserToolDetails
				| AgentResult
				| undefined;
			const text =
				details && ("progress" in details || "status" in details)
					? toolDisplay(details, expanded)
					: result.content
							.filter((block) => block.type === "text")
							.map((block) => block.text)
							.join("\n");
			return new Text(text, 0, 0);
		},
	});

	pi.registerCommand("jev-browser", {
		description: "Drive a browser to answer a request in plain language",
		handler: async (args, ctx) => {
			const request = args.trim();
			if (!request) {
				ctx.ui.notify("Usage: /jev-browser <what you want>", "warning");
				return;
			}

			// Use Pi's normal tool lifecycle: inline updates, persisted results,
			// cancellation, and an assistant turn after the tool finishes. The
			// browser worker still receives only its own isolated planning prompts.
			pi.sendUserMessage(
				`Use jev_browser (headless) for this request:\n${request}\n\n` +
					"After the tool returns, answer the request using its evidence. " +
					"If blocked, explain what is missing or ask its blocking question; " +
					"do not claim completion or silently repeat the same failed run.",
				{ deliverAs: "followUp" },
			);
		},
	});
}
