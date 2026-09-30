/**
 * Browser pooling.
 *
 * A browser costs a launch and keeps the site's session state, so a finished run
 * hands its browser back instead of killing it, and the next run reuses it. Runs
 * that overlap must never share one, so a busy browser is not offered and a new
 * one is created with its own name.
 *
 * Names stay short because playwright-cli builds a unix socket path from the
 * session name, and that path has a hard length limit on macOS.
 */

import type { Browser } from "./browser";
import type { Recorder } from "./metrics";

export type Loan = { browser: Browser; release: () => Promise<void> };

type Entry = {
	name: string;
	browser: Browser;
	busy: boolean;
	box: { recorder: Recorder };
};

export type BrowserPool = {
	acquire: (recorder: Recorder) => Promise<Loan>;
	closeAll: () => Promise<void>;
	/** Idle browsers currently kept warm, for tests and status reporting. */
	idle: () => string[];
};

export function createBrowserPool({
	create,
	name,
	maxIdle,
	alive,
}: {
	create: (session: string, recorder: () => Recorder) => Promise<Browser>;
	name: () => string;
	maxIdle: number;
	/** Whether a browser handed back earlier is still usable. */
	alive: (browser: Browser) => Promise<boolean>;
}): BrowserPool {
	const entries: Entry[] = [];

	async function release(entry: Entry): Promise<void> {
		entry.busy = false;

		const idle = entries.filter((item) => !item.busy);
		while (idle.length > maxIdle) {
			const oldest = idle.shift();
			if (!oldest) break;

			entries.splice(entries.indexOf(oldest), 1);
			await oldest.browser.close();
		}
	}

	return {
		async acquire(recorder: Recorder): Promise<Loan> {
			const idle = entries.find((entry) => !entry.busy);

			if (idle) {
				if (await alive(idle.browser)) {
					idle.busy = true;
					idle.box.recorder = recorder;

					return { browser: idle.browser, release: () => release(idle) };
				}

				// It died while idle, so it is not worth keeping.
				entries.splice(entries.indexOf(idle), 1);
				await idle.browser.close();
			}

			const box = { recorder };
			const session = name();
			const browser = await create(session, () => box.recorder);
			const entry: Entry = { name: session, browser, busy: true, box };
			entries.push(entry);

			return { browser, release: () => release(entry) };
		},

		async closeAll(): Promise<void> {
			for (const entry of entries.splice(0)) await entry.browser.close();
		},

		idle: () =>
			entries.filter((entry) => !entry.busy).map((entry) => entry.name),
	};
}
