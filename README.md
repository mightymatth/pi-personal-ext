# pi-personal-ext

Personal Pi extensions, settings, skills, prompts, and VS Code extensions.

## Installation

```bash
pi install git:github.com/mightymatth/pi-personal-ext
```

Run `/personal-setup`.

For a checkout you intend to edit, use the development installation below instead.

## Commands

- `/code` — open Pi's current project or worktree folder in VS Code using the
  `code` CLI, without forcing a new window or replacing the last active window.
  Requires `code` on `PATH`; on macOS, install it through VS Code's command palette
  with **Shell Command: Install 'code' command in PATH**.

## MCP

MCP servers are defined in `config/mcp.json` and registered when the extension loads.
Built-in MCP is the default. `pi-mcp-adapter` is not bundled; projects can enable
it where server compatibility requires it.

## Skills

Vendored skills and their upstream sources are defined in `skills.ts`.

```bash
bun run skills list
bun run skills update
bun run skills update opensrc
```

## Installation for development

Requires Bun 1.4.4+ with native `fmt`, `lint`, and `check` commands (currently canary).

Clone a local checkout and register it with Pi:

```bash
git clone https://github.com/mightymatth/pi-personal-ext.git ~/dev/pi-personal-ext
cd ~/dev/pi-personal-ext
bun install
bun run setup --local-path "$PWD"
```

Setup registers this checkout, installs missing companion extensions, and links
the bundled VS Code extensions. Use `--dry-run` to preview changes.

After making changes:

```bash
bun run check:fix # fix lint, format, then validate everything
```

Native commands are also available individually:

```bash
bun fmt          # format (tabs and sorted imports configured in bunfig.toml)
bun fmt --check  # check formatting without writing
bun lint         # lint
bun lint --fix   # apply lint fixes
bun check        # type-check using tsconfig.json
bun test         # run tests
bun run verify   # read-only formatting, lint (no warnings), types, and tests
```

Run `/reload` in Pi to load your changes.
