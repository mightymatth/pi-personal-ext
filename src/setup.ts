import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { installPiPackages } from "./setup-packages";
import { installAll } from "./vscode-extensions";

export async function runSetup({
	dryRun = false,
	localPath,
	installed = false,
	log = console.log,
}: {
	dryRun?: boolean;
	localPath?: string | true;
	installed?: boolean;
	log?: (message: string) => void;
}): Promise<void> {
	const agentDir = resolve(
		process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi/agent"),
	);
	await installPiPackages({
		agentDir,
		localPath,
		dryRun,
		registerPersonalPackage: !installed,
		log,
	});
	await installAll({ dryRun, log });
	if (!dryRun) log("Setup complete. Run /reload in Pi and reload VS Code.");
}
