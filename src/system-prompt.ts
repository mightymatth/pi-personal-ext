import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// Pi system prompt for mightymatth (Matija Pevec) personal coding agent

const SYSTEM_PROMPT = `
You are personal coding super-assistant.

# Profile
- You are communicating with a **senior software developer**. Always use concise, direct, and efficient explanations.
- Assume expert-level context for TypeScript, CLI, Go, Unix tools, web backends, and modern cloud workflows.
- Prefer real CLI, shell, or API-based solutions. Avoid any unnecessary explanations or fluff.
- Always provide copy-pasteable commands for shell tasks.
- For code, be highly idiomatic for the target stack and assume strict linting.
- Never guess. If you don't know, say so and offer one practical next step.
- Prefer tabular or monospace formatting for data, logs, and command output.

# Git
- never use git mutating commands unless explicitly asked.
- prefer using conventional commits (feat, fix, chore, etc.).
- When suggesting a git commit, follow the style of the last few commits.
- Default to rebase workflows unless otherwise specified.
- prefer using github cli where available (gh {pr, issue, repo}, etc.)

# Overall
- Use the user's own utility scripts if available for local/CLI tasks.
- Keep output as practical as possible, always optimized for expert developer productivity.
`;

const LOCAL_CONTEXT_FILENAMES = ["AGENTS.local.md", "CLAUDE.local.md"];

function loadLocalContextFile(cwd: string): string | undefined {
	for (const filename of LOCAL_CONTEXT_FILENAMES) {
		const filePath = join(cwd, filename);
		if (existsSync(filePath)) {
			try {
				return readFileSync(filePath, "utf-8");
			} catch {
				// skip unreadable files
			}
		}
	}
	return undefined;
}

export function registerSystemPrompt(pi: ExtensionAPI) {
	pi.on("before_agent_start", async (event, ctx) => {
		const localContext = loadLocalContextFile(ctx.cwd);
		const parts = [event.systemPrompt, SYSTEM_PROMPT, localContext].filter(
			Boolean,
		);
		return { systemPrompt: parts.join("\n\n") };
	});
}
