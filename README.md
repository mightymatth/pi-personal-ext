# pi-personal-ext

mightymatth's personal Pi package: extensions, configuration, skills, prompts, and VS Code extensions.

## Setup

Prerequisites: Git, Bun, and Pi installed and available on `PATH`.

```bash
git clone https://github.com/mightymatth/pi-personal-ext.git
cd pi-personal-ext
bun install
bun run setup
```

`bun install` installs this package's dependencies, including the permission and
web extensions. Their entry points are declared in `package.json` alongside our
extension, skills, and prompt templates. Pi loads them as one package.

MCP uses Pi's built-in support, not `pi-mcp-adapter`. Configure personal servers in
`~/.pi/agent/mcp.json` and project servers in `.pi/mcp.json`. Use `pi mcp list`
to check connections and `/mcp` inside Pi to manage them. OAuth servers require
`pi mcp login <server>`; adapter credentials are not migrated.

`bun run setup`:

- Registers this repo as a local Pi package in `~/.pi/agent/settings.json` (or `PI_CODING_AGENT_DIR`).
- Applies `config/settings.json`, preserving unrelated settings and nested preferences.
- Replaces separate declarations for the bundled extensions so they do not load twice.
- Backs up existing settings before changing them.
- Links bundled VS Code extensions into `~/.vscode/extensions`.

Provider, model, model availability, theme, and credentials remain machine-local.
On a fresh machine, configure authentication and select a model in Pi. No custom theme is required.
Restart Pi and reload VS Code after setup.

Preview without changing settings or creating links:

```bash
bun run setup --dry-run
```

After updating the repo, run `bun install` and `bun run setup` again. Setup does not
spawn package installers or rewrite unchanged settings. Do not run it concurrently
with another settings writer. Project settings can override global defaults.

Keep the repo at its registered location: Pi loads the local package directly.

Codemode is activated by the extension's session-start hook if the built-in tool is
available. Otherwise, Pi displays a warning. `codemode.mode: "on"` keeps direct tools available.

## Skills

Skills in `skills/` are vendored from upstream repositories:

```bash
bun run skills list
bun run skills update
bun run skills update opensrc
```

Edit `skills.ts` to add or change skill sources.

## Development

```bash
bun run check:fix
bun test
```

Use `/reload` in Pi to reload extension changes.
