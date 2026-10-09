import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { errorText } from "./format";
import type { ProviderStatusConfig, RateLimitSnapshot } from "./types";

const PROVIDER = "github-copilot";
const AUTH_PATH = join(getAgentDir(), "auth.json");
const QUERY_TIMEOUT_MS = 8_000;
const MONTH_WINDOW_MINS = 30 * 24 * 60;

type CopilotCredential = {
	type?: string;
	refresh?: string;
	access?: string;
	enterpriseUrl?: string;
};

type QuotaSnapshot = {
	has_quota?: boolean | null;
	unlimited?: boolean | null;
	percent_remaining?: number | null;
	credits_used?: number | null;
	entitlement?: number | null;
	quota_reset_at?: number | null;
};

type CopilotUser = {
	copilot_plan?: string | null;
	quota_reset_date?: string | null;
	quota_snapshots?: Record<string, QuotaSnapshot> | null;
};

function numberFrom(value: unknown) {
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : undefined;
	}
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return undefined;
}

function unixSecondsFrom(value: unknown) {
	if (typeof value === "string") {
		const parsed = Date.parse(value);
		return Number.isFinite(parsed) ? parsed / 1000 : numberFrom(value);
	}
	return numberFrom(value);
}

function normalizeDomain(value: string) {
	try {
		const url = value.includes("://")
			? new URL(value)
			: new URL(`https://${value}`);
		return url.hostname;
	} catch {
		return undefined;
	}
}

function readCredential() {
	let raw: string;
	try {
		raw = readFileSync(AUTH_PATH, "utf8");
	} catch {
		return undefined;
	}
	try {
		const auth = JSON.parse(raw) as Record<
			string,
			CopilotCredential | undefined
		>;
		return auth[PROVIDER];
	} catch {
		return undefined;
	}
}

// The stored Copilot credential keeps the GitHub OAuth token in `refresh` and
// the Copilot API token in `access`. The user/quota endpoint lives on the
// GitHub API, so it needs `refresh` (enterprise installs use their own host).
function copilotApiBase(credential: CopilotCredential) {
	const domain = credential.enterpriseUrl
		? normalizeDomain(credential.enterpriseUrl)
		: undefined;
	return domain ? `https://api.${domain}` : "https://api.github.com";
}

function buildSnapshot(user: CopilotUser): RateLimitSnapshot | undefined {
	const premium = user.quota_snapshots?.premium_interactions;
	if (!premium || premium.has_quota === false || premium.unlimited) {
		return undefined;
	}

	const percentRemaining = numberFrom(premium.percent_remaining);
	let usedPercent: number;
	if (percentRemaining !== undefined) {
		usedPercent = 100 - percentRemaining;
	} else {
		const used = numberFrom(premium.credits_used);
		const entitlement = numberFrom(premium.entitlement);
		if (used === undefined || !entitlement) return undefined;
		usedPercent = (used / entitlement) * 100;
	}

	// Premium requests reset monthly. `quota_reset_at` is 0 when unset, so fall
	// back to the plan-wide reset date.
	const quotaResetAt = unixSecondsFrom(premium.quota_reset_at);
	const resetsAt =
		quotaResetAt && quotaResetAt > 0
			? quotaResetAt
			: user.quota_reset_date
				? unixSecondsFrom(user.quota_reset_date)
				: undefined;

	return {
		planType: user.copilot_plan ?? null,
		windows: [
			{
				usedPercent: Math.min(100, Math.max(0, usedPercent)),
				windowDurationMins: MONTH_WINDOW_MINS,
				resetsAt: resetsAt ?? null,
			},
		],
	};
}

async function queryCopilotUsage() {
	const credential = readCredential();
	if (!credential?.refresh) {
		throw new Error(
			"GitHub Copilot: not authenticated. Run /login and select GitHub Copilot.",
		);
	}

	let response: Response;
	try {
		response = await fetch(
			`${copilotApiBase(credential)}/copilot_internal/user`,
			{
				headers: {
					accept: "application/json",
					authorization: `Bearer ${credential.refresh}`,
				},
				signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
			},
		);
	} catch (error) {
		throw new Error(`GitHub Copilot: request failed: ${errorText(error)}`);
	}

	if (response.status === 401) {
		throw new Error(
			"GitHub Copilot: session expired. Run /login and select GitHub Copilot.",
		);
	}
	if (!response.ok) {
		throw new Error(`GitHub Copilot: API returned HTTP ${response.status}`);
	}

	let user: CopilotUser;
	try {
		user = (await response.json()) as CopilotUser;
	} catch (error) {
		throw new Error(`GitHub Copilot: response failed: ${errorText(error)}`);
	}

	return buildSnapshot(user);
}

export const copilotProvider: ProviderStatusConfig = {
	providers: [PROVIDER],
	statusKey: "provider-github-copilot",
	usageCommand: "copilot-usage",
	usageLabel: "GitHub Copilot",
	query: queryCopilotUsage,
};
