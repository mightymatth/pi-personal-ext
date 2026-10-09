import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { missingRequiredPackages, REQUIRED_PACKAGES } from "./setup-checks";
import { installPiPackages } from "./setup-packages";

test("registered packages with missing files are reported missing", async () => {
	const dir = await mkdtemp(join(tmpdir(), "personal-setup-"));
	try {
		// Empty managed directories prevent Pi from using global npm installs.
		for (const name of REQUIRED_PACKAGES) {
			await mkdir(join(dir, "npm", "node_modules", name), { recursive: true });
		}
		await writeFile(
			join(dir, "settings.json"),
			JSON.stringify({
				packages: REQUIRED_PACKAGES.map((name) => `npm:${name}`),
			}),
		);
		expect(await missingRequiredPackages(dir)).toEqual(REQUIRED_PACKAGES);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("conversation setup installs companions without reinstalling itself", async () => {
	const agentDir = await mkdtemp(join(tmpdir(), "personal-setup-"));
	try {
		const calls: string[][] = [];
		await installPiPackages({
			agentDir,
			registerPersonalPackage: false,
			log: () => {},
			run: async (command) => {
				calls.push(command);
				return "";
			},
		});
		expect(calls).toEqual([
			["pi", "install", "npm:pi-permission-system", "--no-approve"],
			["pi", "install", "npm:pi-web-access", "--no-approve"],
		]);
	} finally {
		await rm(agentDir, { recursive: true, force: true });
	}
});
