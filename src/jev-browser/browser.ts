/**
 * The execution layer. playwright-cli owns the browser process; this module owns
 * the only mapping from an application action to a CLI invocation, and the only
 * place a control that has left the page is rejected before it becomes a side
 * effect.
 */

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Recorder } from "./metrics";
import { observe } from "./observe";
import type { BrowserAction, Observation } from "./types";

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 32 * 1024 * 1024;
const SETTLE_DELAY_MS = 200;
/** A page that is loading keeps changing; wait this long for it to stop. */
const SETTLE_BUDGET_MS = 1000;
/** An action may have navigated, so a new page gets longer to arrive. */
const SETTLE_AFTER_ACTION_MS = 6000;
const SCROLL_STEP = 700;
const WAIT_MS = 750;

/**
 * Raised when the control an action was chosen for is no longer on the page.
 *
 * Freshness is about the target, not about the page being byte-identical. Pages
 * with clocks, carousels, or a spinner never stop changing, so demanding an
 * identical page would starve the agent instead of protecting it.
 */
export class StaleTargetError extends Error {
	constructor() {
		super("The control the action was chosen for is no longer on the page");
		this.name = "StaleTargetError";
	}
}

export type Execution = {
	before: Observation;
	after: Observation;
	/** False when the page was still changing when the wait ran out. */
	settled: boolean;
};

export type Browser = {
	open(url: string, headed: boolean): Promise<void>;
	navigate(url: string): Promise<void>;
	observe(): Promise<Observation>;
	/** Executes one action, or throws StaleTargetError if its target is gone. */
	perform(action: BrowserAction): Promise<Execution>;
	close(): Promise<void>;
};

type ReadResult = { observation: Observation; settled: boolean };

async function run(session: string, args: string[]): Promise<string> {
	try {
		const { stdout } = await execFileAsync(
			"playwright-cli",
			[`-s=${session}`, ...args],
			{ maxBuffer: MAX_BUFFER },
		);

		return stdout;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`playwright-cli ${args[0]} failed: ${message}`);
	}
}

export async function createPlaywrightBrowser({
	session,
	recorder,
}: {
	session: string;
	/** Resolved per call: a pooled browser outlives the run that created it. */
	recorder: () => Recorder;
}): Promise<Browser> {
	const dir = await mkdtemp(join(tmpdir(), "jev-browser-"));
	const snapshotFile = join(dir, "snapshot.yml");

	function measure<T>(name: string, run: () => Promise<T>): Promise<T> {
		return recorder().measure(name, run);
	}

	async function snapshot(): Promise<string> {
		await run(session, ["snapshot", `--filename=${snapshotFile}`]);

		return readFile(snapshotFile, "utf8");
	}

	async function read(budgetMs = SETTLE_BUDGET_MS): Promise<ReadResult> {
		return measure("browser.read", async () => {
			let yaml = await measure("browser.snapshot", snapshot);
			const deadline = Date.now() + budgetMs;
			let settled = false;

			// Two identical consecutive reads mean the page has stopped changing.
			// A page that is loading never matches itself, so it gets more time.
			for (;;) {
				await measure(
					"browser.settle",
					() => new Promise((resolve) => setTimeout(resolve, SETTLE_DELAY_MS)),
				);

				const next = await measure("browser.snapshot", snapshot);
				if (next === yaml) {
					settled = true;
					break;
				}

				yaml = next;
				if (Date.now() >= deadline) break;
			}

			return { observation: observe(yaml), settled };
		});
	}

	async function act(action: BrowserAction): Promise<void> {
		switch (action.kind) {
			case "click":
				await run(session, ["click", action.ref ?? ""]);
				return;
			case "fill":
				await run(session, ["fill", action.ref ?? "", action.value ?? ""]);
				return;
			case "select":
				await run(session, ["select", action.ref ?? "", action.value ?? ""]);
				return;
			case "scroll": {
				const delta = action.direction === "up" ? -SCROLL_STEP : SCROLL_STEP;
				await run(session, ["mousewheel", "--", "0", String(delta)]);
				return;
			}
			case "wait":
				await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
				return;
		}
	}

	return {
		async open(url: string, headed: boolean): Promise<void> {
			const args = ["open", url];
			if (headed) args.push("--headed");

			await measure("browser.open", () => run(session, args));
		},

		async navigate(url: string): Promise<void> {
			await measure("browser.navigate", () => run(session, ["goto", url]));
		},

		async observe(): Promise<Observation> {
			return (await read()).observation;
		},

		async perform(action: BrowserAction): Promise<Execution> {
			return measure("browser.perform", async () => {
				const before = (await read()).observation;

				if (
					action.ref &&
					!before.elements.some((element) => element.ref === action.ref)
				) {
					throw new StaleTargetError();
				}

				await measure(`browser.act:${action.kind}`, () => act(action));

				const after = await read(SETTLE_AFTER_ACTION_MS);

				return { before, after: after.observation, settled: after.settled };
			});
		},

		async close(): Promise<void> {
			await measure("browser.close", async () => {
				await run(session, ["close"]).catch(() => {});
				await rm(dir, { recursive: true, force: true }).catch(() => {});
			});
		},
	};
}
