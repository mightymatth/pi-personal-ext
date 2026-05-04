/**
 * pi-personal-ext
 *
 * Your personal pi coding agent extension.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerPermissionControls } from "./src/permissions";
import { registerSystemPrompt } from "./src/system-prompt";

export default function (pi: ExtensionAPI) {
	registerSystemPrompt(pi);
	registerPermissionControls(pi);
}
