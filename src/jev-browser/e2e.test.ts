/**
 * End-to-end test of the same path the pi tool takes: one free-form request in,
 * a verified result out. It uses the real browser, the real System One model, and
 * the same reasoning model the session is configured with.
 *
 * Run with:
 *   bun test src/jev-browser/e2e.test.ts
 *
 * Override the reasoning model with JEV_E2E_MODEL=provider/model-id.
 */

import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
	clampThinkingLevel,
	type Model,
	type ThinkingLevel,
} from "@earendil-works/pi-ai";
import {
	ModelRegistry,
	ModelRuntime,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { runAgent } from "./agent";
import { type Browser, createPlaywrightBrowser } from "./browser";
import { createJev } from "./jev";
import { Recorder } from "./metrics";
import { createPlanner, type Reasoner } from "./planner";
import type { BrowserAction } from "./types";

const execFileAsync = promisify(execFile);
const AGENT_DIR = join(homedir(), ".pi", "agent");
const REQUEST = "find me the flights from zagreb to split on the next monday";
const START_URL = "https://www.google.com/travel/flights";

/** Models that are known to reason well, tried after the session's own choice. */
const FALLBACK_MODELS = [
	"openai-codex/gpt-5.5",
	"github-copilot/gpt-5.4",
	"opencode-go/kimi-k2.6",
];

async function typeSafeKey(): Promise<string> {
	if (process.env.TYPESAFE_API_KEY) return process.env.TYPESAFE_API_KEY;

	const { stdout } = await execFileAsync("security", [
		"find-generic-password",
		"-s",
		"pi-personal-ext.typesafe",
		"-w",
	]);

	return stdout.trim();
}

function resolveModel(registry: ModelRegistry): Model<string> {
	const settings = SettingsManager.create(
		process.cwd(),
		AGENT_DIR,
	).getGlobalSettings() as {
		enabledModels?: string[];
		defaultProvider?: string;
		defaultModel?: string;
	};

	const wanted = [
		process.env.JEV_E2E_MODEL,
		`${settings.defaultProvider}/${settings.defaultModel}`,
		...(settings.enabledModels ?? []),
		...FALLBACK_MODELS,
	].filter((id): id is string => Boolean(id));

	for (const id of wanted) {
		const slash = id.indexOf("/");
		if (slash === -1) continue;

		const model = registry.find(id.slice(0, slash), id.slice(slash + 1));
		if (model && registry.hasConfiguredAuth(model)) {
			return model as Model<string>;
		}
	}

	const available = registry.getAvailable();
	if (!available.length)
		throw new Error("No model with configured auth is available");

	return available[0] as Model<string>;
}

function createReasoner(
	registry: ModelRegistry,
	model: Model<string>,
	onCall: (shape: { system: number; user: number }) => void,
): Reasoner {
	// Same shape as production: the lowest thinking level the model supports,
	// expressed the way pi expresses it (no option at all means no thinking).
	const lowest = clampThinkingLevel(model, "off");
	const reasoning: ThinkingLevel | undefined =
		lowest === "off" ? undefined : lowest;

	return async ({ system, user, signal }) => {
		onCall({ system: system.length, user: user.length });

		const message = await registry
			.streamSimple(
				model,
				{
					systemPrompt: system,
					messages: [{ role: "user", content: user, timestamp: Date.now() }],
				},
				// The session id is what providers such as opencode require for
				// routing, and the runtime adds it to the request itself.
				{ sessionId: "jev-e2e", maxTokens: 700, reasoning, signal },
			)
			.result();

		const text = message.content
			.filter((block) => block.type === "text")
			.map((block) => block.text)
			.join("")
			.trim();

		if (!text) {
			throw new Error(
				`${model.provider}/${model.id} returned no text (stop=${message.stopReason}${message.errorMessage ? `, error=${message.errorMessage}` : ""})`,
			);
		}

		return text;
	};
}

/** Records what actually reached the browser, so the test can audit side effects. */
function recordingBrowser(
	browser: Browser,
	executed: BrowserAction[],
): Browser {
	return {
		...browser,
		async perform(action) {
			const result = await browser.perform(action);
			executed.push(action);

			return result;
		},
	};
}

function parseDateish(value: string): Date | undefined {
	const iso = new Date(value);
	if (!Number.isNaN(iso.getTime())) return iso;

	const match = value.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
	if (!match) return undefined;

	const parsed = new Date(`${match[2]} ${match[1]}, ${match[3]}`);
	return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

// Opt in with JEV_E2E=1: the run needs the network and costs real model calls.
test.skipIf(process.env.JEV_E2E !== "1")(
	"finds Zagreb to Split flights for next Monday without booking anything",
	async () => {
		const registry = new ModelRegistry(await ModelRuntime.create());
		const model = resolveModel(registry);
		// Unix socket paths are short, so the session name has to be short too.
		const session = "e2e";
		const recorder = new Recorder();
		const browser = await createPlaywrightBrowser({
			session,
			recorder: () => recorder,
		});
		const executed: BrowserAction[] = [];
		const calls: { system: number; user: number }[] = [];

		console.log(`reasoning with ${model.provider}/${model.id}`);

		let result: Awaited<ReturnType<typeof runAgent>>;
		try {
			result = await runAgent({
				recorder,
				request: REQUEST,
				url: START_URL,
				maxSteps: 50,
				deps: {
					browser: recordingBrowser(browser, executed),
					jev: createJev(
						new TypeSafeClient({ apiKey: await typeSafeKey() }),
						recorder,
					),
					planner: createPlanner(
						createReasoner(registry, model, (shape) => calls.push(shape)),
						recorder,
					),
					// No human in the loop: consequential actions must be refused.
					confirm: async () => false,
					onProgress: (event) =>
						console.log(`  ${event.step}. ${event.message}`),
				},
			});
		} finally {
			await browser.close();
		}

		console.log(
			`planner: ${model.provider}/${model.id}, ${calls.length} calls, prompts: ` +
				calls
					.map((c) => `system ${c.system} + user ${c.user} chars`)
					.join(" | ") +
				" (no tools, no pi prompt, no project files)",
		);
		console.log(`\n${result.timings}`);
		console.log(`\n${result.status}: ${result.summary}`);
		console.log(`objective: ${result.task.objective}`);
		console.log(`facts: ${JSON.stringify(result.task.knownFacts)}`);
		console.log(`assumptions: ${JSON.stringify(result.task.assumptions)}`);

		expect(result.status).toBe("DONE");
		expect(result.summary.length).toBeGreaterThan(0);

		// The result must be visible evidence of the requested search, not merely a
		// price calendar: a flight list names a stop pattern or a duration.
		expect(result.page).toContain("Zagreb");
		expect(result.page).toContain("Split");
		expect(result.page).toMatch(/€\s?\d/);
		expect(result.page).toMatch(/nonstop|\d+\s?(hr|min)\b/i);

		// "next monday" must have been resolved to a real Monday, soon.
		const dateFact = result.task.knownFacts.find((fact) =>
			/departure|date/i.test(fact.name),
		);
		expect(dateFact).toBeDefined();
		const date = parseDateish(dateFact?.value ?? "");
		expect(date).toBeDefined();
		expect(date?.getDay()).toBe(1);
		expect(date?.getTime()).toBeGreaterThan(Date.now() - 86_400_000);
		expect(date?.getTime()).toBeLessThan(Date.now() + 14 * 86_400_000);

		// Nothing consequential was allowed to reach the browser.
		expect(executed.filter((action) => action.risk === "high")).toEqual([]);
	},
	900_000,
);
