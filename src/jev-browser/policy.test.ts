/** Cycle detection, which is what stops a run from looping without progress. */

import { describe, expect, test } from "bun:test";
import { coverFacts } from "./agent";
import { findCycle } from "./policy";

describe("cycle detection", () => {
	test("finds the repeating block of a longer cycle", () => {
		expect(findCycle(["a", "b", "c", "a", "b", "c"])).toEqual(["a", "b", "c"]);
		expect(findCycle(["x", "a", "b", "a", "b"])).toEqual(["a", "b"]);
	});

	test("does not fire on ordinary progress", () => {
		expect(findCycle(["a", "b", "c", "d", "e", "f"])).toEqual([]);
		expect(findCycle(["a", "b"])).toEqual([]);
	});
});

describe("plan coverage", () => {
	const page = {
		fingerprint: "f",
		text: "Where from? Zagreb",
		elements: [
			{
				id: "e1",
				role: "combobox",
				name: "Where from?",
				context: "",
				value: "Zagreb",
				states: [],
				ref: "r1",
				canClick: true,
				canFill: true,
				options: [],
			},
		],
		openLists: [],
	};

	test("adds a subgoal for a required value the page does not show", () => {
		const subgoals = coverFacts(
			["Set the route", "View results"],
			[
				{
					name: "trip type",
					value: "One-way",
					source: "inference",
					confidence: 1,
				},
				{ name: "origin", value: "Zagreb", source: "user", confidence: 1 },
			],
			page,
		);

		// The origin is already on the page; the trip type is not, and nothing in
		// the plan set it, so it is set first.
		expect(subgoals).toEqual([
			"Set trip type to One-way",
			"Set the route",
			"View results",
		]);
	});

	test("leaves a plan that already covers its facts alone", () => {
		const subgoals = coverFacts(
			["Set trip type to One-way"],
			[
				{
					name: "trip type",
					value: "One-way",
					source: "inference",
					confidence: 1,
				},
			],
			page,
		);

		expect(subgoals).toEqual(["Set trip type to One-way"]);
	});
});
