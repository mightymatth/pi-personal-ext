import { spawn } from "node:child_process";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

type ExtensionContext = Parameters<Parameters<ExtensionAPI["on"]>[1]>[1];
type Theme = ExtensionContext["ui"]["theme"];
type HeaderValue = string | string[] | undefined;
type Headers = Record<string, HeaderValue>;

type RateLimitWindow = {
	usedPercent: number;
	windowDurationMins: number | null;
	resetsAt: number | null;
};

type RateLimitSnapshot = {
	limitId: string | null;
	primary: RateLimitWindow | null;
	secondary: RateLimitWindow | null;
	planType: string | null;
	rateLimitReachedType: string | null;
};

type ProviderStatusConfig = {
	provider: string;
	statusKey: string;
	usageCommand?: string;
	usageLabel: string;
	getSnapshot?: () => Promise<RateLimitSnapshot | undefined>;
};

const CODEX_QUERY_TIMEOUT_MS = 8_000;
const QUERY_RETRY_MS = 15_000;
const RESPONSE_REFRESH_MS = 15_000;
const NORMAL_REFRESH_MS = 15 * 60_000;
const MEDIUM_USAGE_REFRESH_MS = 5 * 60_000;
const HIGH_USAGE_REFRESH_MS = 2 * 60_000;
const CRITICAL_USAGE_REFRESH_MS = 60_000;

const PROVIDERS: ProviderStatusConfig[] = [
	{
		provider: "openai-codex",
		statusKey: "provider-openai-codex",
		usageCommand: "codex-usage",
		usageLabel: "Codex",
		getSnapshot: queryCodexRateLimits,
	},
];

function getHeader(headers: Headers, name: string) {
	const value = headers[name] ?? headers[name.toLowerCase()];
	return Array.isArray(value) ? value.join(",") : value;
}

function getRetryStatus(headers: Headers) {
	const retryAfter = getHeader(headers, "retry-after");
	return retryAfter ? `429 retry ${retryAfter}` : "429";
}

function windowLabel(mins: number | null, fallback: string) {
	if (!mins) return fallback;
	if (mins % (60 * 24) === 0) return `${mins / (60 * 24)}d`;
	if (mins % 60 === 0) return `${mins / 60}h`;
	return `${mins}m`;
}

/** Matches the Claude statusline `_rate_resets_in` format. */
function resetsIn(unixSeconds: number, nowSeconds: number) {
	const diff = unixSeconds - nowSeconds;
	if (diff <= 0) return "now";
	if (diff < 3600) return `${Math.floor(diff / 60)}m`;
	if (diff < 86400)
		return `${Math.floor(diff / 3600)}h${Math.floor((diff % 3600) / 60)}m`;
	return `${Math.floor(diff / 86400)}d${Math.floor((diff % 86400) / 3600)}h${Math.floor((diff % 3600) / 60)}m`;
}

function resetsAtLocal(unixSeconds: number) {
	return new Date(unixSeconds * 1000)
		.toLocaleString("sv", { hour12: false })
		.replace(" ", "T");
}

/** Pace = used% minus ideal% (elapsed / window). Negative = surplus, positive = overspending. */
function computePace(window: RateLimitWindow, nowSeconds: number) {
	if (!window.windowDurationMins || !window.resetsAt) return undefined;
	const period = window.windowDurationMins * 60;
	const remaining = Math.max(0, window.resetsAt - nowSeconds);
	const ideal = Math.round(((period - remaining) / period) * 100);
	return Math.round(window.usedPercent) - ideal;
}

function formatPace(pace: number | undefined) {
	if (pace === undefined) return "-";
	return pace >= 0 ? `+${pace}%` : `${pace}%`;
}

/** Color by pace: 100% used is red, surplus (ahead) is green, overspending is yellow, on-track is dim. */
function colorize(
	theme: Theme,
	usedPercent: number,
	pace: number | undefined,
	text: string,
) {
	if (Math.round(usedPercent) >= 100) return theme.fg("error", text);
	if (pace !== undefined && pace > 0) return theme.fg("warning", text);
	if (pace !== undefined && pace < 0) return theme.fg("success", text);
	return theme.fg("dim", text);
}

function collectWindows(snapshot: RateLimitSnapshot) {
	return [snapshot.primary, snapshot.secondary].filter(
		(window): window is RateLimitWindow => window !== null,
	);
}

function getRefreshIntervalMs(snapshot: RateLimitSnapshot, nowSeconds: number) {
	const windows = collectWindows(snapshot);
	if (
		windows.some((window) => window.resetsAt && window.resetsAt <= nowSeconds)
	) {
		return 0;
	}

	const maxUsed = Math.max(0, ...windows.map((window) => window.usedPercent));
	if (maxUsed >= 95) return CRITICAL_USAGE_REFRESH_MS;
	if (maxUsed >= 85) return HIGH_USAGE_REFRESH_MS;
	if (maxUsed >= 60) return MEDIUM_USAGE_REFRESH_MS;
	return NORMAL_REFRESH_MS;
}

function formatFooter(
	snapshot: RateLimitSnapshot,
	nowSeconds: number,
	theme: Theme,
) {
	return collectWindows(snapshot)
		.map((window) => {
			const label = windowLabel(window.windowDurationMins, "?");
			const pace = computePace(window, nowSeconds);
			const reset = window.resetsAt
				? ` +${resetsIn(window.resetsAt, nowSeconds)}`
				: "";
			return colorize(
				theme,
				window.usedPercent,
				pace,
				`${label}:${Math.round(window.usedPercent)}% P${formatPace(pace)}${reset}`,
			);
		})
		.join("  ");
}

function formatTable(snapshot: RateLimitSnapshot, nowSeconds: number) {
	const headers = ["Metric", "Used", "Pace", "Resets In", "Resets At"];
	const rows = collectWindows(snapshot).map((window) => {
		const label = windowLabel(window.windowDurationMins, "?");
		return [
			label,
			`${Math.round(window.usedPercent)}%`,
			formatPace(computePace(window, nowSeconds)),
			window.resetsAt ? resetsIn(window.resetsAt, nowSeconds) : "N/A",
			window.resetsAt ? resetsAtLocal(window.resetsAt) : "N/A",
		];
	});

	const widths = headers.map((header, i) =>
		Math.max(header.length, ...rows.map((row) => row[i].length)),
	);
	const renderRow = (cells: string[]) =>
		cells
			.map((cell, i) => cell.padEnd(widths[i]))
			.join("  ")
			.trimEnd();
	const plan = snapshot.planType ? ` (plan: ${snapshot.planType})` : "";

	return [
		`Codex subscription usage${plan}`,
		"```",
		renderRow(headers),
		renderRow(widths.map((width) => "-".repeat(width))),
		...rows.map(renderRow),
		"```",
	].join("\n");
}

function queryCodexRateLimits() {
	return new Promise<RateLimitSnapshot | undefined>((resolve) => {
		const child = spawn("codex", ["app-server", "--listen", "stdio://"], {
			stdio: ["pipe", "pipe", "ignore"],
		});
		let buffer = "";
		let settled = false;

		const finish = (value?: RateLimitSnapshot) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			child.kill();
			resolve(value);
		};

		const timeout = setTimeout(() => finish(), CODEX_QUERY_TIMEOUT_MS);

		child.stdout.on("data", (chunk: Buffer) => {
			buffer += chunk.toString("utf8");
			for (;;) {
				const newline = buffer.indexOf("\n");
				if (newline === -1) break;
				const line = buffer.slice(0, newline).trim();
				buffer = buffer.slice(newline + 1);
				if (!line) continue;

				try {
					const message = JSON.parse(line);
					if (message.id !== 2) continue;
					const snapshot: RateLimitSnapshot | undefined =
						message.result?.rateLimitsByLimitId?.codex ??
						message.result?.rateLimits;
					finish(snapshot);
				} catch {
					// Ignore app-server notifications/log lines that are not JSON-RPC responses.
				}
			}
		});

		child.on("error", () => finish());
		child.on("exit", () => finish());

		child.stdin.write(
			`${JSON.stringify({
				id: 1,
				method: "initialize",
				params: {
					clientInfo: { name: "pi-personal-ext", version: "1.0.0" },
					capabilities: { experimentalApi: true },
				},
			})}\n`,
		);
		child.stdin.write(
			`${JSON.stringify({ id: 2, method: "account/rateLimits/read" })}\n`,
		);
	});
}

export function registerProviderStatus(pi: ExtensionAPI) {
	let activeProvider: ProviderStatusConfig | undefined;
	let snapshot: RateLimitSnapshot | undefined;
	let transportStatus: string | undefined;
	let lastAttemptAt = 0;
	let lastSuccessAt = 0;
	let inFlight: Promise<void> | undefined;
	let generation = 0;

	const render = (ctx: ExtensionContext) => {
		if (!activeProvider) return;
		const parts = [
			snapshot
				? formatFooter(snapshot, Math.floor(Date.now() / 1000), ctx.ui.theme)
				: undefined,
			transportStatus,
		].filter(Boolean);
		ctx.ui.setStatus(
			activeProvider.statusKey,
			parts.length > 0 ? parts.join("  ") : undefined,
		);
	};

	const refresh = (ctx: ExtensionContext, force = false) => {
		if (!activeProvider?.getSnapshot || inFlight) return;

		const provider = activeProvider;
		const now = Date.now();
		if (!force) {
			if (!snapshot && now - lastAttemptAt < QUERY_RETRY_MS) return;
			if (snapshot) {
				const intervalMs = getRefreshIntervalMs(
					snapshot,
					Math.floor(now / 1000),
				);
				if (now - lastSuccessAt < intervalMs) return;
			}
		}

		const refreshGeneration = generation;
		lastAttemptAt = now;
		inFlight = (async () => {
			const next = await provider.getSnapshot?.();
			if (
				!next ||
				refreshGeneration !== generation ||
				activeProvider !== provider
			) {
				return;
			}

			snapshot = next;
			lastSuccessAt = Date.now();
			render(ctx);
		})().finally(() => {
			if (refreshGeneration === generation) inFlight = undefined;
		});
	};

	const selectProvider = (
		ctx: ExtensionContext,
		providerName: string | undefined,
	) => {
		const nextProvider = PROVIDERS.find(
			({ provider }) => provider === providerName,
		);
		if (activeProvider === nextProvider) return;

		generation++;
		activeProvider = nextProvider;
		snapshot = undefined;
		transportStatus = undefined;
		lastAttemptAt = 0;
		lastSuccessAt = 0;
		inFlight = undefined;

		for (const provider of PROVIDERS) {
			ctx.ui.setStatus(provider.statusKey, undefined);
		}

		if (!activeProvider) return;
		refresh(ctx, true);
	};

	pi.on("session_start", async (_event, ctx) => {
		selectProvider(ctx, ctx.model?.provider);
	});

	pi.on("model_select", async (event, ctx) => {
		selectProvider(ctx, event.model.provider);
	});

	pi.on("after_provider_response", (event, ctx) => {
		if (!activeProvider) return;
		transportStatus =
			event.status === 429 ? getRetryStatus(event.headers) : undefined;
		render(ctx);
		if (
			event.status === 429 ||
			Date.now() - lastSuccessAt >= RESPONSE_REFRESH_MS
		) {
			refresh(ctx, true);
		}
	});

	pi.on("agent_end", async (_event, ctx) => {
		if (!activeProvider) return;
		if (Date.now() - lastSuccessAt >= RESPONSE_REFRESH_MS) {
			refresh(ctx, true);
		}
	});

	for (const provider of PROVIDERS) {
		if (!provider.usageCommand || !provider.getSnapshot) continue;

		pi.registerCommand(provider.usageCommand, {
			description: `Show ${provider.usageLabel} subscription usage (5h/weekly limits and resets)`,
			handler: async (_args, ctx) => {
				const next = await provider.getSnapshot?.();
				if (!next) {
					ctx.ui.notify(`${provider.usageLabel}: usage unavailable`, "error");
					return;
				}
				pi.sendMessage({
					customType: "provider-status-usage",
					content: formatTable(next, Math.floor(Date.now() / 1000)),
					display: true,
				});
			},
		});
	}
}
