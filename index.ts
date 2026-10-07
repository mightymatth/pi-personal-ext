/**
 * pi-personal-ext
 *
 * Your personal pi coding agent extension.
 */

import type {
	ExtensionAPI,
	McpServerConfig,
} from "@earendil-works/pi-coding-agent";
import { mcpServers } from "./config/mcp.json";
import { registerPermissionControls } from "./src/permissions";
import { registerPersonalSetup } from "./src/personal-setup";
import { registerProviderStatus } from "./src/provider-status/index";
import { registerSounds } from "./src/sounds";
import { registerSystemPrompt } from "./src/system-prompt";
import { registerGithubPrSelection } from "./src/tools/github-pr-selection";

// Suppress MCP App windows; MCP tool results remain available inline.
process.env.MCP_UI_VIEWER = "none";

export default function (pi: ExtensionAPI) {
	for (const [name, config] of Object.entries(mcpServers)) {
		pi.registerMcpServer(name, config as McpServerConfig);
	}

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

	registerPersonalSetup(pi);
	registerGithubPrSelection(pi);
	registerSystemPrompt(pi);
	registerSounds(pi);
	registerPermissionControls(pi);
	registerProviderStatus(pi);
}
