/**
 * The controller. It owns working memory, budgets, and policy, and it is the
 * only place that decides whether a step is allowed to become a side effect.
 *
 * The fast loop runs on Jev alone. The reasoning layer is re-entered only when
 * the horizon is exhausted, when progress stops, or when a decision is not
 * confident enough to execute.
 */

import { buildActions, unplacedFacts } from "./actions";
import { type Browser, type Execution, StaleTargetError } from "./browser";
import type { Jev } from "./jev";
import { Recorder } from "./metrics";
import { hasOpenChoiceList } from "./observe";
import type { Planner, PlanOutput } from "./planner";
import {
	findCycle,
	MAX_ACTION_FAILURES,
	MAX_CONSECUTIVE_FAILURES,
	MAX_QUESTIONS,
	MAX_REPLANS,
	SATISFIED_THRESHOLD,
	STUCK_THRESHOLD,
	shouldAutoExecute,
} from "./policy";
import type {
	AgentResult,
	Attempt,
	BrowserAction,
	KnownFact,
	Observation,
	ProgressEvent,
	TaskState,
} from "./types";

const DEFAULT_MAX_STEPS = 60;

export type AgentDeps = {
	browser: Browser;
	jev: Jev;
	planner: Planner;
	/** Absent when there is no human to ask; blocking questions then stop the run. */
	askUser?: (question: string) => Promise<string | undefined>;
	/** Absent means consequential actions are refused. */
	confirm?: (action: BrowserAction) => Promise<boolean>;
	onProgress?: (event: ProgressEvent) => void;
};

export type RunOptions = {
	request: string;
	deps: AgentDeps;
	/** Shared with the browser, the decision model, and the planner. */
	recorder?: Recorder;
	url?: string;
	headed?: boolean;
	maxSteps?: number;
	now?: Date;
	signal?: AbortSignal;
};

function emptyTask(objective: string): TaskState {
	return {
		objective,
		knownFacts: [],
		assumptions: [],
		constraints: [],
		unresolvedQuestions: [],
		subgoals: [],
		completedSubgoals: [],
		successConditions: [],
		risk: "low",
	};
}

/**
 * Makes sure the plan covers every value the task needs.
 *
 * A model can list a required fact and then never plan a step that sets it, and a
 * run that searches with, say, the trip type still on its default looks like it
 * worked. A fact the page does not show yet gets a subgoal of its own, prepended
 * so it is set before the steps that depend on it.
 */
export function coverFacts(
	subgoals: string[],
	facts: KnownFact[],
	observation: Observation,
): string[] {
	const additions = unplacedFacts(facts, observation)
		.filter(
			(fact) =>
				!subgoals.some((subgoal) =>
					[fact.name, fact.value].some((token) =>
						subgoal.toLowerCase().includes(token.toLowerCase()),
					),
				),
		)
		.slice(0, 2)
		.map((fact) => `Set ${fact.name} to ${fact.value}`);

	return [...additions, ...subgoals];
}

function applyPlan(
	task: TaskState,
	plan: Awaited<ReturnType<Planner["plan"]>>,
	observation: Observation,
): TaskState {
	return {
		objective: plan.objective || task.objective,
		knownFacts: plan.knownFacts.length ? plan.knownFacts : task.knownFacts,
		assumptions: plan.assumptions,
		constraints: plan.constraints,
		unresolvedQuestions: plan.unresolvedQuestions,
		subgoals: coverFacts(plan.subgoals, plan.knownFacts, observation),
		completedSubgoals: task.completedSubgoals,
		successConditions: plan.successConditions.length
			? plan.successConditions
			: task.successConditions,
		risk: plan.risk,
	};
}

function isBlank(observation: Observation): boolean {
	return (
		observation.text.trim().length === 0 && observation.elements.length === 0
	);
}

function describeNow(now: Date): string {
	return `${now.toISOString()} (local time ${now.toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" })})`;
}

function describeOutcome(
	action: BrowserAction,
	before: Observation,
	after: Observation,
): string {
	if (after.fingerprint === before.fingerprint) return "no observable change";

	if (action.value && after.text.includes(action.value)) {
		return `the page now shows "${action.value}"`;
	}

	return "the page changed";
}

export async function runAgent(options: RunOptions): Promise<AgentResult> {
	const clock = options.recorder ?? new Recorder();

	try {
		const result = await runLoop();
		return { ...result, timings: clock.report() };
	} finally {
		clock.closeStep();
	}

	async function runLoop(): Promise<Omit<AgentResult, "timings">> {
		clock.beginStep(0);
		const {
			request,
			deps,
			url,
			headed,
			maxSteps = DEFAULT_MAX_STEPS,
			now = new Date(),
			signal,
		} = options;

		const attempts: Attempt[] = [];
		const recentActions: string[] = [];
		// How often each action has produced no change for the current subgoal. An
		// action that fails twice stops being offered until the subgoal changes.
		const failures = new Map<string, number>();
		// Page states already visited for the current subgoal. Returning to one of
		// them means the current approach is not converging, whatever it looks like.
		const visited = new Set<string>();
		let previousFingerprint = "";
		let consecutiveFailures = 0;
		let replans = 0;
		let questions = 0;
		let task = emptyTask(request);

		function withheld(): Set<string> {
			return new Set(
				[...failures]
					.filter(([, count]) => count >= MAX_ACTION_FAILURES)
					.map(([id]) => id),
			);
		}

		function recordFailure(actionId: string): void {
			failures.set(actionId, (failures.get(actionId) ?? 0) + 1);
		}

		function startSubgoal(): void {
			failures.clear();
			visited.clear();
			consecutiveFailures = 0;
		}

		function progress(step: number, message: string): void {
			deps.onProgress?.({ step, message });
		}

		async function replan(
			step: number,
			reason: string,
			answer?: string,
		): Promise<void> {
			if (replans >= MAX_REPLANS) {
				progress(step, `replan budget exhausted: ${reason}`);
				return;
			}

			replans += 1;
			observation = await deps.browser.observe();
			fresh = true;
			const plan = await deps.planner.plan({
				request,
				currentDate: describeNow(now),
				page: observation.text,
				task,
				attempts: attempts
					.slice(-12)
					.map((entry) => `${entry.description} -> ${entry.result}`),
				reason,
				answer,
				signal,
			});

			task = applyPlan(task, plan, observation);
			await openPlannedStart(plan, observation, step);
			startSubgoal();
			progress(step, `replanning: ${reason}`);
		}

		// The reasoning layer picks the site; the controller opens it, and only
		// when the browser has nothing on screen, so a page already in progress is
		// never abandoned on the strength of a plan.
		async function openPlannedStart(
			plan: PlanOutput,
			observation: Observation,
			step: number,
		): Promise<void> {
			if (!plan.startUrl || !isBlank(observation)) return;

			progress(step, `opening ${plan.startUrl}`);
			await deps.browser.navigate(plan.startUrl);
		}

		await deps.browser.open(url ?? "about:blank", headed ?? false);

		let observation = await deps.browser.observe();
		// True when the page was read after the last action, so the next step does
		// not have to read it again just to decide.
		let fresh = true;
		const firstPlan = await deps.planner.plan({
			request,
			currentDate: describeNow(now),
			page: observation.text,
			signal,
		});
		task = applyPlan(task, firstPlan, observation);
		if (firstPlan.startUrl && isBlank(observation)) {
			await openPlannedStart(firstPlan, observation, 0);
			observation = await deps.browser.observe();
		}

		for (let step = 1; step <= maxSteps; step += 1) {
			clock.beginStep(step);
			if (signal?.aborted) throw new Error("Cancelled");
			if (!fresh) observation = await deps.browser.observe();
			fresh = false;

			// A page the agent has already been on for this subgoal means the current
			// approach is going in circles. Two steps that produce no change at all
			// are not that; they are handled as ordinary failures below.
			if (
				observation.fingerprint !== previousFingerprint &&
				visited.has(observation.fingerprint)
			) {
				if (replans >= MAX_REPLANS) {
					return {
						status: "BLOCKED",
						reason:
							"The page keeps returning to a state it has already been in.",
						summary: `Stopped while trying to: ${task.subgoals[0] ?? "finish the task"}`,
						task,
						attempts,
						page: observation.text,
					};
				}

				await replan(
					step,
					"The page returned to a state it has already visited for this subgoal, so the current approach is not converging.",
				);
				continue;
			}

			visited.add(observation.fingerprint);
			previousFingerprint = observation.fingerprint;

			const blocking = task.unresolvedQuestions.find(
				(question) => question.blocking,
			);
			if (blocking) {
				if (!deps.askUser) {
					return {
						status: "BLOCKED",
						reason: "The agent needs an answer it cannot safely assume.",
						question: blocking.question,
						summary: blocking.question,
						task,
						attempts,
						page: observation.text,
					};
				}
				if (questions >= MAX_QUESTIONS) {
					return {
						status: "BLOCKED",
						reason: "Too many unanswered questions.",
						question: blocking.question,
						summary: blocking.question,
						task,
						attempts,
						page: observation.text,
					};
				}

				questions += 1;
				const answer = await deps.askUser(blocking.question);
				if (!answer) {
					return {
						status: "BLOCKED",
						reason: "The user did not answer.",
						question: blocking.question,
						summary: blocking.question,
						task,
						attempts,
						page: observation.text,
					};
				}

				await replan(step, "The user answered a blocking question.", answer);
				continue;
			}

			// Horizon exhausted: the reasoning layer judges completion from evidence,
			// and only then is the task allowed to end.
			if (!task.subgoals.length) {
				const verification = await deps.planner.verify({
					task,
					page: observation.text,
					signal,
				});
				if (verification.complete) {
					return {
						status: "DONE",
						summary: verification.summary,
						task,
						attempts,
						page: observation.text,
					};
				}
				if (replans >= MAX_REPLANS) {
					return {
						status: "BLOCKED",
						reason: `Completion could not be verified: ${verification.unmet.join("; ")}`,
						summary: verification.summary,
						task,
						attempts,
						page: observation.text,
					};
				}

				await replan(
					step,
					`The objective is not complete yet. Still missing: ${verification.unmet.join("; ") || "unclear"}`,
				);
				continue;
			}

			const facts = unplacedFacts(task.knownFacts, observation);
			const actions = buildActions({
				observation,
				facts: task.knownFacts,
				ineffective: withheld(),
			});
			if (!actions.length) {
				if (replans >= MAX_REPLANS) {
					return {
						status: "BLOCKED",
						reason: "No supported action is available on this page.",
						summary: "No supported action is available on this page.",
						task,
						attempts,
						page: observation.text,
					};
				}
				await replan(step, "No supported action is available on this page.");
				continue;
			}

			const subgoal = task.subgoals[0];
			const decision = await deps.jev.decide({
				task,
				facts,
				observation,
				actions,
				recentActions: recentActions.slice(-5),
				signal,
			});

			progress(
				step,
				`decision ${decision.actionId} p=${decision.probability.toFixed(2)} margin=${decision.margin.toFixed(2)} satisfied=${decision.subgoalSatisfied.toFixed(2)} stuck=${decision.stuck.toFixed(2)}`,
			);

			if (decision.subgoalSatisfied >= SATISFIED_THRESHOLD) {
				// An open choice list means the page is waiting for a selection: a typed
				// value that merely looks right has not been committed yet. Do not
				// advance on it, resolve the list first and advance on the next step.
				if (!hasOpenChoiceList(observation)) {
					task.completedSubgoals.push(subgoal);
					task.subgoals = task.subgoals.slice(1);
					startSubgoal();
					progress(step, `subgoal reached: ${subgoal}`);
					continue;
				}

				progress(
					step,
					`subgoal looks done but a choice list is open: ${subgoal}`,
				);
			}

			if (decision.stuck >= STUCK_THRESHOLD) {
				if (replans >= MAX_REPLANS) {
					return {
						status: "BLOCKED",
						reason: `No offered action can advance "${subgoal}".`,
						summary: `Stopped while trying to: ${subgoal}`,
						task,
						attempts,
						page: observation.text,
					};
				}
				await replan(step, `No offered action can advance "${subgoal}".`);
				continue;
			}

			const action = actions.find((item) => item.id === decision.actionId);
			if (!action) {
				await replan(
					step,
					"The chosen action was not among the offered actions.",
				);
				continue;
			}

			// Consequential actions are a human decision, not a confidence threshold.
			if (action.risk === "high") {
				const approved = (await deps.confirm?.(action)) ?? false;
				if (!approved) {
					recordFailure(action.id);
					attempts.push({
						subgoal,
						actionId: action.id,
						description: action.description,
						probability: decision.probability,
						confidence: decision.confidence,
						stateChanged: false,
						result: "refused: consequential action",
					});
					progress(step, `refused consequential action: ${action.description}`);
					continue;
				}
			} else if (
				!shouldAutoExecute({
					probability: decision.probability,
					margin: decision.margin,
					risk: action.risk,
				})
			) {
				await replan(
					step,
					`The choice of "${action.description}" was not decisive enough (p=${decision.probability.toFixed(2)}, margin=${decision.margin.toFixed(2)}).`,
				);
				continue;
			}

			let execution: Execution;
			try {
				execution = await deps.browser.perform(action);
			} catch (error) {
				if (error instanceof StaleTargetError) {
					recordFailure(action.id);
					progress(step, "the target left the page; deciding again");
					continue;
				}

				const message = error instanceof Error ? error.message : String(error);
				recordFailure(action.id);
				attempts.push({
					subgoal,
					actionId: action.id,
					description: action.description,
					probability: decision.probability,
					confidence: decision.confidence,
					stateChanged: false,
					result: message,
				});
				consecutiveFailures += 1;
				progress(step, `${action.description} failed: ${message}`);
				if (
					consecutiveFailures >= MAX_CONSECUTIVE_FAILURES &&
					replans < MAX_REPLANS
				) {
					await replan(step, `Repeated execution failures: ${message}`);
				}
				continue;
			}

			const { before, after } = execution;
			const outcome = describeOutcome(action, before, after);
			const stateChanged = after.fingerprint !== before.fingerprint;
			attempts.push({
				subgoal,
				actionId: action.id,
				description: action.description,
				probability: decision.probability,
				confidence: decision.confidence,
				stateChanged,
				result: outcome,
			});
			recentActions.push(`${action.description} -> ${outcome}`);
			progress(step, `${action.description} -> ${outcome}`);
			observation = after;
			fresh = true;

			if (stateChanged) {
				consecutiveFailures = 0;
			} else {
				recordFailure(action.id);
				consecutiveFailures += 1;
				if (
					consecutiveFailures >= MAX_CONSECUTIVE_FAILURES &&
					replans < MAX_REPLANS
				) {
					await replan(step, "Repeated actions are not changing the page.");
					continue;
				}
			}

			// Going in circles needs a different set of actions, not a new plan: a
			// replan leaves the same choices on the table and the cycle resumes. Every
			// action in the cycle keeps changing the page, so the no-change rule never
			// catches them, and withholding them is what ends the loop.
			const cycle = findCycle(attempts.map((attempt) => attempt.actionId));
			if (cycle.length) {
				for (const actionId of cycle)
					failures.set(actionId, MAX_ACTION_FAILURES);
				progress(
					step,
					`actions are going in circles; withholding ${cycle.join(", ")}`,
				);
			}
		}

		const final = await deps.browser.observe();
		const verification = await deps.planner.verify({
			task,
			page: final.text,
			signal,
		});

		return {
			status: verification.complete ? "DONE" : "BLOCKED",
			reason: verification.complete
				? undefined
				: `Action budget exhausted. Still missing: ${verification.unmet.join("; ") || "unclear"}`,
			summary: verification.summary,
			task,
			attempts,
			page: final.text,
		};
	}
}
