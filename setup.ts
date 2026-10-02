#!/usr/bin/env bun
import { constants } from "node:fs";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { Command } from "commander";
import defaults from "./config/settings.json";
import manifest from "./package.json";
import { mergeSettings, registerLocalPackage } from "./src/setup-config";
import { installAll } from "./src/vscode-extensions";

const program = new Command()
	.name("setup")
	.description("Set up personal Pi configuration and VS Code extensions")
	.option("--dry-run", "Preview setup without changing files", false)
	.action(setup);

try {
	await program.parseAsync();
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	program.error(`error: ${message}`);
}

async function setup({ dryRun }: { dryRun: boolean }): Promise<void> {
	const root = import.meta.dir;
	const agentDir = resolve(
		process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi/agent"),
	);
	const settingsPath = join(agentDir, "settings.json");
	const current = await readSettings(settingsPath);
	const settings = mergeSettings(current, defaults);
	settings.packages = registerLocalPackage(
		current.packages,
		root,
		manifest.bundledDependencies,
	);

	if (Array.isArray(current.extensions)) {
		settings.extensions = current.extensions.filter(
			(path) => path !== join(root, "index.ts"),
		);
	}

	console.log(`${dryRun ? "Preview" : "Setup"}: ${settingsPath}`);
	console.log(JSON.stringify(settings, null, 2));
	if (dryRun) {
		await installAll({ dryRun });
		return;
	}

	if (JSON.stringify(settings) !== JSON.stringify(current)) {
		await mkdir(agentDir, { recursive: true });
		await backupSettings(settingsPath);
		const temporary = `${settingsPath}.tmp-${process.pid}`;
		await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, {
			mode: 0o600,
		});
		await rename(temporary, settingsPath);
	}

	await installAll();
	console.log(
		"Setup complete. Restart Pi and reload VS Code. Credentials were not modified.",
	);
}

async function readSettings(path: string): Promise<Record<string, unknown>> {
	try {
		const settings = JSON.parse(await readFile(path, "utf8"));
		if (
			settings === null ||
			typeof settings !== "object" ||
			Array.isArray(settings)
		) {
			throw new Error(`Settings must be a JSON object: ${path}`);
		}
		return settings;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw error;
	}
}

async function backupSettings(path: string): Promise<void> {
	const backup = `${path}.backup-${Date.now()}`;
	try {
		await copyFile(path, backup, constants.COPYFILE_EXCL);
		console.log(`Backup: ${backup}`);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
}
