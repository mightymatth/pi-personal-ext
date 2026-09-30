import {
	lstat,
	mkdir,
	readdir,
	readlink,
	symlink,
	unlink,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export async function installAll({
	dryRun = false,
}: {
	dryRun?: boolean;
} = {}): Promise<void> {
	const sourceDir = join(import.meta.dir, "vscode-extensions");
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
				console.log(`Already linked: ${destination}`);
				continue;
			}
			if (!dryRun) await unlink(destination);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}

		console.log(`Link: ${destination} -> ${source}`);
		if (!dryRun) await symlink(source, destination, "dir");
	}
}
