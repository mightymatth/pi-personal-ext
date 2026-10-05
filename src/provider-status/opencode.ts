import {
	chmodSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { errorText } from "./format";
import type {
	ExtensionContext,
	ProviderSnapshotHandler,
	ProviderStatusConfig,
	RateLimitSnapshot,
	RateLimitWindow,
} from "./types";

const QUERY_TIMEOUT_MS = 8_000;
const CACHE_MS = 90_000;
const LOGIN_TIMEOUT_MS = 10 * 60_000;
const LOGIN_POLL_MS = 1_000;
const LOGIN_RETRY_MS = 10_000;
const LOGIN_SESSION = "ocgo";
const LOGIN_STATUS_KEY = "provider-opencode-go-login";
const LOGIN_URL = "https://opencode.ai/console/login";
const API_BASE = "https://opencode.ai/console/api";
const STATUS_PATH = "/go/status";
const ORGS_PATH = "/orgs";
const COOKIE_DOMAIN = "opencode.ai";
const SESSION_COOKIE = "__Host-console_session";
const CONFIG_PATH = join(homedir(), ".pi", "agent", "pi-go-bars.json");
const PLAYWRIGHT_CWD = homedir();
const USER_AGENT =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/148.0";

const METERS = [
	{ key: "fiveHour", windowDurationMins: 5 * 60 },
	{ key: "week", windowDurationMins: 7 * 24 * 60 },
	{ key: "month", windowDurationMins: 30 * 24 * 60 },
] as const;

type MeterKey = (typeof METERS)[number]["key"];

type OpenCodeConfig = {
	orgId: string;
	cookie: string;
};

type MeterPayload = {
	limitMicroCents?: unknown;
	usedMicroCents?: unknown;
	resetsAt?: unknown;
};

type GoStatusPayload = {
	access?: {
		endsAt?: unknown;
		meters?: Partial<Record<MeterKey, MeterPayload>>;
	} | null;
} | null;

type StatusResult =
	| { kind: "ok"; status: GoStatusPayload }
	| { kind: "expired" }
	| { kind: "absent" }
	| { kind: "error"; message: string };

type ResolveResult =
	| { kind: "ok"; orgId: string; snapshot: RateLimitSnapshot }
	| { kind: "expired" }
	| { kind: "no-subscription" }
	| { kind: "error"; message: string };

function loadConfig() {
	try {
		const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as {
			orgId?: unknown;
			cookie?: unknown;
		};
		if (typeof config.orgId === "string" && typeof config.cookie === "string") {
			return {
				orgId: config.orgId,
				cookie: config.cookie,
			} satisfies OpenCodeConfig;
		}
	} catch {}
	return undefined;
}

function saveConfig(config: OpenCodeConfig) {
	mkdirSync(dirname(CONFIG_PATH), { recursive: true, mode: 0o700 });
	const tempPath = `${CONFIG_PATH}.${process.pid}.tmp`;
	writeFileSync(tempPath, `${JSON.stringify(config, null, 2)}\n`, {
		mode: 0o600,
	});
	renameSync(tempPath, CONFIG_PATH);
	chmodSync(CONFIG_PATH, 0o600);
}

function usageError(message: string) {
	return new Error(`OpenCode Go: ${message}. Run /opencode-go-login.`);
}

function numberFrom(value: unknown) {
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : undefined;
	}
	if (typeof value === "bigint") return Number(value);
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return undefined;
}

function unixSecondsFrom(value: unknown) {
	if (typeof value === "string") {
		const parsed = Date.parse(value);
		if (Number.isFinite(parsed)) return parsed / 1000;
		return numberFrom(value);
	}
	if (typeof value === "number" && Number.isFinite(value)) {
		return value > 1e11 ? value / 1000 : value;
	}
	return undefined;
}

function buildSnapshot(status: GoStatusPayload) {
	const access = status?.access;
	const meters = access?.meters;
	if (!access || !meters) return undefined;

	const windows = METERS.flatMap(({ key, windowDurationMins }) => {
		const meter = meters[key];
		const limit = numberFrom(meter?.limitMicroCents);
		const used = numberFrom(meter?.usedMicroCents);
		if (!limit || limit <= 0 || used === undefined) return [];
		const resetsAt =
			unixSecondsFrom(meter?.resetsAt) ??
			(key === "month" ? unixSecondsFrom(access.endsAt) : undefined);
		return [
			{
				usedPercent: Math.min(100, Math.max(0, (used / limit) * 100)),
				windowDurationMins,
				resetsAt: resetsAt ?? null,
			} satisfies RateLimitWindow,
		];
	});
	if (windows.length === 0) return undefined;

	return { planType: "go", windows } satisfies RateLimitSnapshot;
}

async function apiGet(path: string, cookie: string, orgId?: string) {
	return await fetch(`${API_BASE}${path}`, {
		headers: {
			accept: "application/json",
			cookie,
			...(orgId ? { "x-org-id": orgId } : {}),
			"user-agent": USER_AGENT,
		},
		redirect: "manual",
		signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
	});
}

function redirects(response: Response) {
	return response.status >= 300 && response.status < 400;
}

async function fetchStatus(
	orgId: string,
	cookie: string,
): Promise<StatusResult> {
	let response: Response;
	try {
		response = await apiGet(STATUS_PATH, cookie, orgId);
	} catch (error) {
		return {
			kind: "error",
			message: `dashboard request failed: ${errorText(error)}`,
		};
	}
	if (response.status === 401 || redirects(response))
		return { kind: "expired" };
	if (
		response.status === 400 ||
		response.status === 403 ||
		response.status === 404
	)
		return { kind: "absent" };
	if (!response.ok) {
		return {
			kind: "error",
			message: `dashboard returned HTTP ${response.status}`,
		};
	}
	try {
		return { kind: "ok", status: (await response.json()) as GoStatusPayload };
	} catch (error) {
		return {
			kind: "error",
			message: `dashboard response failed: ${errorText(error)}`,
		};
	}
}

async function resolveUsage(
	cookie: string,
	preferredOrgId?: string,
): Promise<ResolveResult> {
	const orgIds: string[] = [];

	if (preferredOrgId) {
		orgIds.push(preferredOrgId);
		const status = await fetchStatus(preferredOrgId, cookie);
		if (status.kind === "expired") return { kind: "expired" };
		if (status.kind === "error")
			return { kind: "error", message: status.message };
		if (status.kind === "ok") {
			const snapshot = buildSnapshot(status.status);
			if (snapshot) return { kind: "ok", orgId: preferredOrgId, snapshot };
		}
	}

	let response: Response;
	try {
		response = await apiGet(ORGS_PATH, cookie);
	} catch (error) {
		return {
			kind: "error",
			message: `dashboard request failed: ${errorText(error)}`,
		};
	}
	if (response.status === 401 || redirects(response))
		return { kind: "expired" };
	if (!response.ok) {
		return {
			kind: "error",
			message: `dashboard returned HTTP ${response.status}`,
		};
	}

	let payload: unknown;
	try {
		payload = await response.json();
	} catch (error) {
		return {
			kind: "error",
			message: `dashboard response failed: ${errorText(error)}`,
		};
	}
	if (Array.isArray(payload)) {
		for (const entry of payload) {
			const id = (entry as { id?: unknown } | null)?.id;
			if (typeof id === "string" && !orgIds.includes(id)) orgIds.push(id);
		}
	}
	if (orgIds.length === 0) {
		return { kind: "error", message: "no workspaces found for this account" };
	}

	let firstError: string | undefined;
	for (const orgId of orgIds) {
		if (orgId === preferredOrgId) continue;
		const status = await fetchStatus(orgId, cookie);
		if (status.kind === "expired") return { kind: "expired" };
		if (status.kind === "error") {
			firstError ??= status.message;
			continue;
		}
		if (status.kind === "ok") {
			const snapshot = buildSnapshot(status.status);
			if (snapshot) return { kind: "ok", orgId, snapshot };
		}
	}
	if (firstError) return { kind: "error", message: firstError };
	return { kind: "no-subscription" };
}

let cache: { snapshot: RateLimitSnapshot; fetchedAt: number } | undefined;

async function queryUsage() {
	if (cache && Date.now() - cache.fetchedAt < CACHE_MS) {
		return cache.snapshot;
	}

	const config = loadConfig();
	if (!config) throw usageError("login required");

	const result = await resolveUsage(config.cookie, config.orgId);
	if (result.kind === "expired") throw usageError("dashboard session expired");
	if (result.kind === "no-subscription") {
		throw usageError("no Go subscription found for this account");
	}
	if (result.kind === "error") throw usageError(result.message);

	cache = { snapshot: result.snapshot, fetchedAt: Date.now() };
	return result.snapshot;
}

export const openCodeProvider: ProviderStatusConfig = {
	provider: "opencode-go",
	statusKey: "provider-opencode-go",
	usageCommand: "opencode-go-usage",
	usageLabel: "OpenCode Go",
	query: queryUsage,
	register: registerLogin,
};

function registerLogin(pi: ExtensionAPI, onSnapshot: ProviderSnapshotHandler) {
	let loginSession: string | undefined;

	const run = (args: string[], timeout: number) =>
		pi.exec("playwright-cli", [`-s=${LOGIN_SESSION}`, ...args], {
			timeout,
			cwd: PLAYWRIGHT_CWD,
		});

	const closeBrowser = async (session: string) => {
		try {
			await pi.exec("playwright-cli", [`-s=${session}`, "close"], {
				timeout: 10_000,
				cwd: PLAYWRIGHT_CWD,
			});
		} catch {}
	};

	const readCookies = async () => {
		let result: Awaited<ReturnType<typeof run>>;
		try {
			result = await run(["cookie-list", "--domain", COOKIE_DOMAIN], 5_000);
		} catch {
			return { kind: "unavailable" } as const;
		}
		if (result.killed || result.code !== 0)
			return { kind: "unavailable" } as const;

		const pairs = new Map<string, string>();
		for (const line of result.stdout.split("\n")) {
			const match = /^([^=\s]+)=(.*) \(domain:/.exec(line.trim());
			if (match) pairs.set(match[1], match[2]);
		}
		if (pairs.size === 0) return { kind: "none" } as const;
		return {
			kind: "cookies",
			header: [...pairs].map(([name, value]) => `${name}=${value}`).join("; "),
			session: pairs.get(SESSION_COOKIE),
		} as const;
	};

	const login = async (ctx: ExtensionContext) => {
		let browserOpen = false;
		ctx.ui.setStatus(LOGIN_STATUS_KEY, "OpenCode Go: verifying session");

		try {
			const existing = loadConfig();
			if (existing) {
				const resolved = await resolveUsage(existing.cookie, existing.orgId);
				if (resolved.kind === "ok") {
					if (resolved.orgId !== existing.orgId) {
						saveConfig({ orgId: resolved.orgId, cookie: existing.cookie });
					}
					cache = { snapshot: resolved.snapshot, fetchedAt: Date.now() };
					onSnapshot(resolved.snapshot, ctx);
					ctx.ui.notify("OpenCode Go session is still valid", "info");
					return;
				}
			}

			const opened = await run(
				["open", LOGIN_URL, "--browser=chrome", "--headed"],
				30_000,
			);
			if (opened.killed) throw new Error("opening the login browser timed out");
			if (opened.code !== 0) {
				throw new Error(
					opened.stderr.trim() ||
						opened.stdout.trim() ||
						"failed to open browser",
				);
			}
			browserOpen = true;
			loginSession = LOGIN_SESSION;

			ctx.ui.notify(
				"Log into OpenCode. The browser closes by itself once usage is verified.",
				"info",
			);

			const deadline = Date.now() + LOGIN_TIMEOUT_MS;
			let failures = 0;
			let checkedSession: string | undefined;
			let retryAt = 0;
			let lastError: string | undefined;
			let warnedNoSubscription = false;
			let resolved:
				| (Extract<ResolveResult, { kind: "ok" }> & { cookie: string })
				| undefined;

			while (Date.now() < deadline) {
				ctx.ui.setStatus(
					LOGIN_STATUS_KEY,
					lastError
						? `OpenCode Go: ${lastError}`
						: "OpenCode Go: waiting for login",
				);
				const cookies = await readCookies();
				if (cookies.kind === "unavailable") {
					failures++;
					if (failures >= 5) {
						throw new Error("login browser is no longer available");
					}
				} else {
					failures = 0;
					const isNewSession =
						cookies.kind === "cookies" &&
						cookies.session !== undefined &&
						cookies.session !== checkedSession;
					if (
						cookies.kind === "cookies" &&
						(isNewSession || Date.now() >= retryAt)
					) {
						checkedSession = cookies.session;
						retryAt = Date.now() + LOGIN_RETRY_MS;
						const attempted = await resolveUsage(cookies.header);
						if (attempted.kind === "ok") {
							resolved = { ...attempted, cookie: cookies.header };
							break;
						}
						if (attempted.kind === "no-subscription") {
							lastError =
								"this account has no Go subscription; sign in with a Go-enabled account";
							if (!warnedNoSubscription) {
								warnedNoSubscription = true;
								ctx.ui.notify(lastError, "warning");
							}
						}
						if (attempted.kind === "error") lastError = attempted.message;
					}
				}
				await new Promise((resolve) => setTimeout(resolve, LOGIN_POLL_MS));
			}
			if (!resolved) throw new Error(lastError ?? "login timed out");

			saveConfig({ orgId: resolved.orgId, cookie: resolved.cookie });
			cache = { snapshot: resolved.snapshot, fetchedAt: Date.now() };
			onSnapshot(resolved.snapshot, ctx);
			ctx.ui.notify(
				`OpenCode Go login saved for ${resolved.orgId} and usage verified`,
				"info",
			);
		} catch (error) {
			ctx.ui.notify(`OpenCode Go login failed: ${errorText(error)}`, "error");
		} finally {
			if (browserOpen) await closeBrowser(LOGIN_SESSION);
			loginSession = undefined;
			ctx.ui.setStatus(LOGIN_STATUS_KEY, undefined);
		}
	};

	pi.registerCommand("opencode-go-login", {
		description: "Log into OpenCode Go and save dashboard access",
		handler: async (_args, ctx) => login(ctx),
	});

	pi.on("session_shutdown", async () => {
		if (loginSession) await closeBrowser(loginSession);
	});
}
