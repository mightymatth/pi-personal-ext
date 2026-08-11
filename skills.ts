#!/usr/bin/env bun
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { $ } from "bun";
import { Command } from "commander";

const skills: Record<string, string> = {
	grilling:
		"https://github.com/mattpocock/skills/tree/main/skills/productivity/grilling",
	opensrc: "https://github.com/vercel-labs/opensrc/tree/main/skills/opensrc",
	"playwright-cli":
		"https://github.com/microsoft/playwright-cli/tree/main/skills/playwright-cli",
};

const rootDir = import.meta.dir;
const skillsDir = path.join(rootDir, "skills");

const program = new Command()
	.name("skills")
	.description("Manage vendored pi skills")
	.version("1.0.0");

program
	.command("update")
	.description("Update vendored skills from their upstream repositories")
	.argument(
		"[skills...]",
		"Skill names to update. Defaults to all configured skills.",
	)
	.action(async (requestedSkills: string[]) => {
		const skillNames =
			requestedSkills.length > 0 ? requestedSkills : Object.keys(skills);

		for (const skillName of skillNames) {
			const source = skills[skillName];
			if (!source) {
				throw new Error(
					`Unknown skill "${skillName}". Available skills: ${Object.keys(skills).join(", ")}`,
				);
			}

			await updateSkill(skillName, source);
		}
	});

program
	.command("list")
	.description("List configured skill upstreams")
	.action(() => {
		for (const [skillName, source] of Object.entries(skills)) {
			console.log(`${skillName}\t${source}`);
		}
	});

await program.parseAsync();

async function updateSkill(skillName: string, source: string): Promise<void> {
	const workDir = await mkdtemp(path.join(tmpdir(), `pi-skill-${skillName}-`));
	const repoDir = path.join(workDir, "repo");
	const destination = path.join(skillsDir, skillName);

	try {
		const { repo, ref, skillPath } = parseGitHubTreeUrl(source);
		await $`git clone --depth 1 --filter=blob:none --sparse --branch ${ref} ${repo} ${repoDir}`;
		await $`git -C ${repoDir} sparse-checkout set ${skillPath}`;

		await rm(destination, { force: true, recursive: true });
		await cp(path.join(repoDir, skillPath), destination, { recursive: true });

		console.log(`Updated ${skillName} from ${source}`);
	} finally {
		await rm(workDir, { force: true, recursive: true });
	}
}

function parseGitHubTreeUrl(source: string): {
	repo: string;
	ref: string;
	skillPath: string;
} {
	const url = new URL(source);
	const [owner, repoName, tree, ref, ...pathParts] = url.pathname
		.split("/")
		.filter(Boolean);

	if (
		url.hostname !== "github.com" ||
		!owner ||
		!repoName ||
		tree !== "tree" ||
		!ref ||
		pathParts.length === 0
	) {
		throw new Error(`Expected GitHub tree URL, got: ${source}`);
	}

	return {
		repo: `https://github.com/${owner}/${repoName}.git`,
		ref,
		skillPath: pathParts.join("/"),
	};
}
