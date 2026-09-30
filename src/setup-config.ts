type Settings = Record<string, unknown>;
type PackageEntry = string | { source: string; [key: string]: unknown };

export function registerLocalPackage(
	current: unknown,
	root: string,
	bundledDependencies: readonly string[],
): PackageEntry[] {
	const entries = Array.isArray(current) ? current : [];
	const registered = entries.filter((entry): entry is PackageEntry => {
		const source = typeof entry === "string" ? entry : entry?.source;
		if (typeof source !== "string") {
			throw new Error("Invalid package declaration: expected a source string");
		}
		const isBundledDependency = bundledDependencies.some(
			(name) => source === `npm:${name}` || source.startsWith(`npm:${name}@`),
		);
		// Migrate the installation documented before local-checkout setup.
		const isPreviousInstallation =
			/^git:github\.com[:/]mightymatth\/pi-personal-ext(?:\.git)?(?:@.*)?$/.test(
				source,
			);
		return !isBundledDependency && !isPreviousInstallation;
	});
	if (
		!registered.some(
			(entry) => (typeof entry === "string" ? entry : entry.source) === root,
		)
	) {
		registered.push(root);
	}
	return registered;
}

export function mergeSettings(current: Settings, defaults: Settings): Settings {
	const merged = { ...current };

	for (const [key, defaultValue] of Object.entries(defaults)) {
		const currentValue = current[key];
		if (
			defaultValue !== null &&
			typeof defaultValue === "object" &&
			!Array.isArray(defaultValue)
		) {
			const localSettings =
				currentValue !== null &&
				typeof currentValue === "object" &&
				!Array.isArray(currentValue)
					? (currentValue as Settings)
					: {};
			merged[key] = mergeSettings(localSettings, defaultValue as Settings);
		} else {
			merged[key] = defaultValue;
		}
	}

	return merged;
}
