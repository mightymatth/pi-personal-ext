# pi-personal-ext

mightymatth's personal pi coding agent extension.

<!-- permission test -->

## Installation

```bash
pi install git:github.com:mightymatth/pi-personal-ext
```

## Features

- `ctrl+shift+y` toggles permission mode immediately.
- Add your custom tools, commands, and event handlers in `index.ts`.

## Setup

Install personal VS Code extensions and other tooling:

```bash
bun run ~/.pi/agent/extensions/pi-personal-ext/setup.ts
```

## Skills

Skills in `skills/` are vendored from upstream repositories and can be refreshed on demand:

```bash
bun run skills list
bun run skills update
# or only one skill
bun run skills update opensrc
```

Edit `skills.ts` to add or change skill sources.

## Development

```bash
# Edit your extension
vim ~/.pi/agent/extensions/pi-personal-ext/index.ts

# Reload to pick up changes
/reload

# follow this guide during development
# pi-coding-agent/docs/extensions.md
```
