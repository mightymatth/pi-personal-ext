#!/usr/bin/env bun
import { Command } from "commander";

import { runSetup } from "./src/setup";

const program = new Command()
	.name("setup")
	.description("Install personal Pi packages and VS Code extensions")
	.option(
		"--local-path [path]",
		"Register a local checkout; clone if missing (default: agent extensions directory)",
	)
	.option("--installed", "Set up an already registered extension", false)
	.option("--dry-run", "Preview setup without changing files", false)
	.action(runSetup);

try {
	await program.parseAsync();
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	program.error(`error: ${message}`);
}
