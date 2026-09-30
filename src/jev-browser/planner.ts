/**
 * The reasoning layer: interprets the free-form request, owns the generic
 * working memory, and decides what the next short planning horizon is.
 *
 * It never chooses controls and never sees element ids. That is Jev's job. It is
 * also the only place open-ended text is produced, and the only place the whole
 * task is judged complete.
 */

import { Recorder } from "./metrics";
import type { KnownFact, Risk, TaskState } from "./types";

export type Reasoner = (request: {
	system: string;
	user: string;
	signal?: AbortSignal;
}) => Promise<string>;

export type PlanOutput = {
	objective: string;
	knownFacts: KnownFact[];
	assumptions: string[];
	constraints: string[];
	unresolvedQuestions: { question: string; blocking: boolean }[];
	subgoals: string[];
	successConditions: string[];
	/** Site to open when the browser has no page yet. */
	startUrl: string;
	risk: Risk;
	done: boolean;
	summary: string;
};

export type Verification = {
	complete: boolean;
	summary: string;
	unmet: string[];
};

export type PlanInput = {
	request: string;
	currentDate: string;
	page: string;
	task?: TaskState;
	/** What the controller already tried, so a replan can avoid repeating it. */
	attempts?: string[];
	reason?: string;
	answer?: string;
	signal?: AbortSignal;
};

export type Planner = {
	plan(input: PlanInput): Promise<PlanOutput>;
	verify(input: {
		task: TaskState;
		page: string;
		signal?: AbortSignal;
	}): Promise<Verification>;
};

/**
 * Both prompts are written for output length, not for completeness of prose.
 *
 * Measured against a reasoning model: halving the input changed nothing, while
 * capping what the model writes cut a plan from 11.5s to 3.4s and a verdict from
 * 10.0s to 2.9s, because every output token costs about 20ms. Hence the explicit
 * word limits and the small, fixed JSON shapes.
 */
const SYSTEM = `Plan a browser task. Reply with one JSON object and nothing else.

{"objective":"<=12 words","knownFacts":[{"name":"<=3 words","value":"<=6 words"}],"assumptions":["<=8 words",...max 3],"unresolvedQuestions":[{"question":"<=12 words","blocking":true|false}],"subgoals":["<=10 words",...max 3],"successConditions":["<=12 words",...max 2],"startUrl":"site to open when no page is open yet, else ""","risk":"low"|"medium"|"high","done":false,"summary":""}

Rules:
- Resolve relative dates such as "next Monday" to absolute dates using the current date and timezone.
- A fact value is typed into a form field verbatim, such as "Zagreb" or "25 September 2026". Never a sentence.
- Every fact is a value the task needs. Never record what the page currently shows.
- Infer safe defaults, such as one adult, economy, one-way when no return date is given, or any airport serving a named city, instead of asking.
- Ask only when the answer changes the outcome and cannot be inferred, and then set blocking to true.
- subgoals are ordered states the page should reach, not clicks. Keep each under 10 words.
- The subgoals must cover every fact you list, so nothing the task needs is left unset.
- Set done to true only when the page already satisfies the objective, and then write summary.
- summary is the answer for the user: the concrete findings and the assumptions made. Empty unless done.
- When actions already taken are listed, plan a different route instead of repeating them.
- Never plan to buy, book, pay, or send anything unless the request demands it.`;

const VERIFY_SYSTEM = `Judge whether a browser agent finished a task, using only the visible page text. Be a skeptic: a page that merely mentions the subject is not the requested result.

Reply with one JSON object and nothing else: {"complete":true|false,"summary":"<=60 words","unmet":["<=10 words",...max 3]}

Rules:
- complete is true only when the page visibly contains the concrete result the objective asks for.
- unmet lists what is still missing when complete is false.
- summary answers the user: the concrete findings (names, times, prices, dates) and the assumptions made. Under 60 words.`;

function parseJson(text: string): Record<string, unknown> {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start === -1 || end <= start) {
		throw new Error(
			`Reasoning model did not return JSON: ${text.slice(0, 200)}`,
		);
	}

	return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
}

function asString(value: unknown, fallback = ""): string {
	return typeof value === "string" ? value.trim() : fallback;
}

function asStrings(value: unknown): string[] {
	if (!Array.isArray(value)) return [];

	return value
		.map((item) => (typeof item === "string" ? item.trim() : ""))
		.filter(Boolean);
}

function asRisk(value: unknown): Risk {
	return value === "medium" || value === "high" ? value : "low";
}

function asFacts(value: unknown): KnownFact[] {
	if (!Array.isArray(value)) return [];

	return value.flatMap((item) => {
		if (!item || typeof item !== "object") return [];

		const record = item as Record<string, unknown>;
		const name = asString(record.name);
		const factValue = asString(record.value);
		if (!name || !factValue) return [];

		const source = record.source;
		const confidence = record.confidence;

		return [
			{
				name,
				value: factValue,
				source:
					source === "user" || source === "page"
						? source
						: ("inference" as const),
				confidence:
					typeof confidence === "number" && confidence > 0 && confidence <= 1
						? confidence
						: 1,
			},
		];
	});
}

function asQuestions(
	value: unknown,
): { question: string; blocking: boolean }[] {
	if (!Array.isArray(value)) return [];

	return value.flatMap((item) => {
		if (!item || typeof item !== "object") return [];

		const record = item as Record<string, unknown>;
		const question = asString(record.question);

		return question ? [{ question, blocking: record.blocking === true }] : [];
	});
}

function taskSection(task: TaskState | undefined): string {
	if (!task)
		return "This is the first planning step; there is no working memory yet.";

	return `Working memory so far:\n${JSON.stringify(task, null, 2)}`;
}

export function createPlanner(
	reason: Reasoner,
	recorder = new Recorder(),
): Planner {
	return {
		async plan({
			request,
			currentDate,
			page,
			task,
			attempts,
			reason: replanReason,
			answer,
			signal,
		}: PlanInput): Promise<PlanOutput> {
			return recorder.measure("planner.plan", async () => {
				const parts = [
					`Request: ${request}`,
					`Current date and time: ${currentDate}`,
					taskSection(task),
				];
				if (attempts?.length) {
					parts.push(`Actions already taken:\n${attempts.join("\n")}`);
				}
				if (answer) parts.push(`Answer from the user: ${answer}`);
				if (replanReason)
					parts.push(`Why you are being asked again: ${replanReason}`);
				parts.push(`Visible page text:\n${page}`);

				const output = parseJson(
					await reason({ system: SYSTEM, user: parts.join("\n\n"), signal }),
				);

				return {
					objective: asString(output.objective, request),
					knownFacts: asFacts(output.knownFacts),
					assumptions: asStrings(output.assumptions),
					constraints: asStrings(output.constraints),
					unresolvedQuestions: asQuestions(output.unresolvedQuestions),
					subgoals: asStrings(output.subgoals),
					successConditions: asStrings(output.successConditions),
					startUrl: asString(output.startUrl),
					risk: asRisk(output.risk),
					done: output.done === true,
					summary: asString(output.summary),
				};
			});
		},

		async verify({ task, page, signal }): Promise<Verification> {
			return recorder.measure("planner.verify", async () => {
				const output = parseJson(
					await reason({
						system: VERIFY_SYSTEM,
						user: [
							`Objective: ${task.objective}`,
							`Success conditions: ${task.successConditions.join("; ") || "none stated"}`,
							`Assumptions: ${task.assumptions.join("; ") || "none"}`,
							`Visible page text:\n${page}`,
						].join("\n\n"),
						signal,
					}),
				);

				return {
					complete: output.complete === true,
					summary: asString(output.summary),
					unmet: asStrings(output.unmet),
				};
			});
		},
	};
}
