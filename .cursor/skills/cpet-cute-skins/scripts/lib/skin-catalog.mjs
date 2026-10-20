/**
 * Shared catalog + skin.json helpers for CPET skin factory.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  SKILL_CATALOGS,
  SKILL_ROOT,
  SKINS,
  SKINS_SOURCE,
  WORK,
  catalogPath,
  describePaths,
  workDir as resolveWorkDir
} from './paths.mjs'

export {
  SKILL_CATALOGS,
  SKILL_ROOT,
  SKINS,
  SKINS_SOURCE,
  WORK,
  describePaths
}

export function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function lifecycle() {
  return loadJson(catalogPath('LIFECYCLE.json'))
}

export function actionCatalog() {
  return loadJson(catalogPath('ACTION_CATALOG.json'))
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
  return resolveWorkDir(skinId)
}

export function skinJsonPath(skinId) {
  return join(workDir(skinId), 'skin.json')
}

export function loadSkin(skinId) {
  const p = skinJsonPath(skinId)
  if (!existsSync(p)) {
    throw new Error(
      `missing skin.json: ${p}\n${describePaths()}\n` +
        `  run "cpet new" first, or point CPET_OUT_DIR at the dir that holds _work/${skinId}.`
    )
  }
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
  'cute kawaii desktop pet mascot, SINGLE character only, ONE body ONE face, centered, full body with small margin, chubby round proportions, big shiny eyes soft blush, thick clean dark outline, flat soft shading, crisply drawn single-line features, NO motion blur, NO double exposure, NO ghosting, NO afterimage, NO overlapping duplicate eyes/ears/mouth, NO text NO watermark NO logo NO speech bubble NO UI, NO drop shadow under the character, NO floating detached prop stickers around the body'

export const REALISTIC_STYLE =
  'photorealistic adult digital human desktop pet, SINGLE adult person only, ONE anatomically realistic body ONE realistic face, centered, full body with small margin, natural adult head-to-body proportions, realistic eyes and hands, visible skin and fabric texture, cinematic soft studio lighting, crisp photographic detail, NO illustration, NO 3D cartoon, NO Pixar/Disney style, NO anime, NO chibi, NO doll, NO oversized head or eyes, NO thick drawn outline, NO motion blur, NO double exposure, NO ghosting, NO afterimage, NO duplicated facial features or limbs, NO text NO watermark NO logo NO speech bubble NO UI, NO drop shadow under the character, NO floating detached prop stickers around the body'

export const INFANT_REALISTIC_STYLE =
  'photorealistic real human infant desktop pet, SINGLE real baby only, ONE anatomically realistic infant body ONE realistic baby face matching the reference photo, centered, full body with small margin, natural infant proportions, realistic skin eyes nose mouth ears and hands, visible skin and fabric texture, soft studio lighting, crisp photographic detail, NO illustration, NO 3D cartoon, NO Pixar/Disney style, NO anime, NO chibi, NO doll, NO mascot, NO thick drawn outline, NO motion blur, NO double exposure, NO ghosting, NO afterimage, NO duplicated facial features or limbs, NO text NO watermark NO logo NO speech bubble NO UI, NO drop shadow under the character, NO floating detached prop stickers around the body'

/** Pure keys the cutout can strip. Hue is the center of that key. */
const KEY_COLORS = [
  { name: 'red', hex: '#FF0000', hue: 0 },
  { name: 'yellow', hex: '#FFFF00', hue: 60 },
  { name: 'green', hex: '#00FF00', hue: 120 },
  { name: 'cyan', hex: '#00FFFF', hue: 180 },
  { name: 'blue', hex: '#0000FF', hue: 240 },
  { name: 'magenta', hex: '#FF00FF', hue: 300 }
]

/** Colors that actually sit on the character. Black, white, and skin are not keys. */
const COLOR_HUES = [
  [/violet|purple|淡紫|深紫|紫/, 280],
  [/\bblue\b|深蓝|蓝色|蓝袍|蓝衣|蓝/, 240],
  [/\bgreen\b|moss|绿色|绿衣|苔|绿/, 120],
  [/\bred\b|brick|auburn|红色|砖红|赤/, 5],
  [/yellow|\bgold\b|golden|金色|金币|金星|金/, 55],
  [/orange|copper|铜色|橙/, 30],
  [/honey|blonde|flax|蜂蜜|浅亚麻|浅金/, 48],
  [/brown|chestnut|栗色|褐色|棕|褐/, 25]
]

function hueDistance(a, b) {
  const d = Math.abs(a - b) % 360
  return Math.min(d, 360 - d)
}

/**
 * Chroma key is the pure color farthest from every hue named on the character.
 * That is the complement when one hue dominates, and the next unused pure key
 * when the complement itself is on the figure (gold star vs yellow, blue robe vs blue).
 * Blue is only the fallback when the prompt names no hue.
 */
export function keyBackdrop(text) {
  const lower = String(text || '').toLowerCase()
  const hues = []
  for (const [re, hue] of COLOR_HUES) {
    if (re.test(lower)) hues.push(hue)
  }
  if (!hues.length) return KEY_COLORS.find((k) => k.name === 'blue')
  let best = KEY_COLORS[0]
  let bestScore = -1
  for (const key of KEY_COLORS) {
    const score = Math.min(...hues.map((h) => hueDistance(key.hue, h)))
    if (score > bestScore) {
      bestScore = score
      best = key
    }
  }
  return best
}

function backdropClause(key) {
  return `fill the ENTIRE square canvas around the character with ONE flat opaque pure ${key.name} (${key.hex}) that does not appear on skin, hair, clothes, or props. NO white backdrop, NO transparency checkerboard, NO alpha grid, NO Photoshop preview pattern, NEVER gray studio. The ${key.name} is a chroma key, the complement of the colors on the character, and will be replaced with white after cutout`
}

function stylePrompt(skin) {
  const prompt = skin.characterPrompt.toLowerCase()
  const realistic = /\b(?:photorealistic|photo-realistic|realistic digital human)\b/.test(prompt)
  const base = !realistic
    ? COMMON_STYLE
    : /\b(?:baby|infant|toddler|newborn)\b/.test(prompt)
      ? INFANT_REALISTIC_STYLE
      : REALISTIC_STYLE
  return `${base}, ${backdropClause(keyBackdrop(skin.characterPrompt))}`
}

export function stemPrompt(skin, stemDef) {
  return `${stylePrompt(skin)}. Character design (LOCKED): ${skin.characterPrompt}. Pose/emotion: ${stemDef.pose}. CRITICAL vs reference image: keep the SAME species, colors, face, body silhouette, ear count, and limb/foot count — never invent extra legs/ears/props; ONLY change pose/expression and props required by this pose.`
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
