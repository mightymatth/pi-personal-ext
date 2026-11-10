import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import * as childProcess from "node:child_process";

import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import { registerSounds } from "./sounds";

const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
const terminalId = process.env.HC_TERMINAL_ID;

beforeEach(() => {
	Object.defineProperty(process, "platform", { value: "darwin" });
	delete process.env.HC_TERMINAL_ID;
});

afterEach(() => {
	mock.restore();
	Object.defineProperty(process, "platform", platform);
	if (terminalId === undefined) delete process.env.HC_TERMINAL_ID;
	else process.env.HC_TERMINAL_ID = terminalId;
});

test("unsupported platforms register no sound hooks", () => {
	for (const platform of ["linux", "win32"]) {
		Object.defineProperty(process, "platform", { value: platform });
		expect(setup().on).not.toHaveBeenCalled();
	}
});

test("no sound hooks inside Herdr", () => {
	process.env.HC_TERMINAL_ID = "t14";
	expect(setup().on).not.toHaveBeenCalled();
});

test("headless modes never play sounds", () => {
	const { fire, spawn } = setup();
	for (const mode of ["rpc", "json", "print"] as const) {
		fire("agent_end", mode);
		fire("ui_prompt_start", mode);
	}
	expect(spawn).not.toHaveBeenCalled();
});

test("interactive macOS plays finish sounds and throttles input sounds", () => {
	const { fire, spawn } = setup();
	const now = Date.now() + 10_000;
	const clock = spyOn(Date, "now").mockReturnValue(now);
	fire("agent_end", "tui");
	fire("ui_prompt_start", "tui");
	fire("ui_prompt_start", "tui");
	expect(spawn.mock.calls.map((call) => call[1])).toEqual([
		["/System/Library/Sounds/Glass.aiff"],
		["/System/Library/Sounds/Ping.aiff"],
	]);
	clock.mockReturnValue(now + 1_000);
	fire("ui_prompt_start", "tui");
	expect(spawn).toHaveBeenCalledTimes(3);
});

function setup() {
	const hooks = new Map<
		string,
		(event: unknown, ctx: ExtensionContext) => void
	>();
	const child = { on: mock(), unref: mock() };
	const spawn = spyOn(childProcess, "spawn").mockReturnValue(
		child as unknown as ReturnType<typeof childProcess.spawn>,
	);
	const on = mock(
		(
			name: string,
			handler: (event: unknown, ctx: ExtensionContext) => void,
		) => {
			hooks.set(name, handler);
		},
	);
	registerSounds({ on } as unknown as ExtensionAPI);
	return {
		on,
		spawn,
		fire(name: string, mode: ExtensionContext["mode"]) {
			const handler = hooks.get(name);
			if (!handler) throw new Error(`Missing hook: ${name}`);
			handler({}, { mode } as ExtensionContext);
		},
	};
}
