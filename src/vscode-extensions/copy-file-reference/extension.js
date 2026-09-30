import * as vscode from "vscode";

import { formatCopyText, formatFileReference } from "./format.js";

export function activate(context) {
	async function copyReference(includeSelection) {
		const editor = vscode.window.activeTextEditor;
		if (!editor) return;

		const relativePath = vscode.workspace.asRelativePath(
			editor.document.uri,
			false,
		);
		const selection = editor.selection;
		const reference = formatFileReference(relativePath, selection);
		const text = includeSelection
			? formatCopyText(
					relativePath,
					selection,
					editor.document.getText(selection),
				)
			: reference;

		await vscode.env.clipboard.writeText(`${text}\n`);
		vscode.window.setStatusBarMessage(`Copied: ${reference}`, 2000);
	}

	context.subscriptions.push(
		vscode.commands.registerCommand("copyFileReference.copy", () =>
			copyReference(false),
		),
		vscode.commands.registerCommand("copyFileReference.copyWithSelection", () =>
			copyReference(true),
		),
	);
}
