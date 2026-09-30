/**
 * Pool behaviour, tested with a fake browser factory so it needs no pi session,
 * no browser process, and no model.
 */

import { describe, expect, test } from "bun:test";
import type { Browser } from "./browser";
import { Recorder } from "./metrics";
import { createBrowserPool } from "./pool";

function fakeBrowser(log: string[], session: string): Browser {
	return {
		async open() {},
		async navigate() {},
		async observe() {
			return { fingerprint: session, text: "", elements: [], openLists: [] };
		},
		async perform() {
			throw new Error("not used");
		},
		async close() {
			log.push(`closed ${session}`);
		},
	};
}

function harness({ maxIdle = 2, alive = true } = {}) {
	const created: string[] = [];
	const closed: string[] = [];
	let counter = 0;

	const pool = createBrowserPool({
		create: async (session) => {
			created.push(session);
			return fakeBrowser(closed, session);
		},
		name: () => {
			counter += 1;
			return `jev-${counter}`;
		},
		maxIdle,
		alive: async () => alive,
	});

	return { pool, created, closed };
}

describe("browser pool", () => {
	test("reuses the browser a previous run handed back", async () => {
		const { pool, created } = harness();
		const first = await pool.acquire(new Recorder());
		await first.release();
		const second = await pool.acquire(new Recorder());

		expect(second.browser).toBe(first.browser);
		expect(created).toHaveLength(1);
		await pool.closeAll();
	});

	test("two overlapping runs never share a browser", async () => {
		const { pool, created } = harness();
		const a = await pool.acquire(new Recorder());
		const b = await pool.acquire(new Recorder());

		expect(a.browser).not.toBe(b.browser);
		expect(created).toEqual(["jev-1", "jev-2"]);

		// Both are busy, so a third run gets its own too.
		const c = await pool.acquire(new Recorder());
		expect(created).toEqual(["jev-1", "jev-2", "jev-3"]);

		await a.release();
		await b.release();
		await c.release();
		expect(pool.idle()).toHaveLength(2);
		await pool.closeAll();
	});

	test("a browser that died while idle is replaced", async () => {
		const created: string[] = [];
		const pool = createBrowserPool({
			create: async (session) => {
				created.push(session);
				return fakeBrowser([], session);
			},
			name: () => `jev-${created.length + 1}`,
			maxIdle: 2,
			alive: async () => false,
		});

		const first = await pool.acquire(new Recorder());
		await first.release();
		const second = await pool.acquire(new Recorder());

		expect(second.browser).not.toBe(first.browser);
		expect(created).toHaveLength(2);
		await pool.closeAll();
	});

	test("keeps only the configured number of idle browsers warm", async () => {
		const { pool, closed } = harness({ maxIdle: 1 });
		const a = await pool.acquire(new Recorder());
		const b = await pool.acquire(new Recorder());

		await a.release();
		await b.release();

		// Two idle, one allowed: the older browser is closed.
		expect(closed).toEqual(["closed jev-1"]);
		expect(pool.idle()).toEqual(["jev-2"]);
		await pool.closeAll();
		expect(closed).toEqual(["closed jev-1", "closed jev-2"]);
	});

	test("hands each run its own recorder", async () => {
		const recorders: Recorder[] = [];
		let seen: (() => Recorder) | undefined;
		const pool = createBrowserPool({
			create: async (_session, recorder) => {
				seen = recorder;
				return fakeBrowser([], "s");
			},
			name: () => "jev-x",
			maxIdle: 1,
			alive: async () => true,
		});

		const first = new Recorder();
		const loan = await pool.acquire(first);
		await loan.release();

		const second = new Recorder();
		recorders.push(first, second);
		await pool.acquire(second);

		// The pooled browser reports into whichever run holds it now.
		expect(seen?.()).toBe(second);
		await pool.closeAll();
	});
});
