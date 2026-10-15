import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Workaround for pi-permission-system 0.8.0: on `before_agent_start` it calls
 * `setActiveTools()` with every registered tool it does not deny, which activates tools
 * Pi keeps inactive (codemode-only MCP tools, grep, find, ls, powershell, tool_search).
 *
 * We remember the active tools before each run and, after the permission system's
 * handler (this extension loads later), drop whatever it added. Tools it removed
 * (denied) stay removed.
 */
export function registerPermissionToolsFix(pi: ExtensionAPI): void {
	let beforeRun: string[] = [];
	const remember = () => {
		beforeRun = pi.getActiveTools();
	};

	pi.on("session_start", remember);
	pi.on("session_tree", remember);
	// `input` precedes user-started runs; `agent_end` covers runs started without input
	// and keeps tools loaded during a run (e.g. by web_enable).
	pi.on("input", () => {
		remember();
		return { action: "continue" };
	});
	pi.on("agent_end", remember);

	pi.on("before_agent_start", () => {
		const active = pi.getActiveTools();
		const restored = beforeRun.filter((name) => active.includes(name));
		if (restored.length !== active.length) pi.setActiveTools(restored);
	});
}
