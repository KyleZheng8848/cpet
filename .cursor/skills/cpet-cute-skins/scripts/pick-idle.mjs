#!/usr/bin/env node
/**
 * Lock the chosen idle candidate as the identity anchor.
 *
 *   cpet pick <skinId> <candidate.png|N>
 *
 * `N` is shorthand for _idle_cands/idle-N.png. Refuses to overwrite an existing
 * anchor unless FORCE=1, because every other stem is generated against it.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { loadSkin, workDir } from './lib/skin-catalog.mjs'

const [skinId, choice] = process.argv.slice(2)
if (!skinId || !choice) {
  console.error('Usage: cpet pick <skinId> <candidate.png|N>')
  process.exit(1)
}

loadSkin(skinId)
const dir = workDir(skinId)
const cands = join(dir, '_idle_cands')

let src
if (/^\d+$/.test(choice)) src = join(cands, `idle-${choice}.png`)
else if (isAbsolute(choice) || existsSync(resolve(choice))) src = resolve(choice)
else src = join(cands, choice)

if (!existsSync(src)) {
  const have = existsSync(cands) ? readdirSync(cands).join(', ') : '(no _idle_cands yet)'
  console.error(`no such candidate: ${src}\n  available: ${have}`)
  process.exit(1)
}

const dest = join(dir, 'raw', 'idle.png')
if (existsSync(dest) && !process.env.FORCE) {
  console.error(`anchor already locked: ${dest}\n  re-locking invalidates every other stem; use FORCE=1 if you really mean it.`)
  process.exit(1)
}
mkdirSync(join(dir, 'raw'), { recursive: true })
copyFileSync(src, dest)
console.log('locked idle anchor:', dest, '←', src)
