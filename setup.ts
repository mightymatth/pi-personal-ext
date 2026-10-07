#!/usr/bin/env bun
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { Command } from "commander";
import { installPiPackages } from "./src/setup-packages";
import { installAll } from "./src/vscode-extensions";

const program = new Command()
	.name("setup")
	.description("Install personal Pi packages and VS Code extensions")
	.option(
		"--local-path [path]",
		"Register a local checkout; clone if missing (default: agent extensions directory)",
	)
	.option("--installed", "Set up an already registered extension", false)
	.option("--dry-run", "Preview setup without changing files", false)
	.action(setup);

try {
	await program.parseAsync();
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	program.error(`error: ${message}`);
}

async function setup({
	dryRun,
	localPath,
	installed,
}: {
	dryRun: boolean;
	localPath?: string | true;
	installed: boolean;
}): Promise<void> {
	const agentDir = resolve(
		process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi/agent"),
	);
	await installPiPackages({
		agentDir,
		localPath,
		dryRun,
		registerPersonalPackage: !installed,
	});
	await installAll({ dryRun });
	if (!dryRun) {
		console.log("Setup complete. Run /reload in Pi and reload VS Code.");
	}
}
