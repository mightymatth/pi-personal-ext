import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { formatCopyText } from "./format.js";

const fixturePath =
	"src/vscode-extensions/copy-file-reference/fixtures/example.js";
const fixtureLines = readFileSync(
	new URL("./fixtures/example.js", import.meta.url),
	"utf8",
).split("\n");
const messageLine = fixtureLines[1];

function selection(startLine, startCharacter, endLine, endCharacter) {
	return {
		isEmpty: startLine === endLine && startCharacter === endCharacter,
		start: { line: startLine, character: startCharacter },
		end: { line: endLine, character: endCharacter },
	};
}

describe("formatCopyText", () => {
	test("copies the cursor line", () => {
		expect(formatCopyText(fixturePath, selection(1, 10, 1, 10), "")).toBe(
			`@${fixturePath}:2`,
		);
	});

	test("treats a whole-line selection ending on the next line as one line", () => {
		expect(
			formatCopyText(fixturePath, selection(1, 0, 2, 0), `${messageLine}\n`),
		).toBe(`@${fixturePath}:2`);
	});

	test("includes a partial single-line selection as a quote", () => {
		const start = messageLine.indexOf("message");
		const end = messageLine.length - 1;
		const excerpt = messageLine.slice(start, end);

		expect(
			formatCopyText(fixturePath, selection(1, start, 1, end), excerpt),
		).toBe(`@${fixturePath}:2\n\n> ${excerpt}`);
	});

	test("removes only a selected trailing line ending from a single-line excerpt", () => {
		const start = messageLine.indexOf("message");
		const excerpt = messageLine.slice(start);

		expect(
			formatCopyText(fixturePath, selection(1, start, 2, 0), `${excerpt}\r\n`),
		).toBe(`@${fixturePath}:2\n\n> ${excerpt}`);
	});

	test("does not include an excerpt for a multi-line selection", () => {
		const selectedText = `${fixtureLines[1]}\n${fixtureLines[2]}\n`;

		expect(
			formatCopyText(fixturePath, selection(1, 0, 3, 0), selectedText),
		).toBe(`@${fixturePath}:2-3`);
	});
});
