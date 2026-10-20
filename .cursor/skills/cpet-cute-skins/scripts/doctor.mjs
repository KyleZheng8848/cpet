#!/usr/bin/env node
/**
 * Preflight for the CPET skin factory: paths, runtimes, python deps.
 *
 *   cpet doctor          full check (exit 1 if anything blocking is missing)
 *   cpet paths           just the resolved paths
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  SKILL_ROOT,
  SKINS,
  WORK,
  describePaths,
  listSkinIds
} from './lib/skin-catalog.mjs'

const PY = process.env.CPET_PYTHON || 'python3'
const pathsOnly = process.argv.includes('--paths-only')

console.log(describePaths())
if (pathsOnly) process.exit(0)

const problems = []
const notes = []

const [major] = process.versions.node.split('.').map(Number)
if (major < 18) problems.push(`node ${process.versions.node} too old — need ≥18 (fetch/FormData/File)`)
else notes.push(`node       ${process.versions.node}`)

const pyv = spawnSync(PY, ['-c', 'import sys;print("%d.%d.%d"%sys.version_info[:3])'], { encoding: 'utf8' })
if (pyv.status !== 0) {
  problems.push(`${PY} not runnable — install Python 3.9+ or set CPET_PYTHON`)
} else {
  notes.push(`python     ${pyv.stdout.trim()} (${PY})`)
  const deps = spawnSync(
    PY,
    ['-c', 'import PIL,numpy;print("Pillow",PIL.__version__,"numpy",numpy.__version__)'],
    { encoding: 'utf8' }
  )
  if (deps.status !== 0) {
    problems.push(`python deps missing — ${PY} -m pip install --user Pillow numpy`)
  } else {
    notes.push(`py deps    ${deps.stdout.trim()}`)
  }
  const sam = spawnSync(
    PY,
    [
      '-c',
      `import os
from pathlib import Path
import sam2
home = Path.home()
env = os.environ.get("SAM2_CHECKPOINT","").strip()
cands = [Path(env).expanduser()] if env else []
cands += [home/"Desktop"/"sam2_hiera_small.pt", home/".cache"/"cpet-skins"/"sam2_hiera_small.pt"]
hit = next((p for p in cands if p.is_file()), None)
print("sam2", "ckpt", hit if hit else "MISSING")`
    ],
    { encoding: 'utf8' }
  )
  if (sam.status !== 0) {
    problems.push(`sam2 missing — ${PY} -m pip install sam2  (cutout). Weights: SAM2_CHECKPOINT or ~/Desktop/sam2_hiera_small.pt`)
  } else if (sam.stdout.includes('MISSING')) {
    problems.push(`sam2 package ok, checkpoint missing — set SAM2_CHECKPOINT or put sam2_hiera_small.pt on the Desktop`)
  } else {
    notes.push(`sam2       ${sam.stdout.trim()}`)
  }
}

for (const f of ['catalogs/LIFECYCLE.json', 'catalogs/ACTION_CATALOG.json', 'reference.md']) {
  if (!existsSync(join(SKILL_ROOT, f))) problems.push(`skill file missing: ${f}`)
}

notes.push(`frames     ${process.env.FRAMES || '4'} (clamped 3..8)`)

const ids = existsSync(WORK) ? listSkinIds() : []
notes.push(`skins here ${ids.length ? ids.join(', ') : '(none yet)'}`)

console.log('\n' + notes.join('\n'))

if (problems.length) {
  console.error('\nBLOCKING (' + problems.length + '):')
  for (const p of problems) console.error('  - ' + p.replace(/\n/g, '\n    '))
  process.exit(1)
}
console.log(`\nready — output will land in ${SKINS}`)
