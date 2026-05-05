/**
 * Installs local VS Code extensions by symlinking them
 * into ~/.vscode/extensions/
 *
 * Extensions live as real files under src/vscode-extensions/<name>/
 */

import { symlink, readlink, unlink, lstat } from 'node:fs/promises'
import { readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'

const EXTENSIONS_SRC = resolve(import.meta.dirname ?? __dirname, 'vscode-extensions')
const VSCODE_EXT_DIR = join(homedir(), '.vscode', 'extensions')

async function isSymlinkTo(path: string, target: string): Promise<boolean> {
  try {
    const stat = await lstat(path)
    if (!stat.isSymbolicLink()) return false
    const existing = await readlink(path)
    return resolve(existing) === resolve(target)
  } catch {
    return false
  }
}

async function linkExtension(name: string): Promise<void> {
  const src = join(EXTENSIONS_SRC, name)
  const dest = join(VSCODE_EXT_DIR, `local.${name}`)

  if (await isSymlinkTo(dest, src)) {
    console.log(`  [skip] ${name} (already linked)`)
    return
  }

  // Remove stale link/dir if exists
  try {
    await unlink(dest)
  } catch {}

  await symlink(src, dest, 'dir')
  console.log(`  [link] ${name} -> ${dest}`)
}

export async function installAll(): Promise<void> {
  const extensions = readdirSync(EXTENSIONS_SRC, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)

  console.log('==> Linking VS Code extensions')
  for (const ext of extensions) {
    await linkExtension(ext)
  }
  console.log('==> Done. Reload VS Code to activate.')
}
