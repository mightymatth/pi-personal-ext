import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import type {
	ExtensionAPI,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { Markdown, type MarkdownTheme } from "@earendil-works/pi-tui";
import { Marked } from "marked";

function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/g, (character) => {
		return `&#${character.charCodeAt(0)};`;
	});
}

const unstyled = (text: string): string => text;
const tableTheme: MarkdownTheme = {
	heading: unstyled,
	link: unstyled,
	linkUrl: unstyled,
	code: unstyled,
	codeBlock: unstyled,
	codeBlockBorder: unstyled,
	quote: unstyled,
	quoteBorder: unstyled,
	hr: unstyled,
	listBullet: unstyled,
	bold: unstyled,
	italic: unstyled,
	strikethrough: unstyled,
	underline: unstyled,
};

function textTable(source: string): string {
	const table = new Markdown(source, 0, 0, tableTheme);
	// Give Pi enough room to use natural widths, including wide Unicode characters.
	return table
		.render(source.length * 2)
		.map((line) => stripVTControlCharacters(line).trimEnd())
		.join("\n")
		.trim()
		.replace(/[│─┌┬┐├┼┤└┴┘]/g, (character) =>
			character === "│" ? "|" : character === "─" ? "-" : "+",
		);
}

// Never load images or interpret model-generated raw HTML during conversion.
const markdown = new Marked({
	renderer: {
		html: ({ text }) => escapeHtml(text),
		image: ({ text }) => escapeHtml(text),
		table({ raw }) {
			const grid = textTable(raw);
			return `<pre><code>${escapeHtml(grid)}</code></pre>`;
		},
		link({ href, tokens }) {
			const label = this.parser.parseInline(tokens);
			return /^(https?:|mailto:)/i.test(href)
				? `<a href="${escapeHtml(href)}">${label}</a>`
				: label;
		},
	},
});

export function markdownToHtml(text: string): string {
	// Slack discards paragraph margins; explicit empty paragraphs survive pasting.
	// Separate top-level blocks only, leaving list items and code contents intact.
	return `<!doctype html><html><head><meta charset="utf-8"><style>
body { font-family: Helvetica, Arial, sans-serif; font-size: 12pt; }
pre, code { font-family: Menlo, monospace; }
</style></head><body>${markdown
		.lexer(text)
		.map((token) => markdown.parser([token]))
		.filter((html) => html.length > 0)
		.join('<p style="margin: 0"><br></p>')}</body></html>`;
}

export function lastAssistantText(
	entries: readonly SessionEntry[],
): string | undefined {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (entry.type !== "message" || entry.message.role !== "assistant")
			continue;
		const message = entry.message;
		if (message.stopReason === "aborted" && message.content.length === 0)
			continue;
		return (
			message.content
				.filter((block) => block.type === "text")
				.map((block) => block.text)
				.join("")
				.trim() || undefined
		);
	}
	return undefined;
}

export function registerCopyRtf(pi: ExtensionAPI): void {
	pi.registerCommand("copy-rtf", {
		description: "Copy the last assistant response as rich text (macOS)",
		handler: async (_args, ctx) => {
			if (process.platform !== "darwin") {
				ctx.ui.notify("/copy-rtf currently supports macOS only.", "error");
				return;
			}
			const text = lastAssistantText(ctx.sessionManager.getBranch());
			if (!text) {
				ctx.ui.notify("No agent messages to copy yet.", "error");
				return;
			}
			let directory: string | undefined;
			try {
				directory = await mkdtemp(join(tmpdir(), "pi-copy-rtf-"));
				const htmlPath = join(directory, "message.html");
				await writeFile(htmlPath, markdownToHtml(text), { mode: 0o600 });
				const script = fileURLToPath(
					new URL("./copy-rtf.swift", import.meta.url),
				);
				const result = await pi.exec("/usr/bin/swift", [script, htmlPath], {
					timeout: 60_000,
				});
				if (result.killed || result.code !== 0) {
					throw new Error(
						result.stderr.trim() ||
							"Rich-text clipboard conversion failed or timed out.",
					);
				}
				ctx.ui.notify("Copied last agent message as rich text.", "info");
			} catch (error) {
				ctx.ui.notify(
					error instanceof Error ? error.message : String(error),
					"error",
				);
			} finally {
				if (directory) await rm(directory, { recursive: true, force: true });
			}
		},
	});
}
