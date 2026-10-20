import { expect, mock, test } from "bun:test";

import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

import { registerCode } from "./code";

test("/code opens the exact worktree path without window flags", async () => {
	const { handler, ctx, exec, notify } = setup();

	await handler("", ctx);

	expect(exec).toHaveBeenCalledWith("code", [ctx.cwd], { timeout: 10_000 });
	expect(notify).toHaveBeenCalledWith(`Opened in VS Code: ${ctx.cwd}`, "info");
});

test("/code reports CLI failures", async () => {
	const { handler, ctx, exec, notify } = setup();
	exec.mockResolvedValue({
		code: 1,
		stdout: "",
		stderr: "Launch failed",
		killed: false,
	});

	await handler("", ctx);

	expect(notify).toHaveBeenCalledWith(
		expect.stringContaining("Launch failed"),
		"error",
	);
});

test("/code reports timeouts", async () => {
	const { handler, ctx, exec, notify } = setup();
	exec.mockResolvedValue({ code: 0, stdout: "", stderr: "", killed: true });

	await handler("", ctx);

	expect(notify).toHaveBeenCalledWith(
		expect.stringContaining("timed out"),
		"error",
	);
});

test("/code explains how to install a missing CLI", async () => {
	const { handler, ctx, exec, notify } = setup();
	exec.mockRejectedValue(new Error("spawn code ENOENT"));

	await handler("", ctx);

	expect(notify).toHaveBeenCalledWith(
		expect.stringContaining("Shell Command: Install 'code' command in PATH"),
		"error",
	);
});

function setup() {
	let command: Parameters<ExtensionAPI["registerCommand"]>[1] | undefined;
	const exec = mock(async () => ({
		code: 0,
		stdout: "",
		stderr: "",
		killed: false,
	}));
	const notify = mock();
	registerCode({
		registerCommand(
			name: string,
			options: Parameters<ExtensionAPI["registerCommand"]>[1],
		) {
			expect(name).toBe("code");
			command = options;
		},
		exec,
	} as unknown as ExtensionAPI);
	if (!command) throw new Error("/code was not registered");
	const ctx = {
		cwd: "/projects/worktrees/feature with spaces",
		ui: { notify },
	} as unknown as ExtensionCommandContext;
	return { handler: command.handler, ctx, exec, notify };
}
