/**
 * Path + env resolution for the CPET skin factory (portable / cwd-independent).
 *
 * The whole toolchain lives inside the skill, so it can be invoked by absolute
 * path from any project. Nothing here resolves relative to process.cwd() except
 * the *output* dir, which is intentionally project-local:
 *
 *   1. $CPET_OUT_DIR (aliases: $CPET_SKINS_DIR, $CPET_ASSETS_DIR, $CPET_WORK_ROOT)
 *   2. existing `cpet-skins/` at cwd or any ancestor up to the project root
 *   3. existing CPET-shaped `assets/skins/` in that same range (already holds
 *      `_work/` or `LIFECYCLE.json` — this keeps the cursor-pet repo behaving
 *      exactly like before)
 *   4. `<cwd>/cpet-skins`                                (fresh project default)
 *
 * The upward walk stops at the project root (nearest ancestor with `.git`, or
 * cwd when there is none) so a stray `~/cpet-skins` or `/tmp/cpet-skins` can
 * never swallow another project's output.
 *
 * Catalogs (LIFECYCLE.json / ACTION_CATALOG.json) resolve to the out dir when
 * present, otherwise to the skill's own `catalogs/` — never a hardcoded repo path.
 *
 * Keep in sync with the Python mirror: lib/cpet_paths.py
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, parse, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** <skill>/scripts */
export const SCRIPTS = resolve(__dirname, '..')
/** <skill> — self-contained: catalogs, providers, bin and docs all live here. */
export const SKILL_ROOT = resolve(SCRIPTS, '..')
/** Catalog fallback bundled with the skill. */
export const SKILL_CATALOGS = join(SKILL_ROOT, 'catalogs')

const OUT_DIR_ENV = ['CPET_OUT_DIR', 'CPET_SKINS_DIR', 'CPET_ASSETS_DIR', 'CPET_WORK_ROOT']
const DEFAULT_OUT_NAME = 'cpet-skins'

function isDir(p) {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** A dir counts as a CPET skins dir once the factory has written into it. */
function looksLikeSkinsDir(p) {
  return isDir(join(p, '_work')) || existsSync(join(p, 'LIFECYCLE.json'))
}

/** cwd, then each ancestor up to and including the project root (`.git` holder). */
function searchDirs(from = process.cwd()) {
  const start = resolve(from)
  const fsRoot = parse(start).root
  const chain = []
  let dir = start
  for (;;) {
    chain.push(dir)
    if (existsSync(join(dir, '.git'))) return chain
    if (dir === fsRoot) break
    dir = dirname(dir)
  }
  return [start]
}

/** First `rel` that exists (and passes `accept`) within the project. */
function findInProject(rel, accept = isDir) {
  for (const dir of searchDirs()) {
    const hit = join(dir, rel)
    if (isDir(hit) && accept(hit)) return hit
  }
  return null
}

function envOutDir() {
  for (const key of OUT_DIR_ENV) {
    const v = process.env[key]
    if (v && v.trim()) return { dir: resolve(v.trim()), source: `$${key}` }
  }
  return null
}

function parseEnvFile(text) {
  const out = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const body = line.startsWith('export ') ? line.slice(7).trim() : line
    const eq = body.indexOf('=')
    if (eq <= 0) continue
    const key = body.slice(0, eq).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    let value = body.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

/** `.env.local` / `.env` inside the current project, plus the global fallback. */
export function envFileCandidates() {
  const list = []
  for (const key of ['CPET_ENV_FILE', 'CPET_SKINS_ENV']) {
    const v = process.env[key]
    if (v && v.trim()) list.push(resolve(v.trim()))
  }
  for (const dir of searchDirs()) {
    list.push(join(dir, '.env.local'))
    list.push(join(dir, '.env'))
  }
  list.push(join(homedir(), '.config/cpet-skins/.env'))
  return list
}

/** Load env files without clobbering anything already exported. Returns files used. */
export function loadEnvFiles() {
  const used = []
  for (const file of envFileCandidates()) {
    if (!existsSync(file)) continue
    let parsed
    try {
      parsed = parseEnvFile(readFileSync(file, 'utf8'))
    } catch {
      continue
    }
    let applied = false
    for (const [k, v] of Object.entries(parsed)) {
      if (process.env[k] === undefined) {
        process.env[k] = v
        applied = true
      }
    }
    if (applied) used.push(file)
  }
  return used
}

// Must run before SKINS is computed: an env file may define CPET_OUT_DIR.
export const ENV_FILES_LOADED = loadEnvFiles()

const resolved =
  envOutDir() ||
  (() => {
    const own = findInProject(DEFAULT_OUT_NAME)
    if (own) return { dir: own, source: `${DEFAULT_OUT_NAME}/ found in project` }
    const legacy = findInProject('assets/skins', looksLikeSkinsDir)
    if (legacy) return { dir: legacy, source: 'CPET-shaped assets/skins found in project' }
    return {
      dir: join(resolve(process.cwd()), DEFAULT_OUT_NAME),
      source: `<cwd>/${DEFAULT_OUT_NAME} (default)`
    }
  })()

/** Where packs and the `_work` scratch area live. */
export const SKINS = resolved.dir
/** How SKINS was decided — printed in error messages so failures are debuggable. */
export const SKINS_SOURCE = resolved.source
/** Intermediate artifacts. The app skips `_work` when scanning for packs. */
export const WORK = join(SKINS, '_work')

export function workDir(skinId) {
  return join(WORK, skinId)
}

export function packDir(packName) {
  return join(SKINS, packName)
}

/** Catalog source of truth: out dir first, skill-bundled copy as fallback. */
export function catalogPath(name) {
  const override = process.env.CPET_CATALOG_DIR
  if (override && override.trim()) {
    const p = join(resolve(override.trim()), name)
    if (existsSync(p)) return p
  }
  const primary = join(SKINS, name)
  if (existsSync(primary)) return primary
  const bundled = join(SKILL_CATALOGS, name)
  if (existsSync(bundled)) return bundled
  throw new Error(
    `missing catalog ${name}\n  looked in: ${primary}\n             ${bundled}\n` +
      `  (out dir from ${SKINS_SOURCE}; set CPET_OUT_DIR to override)`
  )
}

/** Human-readable resolution report, reused by doctor.mjs and error paths. */
export function describePaths() {
  return [
    `skill      ${SKILL_ROOT}`,
    `out dir    ${SKINS}   [${SKINS_SOURCE}]${existsSync(SKINS) ? '' : '   (does not exist yet)'}`,
    `work       ${WORK}${existsSync(WORK) ? '' : '   (does not exist yet)'}`,
    `catalogs   ${existsSync(join(SKINS, 'LIFECYCLE.json')) ? SKINS : SKILL_CATALOGS}`,
    `env files  ${ENV_FILES_LOADED.length ? ENV_FILES_LOADED.join(', ') : '(none found)'}`
  ].join('\n')
}
