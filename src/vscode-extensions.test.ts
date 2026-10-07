import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasCopyExtension } from "./vscode-extensions";

test("a copy-extension link with a missing target is not treated as installed", async () => {
	const home = await mkdtemp(join(tmpdir(), "personal-vscode-"));
	try {
		const directory = join(home, ".vscode", "extensions");
		const source = join(home, "source");
		await mkdir(directory, { recursive: true });
		await symlink(source, join(directory, "local.copy-file-reference"));
		expect(await hasCopyExtension(home)).toBe(false);
		await mkdir(source);
		await writeFile(
			join(source, "package.json"),
			JSON.stringify({
				name: "copy-file-reference",
				publisher: "local",
				main: "extension.js",
			}),
		);
		await writeFile(join(source, "extension.js"), "");
		expect(await hasCopyExtension(home)).toBe(true);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
