import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type ExtensionAPI,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { missingRequiredPackages } from "./setup-checks";
import { hasCopyExtension, isVSCodeInstalled } from "./vscode-extensions";

export function registerPersonalSetup(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		try {
			const missing = await missingRequiredPackages(getAgentDir());
			if ((await isVSCodeInstalled()) && !(await hasCopyExtension())) {
				missing.push("VS Code copy extension");
			}
			if (missing.length > 0) {
				ctx.ui.notify(
					`Missing: ${missing.join(", ")}. Run /personal-setup to set up.`,
					"warning",
				);
			}
		} catch (error) {
			ctx.ui.notify(
				`Setup check failed: ${error instanceof Error ? error.message : String(error)}`,
				"warning",
			);
		}
	});

	pi.registerCommand("personal-setup", {
		description: "Set up required Pi extensions and bundled VS Code extensions",
		handler: async (_args, ctx) => {
			try {
				const script = join(
					dirname(fileURLToPath(import.meta.url)),
					"..",
					"setup.ts",
				);
				const result = await pi.exec("bun", ["run", script, "--installed"], {
					timeout: 120_000,
				});
				if (result.killed || result.code !== 0) {
					throw new Error(
						result.stderr.trim() ||
							result.stdout.trim() ||
							"Setup failed or timed out",
					);
				}
				pi.sendMessage({
					customType: "personal-setup",
					content: result.stdout.trim(),
					display: true,
				});
			} catch (error) {
				ctx.ui.notify(
					`Setup failed: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
			}
		},
	});
}
