import {
	chmodSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { errorText } from "./format";
import type {
	ExtensionContext,
	ProviderSnapshotHandler,
	ProviderStatusConfig,
	RateLimitSnapshot,
} from "./types";

const QUERY_TIMEOUT_MS = 8_000;
const CACHE_MS = 90_000;
const LOGIN_TIMEOUT_MS = 10 * 60_000;
const LOGIN_SESSION = "ocgo";
const LOGIN_STATUS_KEY = "provider-opencode-go-login";
const CONFIG_PATH = join(homedir(), ".pi", "agent", "pi-go-bars.json");

type OpenCodeConfig = {
	workspaceId: string;
	authCookie: string;
};

type OpenCodeUsageWindow = {
	usagePercent: number;
	resetInSec: number;
};

function loadConfig() {
	try {
		const config = JSON.parse(
			readFileSync(CONFIG_PATH, "utf8"),
		) as Partial<OpenCodeConfig>;
		if (config.workspaceId && config.authCookie) {
			return config as OpenCodeConfig;
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

function parseUsageWindow(html: string, name: string) {
	const number = String.raw`(-?\d+(?:\.\d+)?)`;
	const usageFirst = new RegExp(
		String.raw`${name}:\$R\[\d+\]=\{[^}]*usagePercent:${number}[^}]*resetInSec:${number}[^}]*\}`,
	);
	const resetFirst = new RegExp(
		String.raw`${name}:\$R\[\d+\]=\{[^}]*resetInSec:${number}[^}]*usagePercent:${number}[^}]*\}`,
	);
	const usageMatch = usageFirst.exec(html);
	const resetMatch = resetFirst.exec(html);
	const usagePercent = Number(usageMatch?.[1] ?? resetMatch?.[2]);
	const resetInSec = Number(usageMatch?.[2] ?? resetMatch?.[1]);
	if (!Number.isFinite(usagePercent) || !Number.isFinite(resetInSec)) {
		return undefined;
	}
	return { usagePercent, resetInSec } satisfies OpenCodeUsageWindow;
}

let cache: { snapshot: RateLimitSnapshot; fetchedAt: number } | undefined;

async function queryUsage() {
	if (cache && Date.now() - cache.fetchedAt < CACHE_MS) {
		return cache.snapshot;
	}

	const config = loadConfig();
	if (!config) throw usageError("login required");

	let response: Response;
	try {
		response = await fetch(
			`https://opencode.ai/workspace/${config.workspaceId}/go`,
			{
				headers: {
					cookie: `auth=${config.authCookie}`,
					"user-agent":
						"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/148.0",
				},
				signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
			},
		);
	} catch (error) {
		throw usageError(`dashboard request failed: ${errorText(error)}`);
	}
	if (!response.ok) {
		throw usageError(`dashboard returned HTTP ${response.status}`);
	}
	if (!response.url.includes(`/workspace/${config.workspaceId}/go`)) {
		throw usageError("dashboard session expired");
	}

	let html: string;
	try {
		html = await response.text();
	} catch (error) {
		throw usageError(`dashboard response failed: ${errorText(error)}`);
	}
	const values = [
		[parseUsageWindow(html, "rollingUsage"), 5 * 60],
		[parseUsageWindow(html, "weeklyUsage"), 7 * 24 * 60],
		[parseUsageWindow(html, "monthlyUsage"), 30 * 24 * 60],
	] as const;
	if (values.some(([value]) => !value)) {
		throw usageError("dashboard usage payload was not found");
	}

	const nowSeconds = Date.now() / 1000;
	const snapshot = {
		planType: "go",
		windows: values.map(([value, windowDurationMins]) => ({
			usedPercent: value?.usagePercent ?? 0,
			windowDurationMins,
			resetsAt: nowSeconds + (value?.resetInSec ?? 0),
		})),
	} satisfies RateLimitSnapshot;
	cache = { snapshot, fetchedAt: Date.now() };
	return snapshot;
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

	const closeBrowser = async (session: string) => {
		try {
			await pi.exec("playwright-cli", [`-s=${session}`, "close"], {
				timeout: 5_000,
			});
		} catch {}
	};

	const login = async (ctx: ExtensionContext) => {
		let browserOpen = false;
		let success = false;
		ctx.ui.setStatus(LOGIN_STATUS_KEY, "OpenCode Go: waiting for login");

		try {
			const opened = await pi.exec(
				"playwright-cli",
				[
					`-s=${LOGIN_SESSION}`,
					"open",
					"https://opencode.ai/auth",
					"--browser=chrome",
					"--headed",
				],
				{ timeout: 30_000 },
			);
			if (opened.code !== 0) {
				throw new Error(
					opened.stderr.trim() || "failed to open Playwright browser",
				);
			}
			browserOpen = true;
			loginSession = LOGIN_SESSION;

			ctx.ui.notify(
				"Log into OpenCode and select the workspace. The browser closes after usage is verified.",
				"info",
			);
			const deadline = Date.now() + LOGIN_TIMEOUT_MS;
			let workspaceId: string | undefined;
			let tabFailures = 0;
			while (!workspaceId && Date.now() < deadline) {
				const tabs = await pi.exec(
					"playwright-cli",
					[`-s=${LOGIN_SESSION}`, "tab-list"],
					{ timeout: 5_000 },
				);
				if (tabs.code !== 0) {
					tabFailures++;
					if (tabFailures >= 5) {
						throw new Error(tabs.stderr.trim() || "login browser was closed");
					}
				} else {
					tabFailures = 0;
					workspaceId =
						/https:\/\/opencode\.ai\/workspace\/(wrk_[A-Za-z0-9]+)(?:[/?#)]|$)/.exec(
							tabs.stdout,
						)?.[1];
				}
				if (!workspaceId) {
					await new Promise((resolve) => setTimeout(resolve, 1_000));
				}
			}
			if (!workspaceId) throw new Error("OpenCode login timed out");

			const cookie = await pi.exec(
				"playwright-cli",
				[`-s=${LOGIN_SESSION}`, "cookie-get", "auth"],
				{ timeout: 5_000 },
			);
			if (cookie.code !== 0) {
				throw new Error(cookie.stderr.trim() || "failed to read auth cookie");
			}
			const authCookie = /^auth=(.*) \(domain:/m.exec(cookie.stdout)?.[1];
			if (!authCookie) throw new Error("OpenCode auth cookie was not captured");

			saveConfig({ workspaceId, authCookie });
			cache = undefined;
			const snapshot = await queryUsage();
			onSnapshot(snapshot, ctx);
			success = true;
			ctx.ui.notify("OpenCode Go login saved and usage verified", "info");
		} catch (error) {
			const retry = browserOpen
				? "The browser was left open; rerun /opencode-go-login to retry."
				: "Rerun /opencode-go-login to retry.";
			ctx.ui.notify(
				`OpenCode Go login failed: ${errorText(error)}. ${retry}`,
				"error",
			);
		} finally {
			if (success) {
				await closeBrowser(LOGIN_SESSION);
				loginSession = undefined;
				ctx.ui.setStatus(LOGIN_STATUS_KEY, undefined);
			} else if (browserOpen) {
				loginSession = LOGIN_SESSION;
				ctx.ui.setStatus(
					LOGIN_STATUS_KEY,
					"OpenCode Go: login browser open — rerun /opencode-go-login",
				);
			} else {
				loginSession = undefined;
				ctx.ui.setStatus(LOGIN_STATUS_KEY, undefined);
			}
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
