import type {
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import {
	getPiPermissionSystemRuntimeApi,
	type YoloModeControlResult,
} from "pi-permission-system";

const EXTENSION_NAME = "pi-personal-ext";
const YOLO_SHORTCUT = "ctrl+shift+y";

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

function registerStartupNotification(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		ctx.ui.notify(
			`${EXTENSION_NAME} loaded! Permissions: ${getYoloMode() ? "🔓 YOLO" : "🔒 Safe"} (${YOLO_SHORTCUT} to toggle)`,
			"info",
		);
	});
}

export function registerPermissionControls(pi: ExtensionAPI): void {
	registerYoloShortcut(pi);
	registerStartupNotification(pi);
}
