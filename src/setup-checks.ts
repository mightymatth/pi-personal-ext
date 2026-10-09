import { existsSync, realpathSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
	DefaultPackageManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

export const REQUIRED_PACKAGES = ["pi-permission-system", "pi-web-access"];
type InstalledPackage = { source: string; path?: string; name?: string };

export async function registeredPackages(
	agentDir: string,
): Promise<InstalledPackage[]> {
	const cwd = process.cwd();
	const settings = SettingsManager.create(cwd, agentDir, {
		projectTrusted: false,
	});
	const [error] = settings.drainErrors();
	if (error) throw error.error;
	const manager = new DefaultPackageManager({
		cwd,
		agentDir,
		settingsManager: settings,
	});
	const packages: InstalledPackage[] = manager
		.listConfiguredPackages()
		.map(({ source, installedPath }) => ({ source, path: installedPath }));
	for (const extension of settings.getGlobalSettings().extensions ?? []) {
		if (
			extension.startsWith("-") ||
			extension.startsWith("!") ||
			extension.includes("builtin:")
		)
			continue;
		const source = extension.replace(/^\+/, "");
		const path = source.startsWith("~/")
			? join(homedir(), source.slice(2))
			: resolve(agentDir, source);
		packages.push({ source, path });
	}
	const entries = [...packages, ...(await discoveredPackages(agentDir))];
	return Promise.all(
		entries.map(async (entry) => ({
			...entry,
			name: await packageName(entry.path),
		})),
	);
}

export async function packageName(path?: string): Promise<string | undefined> {
	if (!path) return undefined;
	try {
		let directory = (await stat(path)).isDirectory() ? path : dirname(path);
		while (true) {
			if (existsSync(join(directory, "package.json"))) {
				const manifest = JSON.parse(
					await readFile(join(directory, "package.json"), "utf8"),
				);
				return typeof manifest?.name === "string" ? manifest.name : undefined;
			}
			const parent = dirname(directory);
			if (parent === directory) return undefined;
			directory = parent;
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

async function discoveredPackages(
	agentDir: string,
): Promise<InstalledPackage[]> {
	const directory = join(agentDir, "extensions");
	try {
		const entries = await readdir(directory, { withFileTypes: true });
		return entries
			.filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
			.map((entry) => {
				const path = join(directory, entry.name);
				return { source: path, path };
			});
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}

export function samePath(left: string, right: string): boolean {
	const canonical = (path: string) =>
		existsSync(path) ? realpathSync(path) : resolve(path);
	return canonical(left) === canonical(right);
}

export async function missingRequiredPackages(
	agentDir: string,
): Promise<string[]> {
	const entries = await registeredPackages(agentDir);
	const names = entries.map((entry) => entry.name);
	return REQUIRED_PACKAGES.filter((name) => !names.includes(name));
}
