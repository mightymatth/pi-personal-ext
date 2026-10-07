# pi-personal-ext

Personal Pi extensions, settings, skills, prompts, and VS Code extensions.

## Installation

```bash
pi install git:github.com/mightymatth/pi-personal-ext
```

Run `/personal-setup`.

For a checkout you intend to edit, use the development installation below instead.

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
bun run check:fix
bun test
```

Run `/reload` in Pi to load your changes.
