import { expect, mock, test } from "bun:test";

import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ToolCallEvent,
	ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";

import { registerPermissionControls } from "./permissions";

test("starts in YOLO and /guard toggles both ways", async () => {
	const { start, toggle, call, ctx, select, setStatus } = setup();
	start();
	expect(setStatus).toHaveBeenLastCalledWith("permissions", "yolo");
	expect(await call("rm -rf /tmp/example")).toBeUndefined();
	await toggle();
	expect(setStatus).toHaveBeenLastCalledWith("permissions", "guard");
	expect((await call("rm -rf /tmp/example"))?.block).toBe(true);
	await toggle();
	expect(setStatus).toHaveBeenLastCalledWith("permissions", "yolo");
	ctx.hasUI = false;
	expect(await call("sudo reboot")).toBeUndefined();
	expect(select).toHaveBeenCalledTimes(1);
});

test("session start resets to YOLO and separate instances have independent modes", async () => {
	const first = setup();
	await first.toggle();
	expect((await first.call("git push"))?.block).toBe(true);
	expect(await setup().call("git push")).toBeUndefined();
	first.start();
	expect(await first.call("git push")).toBeUndefined();
});

for (const command of [
	"rm file.txt",
	"rm -fr build",
	"/bin/rm -rf build",
	"./bin/rm -rf build",
	"find . -type f -delete",
	"sudo reboot",
	"chmod +x script.sh",
	"chown root file",
	"mkfs.ext4 /dev/sda",
	"dd if=image of=/dev/disk2",
	":(){ :|:& };:",
	"git push",
	"git -C /tmp/repo push origin main",
	"git reset --hard HEAD~1",
	"git clean -fd",
	"git checkout -- src",
	"git restore src",
	"git branch -D topic",
	"git stash clear",
	"git stash drop",
	"npm publish",
	"bun publish",
	"yarn npm publish",
	"terraform destroy",
	"kubectl delete namespace example",
	"vercel deploy",
	"gh pr create",
	"gh pr merge 42",
	"gh repo delete example",
	"gh api repos/owner/repo -X DELETE",
	"gh api --method=PATCH repos/owner/repo",
	"gh api repos/owner/repo -f name=value",
	"gh api repos/owner/repo --raw-field=name=value",
	"gh api repos/owner/repo -Fname=value",
	"gh api -XPOST repos/owner/repo/issues",
	"bun test && rm -rf build",
	"git status; git push",
	"echo ready\ngit push",
	"find . -exec rm {} \\;",
	"bash -c 'rm -rf build'",
]) {
	test(`guard asks before: ${command}`, async () => {
		const { toggle, call, select } = setup();
		await toggle();
		expect((await call(command))?.block).toBe(true);
		expect(select).toHaveBeenCalledTimes(1);
		expect(select.mock.calls[0]?.[0]).toContain(command);
	});
}

for (const command of [
	"git status",
	"git diff",
	"git log -5",
	"git add .",
	"git commit -m fix",
	"git reset --soft HEAD~1",
	"git stash list",
	"git branch --show-current",
	"bun run check:fix",
	"bun test",
	"npm install",
	"ls -la",
	"rg permissions src",
	"gh pr view 42",
	"gh api repos/owner/repo",
	"gh api --method GET user",
	"curl https://example.com",
	"echo npm-publish",
	"./scripts/deployment-info",
]) {
	test(`guard allows: ${command}`, async () => {
		const { toggle, call, select } = setup();
		await toggle();
		expect(await call(command)).toBeUndefined();
		expect(select).not.toHaveBeenCalled();
	});
}

test("approval applies once; dismissal denies", async () => {
	const { toggle, call, select } = setup();
	await toggle();
	select.mockResolvedValueOnce("Allow once");
	expect(await call("git push")).toBeUndefined();
	expect((await call("git push"))?.block).toBe(true);
	select.mockResolvedValueOnce(undefined);
	expect((await call("git push"))?.block).toBe(true);
});

test("concurrent bash calls queue approvals instead of replacing dialogs", async () => {
	const { toggle, call, select } = setup();
	await toggle();
	let resolveFirst!: (choice: string) => void;
	select.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				resolveFirst = resolve;
			}),
	);
	const first = call("git push");
	const second = call("rm file.txt");
	await Promise.resolve();
	expect(select).toHaveBeenCalledTimes(1);
	resolveFirst("Allow once");
	expect(await first).toBeUndefined();
	expect((await second)?.block).toBe(true);
	expect(select).toHaveBeenCalledTimes(2);
});

test("a failed dialog does not prevent later approvals", async () => {
	const { toggle, call, select } = setup();
	await toggle();
	select.mockRejectedValueOnce(new Error("Dialog failed"));
	await expect(call("git push")).rejects.toThrow("Dialog failed");
	select.mockResolvedValueOnce("Allow once");
	expect(await call("git push")).toBeUndefined();
	expect(select).toHaveBeenCalledTimes(2);
});

test("headless guard blocks dangerous commands without prompting", async () => {
	const { toggle, call, ctx, select } = setup();
	await toggle();
	ctx.hasUI = false;
	expect(await call("git push")).toEqual({
		block: true,
		reason: expect.stringContaining("no UI"),
	});
	expect(await call("bun test")).toBeUndefined();
	expect(select).not.toHaveBeenCalled();
});

test("non-bash tools are never gated", async () => {
	const { toggle, call, select } = setup();
	await toggle();
	for (const tool of ["read", "write", "edit", "mcp", "codemode"]) {
		expect(await call("rm -rf /", tool)).toBeUndefined();
	}
	expect(select).not.toHaveBeenCalled();
});

function setup() {
	let startHandler: (event: unknown, ctx: ExtensionContext) => void;
	let toolHandler: (
		event: ToolCallEvent,
		ctx: ExtensionContext,
	) => Promise<ToolCallEventResult | undefined>;
	let command: Parameters<ExtensionAPI["registerCommand"]>[1];
	const select = mock(
		async (_title: string, _options: string[]): Promise<string | undefined> =>
			"Deny",
	);
	const setStatus = mock();
	const ctx = {
		hasUI: true,
		ui: { select, setStatus, notify: mock() },
	} as unknown as ExtensionCommandContext;
	registerPermissionControls({
		on(name: string, handler: unknown) {
			if (name === "session_start")
				startHandler = handler as typeof startHandler;
			else if (name === "tool_call")
				toolHandler = handler as typeof toolHandler;
			else throw new Error(`Unexpected hook: ${name}`);
		},
		registerCommand(name: string, options: typeof command) {
			expect(name).toBe("guard");
			command = options;
		},
	} as unknown as ExtensionAPI);
	return {
		ctx,
		select,
		setStatus,
		start: () => startHandler({}, ctx),
		toggle: () => command.handler("", ctx),
		call: (command: string, toolName = "bash") =>
			toolHandler(
				{
					type: "tool_call",
					toolCallId: "test",
					toolName,
					input: { command },
				} as ToolCallEvent,
				ctx,
			),
	};
}
