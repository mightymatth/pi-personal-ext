/**
 * Turns a playwright-cli aria snapshot into the compact semantic state the rest
 * of the agent reasons about: visible text, plus the controls that are actually
 * actionable right now.
 *
 * The snapshot YAML has three shapes, and only three:
 *   - a bare string item        -> a child node with no content
 *   - `descriptor: scalar`      -> that node's inline text
 *   - `descriptor: [items]`     -> that node's children, plus `/placeholder`,
 *                                  `/value`, and `/url` attributes of the node
 */

import { createHash } from "node:crypto";
import { parse } from "yaml";
import type { BrowserElement, BrowserOption, Observation } from "./types";

/** Jev rejects questions with more than 254 choices; stay clear of the edge. */
const MAX_ELEMENTS = 235;
const MAX_TEXT = 6000;

/** Roles whose value the user can type. */
const TEXT_ROLES = new Set(["searchbox", "spinbutton", "textbox"]);

/** Roles that repeat themselves; a click on the container is rarely useful. */
const COLLECTION_ROLES = new Set([
	"cell",
	"columnheader",
	"grid",
	"gridcell",
	"row",
	"rowgroup",
	"rowheader",
	"table",
]);

/**
 * Roles that describe content rather than offer a control. They are traversed
 * but never offered as actions, otherwise every heading becomes a candidate.
 * Choice containers are here too: the items inside them are the real targets.
 */
const CONTENT_ROLES = new Set([
	"alert",
	"article",
	"banner",
	"blockquote",
	"caption",
	"code",
	"columnheader",
	"complementary",
	"contentinfo",
	"definition",
	"dialog",
	"emphasis",
	"figure",
	"form",
	"generic",
	"group",
	"heading",
	"iframe",
	"image",
	"img",
	"label",
	"list",
	"listbox",
	"listitem",
	"log",
	"main",
	"mark",
	"math",
	"menu",
	"meter",
	"navigation",
	"none",
	"note",
	"paragraph",
	"presentation",
	"progressbar",
	"radiogroup",
	"region",
	"row",
	"rowgroup",
	"rowheader",
	"search",
	"separator",
	"status",
	"strong",
	"subscript",
	"superscript",
	"table",
	"tablist",
	"term",
	"text",
	"time",
	"toolbar",
	"tooltip",
	"tree",
]);

const CHOICE_ROLES = new Set(["listbox", "menu"]);

type SnapshotNode = {
	role: string;
	name: string;
	ref?: string;
	states: string[];
	text: string;
	value: string;
	placeholder: string;
	children: SnapshotNode[];
};

function parseDescriptor(
	descriptor: string,
): { role: string; name: string; ref?: string; states: string[] } | null {
	const match = descriptor.match(
		/^([\w-]+)(?:\s+"((?:[^"\\]|\\.)*)")?((?:\s+\[[^\]]+\])*)$/,
	);
	if (!match) return null;

	const attributes = [...(match[3] ?? "").matchAll(/\[([^\]]+)\]/g)].map(
		(attribute) => attribute[1],
	);

	return {
		role: match[1],
		name: (match[2] ?? "").replace(/\\([\\"])/g, "$1"),
		ref: attributes
			.find((attribute) => attribute.startsWith("ref="))
			?.slice("ref=".length),
		states: attributes.filter(
			(attribute) =>
				!attribute.startsWith("ref=") && attribute !== "cursor=pointer",
		),
	};
}

function readNode(descriptor: string, content: unknown): SnapshotNode | null {
	const parsed = parseDescriptor(descriptor);
	if (!parsed) return null;

	const node: SnapshotNode = {
		...parsed,
		text: typeof content === "string" ? content : "",
		value: "",
		placeholder: "",
		children: [],
	};

	if (!Array.isArray(content)) return node;

	for (const item of content) {
		if (typeof item === "string") {
			const child = readNode(item, null);
			if (child) node.children.push(child);
			continue;
		}
		if (!item || typeof item !== "object") continue;

		for (const [key, value] of Object.entries(item)) {
			if (key === "/placeholder") {
				node.placeholder = String(value);
				continue;
			}
			if (key === "/value") {
				node.value = String(value);
				continue;
			}
			if (key.startsWith("/")) continue;
			if (key === "text") {
				node.text = [node.text, String(value)].filter(Boolean).join(" ");
				continue;
			}

			const child = readNode(key, value);
			if (child) node.children.push(child);
		}
	}

	return node;
}

function readNodes(items: unknown[]): SnapshotNode[] {
	const nodes: SnapshotNode[] = [];

	for (const item of items) {
		if (typeof item === "string") {
			const node = readNode(item, null);
			if (node) nodes.push(node);
			continue;
		}
		if (!item || typeof item !== "object") continue;

		for (const [descriptor, content] of Object.entries(item)) {
			const node = readNode(descriptor, content);
			if (node) nodes.push(node);
		}
	}

	return nodes;
}

function nodeText(node: SnapshotNode): string {
	return [node.text, ...node.children.map(nodeText)]
		.filter(Boolean)
		.join(" ")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Playwright's aria snapshot carries the accessible name when it can compute
 * one. When it cannot, fall back the way the accname spec does: name from
 * content, with the placeholder as the host-language fallback.
 */
function nodeName(node: SnapshotNode): string {
	if (node.name) return node.name;

	return node.placeholder || node.value || nodeText(node);
}

/**
 * A bare combobox is a text input. A combobox that already has children is a
 * picker whose options are separate nodes, so typing into it is not the way to
 * choose; opening it is.
 */
function fillable(node: SnapshotNode): boolean {
	if (TEXT_ROLES.has(node.role)) return true;

	return node.role === "combobox" && node.children.length === 0;
}

function optionChildren(node: SnapshotNode): BrowserOption[] {
	return node.children
		.filter((child) => child.role === "option")
		.map((child) => ({ name: nodeName(child), ref: child.ref }));
}

/** Containers whose name is meaningful enough to name an unnamed control. */
const CONTEXT_ROLES = new Set([
	"article",
	"complementary",
	"dialog",
	"figure",
	"form",
	"group",
	"main",
	"navigation",
	"region",
	"search",
	"tabpanel",
	"table",
]);

/**
 * Names a control by where it lives, so a control that has no accessible name
 * at this instant stays reachable instead of being silently dropped. Only
 * containers with a real name qualify; a generic wrapper's name is just its
 * concatenated contents and would name nothing.
 */
function contextOf(path: { role: string; name: string }[]): string {
	for (let index = path.length - 1; index >= 0; index -= 1) {
		const { role, name } = path[index];
		if (!name || !CONTEXT_ROLES.has(role)) continue;
		// A container whose "name" is a paragraph of concatenated content is not
		// a label, it is an artefact of the snapshot.
		if (name.length > 60) continue;

		return `${role} "${name}"`;
	}

	return "";
}

export function observe(snapshotYaml: string): Observation {
	const parsed = parse(snapshotYaml);
	const roots = readNodes(Array.isArray(parsed) ? parsed : []);
	const collected: { element: BrowserElement; priority: number }[] = [];
	const texts: string[] = [];
	const openLists: string[] = [];

	type Ancestor = { role: string; name: string };

	function visit(node: SnapshotNode, path: Ancestor[]): void {
		if (node.text) texts.push(node.text);

		if (CHOICE_ROLES.has(node.role)) {
			const options = optionChildren(node);
			if (options.length) {
				openLists.push(
					`${node.role} with ${options.length} options: ` +
						options
							.slice(0, 8)
							.map((option) => option.name.slice(0, 40))
							.join(", "),
				);
			}
		}

		const name = nodeName(node);
		const value = node.value || node.text;
		const context = name ? "" : contextOf(path);
		const nextPath = [...path, { role: node.role, name }];

		if (CONTENT_ROLES.has(node.role)) {
			for (const child of node.children) visit(child, nextPath);
			return;
		}

		const options = optionChildren(node);
		const redundant = path.some(
			(ancestor) =>
				COLLECTION_ROLES.has(ancestor.role) && ancestor.name === name,
		);

		if (
			node.ref &&
			(name || context) &&
			!node.states.includes("disabled") &&
			!redundant
		) {
			const canFill = fillable(node);
			const inCollection = path.some((ancestor) =>
				COLLECTION_ROLES.has(ancestor.role),
			);

			collected.push({
				element: {
					id: "",
					role: node.role,
					name,
					context,
					value: canFill ? value : "",
					states: node.states,
					ref: node.ref,
					canClick: true,
					canFill,
					options,
				},
				// Filling an empty field is how goals get satisfied, so those
				// candidates survive the cap first; collection rows last.
				priority: canFill && !value ? 0 : inCollection ? 2 : 1,
			});
		}

		for (const child of node.children) visit(child, nextPath);
	}

	for (const root of roots) visit(root, []);

	const elements = collected
		.map((entry, index) => ({ ...entry, index }))
		.sort(
			(left, right) =>
				left.priority - right.priority || left.index - right.index,
		)
		.slice(0, MAX_ELEMENTS)
		.sort((left, right) => left.index - right.index)
		.map((entry) => entry.element);

	elements.forEach((element, index) => {
		element.id = `e${index + 1}`;
	});

	return {
		fingerprint: createHash("sha1").update(snapshotYaml).digest("hex"),
		text: texts.join("\n").slice(0, MAX_TEXT),
		elements,
		openLists,
	};
}

/** Whether an open choice list is waiting for a selection. */
export function hasOpenChoiceList(observation: Observation): boolean {
	return observation.openLists.length > 0;
}
