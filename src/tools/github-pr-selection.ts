import { createHash } from "node:crypto";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function readPatch(patch: string, side: string): Map<number, string> {
	const lines = new Map<number, string>();
	const isLeftSide = side === "L";
	const selectedPrefix = isLeftSide ? "-" : "+";
	let lineNumber = 0;

	for (const line of patch.split("\n")) {
		const hunkHeader = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);

		if (hunkHeader) {
			const [, oldStart, newStart] = hunkHeader;
			lineNumber = Number(isLeftSide ? oldStart : newStart);
			continue;
		}

		if (lineNumber === 0) {
			continue;
		}

		const isContextLine = line.startsWith(" ");
		const isSelectedChange = line.startsWith(selectedPrefix);

		if (!isContextLine && !isSelectedChange) {
			continue;
		}

		lines.set(lineNumber, line.slice(1));
		lineNumber++;
	}

	return lines;
}

export function registerGithubPrSelection(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "github_pr_selection",
		label: "GitHub PR selection",
		description:
			"Read a file patch or selected lines from a GitHub PR changes URL, with optional surrounding context. Uses authenticated gh CLI and the current PR diff.",
		parameters: Type.Object({
			url: Type.String({
				description:
					"GitHub PR changes URL with a file anchor or selected lines",
			}),
			context: Type.Optional(
				Type.Integer({
					minimum: 0,
					default: 0,
					description: "Extra lines above and below",
				}),
			),
		}),
		async execute(_id, { url, context = 0 }, signal) {
			const link = new URL(url);
			const path = /^\/([^/]+\/[^/]+)\/pull\/(\d+)\/changes$/.exec(
				link.pathname,
			);
			const anchor =
				/^#diff-([a-f0-9]{64})(?:([LR])(\d+)(?:-([LR])(\d+))?)?$/.exec(
					link.hash,
				);

			if (link.origin !== "https://github.com" || !path || !anchor) {
				throw new Error(
					"Expected a GitHub PR changes URL with a file anchor or selected lines.",
				);
			}

			const [, repo, pr] = path;
			const [, hash, side, first, endSide, last] = anchor;
			const start = Number(first);
			const end = Number(last ?? first);
			const from = Math.max(1, start - context);
			const to = end + context;

			if (
				!Number.isSafeInteger(context) ||
				context < 0 ||
				(side &&
					(!Number.isSafeInteger(start) ||
						!Number.isSafeInteger(to) ||
						start < 1 ||
						end < start ||
						(endSide && side !== endSide)))
			) {
				throw new Error(
					"Invalid selection or context; the range must stay on one side.",
				);
			}

			const result = await pi.exec(
				"gh",
				[
					"api",
					`repos/${repo}/pulls/${pr}/files?per_page=100`,
					"--paginate",
					"--slurp",
				],
				{ signal, timeout: 30_000 },
			);

			if (result.killed || result.code !== 0) {
				throw new Error(
					result.stderr.trim() || "gh api failed or was cancelled",
				);
			}

			const pages: {
				filename: string;
				previous_filename?: string;
				patch?: string;
			}[][] = JSON.parse(result.stdout);

			const file = pages
				.flat()
				.find(
					({ filename }) =>
						createHash("sha256").update(filename).digest("hex") === hash,
				);

			if (!file) {
				throw new Error("Selected file not found in the current PR diff.");
			}

			if (!side) {
				if (!file.patch) {
					throw new Error("No patch available for the selected file.");
				}

				return {
					content: [{ type: "text", text: `${file.filename}\n${file.patch}` }],
					details: { filename: file.filename },
				};
			}

			const filename =
				side === "L"
					? (file.previous_filename ?? file.filename)
					: file.filename;
			const patch = readPatch(file.patch ?? "", side);
			const lines: string[] = [];

			for (let n = from; n <= to; n++) {
				const line = patch.get(n);
				if (line === undefined) {
					break;
				}

				lines.push(line);
			}

			if (lines.length !== to - from + 1) {
				throw new Error("Requested lines are not available in the PR patch.");
			}

			const text = [
				`${filename} (${side}, selected ${start}–${end})`,
				...lines.map((line, i) => `${from + i}: ${line}`),
			].join("\n");

			return {
				content: [{ type: "text", text }],
				details: { filename },
			};
		},
	});
}
