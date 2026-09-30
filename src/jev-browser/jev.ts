/**
 * The System One decision: one local, bounded choice among actions that are
 * already executable, plus two independent yes/no reads of the same page.
 *
 * All three questions are asked in a single request on purpose. Questions in one
 * request are answered independently, so a question can never consume another
 * question's answer, and the whole step costs one round trip.
 */

import { choice, noul, type TypeSafeClient } from "@typesafe-ai/sdk";
import { Recorder } from "./metrics";
import type { BrowserAction, KnownFact, Observation, TaskState } from "./types";

export type JevDecision = {
	actionId: string;
	probability: number;
	/** How far the top choice is ahead of the runner-up. */
	margin: number;
	confidence: number;
	/** P(the current subgoal is already satisfied), from 0 to 1. */
	subgoalSatisfied: number;
	/** P(no offered action can make progress), from 0 to 1. */
	stuck: number;
};

export type JevInput = {
	task: TaskState;
	facts: KnownFact[];
	observation: Observation;
	actions: BrowserAction[];
	recentActions: string[];
	signal?: AbortSignal;
};

export type Jev = {
	decide(input: JevInput): Promise<JevDecision>;
};

type Answers = {
	nextAction: {
		choice: string;
		confidence?: number;
		probabilities?: Record<string, number>;
	};
	subgoalSatisfied: { noul: number };
	stuck: { noul: number };
};

export function createJev(
	client: TypeSafeClient,
	recorder = new Recorder(),
): Jev {
	return {
		async decide({
			task,
			facts,
			observation,
			actions,
			recentActions,
			signal,
		}: JevInput): Promise<JevDecision> {
			return recorder.measure("jev.decide", async () => {
				const result = await client.systemOne(
					{
						state: {
							objective: task.objective,
							currentSubgoal: task.subgoals[0] ?? "",
							completedSubgoals: task.completedSubgoals,
							knownFacts: facts.map((fact) => `${fact.name} = ${fact.value}`),
							constraints: task.constraints,
							assumptions: task.assumptions,
							page: { text: observation.text },
							open_lists: observation.openLists,
							recentActions,
						},
						questions: {
							nextAction: choice(
								"Choose the single executable action that most directly advances the current subgoal. If a known fact is not yet visible on the page, prefer the action that puts it there. Do not choose an action whose effect the page already shows.",
								Object.fromEntries(
									actions.map((action) => [action.id, action.description]),
								),
							),
							subgoalSatisfied: noul(
								"Is there visible evidence on the page that the current subgoal is already satisfied?",
								{
									true: "The page visibly shows the current subgoal as done.",
									false:
										"The page does not yet show the current subgoal as done.",
								},
							),
							stuck: noul(
								"Is progress toward the current subgoal impossible using only the offered actions?",
								{
									true: "None of the offered actions can advance the current subgoal.",
									false:
										"At least one offered action can still advance the current subgoal.",
								},
							),
						},
					},
					{ signal },
				);

				const answers = result.answers as unknown as Answers;
				const probabilities = answers.nextAction.probabilities ?? {};
				const ranked = Object.values(probabilities).sort(
					(left, right) => right - left,
				);
				const [top = 0, second = 0] = ranked;

				return {
					actionId: answers.nextAction.choice,
					probability: probabilities[answers.nextAction.choice] ?? 0,
					margin: top - second,
					confidence: answers.nextAction.confidence ?? 0,
					subgoalSatisfied: answers.subgoalSatisfied.noul,
					stuck: answers.stuck.noul,
				};
			});
		},
	};
}
