/**
 * Shared catalog + skin.json helpers for CPET skin factory.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const ROOT = join(__dirname, '../..')
export const SKINS = join(ROOT, 'assets/skins')
export const WORK = join(SKINS, '_work')
/** Skill-bundled catalogs (independent skill docs; keep in sync with assets/skins). */
export const SKILL_CATALOGS = join(ROOT, '.cursor/skills/cpet-cute-skins/catalogs')

export function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function resolveCatalog(name) {
  const primary = join(SKINS, name)
  if (existsSync(primary)) return primary
  const bundled = join(SKILL_CATALOGS, name)
  if (existsSync(bundled)) return bundled
  throw new Error(`missing catalog ${name} (checked assets/skins and skill catalogs/)`)
}

export function lifecycle() {
  return loadJson(resolveCatalog('LIFECYCLE.json'))
}

export function actionCatalog() {
  return loadJson(resolveCatalog('ACTION_CATALOG.json'))
}

export function reservedNames() {
  return new Set(lifecycle().reserved.map((s) => s.toLowerCase()))
}

export function allStemDefs() {
  const life = lifecycle().states
  const actions = actionCatalog().actions
  for (const a of actions) {
    if (reservedNames().has(a.id.toLowerCase())) {
      throw new Error(`ACTION_CATALOG id "${a.id}" collides with reserved lifecycle/docked name`)
    }
  }
  return {
    lifecycle: life,
    actions,
    all: [...life, ...actions]
  }
}

export function workDir(skinId) {
  return join(WORK, skinId)
}

export function skinJsonPath(skinId) {
  return join(workDir(skinId), 'skin.json')
}

export function loadSkin(skinId) {
  const p = skinJsonPath(skinId)
  if (!existsSync(p)) throw new Error(`missing skin.json: ${p}`)
  const skin = loadJson(p)
  if (!skin.id || !skin.packName || !skin.characterPrompt) {
    throw new Error(`skin.json incomplete (need id, packName, characterPrompt): ${p}`)
  }
  return skin
}

export function writeSkin(skin) {
  const dir = workDir(skin.id)
  mkdirSync(dir, { recursive: true })
  mkdirSync(join(dir, 'raw'), { recursive: true })
  mkdirSync(join(dir, 'anim'), { recursive: true })
  const path = skinJsonPath(skin.id)
  const normalized = {
    id: skin.id,
    packName: skin.packName,
    characterPrompt: skin.characterPrompt,
    identityRef: skin.identityRef || 'raw/idle.png',
    model: skin.model || ''
  }
  writeFileSync(path, JSON.stringify(normalized, null, 2) + '\n', 'utf8')
  writeFileSync(
    join(dir, 'identity.json'),
    JSON.stringify(
      {
        id: normalized.id,
        packName: normalized.packName,
        characterPrompt: normalized.characterPrompt,
        identityRef: normalized.identityRef
      },
      null,
      2
    ) + '\n',
    'utf8'
  )
  return path
}

export const COMMON_STYLE =
  'cute kawaii desktop pet mascot, SINGLE character only, ONE body ONE face, centered, full body with small margin, chubby round proportions, big shiny eyes soft blush, thick clean dark outline, flat soft shading, crisply drawn single-line features, NO motion blur, NO double exposure, NO ghosting, NO afterimage, NO overlapping duplicate eyes/ears/mouth, NO text NO watermark NO logo NO speech bubble NO UI, NO drop shadow under the character, NO floating detached prop stickers around the body, fill the ENTIRE square canvas with opaque solid flat white (#FFFFFF) — do NOT draw any transparency checkerboard / alpha grid / Photoshop preview pattern, NEVER gray/dark studio backdrop, cutout-friendly'

export function stemPrompt(skin, stemDef) {
  return `${COMMON_STYLE}. Character design (LOCKED): ${skin.characterPrompt}. Pose/emotion: ${stemDef.pose}. CRITICAL vs reference image: keep the SAME species, colors, outline, face, body silhouette, ear count, and limb/foot count — never invent extra legs/ears/props; ONLY change pose/expression and props required by this pose.`
}

export function listSkinIds() {
  if (!existsSync(WORK)) return []
  return readdirSync(WORK)
    .filter((name) => {
      if (name.startsWith('.') || name.startsWith('_')) return false
      try {
        return statSync(join(WORK, name)).isDirectory() && existsSync(skinJsonPath(name))
      } catch {
        return false
      }
    })
    .sort()
}

export function packDir(skin) {
  return join(SKINS, skin.packName)
}
