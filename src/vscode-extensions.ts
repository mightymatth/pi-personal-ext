import { execFile } from "node:child_process";
import { type Dirent, existsSync } from "node:fs";
import {
	lstat,
	mkdir,
	readdir,
	readFile,
	readlink,
	symlink,
	unlink,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export async function isVSCodeInstalled(): Promise<boolean> {
	const home = homedir();
	const applicationPaths = [
		"/Applications/Visual Studio Code.app",
		join(home, "Applications", "Visual Studio Code.app"),
		"/usr/share/code",
		"/opt/visual-studio-code",
		...[
			process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Programs"),
			process.env.ProgramFiles,
			process.env["ProgramFiles(x86)"],
		]
			.filter((path): path is string => Boolean(path))
			.map((path) => join(path, "Microsoft VS Code", "Code.exe")),
	];
	if (applicationPaths.some((path) => existsSync(path))) return true;
	try {
		await promisify(execFile)("code", ["--version"], { timeout: 5_000 });
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code !== "ENOENT";
	}
}

export async function hasCopyExtension(home = homedir()): Promise<boolean> {
	const directory = join(home, ".vscode", "extensions");
	let entries: Dirent<string>[];
	try {
		entries = await readdir(directory, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
	for (const entry of entries) {
		if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
		const root = join(directory, entry.name);
		try {
			const manifest = JSON.parse(
				await readFile(join(root, "package.json"), "utf8"),
			);
			if (
				manifest.name === "copy-file-reference" &&
				manifest.publisher === "local" &&
				typeof manifest.main === "string" &&
				existsSync(join(root, manifest.main))
			)
				return true;
		} catch (error) {
			if (
				(error as NodeJS.ErrnoException).code !== "ENOENT" &&
				!(error instanceof SyntaxError)
			)
				throw error;
		}
	}
	return false;
}

export async function installAll({
	dryRun = false,
	log = console.log,
}: {
	dryRun?: boolean;
	log?: (message: string) => void;
} = {}): Promise<void> {
	const sourceDir = fileURLToPath(
		new URL("./vscode-extensions/", import.meta.url),
	);
	const destinationDir = join(homedir(), ".vscode", "extensions");
	const entries = await readdir(sourceDir, { withFileTypes: true });

	if (!dryRun) await mkdir(destinationDir, { recursive: true });

	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const source = join(sourceDir, entry.name);
		const destination = join(destinationDir, `local.${entry.name}`);

		try {
			const existing = await lstat(destination);
			if (!existing.isSymbolicLink()) {
				throw new Error(
					`Refusing to replace an existing VS Code extension: ${destination}`,
				);
			}
			const target = await readlink(destination);
			if (resolve(destinationDir, target) === source) {
				log(`Already linked: ${destination}`);
				continue;
			}
			if (!dryRun) await unlink(destination);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}

		log(`Link: ${destination} -> ${source}`);
		if (!dryRun) await symlink(source, destination, "dir");
	}
}
