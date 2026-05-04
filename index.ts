/**
 * pi-personal-ext
 *
 * Your personal pi coding agent extension.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerPermissionControls } from "./permissions.js";

export default function (pi: ExtensionAPI) {
	registerPermissionControls(pi);
}
