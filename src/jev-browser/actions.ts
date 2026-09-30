/**
 * Candidate generation: the finite set of atomic actions that are executable
 * against the page right now. The set is derived from live state, never from a
 * hand-written list of website workflows.
 *
 * Fill candidates pair one editable control with one known fact, so a single
 * choice carries both the field and the value. Splitting them into two questions
 * is what lets a model pair an origin with a date field.
 */

import type {
	BrowserAction,
	BrowserElement,
	KnownFact,
	Observation,
	Risk,
} from "./types";

/** Jev rejects questions with more than 254 choices; stay clear of the edge. */
const MAX_ACTIONS = 235;

/** Actions that commit money, destroy data, or speak to the outside world. */
const HIGH_RISK =
	/\b(book|buy|purchase|pay|payment|checkout|check out|place order|order now|subscribe|delete|remove|unsubscribe|transfer|withdraw|send)\b/i;

/** Actions that persist or commit something, but are ordinary and expected. */
const MEDIUM_RISK = /\b(save|apply|submit|confirm|agree|authorize)\b/i;

const COLLECTION_ROLES = new Set([
	"cell",
	"columnheader",
	"gridcell",
	"row",
	"rowheader",
]);

/** Items inside an open choice list: the only things worth clicking then. */
const CHOICE_ITEM_ROLES = new Set([
	"menuItem",
	"menuitem",
	"menuitemcheckbox",
	"menuitemradio",
	"option",
	"treeitem",
]);

export function classifyRisk(name: string): Risk {
	if (HIGH_RISK.test(name)) return "high";
	if (MEDIUM_RISK.test(name)) return "medium";

	return "low";
}

function describeElement(element: BrowserElement): string {
	const held = element.value ? ` (currently "${element.value}")` : "";

	return `${element.role} "${element.name}"${held}`;
}

/** Values the page already holds, so they are not offered again. */
export function valuesOnPage(observation: Observation): Set<string> {
	return new Set(
		observation.elements
			.map((element) => element.value)
			.filter((value) => value.length > 0),
	);
}

export function unplacedFacts(
	facts: KnownFact[],
	observation: Observation,
): KnownFact[] {
	const placed = valuesOnPage(observation);

	return facts.filter((fact) => !placed.has(fact.value));
}

export function buildActions({
	observation,
	facts,
	ineffective,
}: {
	observation: Observation;
	facts: KnownFact[];
	ineffective: Set<string>;
}): BrowserAction[] {
	const pending = unplacedFacts(facts, observation);
	const ranked: { action: BrowserAction; priority: number }[] = [];

	function offer(action: BrowserAction, priority: number): void {
		if (ineffective.has(action.id)) return;
		ranked.push({ action, priority });
	}

	// While a choice list is open, the page is waiting for a choice, and anything
	// else loses the list without committing what it belonged to: typing moves
	// focus away, and a click elsewhere dismisses it. Both leave the field the
	// list was serving unset, which then blocks everything that depends on it.
	const choosing = observation.openLists.length > 0;

	for (const element of observation.elements) {
		if (choosing && !CHOICE_ITEM_ROLES.has(element.role)) continue;

		if (element.canClick) {
			offer(
				{
					id: `click:${element.id}`,
					kind: "click",
					description: `Click ${describeElement(element)}`,
					risk: classifyRisk(element.name || element.context),
					ref: element.ref,
				},
				COLLECTION_ROLES.has(element.role) ? 2 : 1,
			);
		}

		if (element.canFill && !choosing) {
			for (const fact of pending) {
				if (element.value === fact.value) continue;

				offer(
					{
						id: `fill:${element.id}:${fact.name}`,
						kind: "fill",
						description:
							`Type "${fact.value}" into ${describeElement(element)}` +
							` (${fact.name})`,
						risk: classifyRisk(element.name || element.context),
						ref: element.ref,
						value: fact.value,
					},
					0,
				);
			}
		}

		// Native selects expose options without refs, so the option cannot be
		// clicked and the control itself has to be told what to select.
		const unreferenced = choosing
			? []
			: element.options.filter((option) => !option.ref);
		for (const option of unreferenced) {
			offer(
				{
					id: `select:${element.id}:${option.name}`,
					kind: "select",
					description: `Select "${option.name}" in ${describeElement(element)}`,
					risk: classifyRisk(option.name),
					ref: element.ref,
					value: option.name,
				},
				1,
			);
		}
	}

	const actions = ranked
		.sort((left, right) => left.priority - right.priority)
		.slice(0, MAX_ACTIONS - 3)
		.map((entry) => entry.action);

	const always: BrowserAction[] = [
		{
			id: "scroll:down",
			kind: "scroll",
			description: "Scroll down to bring more of the page into view",
			risk: "low",
			direction: "down",
		},
		{
			id: "scroll:up",
			kind: "scroll",
			description: "Scroll up to bring earlier page content into view",
			risk: "low",
			direction: "up",
		},
		{
			id: "wait",
			kind: "wait",
			description: "Wait briefly for the page to finish updating",
			risk: "low",
		},
	];

	return [
		...actions,
		...always.filter((action) => !ineffective.has(action.id)),
	];
}
