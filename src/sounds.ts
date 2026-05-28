import { spawn } from "node:child_process";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getPiPermissionSystemRuntimeApi } from "pi-permission-system";

const FINISHED_SOUND = "/System/Library/Sounds/Glass.aiff";
const INPUT_NEEDED_SOUND = "/System/Library/Sounds/Ping.aiff";
const INPUT_NEEDED_COOLDOWN_MS = 1_000;

let lastInputNeededSoundAt = 0;

function playSound(path: string): void {
	const child = spawn("afplay", [path], {
		detached: true,
		stdio: "ignore",
	});

	child.unref();
}

function playInputNeededSound(): void {
	const now = Date.now();
	// Parallel or batched tool calls can trigger multiple permission prompts in
	// quick succession. Suppress duplicate pings for the same "needs input" moment.
	if (now - lastInputNeededSoundAt < INPUT_NEEDED_COOLDOWN_MS) return;

	lastInputNeededSoundAt = now;
	playSound(INPUT_NEEDED_SOUND);
}

function isYoloMode(): boolean {
	return getPiPermissionSystemRuntimeApi()?.getYoloMode() ?? false;
}

export function registerSounds(pi: ExtensionAPI): void {
	// Pi lifecycle equivalent of Claude Code's Stop hook.
	pi.on("agent_end", () => {
		playSound(FINISHED_SOUND);
	});

	// Pi has no global "UI prompt opened" hook. Register this before the
	// permission system so permission-gated tool calls ping before its select()
	// dialog waits for user input.
	pi.on("tool_call", () => {
		if (isYoloMode()) return;
		playInputNeededSound();
	});
}
