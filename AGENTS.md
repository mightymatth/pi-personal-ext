# AGENTS.md

Personal pi coding agent extension. Lives at `~/.pi/agent/extensions/pi-personal-ext`.

## Stack

- **Runtime**: Bun 1.4.4+ (canary with native tooling)
- **Language**: TypeScript (strict, ESM)
- **Tooling**: Native `bun fmt`, `bun lint`, `bun check`, and `bun test` (config: `bunfig.toml`)
- **Package type**: pi extension

## Project files

| File           | Purpose                                                        |
| -------------- | -------------------------------------------------------------- |
| `index.ts`     | Extension entrypoint — tools, commands, shortcuts, event hooks |
| `package.json` | Package metadata + `pi.extensions` entry                       |

## Development

```shell
# install dependencies
bun i

# Always run checks and fixes after code or prompt changes!
bun run check:fix
```
