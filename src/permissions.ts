import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function registerPermissionControls(pi: ExtensionAPI): void {
	let guarded = false;
	let approvalQueue = Promise.resolve();

	pi.on("session_start", (_event, ctx) => {
		guarded = false;
		ctx.ui.setStatus("permissions", "yolo");
	});

	pi.registerCommand("guard", {
		description: "Toggle YOLO / Guard mode (confirm dangerous bash commands)",
		handler: async (_args, ctx) => {
			guarded = !guarded;
			const mode = guarded ? "guard" : "yolo";
			ctx.ui.setStatus("permissions", mode);
			ctx.ui.notify(`${mode} mode`, "info");
		},
	});

	pi.on("tool_call", async (event, ctx) => {
		if (!guarded || event.toolName !== "bash") return;
		const command = event.input.command;
		if (typeof command !== "string") return;
		if (!DANGEROUS_COMMANDS.some((pattern) => pattern.test(command))) return;

		if (!ctx.hasUI) {
			return {
				block: true,
				reason: "Guard: dangerous bash command requires approval (no UI).",
			};
		}

		// Codemode can call bash concurrently; do not let dialogs replace each other.
		const approval = approvalQueue.then(() =>
			ctx.ui.select(`Guard: allow this bash command?\n\n${command}`, [
				"Deny",
				"Allow once",
			]),
		);
		approvalQueue = approval.then(
			() => {},
			() => {},
		);
		if ((await approval) !== "Allow once") {
			return { block: true, reason: "Guard: bash command denied by user." };
		}
	});
}

// Best-effort tripwires, not a shell parser: scripts/aliases can hide operations,
// and quoted examples can trigger approval. Scan the whole command, including chains.
const DANGEROUS_COMMANDS = [
	// Deletion, privilege changes, and disk writes.
	/(?:^|[\s/;&|(`"'])(?:rm|rmdir|unlink|shred|sudo|doas|chmod|chown|mkfs(?:\.[\w-]+)?|dd|diskutil)\b/,
	/\bfind\b[^\n;&|]*\s-delete\b/,
	/:\s*\(\s*\)\s*\{/, // Shell fork bomb.
	// Local history/worktree loss and remote git changes.
	/\bgit\s+(?:-C\s+\S+\s+)*(?:push|clean)\b/,
	/\bgit\s+(?:-C\s+\S+\s+)*reset\b[^\n;&|]*--hard\b/,
	/\bgit\s+(?:-C\s+\S+\s+)*(?:checkout|restore)\s/,
	/\bgit\s+(?:-C\s+\S+\s+)*branch\b[^\n;&|]*\s-[dD]\b/,
	/\bgit\s+(?:-C\s+\S+\s+)*stash\s+(?:drop|clear)\b/,
	// Publishing and deployment.
	/\b(?:npm|pnpm|bun)\s+(?:publish|unpublish)\b/,
	/\byarn\s+(?:npm\s+)?publish\b/,
	/\b(?:deploy|terraform\s+(?:apply|destroy)|kubectl\s+(?:apply|delete|replace)|pulumi\s+(?:up|destroy))\b/,
	// GitHub mutations, including API requests with implicit POST via fields.
	/\bgh\s+(?:pr|issue|release|repo)\s+(?:create|edit|merge|close|delete|archive|rename|transfer)\b/,
	/\bgh\s+api\b[^\n;&|]*\s(?:--method[=\s]+|-X\s*)["']?(?:POST|PUT|PATCH|DELETE)\b/,
	/\bgh\s+api\b[^\n;&|]*\s(?:-[fF]|--(?:raw-)?field(?:\s|=))/,
];
