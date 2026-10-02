# pi-personal-ext

Personal Pi extensions, settings, skills, prompts, and VS Code extensions.

## Installation

```bash
git clone https://github.com/mightymatth/pi-personal-ext.git \
  "${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/extensions/pi-personal-ext"
cd "${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/extensions/pi-personal-ext"
bun install
bun run setup
```

Setup registers the local package, merges `config/settings.json`, removes duplicate
permission/web package declarations, and links the bundled VS Code extensions.
Existing settings are backed up; unrelated preferences and credentials are preserved.

```bash
bun run setup --dry-run
```

## MCP

Built-in MCP is the default. `pi-mcp-adapter` is not bundled; projects can enable
it where server compatibility requires it.

## Skills

Vendored skills and their upstream sources are defined in `skills.ts`.

```bash
bun run skills list
bun run skills update
bun run skills update opensrc
```

## Development

```bash
bun run check:fix
bun test
```
