import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { $ } from "bun";
import {
	packageName,
	REQUIRED_PACKAGES,
	registeredPackages,
	samePath,
} from "./setup-checks";

const PERSONAL_PACKAGE = "pi-personal-ext";
const PERSONAL_REPOSITORY =
	"https://github.com/mightymatth/pi-personal-ext.git";
const PERSONAL_GIT_SOURCE = "git:github.com/mightymatth/pi-personal-ext";

async function runCommand(command: string[]): Promise<string> {
	console.log(command.map((argument) => JSON.stringify(argument)).join(" "));
	const output = await $`${command}`
		.env({ ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" })
		.quiet()
		.text();
	if (output.trim()) console.log(output.trimEnd());
	return output;
}

export async function installPiPackages({
	agentDir,
	localPath,
	dryRun = false,
	registerPersonalPackage = true,
	run = runCommand,
	log = console.log,
}: {
	agentDir: string;
	localPath?: string | true;
	dryRun?: boolean;
	registerPersonalPackage?: boolean;
	run?: (command: string[]) => Promise<string>;
	log?: (message: string) => void;
}): Promise<void> {
	let target: string | undefined;
	if (localPath === true) {
		target = join(agentDir, "extensions", PERSONAL_PACKAGE);
	} else if (localPath !== undefined) {
		target = localPath;
	}
	if (target !== undefined) target = resolve(target);
	const registered = await registeredPackages(agentDir);
	const named = await Promise.all(
		registered.map(async (entry) => ({
			...entry,
			name: entry.path ? await packageName(entry.path) : undefined,
		})),
	);
	const source = target ?? PERSONAL_GIT_SOURCE;
	for (const entry of named) {
		if (!registerPersonalPackage || entry.name !== PERSONAL_PACKAGE) continue;
		const matches = target
			? entry.path !== undefined && samePath(entry.path, target)
			: entry.source === PERSONAL_GIT_SOURCE;
		if (!matches) {
			throw new Error(
				`${PERSONAL_PACKAGE} already loads from ${entry.source}. Use --local-path with that checkout, or relocate/unregister it yourself before changing installation mode. Setup will not remove it.`,
			);
		}
	}

	if (target && existsSync(target)) {
		if ((await packageName(target)) !== PERSONAL_PACKAGE) {
			throw new Error(`Not a ${PERSONAL_PACKAGE} checkout: ${target}`);
		}
	} else if (target) {
		const clone = ["git", "clone", PERSONAL_REPOSITORY, target];
		const installDependencies = ["bun", "install", "--cwd", target];
		if (dryRun) {
			log(`Would run: ${JSON.stringify(clone)}`);
			log(`Would run: ${JSON.stringify(installDependencies)}`);
		} else {
			await run(["mkdir", "-p", dirname(target)]);
			await run(clone);
			await run(installDependencies);
		}
	}

	const install = async (packageSource: string) => {
		const command = ["pi", "install", packageSource, "--no-approve"];
		if (dryRun) log(`Would run: ${JSON.stringify(command)}`);
		else await run(command);
	};

	for (const name of REQUIRED_PACKAGES) {
		const existing = named.find((entry) => entry.name === name);
		if (existing) {
			log(`Already installed: ${name} (${existing.source}); unchanged`);
			continue;
		}
		// Preserve even broken registrations rather than overwriting user choices.
		const entry = registered.find(
			(entry) =>
				entry.source === `npm:${name}` ||
				entry.source.startsWith(`npm:${name}@`),
		);
		if (entry) {
			throw new Error(
				`${entry.source} is registered but its package is missing. Repair it with pi install ${entry.source}; setup will not replace the registration.`,
			);
		}
		await install(`npm:${name}`);
	}
	if (registerPersonalPackage) await install(source);
}
