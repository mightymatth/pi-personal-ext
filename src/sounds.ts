import { spawn } from "node:child_process";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const FINISHED_SOUND = "/System/Library/Sounds/Glass.aiff";
const INPUT_NEEDED_SOUND = "/System/Library/Sounds/Ping.aiff";
const INPUT_NEEDED_COOLDOWN_MS = 1_000;

let lastInputNeededSoundAt = 0;

function playSound(path: string): void {
	if (process.platform !== "darwin") return;
	const child = spawn("afplay", [path], {
		detached: true,
		stdio: "ignore",
	});
	child.on("error", () => {});
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

export function registerSounds(pi: ExtensionAPI): void {
	// Pi lifecycle equivalent of Claude Code's Stop hook.
	pi.on("agent_end", () => {
		playSound(FINISHED_SOUND);
	});

	pi.on("ui_prompt_start", playInputNeededSound);
}
