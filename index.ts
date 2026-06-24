/**
 * pi-personal-ext
 *
 * Your personal pi coding agent extension.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerPermissionControls } from "./src/permissions";
import { registerProviderStatus } from "./src/provider-status";
import { registerSounds } from "./src/sounds";
import { registerSystemPrompt } from "./src/system-prompt";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = resolve(__dirname, "skills");

export default function (pi: ExtensionAPI) {
	registerSystemPrompt(pi);
	registerSounds(pi);
	registerPermissionControls(pi);
	registerProviderStatus(pi);

	// Register bundled skills so they appear in the agent's skill list.
	pi.on("resources_discover", async (_event, _ctx) => {
		return {
			skillPaths: [SKILLS_DIR],
		};
	});
}
