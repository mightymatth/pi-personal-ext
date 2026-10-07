import { errorText } from "./format";
import type {
	ExtensionContext,
	ProviderStatusConfig,
	RateLimitSnapshot,
	RateLimitWindow,
} from "./types";

const USAGE_URL = "https://opencode.ai/zen/go/v1/usage";
const QUERY_TIMEOUT_MS = 8_000;
const CACHE_MS = 90_000;

const WINDOWS = [
	{ key: "rolling", windowDurationMins: 5 * 60 },
	{ key: "weekly", windowDurationMins: 7 * 24 * 60 },
	{ key: "monthly", windowDurationMins: 30 * 24 * 60 },
] as const;

type WindowKey = (typeof WINDOWS)[number]["key"];

type UsagePayload = {
	usage?: Partial<
		Record<WindowKey, { percent?: unknown; resetsAt?: unknown } | null>
	> | null;
} | null;

let cache: { snapshot: RateLimitSnapshot; fetchedAt: number } | undefined;

function unixSecondsFrom(value: unknown) {
	if (typeof value !== "string") return undefined;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed / 1000 : undefined;
}

function buildSnapshot(payload: UsagePayload) {
	const usage = payload?.usage;
	if (!usage) return undefined;

	const windows = WINDOWS.flatMap(({ key, windowDurationMins }) => {
		const meter = usage[key];
		const percent = Number(meter?.percent);
		if (!Number.isFinite(percent)) return [];
		return [
			{
				usedPercent: Math.min(100, Math.max(0, percent)),
				windowDurationMins,
				resetsAt: unixSecondsFrom(meter?.resetsAt) ?? null,
			} satisfies RateLimitWindow,
		];
	});
	if (windows.length === 0) return undefined;

	return { planType: "go", windows } satisfies RateLimitSnapshot;
}

async function queryUsage(ctx: ExtensionContext) {
	if (cache && Date.now() - cache.fetchedAt < CACHE_MS) {
		return cache.snapshot;
	}

	const apiKey = await ctx.modelRegistry.getApiKeyForProvider("opencode-go");
	if (!apiKey) {
		throw new Error(
			"OpenCode Go: no API key. Run /login opencode-go or set OPENCODE_API_KEY.",
		);
	}

	let response: Response;
	try {
		response = await fetch(USAGE_URL, {
			headers: {
				accept: "application/json",
				authorization: `Bearer ${apiKey}`,
			},
			signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
		});
	} catch (error) {
		throw new Error(`OpenCode Go: usage request failed: ${errorText(error)}`);
	}

	if (response.status === 401) {
		throw new Error("OpenCode Go: API key rejected. Run /login opencode-go.");
	}
	if (response.status === 403) {
		throw new Error("OpenCode Go: no Go subscription on this account.");
	}
	if (!response.ok) {
		throw new Error(`OpenCode Go: usage returned HTTP ${response.status}`);
	}

	let payload: UsagePayload;
	try {
		payload = (await response.json()) as UsagePayload;
	} catch (error) {
		throw new Error(`OpenCode Go: usage response failed: ${errorText(error)}`);
	}

	const snapshot = buildSnapshot(payload);
	if (!snapshot) throw new Error("OpenCode Go: usage response had no windows");

	cache = { snapshot, fetchedAt: Date.now() };
	return snapshot;
}

export const openCodeProvider: ProviderStatusConfig = {
	provider: "opencode-go",
	statusKey: "provider-opencode-go",
	usageCommand: "opencode-go-usage",
	usageLabel: "OpenCode Go",
	query: queryUsage,
};
