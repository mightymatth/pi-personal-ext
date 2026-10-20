import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function registerCode(pi: ExtensionAPI): void {
	pi.registerCommand("code", {
		description: "Open the current project or worktree in VS Code",
		handler: async (_args, ctx) => {
			try {
				const result = await pi.exec("code", [ctx.cwd], {
					timeout: 10_000,
				});
				if (result.killed || result.code !== 0) {
					throw new Error(
						result.stderr.trim() ||
							result.stdout.trim() ||
							"VS Code failed to open or timed out.",
					);
				}
				ctx.ui.notify(`Opened in VS Code: ${ctx.cwd}`, "info");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(
					`Could not open VS Code: ${message}\nEnsure 'code' is on PATH. On macOS, run "Shell Command: Install 'code' command in PATH" from VS Code's command palette.`,
					"error",
				);
			}
		},
	});
}
