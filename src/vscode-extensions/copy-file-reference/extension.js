import * as vscode from "vscode";

export function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("copyFileReference.copy", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const rel = vscode.workspace.asRelativePath(editor.document.uri, false);
      const sel = editor.selection;
      const start = sel.start.line + 1;
      const end = sel.end.line + 1;

      const ref =
        sel.isEmpty || start === end
          ? `@${rel}#L${start}`
          : `@${rel}#L${start}-L${end}`;

      await vscode.env.clipboard.writeText(ref);
      vscode.window.setStatusBarMessage(`Copied: ${ref}`, 2000);
    }),
  );
}
