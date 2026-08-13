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
	const { first, last } = getSelectionLines(selection);
	const isWholeLineSelection =
		!selection.isEmpty &&
		selection.start.character === 0 &&
		selection.end.character === 0;
	const shouldIncludeExcerpt =
		!selection.isEmpty && first === last && !isWholeLineSelection;
	const reference = formatFileReference(relativePath, selection);

	if (!shouldIncludeExcerpt) return reference;

	const excerpt = selectedText.replace(/\r?\n$/, "");
	return `${reference}\n\n> ${excerpt}`;
}
