import { spawn } from "node:child_process";
import type {
	ProviderStatusConfig,
	RateLimitSnapshot,
	RateLimitWindow,
} from "./types";

const QUERY_TIMEOUT_MS = 8_000;

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

		const timeout = setTimeout(() => finish(), QUERY_TIMEOUT_MS);

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
					const limits =
						message.result?.rateLimitsByLimitId?.codex ??
						message.result?.rateLimits;
					if (!limits) continue;
					finish({
						planType: limits.planType ?? null,
						windows: [limits.primary, limits.secondary].filter(
							(window): window is RateLimitWindow => window != null,
						),
					});
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

export const codexProvider: ProviderStatusConfig = {
	provider: "openai-codex",
	statusKey: "provider-openai-codex",
	usageCommand: "codex-usage",
	usageLabel: "Codex",
	query: queryCodexRateLimits,
};
