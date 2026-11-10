import {
	type ExtensionAPI,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";

import { runSetup } from "./setup";
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
			const output: string[] = [];
			try {
				await runSetup({
					installed: true,
					log: (message) => output.push(message),
				});
				pi.sendMessage({
					customType: "personal-setup",
					content: output.join("\n"),
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
