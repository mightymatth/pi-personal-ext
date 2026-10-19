import { describe, expect, test } from "bun:test";

import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

import { lastAssistantText, markdownToHtml } from "./index";

function assistant(content: unknown[], stopReason = "stop"): SessionEntry {
	return {
		type: "message",
		message: { role: "assistant", content, stopReason },
	} as SessionEntry;
}

describe("rich-text copy", () => {
	test("inserts real blank paragraphs between blocks, not between list items", () => {
		const html = markdownToHtml(
			"Intro\n\n- One\n- Two\n\nConclusion\n\n[Link](https://example.com)",
		);
		const spacer = '<p style="margin: 0"><br></p>';
		expect(html.split(spacer)).toHaveLength(4);
		expect(html).toContain(`</p>\n${spacer}<ul>`);
		expect(html).toContain(`</ul>\n${spacer}<p>Conclusion</p>`);
		expect(html).toContain("<li>One</li>\n<li>Two</li>");
	});

	test("link definitions do not introduce extra blank paragraphs", () => {
		const html = markdownToHtml(
			"[Docs][docs]\n\n[docs]: https://example.com\n\nNext paragraph",
		);
		expect(html).toContain('<a href="https://example.com">Docs</a>');
		expect(html.split('<p style="margin: 0"><br></p>')).toHaveLength(2);
	});

	test("renders tables as aligned text without Markdown inside cells", () => {
		const html = markdownToHtml(
			"| Question | Answer |\n| --- | --- |\n| API | **GraphQL only** with `gh`. |\n| CLI? | [Docs](https://example.com) |",
		);
		expect(html).toContain("<pre><code>+");
		expect(html).toMatch(/\| API +\| GraphQL only with gh\. +\|/);
		expect(html).toMatch(/\| CLI\? +\| Docs +\|/);
	});

	test("sizes columns to content without wrapping and aligns Unicode correctly", () => {
		const leg = "AB123 ABC→DEF, then AB456 DEF→GHI";
		const description = "Long description ".repeat(10).trim();
		const html = markdownToHtml(`| Leg | Date | Status |
| --- | --- | --- |
| ${leg} | 1–2 Jun 2030 | Confirmed |
| 苹果 🚀 | | ${description} |`);
		const grid = html.match(/<pre><code>([\s\S]*?)<\/code><\/pre>/)?.[1] ?? "";
		const lines = grid.split("\n");
		expect(new Set(lines.map(visibleWidth)).size).toBe(1);
		expect(grid).toContain(leg);
		expect(grid).toContain(description);
		expect(grid).toContain("苹果 🚀");
	});

	test("does not interpret raw HTML, fetch images, or retain unsafe links", () => {
		const html = markdownToHtml(
			"<script>alert(1)</script>\n\n![image](https://example.com/image.png)\n\n[bad](javascript:alert%281%29)",
		);
		expect(html).not.toContain("<script>");
		expect(html).not.toContain("<img");
		expect(html).not.toContain('href="javascript:');
		expect(html).toContain("image");
	});

	test("copies only text from the last assistant message", () => {
		expect(
			lastAssistantText([
				assistant([{ type: "text", text: "old" }]),
				assistant([
					{ type: "thinking", thinking: "private" },
					{ type: "text", text: " new " },
				]),
			]),
		).toBe("new");
	});

	test("skips empty aborted messages but not tool-only assistant messages", () => {
		const previous = assistant([{ type: "text", text: "old" }]);
		expect(lastAssistantText([previous, assistant([], "aborted")])).toBe("old");
		expect(
			lastAssistantText([
				previous,
				assistant([{ type: "toolCall", name: "bash" }]),
			]),
		).toBeUndefined();
		expect(lastAssistantText([])).toBeUndefined();
	});
});
