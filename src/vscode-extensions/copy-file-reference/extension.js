import * as vscode from "vscode";

import { formatCopyText, formatFileReference } from "./format.js";

export function activate(context) {
	context.subscriptions.push(
		vscode.commands.registerCommand("copyFileReference.copy", async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) return;

			const relativePath = vscode.workspace.asRelativePath(
				editor.document.uri,
				false,
			);
			const selection = editor.selection;
			const text = formatCopyText(
				relativePath,
				selection,
				editor.document.getText(selection),
			);
			const reference = formatFileReference(relativePath, selection);

			await vscode.env.clipboard.writeText(text);
			vscode.window.setStatusBarMessage(`Copied: ${reference}`, 2000);
		}),
	);
}
