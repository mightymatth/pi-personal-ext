/**
 * Policy: budgets, thresholds, and the gates that decide whether a fast decision
 * is allowed to become a side effect.
 *
 * The numeric thresholds are placeholders. They must come from representative
 * evaluation data, not from intuition, which is why they live in one place.
 */

import type { Risk } from "./types";

/**
 * Below this, the page does not yet count as showing the subgoal as done.
 *
 * Set below the values Jev reports for work that is plainly still in progress,
 * because the two mistakes are not symmetric: a subgoal advanced too early is
 * caught by verification and replanning, while a subgoal that never advances
 * freezes the whole plan on its first step.
 */
export const SATISFIED_THRESHOLD = 0.6;

/** Above this, the fast loop stops and the reasoning layer takes over. */
export const STUCK_THRESHOLD = 0.85;

/** Consecutive actions with no observable state change before replanning. */
export const MAX_CONSECUTIVE_FAILURES = 3;

/** How often one action may change nothing before it stops being offered. */
export const MAX_ACTION_FAILURES = 2;

export const MAX_REPLANS = 6;
export const MAX_QUESTIONS = 3;

const THRESHOLDS: Record<Risk, number> = {
	low: 0.5,
	medium: 0.6,
	high: 0.99,
};

/** How far ahead the top choice must be before it is treated as a decision. */
const MIN_MARGIN = 0.15;

/**
 * Whether a choice is confident enough to execute unattended.
 *
 * Low-risk actions are not gated. Replanning instead of acting costs a reasoning
 * call and a round trip, and the next decision is drawn from the same state, so
 * the agent learns nothing and simply acts later. A wrong low-risk action costs
 * one step and is caught by state-change verification.
 *
 * The gate uses the top probability and its margin over the runner-up. Jev's own
 * `confidence` is recorded in the attempt log but not gated on: it is
 * systematically low, so gating on it turns ordinary steps into escalations.
 */
export function shouldAutoExecute({
	probability,
	margin,
	risk,
}: {
	probability: number;
	margin: number;
	risk: Risk;
}): boolean {
	if (risk === "low") return true;

	return probability >= THRESHOLDS[risk] && margin >= MIN_MARGIN;
}

// Repeat detection lives in the controller: it watches for page states it has
// already visited for the current subgoal, which covers alternating actions and
// longer cycles that an A/B check on action ids would miss.

/**
 * The block of actions the history is repeating, or an empty list.
 *
 * A cycle can be longer than two actions, and its page can look different every
 * time it comes round (prices, counters, ads), so it is detected on the actions
 * rather than on the page. Repeating an action that keeps changing the page is
 * otherwise indistinguishable from progress.
 */
export function findCycle(actionIds: string[], maxCycle = 4): string[] {
	const ids = actionIds.slice(-(maxCycle * 2));

	for (let size = 2; size <= maxCycle; size += 1) {
		if (ids.length < size * 2) continue;

		const tail = ids.slice(-size);
		const previous = ids.slice(-size * 2, -size);
		if (tail.every((id, index) => id === previous[index])) return tail;
	}

	return [];
}
