/**
 * Unit tests for the observation and candidate rules. The snapshots here are
 * trimmed but otherwise verbatim shapes produced by playwright-cli.
 */

import { describe, expect, test } from "bun:test";
import { buildActions } from "./actions";
import { hasOpenChoiceList, observe } from "./observe";
import type { BrowserElement, KnownFact, Observation } from "./types";

const FLIGHT_FORM = `- generic [ref=e93]:
  - search "Flight" [ref=e99]:
    - combobox "Change ticket type. Round trip" [ref=e107]:
      - generic: Round trip
    - generic [ref=e135]:
      - combobox "Where from?" [ref=e136]: Zagreb
      - combobox "Where to?" [ref=e147]
    - generic [ref=e159]:
      - textbox [ref=e166]:
        - /placeholder: Departure
  - button [ref=e743]:
    - img [ref=e177]
    - generic [ref=e179]: Search
`;

const OPEN_SUGGESTIONS = `- search "Flight" [ref=e99]:
  - combobox "Where else?" [ref=e147]: Split
  - listbox [ref=e150]:
    - option "Split" [ref=e151]
    - option "Split Airport (SPU)" [ref=e152]
`;

function element(overrides: Partial<BrowserElement>): BrowserElement {
	return {
		id: "e1",
		role: "combobox",
		name: "Where to?",
		context: "",
		value: "",
		states: [],
		ref: "r1",
		canClick: true,
		canFill: true,
		options: [],
		...overrides,
	};
}

function observation(overrides: Partial<Observation>): Observation {
	return {
		fingerprint: "f",
		text: "",
		elements: [],
		openLists: [],
		...overrides,
	};
}

const FACTS: KnownFact[] = [
	{ name: "origin", value: "Zagreb", source: "user", confidence: 1 },
	{ name: "destination", value: "Split", source: "user", confidence: 1 },
	{
		name: "departure date",
		value: "28 September 2026",
		source: "inference",
		confidence: 0.9,
	},
];

describe("observe", () => {
	test("reads the form, names a control by its placeholder, and drops containers", () => {
		const page = observe(FLIGHT_FORM);
		const names = page.elements.map((entry) => `${entry.role}:${entry.name}`);

		expect(names).toContain("textbox:Departure");
		expect(names).toContain("button:Search");
		// A combobox with children is a picker, not something to type into.
		expect(
			page.elements.find((e) => e.name === "Change ticket type. Round trip")
				?.canFill,
		).toBe(false);
		expect(page.elements.find((e) => e.name === "Where to?")?.canFill).toBe(
			true,
		);
		// Containers stay out of the action space.
		expect(names.some((name) => name.startsWith("search:"))).toBe(false);
		expect(names.some((name) => name.startsWith("generic:"))).toBe(false);
	});

	test("reports an open choice list", () => {
		const page = observe(OPEN_SUGGESTIONS);

		expect(hasOpenChoiceList(page)).toBe(true);
		expect(page.openLists[0]).toContain("Split Airport (SPU)");
		// The listbox itself is a container; its options are the targets.
		expect(page.elements.map((e) => e.name)).toContain("Split Airport (SPU)");
		expect(page.elements.map((e) => e.role)).not.toContain("listbox");
	});

	test("names an unnamed control by its container instead of dropping it", () => {
		const page = observe(`- search "Flight" [ref=e99]:
  - combobox [ref=e725]
`);
		const [control] = page.elements;

		expect(control?.name).toBe("");
		expect(control?.context).toBe('search "Flight"');
	});

	test("ignores a container whose name is a paragraph of concatenated content", () => {
		const page =
			observe(`- table "a | b | c | d | e | f | g | h | i | j | k | l | m | n | o | p | q | r" [ref=e1]:
  - row [ref=e2]:
    - cell [ref=e3]
`);

		expect(page.elements).toHaveLength(0);
	});

	test("fingerprints the page so stale decisions can be rejected", () => {
		expect(observe(FLIGHT_FORM).fingerprint).not.toBe(
			observe(OPEN_SUGGESTIONS).fingerprint,
		);
	});
});

describe("buildActions", () => {
	test("pairs each editable field with each value that is not on the page", () => {
		const page = observe(FLIGHT_FORM);
		const actions = buildActions({
			observation: page,
			facts: FACTS,
			ineffective: new Set(),
		});
		const fills = actions.filter((action) => action.kind === "fill");
		const descriptions = fills.map((action) => action.description);

		// The origin is already shown in its field, so it is not offered again.
		expect(fills.some((action) => action.value === "Zagreb")).toBe(false);
		expect(
			descriptions.some(
				(text) => text.includes('"Split"') && text.includes('"Where to?"'),
			),
		).toBe(true);
		expect(
			descriptions.some(
				(text) =>
					text.includes('"28 September 2026"') && text.includes('"Departure"'),
			),
		).toBe(true);
	});

	test("offers only the choices while a choice list is open", () => {
		const page = observe(OPEN_SUGGESTIONS);
		const actions = buildActions({
			observation: page,
			facts: FACTS,
			ineffective: new Set(),
		});

		expect(actions.some((action) => action.kind === "fill")).toBe(false);
		expect(
			actions
				.filter((action) => action.kind === "click")
				.map((action) => action.description),
		).toEqual(['Click option "Split"', 'Click option "Split Airport (SPU)"']);
	});

	test("classifies consequential actions as high risk", () => {
		const page = observation({
			elements: [
				element({ id: "e1", name: "Book with Croatia Airlines" }),
				element({ id: "e2", name: "Search" }),
			],
		});
		const actions = buildActions({
			observation: page,
			facts: [],
			ineffective: new Set(),
		});

		expect(
			actions.find((action) => action.description.includes("Book"))?.risk,
		).toBe("high");
		expect(
			actions.find((action) => action.description.includes("Search"))?.risk,
		).toBe("low");
	});

	test("stops offering an action that has failed twice", () => {
		const page = observation({ elements: [element({ id: "e7" })] });
		const actions = buildActions({
			observation: page,
			facts: [],
			ineffective: new Set(["click:e7"]),
		});

		expect(actions.some((action) => action.id === "click:e7")).toBe(false);
	});

	test("always leaves an escape hatch available", () => {
		const actions = buildActions({
			observation: observation({}),
			facts: [],
			ineffective: new Set(),
		});

		expect(actions.map((action) => action.id)).toEqual([
			"scroll:down",
			"scroll:up",
			"wait",
		]);
	});
});
