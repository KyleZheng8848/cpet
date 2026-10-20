#!/usr/bin/env node
/**
 * Copy a finished pack into the CPET app's userData skins dir.
 *
 *   cpet install <包名>
 *
 * macOS default: ~/Library/Application Support/cursor-pet/skins/<包名>
 * Override with CPET_USERDATA_DIR. Quit the app fully (Cmd+Q) before relaunch.
 */
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { join, resolve } from 'node:path'
import { SKINS, describePaths } from './lib/skin-catalog.mjs'

const packName = process.argv[2]
if (!packName) {
  console.error('Usage: cpet install <包名>')
  process.exit(1)
}

const src = join(SKINS, packName)
if (!existsSync(src)) {
  console.error(`missing pack: ${src}\n${describePaths()}`)
  process.exit(1)
}
const gifs = readdirSync(src).filter((f) => /\.(gif|png)$/i.test(f))
if (!gifs.length) {
  console.error(`pack has no gif/png: ${src} — run "cpet gif" first`)
  process.exit(1)
}

function userDataSkins() {
  const override = process.env.CPET_USERDATA_DIR
  if (override && override.trim()) return resolve(override.trim())
  if (platform() === 'darwin') return join(homedir(), 'Library/Application Support/cursor-pet/skins')
  if (platform() === 'win32') return join(process.env.APPDATA || join(homedir(), 'AppData/Roaming'), 'cursor-pet/skins')
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'cursor-pet/skins')
}

const dest = join(userDataSkins(), packName)
mkdirSync(dest, { recursive: true })
cpSync(src, dest, { recursive: true })
console.log(`installed ${gifs.length} file(s) → ${dest}`)
console.log('quit the app completely (Cmd+Q) and relaunch to pick it up.')
