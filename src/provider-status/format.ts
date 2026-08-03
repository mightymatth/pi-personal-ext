import type {
	ExtensionContext,
	RateLimitSnapshot,
	RateLimitWindow,
} from "./types";

type Theme = ExtensionContext["ui"]["theme"];
type HeaderValue = string | string[] | undefined;
type Headers = Record<string, HeaderValue>;

const NORMAL_REFRESH_MS = 15 * 60_000;
const MEDIUM_USAGE_REFRESH_MS = 5 * 60_000;
const HIGH_USAGE_REFRESH_MS = 2 * 60_000;
const CRITICAL_USAGE_REFRESH_MS = 60_000;

export function errorText(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

function getHeader(headers: Headers, name: string) {
	const value = headers[name] ?? headers[name.toLowerCase()];
	return Array.isArray(value) ? value.join(",") : value;
}

export function getRetryStatus(headers: Headers) {
	const retryAfter = getHeader(headers, "retry-after");
	return retryAfter ? `429 retry ${retryAfter}` : "429";
}

function windowLabel(mins: number | null, fallback: string) {
	if (!mins) return fallback;
	if (mins % (60 * 24) === 0) return `${mins / (60 * 24)}d`;
	if (mins % 60 === 0) return `${mins / 60}h`;
	return `${mins}m`;
}

function resetsIn(unixSeconds: number, nowSeconds: number) {
	const diff = unixSeconds - nowSeconds;
	if (diff <= 0) return "now";
	if (diff < 3600) return `${Math.floor(diff / 60)}m`;
	if (diff < 86400) {
		return `${Math.floor(diff / 3600)}h${Math.floor((diff % 3600) / 60)}m`;
	}
	return `${Math.floor(diff / 86400)}d${Math.floor((diff % 86400) / 3600)}h${Math.floor((diff % 3600) / 60)}m`;
}

function resetsAtLocal(unixSeconds: number) {
	return new Date(unixSeconds * 1000)
		.toLocaleString("sv", { hour12: false })
		.replace(" ", "T");
}

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

export function getRefreshIntervalMs(
	snapshot: RateLimitSnapshot,
	nowSeconds: number,
) {
	if (
		snapshot.windows.some(
			(window) => window.resetsAt && window.resetsAt <= nowSeconds,
		)
	) {
		return 0;
	}

	const maxUsed = Math.max(
		0,
		...snapshot.windows.map((window) => window.usedPercent),
	);
	if (maxUsed >= 95) return CRITICAL_USAGE_REFRESH_MS;
	if (maxUsed >= 85) return HIGH_USAGE_REFRESH_MS;
	if (maxUsed >= 60) return MEDIUM_USAGE_REFRESH_MS;
	return NORMAL_REFRESH_MS;
}

export function formatFooter(
	snapshot: RateLimitSnapshot,
	nowSeconds: number,
	theme: Theme,
) {
	return snapshot.windows
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

export function formatTable(snapshot: RateLimitSnapshot, title: string) {
	const headers = ["Metric", "Used", "Pace", "Resets In", "Resets At"];
	const nowSeconds = Date.now() / 1000;
	const rows = snapshot.windows.map((window) => {
		const label = windowLabel(window.windowDurationMins, "?");
		const pace = formatPace(computePace(window, nowSeconds));
		const resetsInCell = window.resetsAt
			? resetsIn(window.resetsAt, nowSeconds)
			: "N/A";
		const resetsAtCell = window.resetsAt
			? resetsAtLocal(window.resetsAt)
			: "N/A";
		return [
			label,
			`${Math.round(window.usedPercent)}%`,
			pace,
			resetsInCell,
			resetsAtCell,
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
		`${title}${plan}`,
		"```",
		renderRow(headers),
		renderRow(widths.map((width) => "-".repeat(width))),
		...rows.map(renderRow),
		"```",
	].join("\n");
}
