import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getAgentDir } from "@mariozechner/pi-coding-agent";

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

function loadLocalContextFileFromDir(
	dir: string,
): { path: string; content: string } | undefined {
	for (const filename of LOCAL_CONTEXT_FILENAMES) {
		const filePath = join(dir, filename);
		if (existsSync(filePath)) {
			try {
				return { path: filePath, content: readFileSync(filePath, "utf-8") };
			} catch {
				// skip unreadable files
			}
		}
	}
	return undefined;
}

function loadLocalContextFiles(cwd: string): string[] {
	const seenPaths = new Set<string>();
	const files: { path: string; content: string }[] = [];

	// 1. Global: ~/.pi/agent/AGENTS.local.md
	const globalFile = loadLocalContextFileFromDir(getAgentDir());
	if (globalFile) {
		files.push(globalFile);
		seenPaths.add(globalFile.path);
	}

	// 2. Walk up from cwd to root (outer-to-inner priority)
	const ancestors: { path: string; content: string }[] = [];
	let currentDir = resolve(cwd);
	const root = resolve("/");
	while (true) {
		const file = loadLocalContextFileFromDir(currentDir);
		if (file && !seenPaths.has(file.path)) {
			ancestors.unshift(file);
			seenPaths.add(file.path);
		}
		if (currentDir === root) break;
		const parentDir = resolve(currentDir, "..");
		if (parentDir === currentDir) break;
		currentDir = parentDir;
	}
	files.push(...ancestors);

	return files.map((f) => `## ${f.path}\n\n${f.content}`);
}

export function registerSystemPrompt(pi: ExtensionAPI) {
	pi.on("before_agent_start", async (event, ctx) => {
		const localContextParts = loadLocalContextFiles(ctx.cwd);
		const parts = [
			event.systemPrompt,
			SYSTEM_PROMPT,
			...localContextParts,
		].filter(Boolean);
		return { systemPrompt: parts.join("\n\n") };
	});
}
