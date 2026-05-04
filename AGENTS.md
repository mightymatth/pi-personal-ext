# AGENTS.md

Personal pi coding agent extension. Lives at `~/.pi/agent/extensions/pi-personal-ext`.

## Stack

- **Runtime**: Bun
- **Language**: TypeScript (strict, ESM)
- **Formatter/Linter**: Biome (config: `biome.json`)
- **Package type**: pi extension

## Project files

| File | Purpose |
|---|---|
| `index.ts` | Extension entrypoint — tools, commands, shortcuts, event hooks |
| `package.json` | Package metadata + `pi.extensions` entry |

## Development

```
# install dependencies
bun i

# Always run lint+fix after code or prompt changes!
bun run lint:fix
```
