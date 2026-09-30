/**
 * pi-personal-ext
 *
 * Your personal pi coding agent extension.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerPermissionControls } from "./src/permissions";
import { registerProviderStatus } from "./src/provider-status/index";
import { registerSounds } from "./src/sounds";
import { registerSystemPrompt } from "./src/system-prompt";

// Suppress MCP App windows; MCP tool results remain available inline.
process.env.MCP_UI_VIEWER = "none";

export default function (pi: ExtensionAPI) {
	// Auto-discovery under extensions/ does not load package skills or prompts.
	const root = dirname(fileURLToPath(import.meta.url));
	pi.on("resources_discover", () => ({
		skillPaths: [join(root, "skills")],
		promptPaths: [join(root, "prompts")],
	}));

	pi.on("session_start", (_event, ctx) => {
		if (!pi.getAllTools().some((tool) => tool.name === "codemode")) {
			ctx.ui.notify(
				"Codemode is unavailable. Enable builtin:codemode or update Pi.",
				"warning",
			);
			return;
		}
		const tools = pi.getActiveTools();
		if (!tools.includes("codemode")) pi.setActiveTools([...tools, "codemode"]);
	});

	registerSystemPrompt(pi);
	registerSounds(pi);
	registerPermissionControls(pi);
	registerProviderStatus(pi);
}
