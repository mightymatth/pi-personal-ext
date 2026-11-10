import { spawn } from "node:child_process";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function registerSounds(pi: ExtensionAPI): void {
	if (process.platform !== "darwin") return;
	// Herdr handles its own sounds; avoid playing them twice.
	if (process.env.HC_TERMINAL_ID) return;

	pi.on("agent_end", (_event, ctx) => {
		if (ctx.mode === "tui") playSound(Sounds.FINISHED);
	});

	pi.on("ui_prompt_start", (_event, ctx) => {
		if (ctx.mode === "tui") playSound(Sounds.INPUT_NEEDED);
	});
}

function playSound(sound: Sounds): void {
	if (sound === Sounds.INPUT_NEEDED) {
		const now = Date.now();
		// Batched permission prompts should only ping once per second.
		if (now - lastInputNeededSoundAt < 1_000) return;
		lastInputNeededSoundAt = now;
	}

	const child = spawn("afplay", [sound], {
		detached: true,
		stdio: "ignore",
	});
	child.on("error", () => {});
	child.unref();
}

enum Sounds {
	FINISHED = "/System/Library/Sounds/Glass.aiff",
	INPUT_NEEDED = "/System/Library/Sounds/Ping.aiff",
}

let lastInputNeededSoundAt = 0;
