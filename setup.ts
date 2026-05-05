#!/usr/bin/env -S bun run
import { installAll } from './src/vscode-extensions'

await installAll()
