import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { codexProvider } from "./codex";
import {
	errorText,
	formatFooter,
	formatTable,
	getRefreshIntervalMs,
	getRetryStatus,
} from "./format";
import { openCodeProvider } from "./opencode";
import type {
	ExtensionContext,
	ProviderStatusConfig,
	RateLimitSnapshot,
} from "./types";

const QUERY_RETRY_MS = 15_000;
const RESPONSE_REFRESH_MS = 15_000;

const PROVIDERS: ProviderStatusConfig[] = [codexProvider, openCodeProvider];

export function registerProviderStatus(pi: ExtensionAPI) {
	let activeProvider: ProviderStatusConfig | undefined;
	let snapshot: RateLimitSnapshot | undefined;
	let transportStatus: string | undefined;
	let queryError: string | undefined;
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
			queryError ? ctx.ui.theme.fg("error", queryError) : undefined,
			transportStatus,
		].filter(Boolean);
		ctx.ui.setStatus(
			activeProvider.statusKey,
			parts.length > 0 ? parts.join("  ") : undefined,
		);
	};

	const refresh = (ctx: ExtensionContext, force = false) => {
		if (!activeProvider || inFlight) return;

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
			try {
				const next = await provider.query();
				if (
					!next ||
					refreshGeneration !== generation ||
					activeProvider !== provider
				) {
					return;
				}

				snapshot = next;
				queryError = undefined;
				lastSuccessAt = Date.now();
				render(ctx);
			} catch (error) {
				if (refreshGeneration !== generation || activeProvider !== provider) {
					return;
				}
				snapshot = undefined;
				const nextError = errorText(error);
				const changed = queryError !== nextError;
				queryError = nextError;
				render(ctx);
				if (changed) ctx.ui.notify(nextError, "error");
			}
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
		queryError = undefined;
		lastAttemptAt = 0;
		lastSuccessAt = 0;
		inFlight = undefined;

		for (const provider of PROVIDERS) {
			ctx.ui.setStatus(provider.statusKey, undefined);
		}

		if (!activeProvider) return;
		refresh(ctx, true);
	};

	for (const provider of PROVIDERS) {
		provider.register?.(pi, (next, ctx) => {
			if (activeProvider !== provider) return;
			snapshot = next;
			queryError = undefined;
			lastSuccessAt = Date.now();
			render(ctx);
		});
	}

	pi.on("session_start", async (_event, ctx) => {
		selectProvider(ctx, ctx.model?.provider);
	});

	pi.on("session_shutdown", async () => {
		generation++;
		inFlight = undefined;
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
		if (!provider.usageCommand) continue;

		pi.registerCommand(provider.usageCommand, {
			description: `Show ${provider.usageLabel} usage (windows, pace, resets)`,
			handler: async (_args, ctx) => {
				try {
					const next = await provider.query();
					if (!next) {
						ctx.ui.notify(`${provider.usageLabel}: usage unavailable`, "error");
						return;
					}
					pi.sendMessage({
						customType: "provider-status-usage",
						content: formatTable(
							next,
							`${provider.usageLabel} subscription usage`,
						),
						display: true,
					});
				} catch (error) {
					ctx.ui.notify(errorText(error), "error");
				}
			},
		});
	}
}
