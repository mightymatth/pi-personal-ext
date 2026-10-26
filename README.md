# pi-personal-ext

Personal Pi extensions, settings, skills, prompts, and VS Code extensions.

## Installation

```bash
pi install git:github.com/mightymatth/pi-personal-ext
```

Run `/personal-setup`.

For a checkout you intend to edit, use the development installation below instead.

## Commands

- `/code` — open the current project folder in VS Code. Requires `code` on `PATH`.

## MCP

`/personal-setup` installs `pi-mcp-adapter`. Servers from `config/mcp.json`
register when the extension loads; Pi and the adapter handle the integration.

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
