import { describe, expect, test } from "bun:test";
import { mergeSettings, registerLocalPackage } from "./setup-config";

const root = "/home/user/.pi/agent/extensions/pi-personal-ext";
const bundled = ["pi-web-access", "pi-permission-system"];

describe("registerLocalPackage", () => {
	test("removes bundled packages with versions and resource filters", () => {
		expect(
			registerLocalPackage(
				[
					"npm:pi-web-access",
					"npm:pi-web-access@0.34.0",
					{ source: "npm:pi-permission-system@0.4.9", extensions: [] },
					"npm:pi-permission-system@latest",
				],
				root,
				bundled,
			),
		).toEqual([root]);
	});

	test("preserves unrelated packages and existing local filters", () => {
		const entries = [
			"npm:pi-web-access-extra@1",
			{ source: "npm:other", skills: [] },
			{ source: root, prompts: [] },
		];
		expect(registerLocalPackage(entries, root, bundled)).toEqual(entries);
	});

	test("replaces the previously documented Git installation", () => {
		for (const source of [
			"git:github.com:mightymatth/pi-personal-ext",
			"git:github.com/mightymatth/pi-personal-ext@main",
			"git:github.com/mightymatth/pi-personal-ext.git@v1",
		]) {
			expect(registerLocalPackage([source], root, bundled)).toEqual([root]);
		}
	});

	test("is idempotent without mutating the existing declarations", () => {
		const entries = ["npm:pi-web-access@0.34.0", "npm:other"];
		const result = registerLocalPackage(entries, root, bundled);
		expect(registerLocalPackage(result, root, bundled)).toEqual(result);
		expect(entries).toEqual(["npm:pi-web-access@0.34.0", "npm:other"]);
	});

	test("rejects malformed entries instead of silently discarding them", () => {
		expect(() => registerLocalPackage([null], root, bundled)).toThrow(
			"Invalid package declaration",
		);
	});
});

test("mergeSettings preserves unrelated nested settings without mutation", () => {
	const current = {
		compaction: { enabled: false, reserveTokens: 1000 },
		theme: "dark",
	};
	expect(mergeSettings(current, { compaction: { enabled: true } })).toEqual({
		compaction: { enabled: true, reserveTokens: 1000 },
		theme: "dark",
	});
	expect(current.compaction.enabled).toBe(false);
});
