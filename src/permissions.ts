import {
	existsSync,
	lstatSync,
	mkdirSync,
	readlinkSync,
	symlinkSync,
	unlinkSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import {
	getPiPermissionSystemRuntimeApi,
	type YoloModeControlResult,
} from "pi-permission-system";

const EXTENSION_NAME = "pi-personal-ext";
const YOLO_SHORTCUT = "ctrl+shift+y";
const EXTENSION_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_POLICY_PATH = join(EXTENSION_ROOT, "pi-permissions.jsonc");
const TARGET_POLICY_PATH = join(getAgentDir(), "pi-permissions.jsonc");

function getYoloMode(): boolean {
	return getPiPermissionSystemRuntimeApi()?.getYoloMode() ?? false;
}

function yoloApiUnavailableResult(): YoloModeControlResult {
	return {
		yoloMode: false,
		changed: false,
		persisted: false,
		error: "pi-permission-system runtime API is unavailable.",
	};
}

function setYoloMode(enabled: boolean): YoloModeControlResult {
	const api = getPiPermissionSystemRuntimeApi();
	if (!api) return yoloApiUnavailableResult();

	return api.setYoloMode(enabled, {
		persist: true,
		source: EXTENSION_NAME,
	});
}

function toggleYoloMode(): YoloModeControlResult {
	const api = getPiPermissionSystemRuntimeApi();
	if (!api) return yoloApiUnavailableResult();

	return setYoloMode(!api.getYoloMode());
}

function notifyYoloMode(ctx: ExtensionContext, yoloMode: boolean): void {
	ctx.ui.notify(
		yoloMode
			? "🔓 YOLO mode ON — ask rules auto-approved"
			: "🔒 Safe mode ON — ask rules will prompt",
		"info",
	);
}

function handleYoloShortcut(ctx: ExtensionContext): void {
	const result = toggleYoloMode();
	if (result.error) {
		ctx.ui.notify(`Failed to toggle YOLO mode: ${result.error}`, "error");
		return;
	}

	notifyYoloMode(ctx, result.yoloMode);
}

function registerYoloShortcut(pi: ExtensionAPI): void {
	pi.registerShortcut(YOLO_SHORTCUT, {
		description: "Toggle permission YOLO mode (skip ask / ask)",
		handler: handleYoloShortcut,
	});
}

function resolveLinkTarget(linkPath: string): string {
	return resolve(dirname(TARGET_POLICY_PATH), linkPath);
}

function ensurePermissionPolicySymlink(ctx?: ExtensionContext): void {
	try {
		mkdirSync(dirname(TARGET_POLICY_PATH), { recursive: true });

		if (existsSync(TARGET_POLICY_PATH)) {
			const stats = lstatSync(TARGET_POLICY_PATH);
			if (stats.isSymbolicLink()) {
				const currentTargetPath = resolveLinkTarget(
					readlinkSync(TARGET_POLICY_PATH),
				);
				if (currentTargetPath === SOURCE_POLICY_PATH) {
					return;
				}

				unlinkSync(TARGET_POLICY_PATH);
			} else {
				ctx?.ui.notify(
					`Permission policy link not installed: '${TARGET_POLICY_PATH}' exists and is not a symlink.`,
					"warning",
				);
				return;
			}
		}

		symlinkSync(SOURCE_POLICY_PATH, TARGET_POLICY_PATH);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		ctx?.ui.notify(
			`Failed to ensure permission policy symlink: ${message}`,
			"error",
		);
	}
}

function registerStartupNotification(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		ensurePermissionPolicySymlink(ctx);
		ctx.ui.notify(
			`${EXTENSION_NAME} loaded! Permissions: ${getYoloMode() ? "🔓 YOLO" : "🔒 Safe"} (${YOLO_SHORTCUT} to toggle)`,
			"info",
		);
	});

	pi.on("resources_discover", (event, ctx) => {
		if (event.reason === "reload") {
			ensurePermissionPolicySymlink(ctx);
		}
	});
}

export function registerPermissionControls(pi: ExtensionAPI): void {
	ensurePermissionPolicySymlink();
	registerYoloShortcut(pi);
	registerStartupNotification(pi);
}
