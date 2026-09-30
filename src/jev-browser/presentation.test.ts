import { describe, expect, test } from "bun:test";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { registerJevBrowser } from "./index";
import { resultEvidence, toolDisplay } from "./presentation";
import type { AgentResult } from "./types";

const result: AgentResult = {
	status: "BLOCKED",
	summary: "No matching flights verified.",
	reason: "The date was not committed.",
	question: "Which departure date?",
	task: {
		objective: "Find flights",
		knownFacts: [],
		assumptions: ["One adult"],
		constraints: [],
		unresolvedQuestions: [],
		subgoals: [],
		completedSubgoals: [],
		successConditions: [],
		risk: "low",
	},
	attempts: [],
	page: "PAGE EVIDENCE",
	timings: "TIMING DIAGNOSTICS",
	planner: "MODEL DIAGNOSTICS",
};

function harness(fail = false) {
	let command!: Parameters<ExtensionAPI["registerCommand"]>[1];
	let tool!: Parameters<ExtensionAPI["registerTool"]>[0];
	const messages: unknown[][] = [];
	const entries: unknown[][] = [];
	let runs = 0;
	const pi = {
		on() {},
		registerTool(value: typeof tool) {
			tool = value;
		},
		registerCommand(_name: string, value: typeof command) {
			command = value;
		},
		sendUserMessage(...args: unknown[]) {
			messages.push(args);
		},
		appendEntry(...args: unknown[]) {
			entries.push(args);
		},
	} as unknown as ExtensionAPI;
	registerJevBrowser(pi, async (_ctx, options) => {
		runs += 1;
		options.onProgress?.("Step 1: Click Search -> no observable change");
		if (fail) throw new Error("Browser disconnected");
		return result;
	});
	return { command, tool, messages, entries, runs: () => runs };
}

describe("Pi browser integration", () => {
	test("command enters the normal agent/tool flow rather than running in a footer", async () => {
		const h = harness();
		// No UI methods: any accidental notify/setStatus/run in this path fails.
		await h.command.handler("find flights", {} as ExtensionCommandContext);
		expect(h.runs()).toBe(0);
		expect(h.messages).toHaveLength(1);
		expect(h.messages[0][0]).toContain("Use jev_browser (headless)");
		expect(h.messages[0][0]).toContain("find flights");
		expect(h.messages[0][0]).toContain("After the tool returns, answer");
		expect(h.messages[0][1]).toEqual({ deliverAs: "followUp" });
	});

	test("tool streams inline and returns evidence plus persisted diagnostics without terminating the turn", async () => {
		const h = harness();
		const updates: unknown[] = [];
		const output = await h.tool.execute(
			"call",
			{ request: "find flights" },
			undefined,
			(update) => updates.push(update),
			{} as ExtensionContext,
		);
		expect(updates).toHaveLength(1);
		expect(output.details).toEqual({
			result,
			progress: ["Step 1: Click Search -> no observable change"],
		});
		expect(output.content).toEqual([
			{ type: "text", text: resultEvidence(result) },
		]);
		expect(output.terminate).not.toBe(true);
	});

	test("errors preserve the trace and remain failed tool calls", async () => {
		const h = harness(true);
		await expect(
			h.tool.execute(
				"call",
				{ request: "find flights" },
				undefined,
				undefined,
				{} as ExtensionContext,
			),
		).rejects.toThrow("Browser disconnected");
		expect(h.entries).toEqual([
			[
				"jev-browser-error",
				{
					request: "find flights",
					progress: ["Step 1: Click Search -> no observable change"],
					error: "Browser disconnected",
				},
			],
		]);
	});
});

describe("browser output", () => {
	test("replays results saved before the inline UI change", () => {
		expect(toolDisplay(result, false)).toContain("BLOCKED");
		expect(toolDisplay(result, true)).toContain("PAGE EVIDENCE");
	});

	test("collapsed output shows the blocker, not raw page/timing dumps", () => {
		const text = toolDisplay({ result, progress: [] }, false);
		expect(text).toContain("BLOCKED");
		expect(text).toContain(result.reason as string);
		expect(text).toContain(result.question as string);
		expect(text).not.toContain("PAGE EVIDENCE");
		expect(text).not.toContain("DIAGNOSTICS");
	});

	test("expanded output retains diagnostics and page evidence", () => {
		const text = toolDisplay({ result, progress: ["Step 1: click"] }, true);
		expect(text).toContain("PAGE EVIDENCE");
		expect(text).toContain("TIMING DIAGNOSTICS");
		expect(text).toContain("Step 1: click");
	});

	test("partial output keeps recent progress without probability spam", () => {
		const progress = Array.from({ length: 8 }, (_, i) => `Step ${i}: clicked`);
		progress.push("Step 9: decision click:e1 p=0.2 margin=0.1");
		const text = toolDisplay({ progress }, false);
		expect(text.split("\n")).toHaveLength(5);
		expect(text).not.toContain("decision");
		expect(text).toContain("Step 7: clicked");
	});

	test("model gets evidence and assumptions, not the profiling dump", () => {
		const text = resultEvidence(result);
		expect(text).toContain("PAGE EVIDENCE");
		expect(text).toContain("One adult");
		expect(text).toContain("BLOCKED");
		expect(text).not.toContain("DIAGNOSTICS");
	});
});
