import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export type ExtensionContext = Parameters<Parameters<ExtensionAPI["on"]>[1]>[1];

export type RateLimitWindow = {
	usedPercent: number;
	windowDurationMins: number | null;
	resetsAt: number | null;
};

export type RateLimitSnapshot = {
	planType: string | null;
	windows: RateLimitWindow[];
};

export type ProviderSnapshotHandler = (
	snapshot: RateLimitSnapshot,
	ctx: ExtensionContext,
) => void;

export type ProviderStatusConfig = {
	provider: string;
	statusKey: string;
	usageLabel: string;
	usageCommand?: string;
	query: () => Promise<RateLimitSnapshot | undefined>;
	register?: (pi: ExtensionAPI, onSnapshot: ProviderSnapshotHandler) => void;
};
