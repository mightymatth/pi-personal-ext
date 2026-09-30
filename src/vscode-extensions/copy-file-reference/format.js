function getSelectionLines(selection) {
	const first = selection.start.line + 1;
	const endsAtStartOfLine = !selection.isEmpty && selection.end.character === 0;
	const last = endsAtStartOfLine ? selection.end.line : selection.end.line + 1;

	return { first, last };
}

export function formatFileReference(relativePath, selection) {
	const { first, last } = getSelectionLines(selection);

	return selection.isEmpty || first === last
		? `@${relativePath}:${first}`
		: `@${relativePath}:${first}-${last}`;
}

export function formatCopyText(relativePath, selection, selectedText) {
	const reference = formatFileReference(relativePath, selection);
	if (selection.isEmpty) return reference;

	const excerpt = selectedText
		.replace(/\r?\n$/, "")
		.split(/\r?\n/)
		.map((line) => `> ${line}`)
		.join("\n");
	return `${reference}\n\n${excerpt}`;
}
