/**
 * Timing. A long run hides its cost in a handful of places — waiting for the
 * page, asking the decision model, calling the reasoning model — and guessing
 * which one dominates is how a run that could take twenty seconds takes a
 * minute. Every phase reports itself here, attributed to the step it belongs to.
 */

export type Timing = {
	name: string;
	count: number;
	totalMs: number;
};

export type StepTiming = {
	step: number;
	name: string;
	ms: number;
};

const SETUP_STEP = 0;

export class Recorder {
	private readonly timings = new Map<string, Timing>();
	private readonly steps = new Map<number, Map<string, number>>();
	private step = SETUP_STEP;
	private stepStartedAt = performance.now();

	/** Attribution for everything recorded from now on. */
	beginStep(step: number): void {
		this.closeStep();
		this.step = step;
		this.stepStartedAt = performance.now();
	}

	/** Closes the running step's wall clock. Safe to call more than once. */
	closeStep(): void {
		this.add(this.step, "wall", performance.now() - this.stepStartedAt);
		this.stepStartedAt = performance.now();
	}

	record(name: string, ms: number): void {
		const timing = this.timings.get(name) ?? { name, count: 0, totalMs: 0 };
		timing.count += 1;
		timing.totalMs += ms;
		this.timings.set(name, timing);

		this.add(this.step, name, ms);
	}

	async measure<T>(name: string, run: () => Promise<T>): Promise<T> {
		const started = performance.now();
		try {
			return await run();
		} finally {
			this.record(name, performance.now() - started);
		}
	}

	private add(step: number, name: string, ms: number): void {
		const entries = this.steps.get(step) ?? new Map<string, number>();
		entries.set(name, (entries.get(name) ?? 0) + ms);
		this.steps.set(step, entries);
	}

	list(): Timing[] {
		return [...this.timings.values()].sort(
			(left, right) => right.totalMs - left.totalMs,
		);
	}

	stepList(): StepTiming[] {
		return [...this.steps]
			.flatMap(([step, entries]) =>
				[...entries].map(([name, ms]) => ({ step, name, ms })),
			)
			.sort(
				(left, right) =>
					left.step - right.step || left.name.localeCompare(right.name),
			);
	}

	/** Total wall clock across every step, which is the run's real duration. */
	totalMs(): number {
		return this.list()
			.filter((timing) => timing.name === "wall")
			.reduce((sum, timing) => sum + timing.totalMs, 0);
	}

	report(): string {
		const phases = this.list().filter((timing) => timing.name !== "wall");
		if (!phases.length) return "timings: nothing recorded";

		const names = phases.map((timing) => timing.name);
		const width = Math.max(...names.map((name) => name.length), 4);

		const category = [
			"timings (ms):",
			`  ${"phase".padEnd(width)}  count     total       avg`,
			...phases.map(
				(timing) =>
					`  ${timing.name.padEnd(width)}  ${String(timing.count).padStart(5)}` +
					`  ${timing.totalMs.toFixed(0).padStart(8)}  ${(timing.totalMs / timing.count).toFixed(0).padStart(6)}`,
			),
		];

		const perStep = new Map<number, Map<string, number>>();
		for (const { step, name, ms } of this.stepList()) {
			const entries = perStep.get(step) ?? new Map<string, number>();
			entries.set(name, ms);
			perStep.set(step, entries);
		}

		const columns = [
			...new Set(this.stepList().map((entry) => entry.name)),
		].filter((name) => name !== "wall");
		const label = (step: number) => (step === SETUP_STEP ? "setup" : `${step}`);

		const header = `  ${"step".padEnd(6)}${"wall".padStart(9)}${columns
			.map((name) => name.replace(/^[a-z]+\./, "").padStart(10))
			.join("")}`;
		const rows = [...perStep.keys()]
			.sort((left, right) => left - right)
			.map((step) => {
				const entries = perStep.get(step) as Map<string, number>;
				const cells = columns
					.map((name) => (entries.get(name) ?? 0).toFixed(0).padStart(10))
					.join("");

				return `  ${label(step).padEnd(6)}${(entries.get("wall") ?? 0).toFixed(0).padStart(9)}${cells}`;
			});

		return [
			...category,
			"",
			`per step (ms), ${(this.totalMs() / 1000).toFixed(1)}s total:`,
			header,
			...rows,
		].join("\n");
	}
}
