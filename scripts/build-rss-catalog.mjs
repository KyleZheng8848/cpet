#!/usr/bin/env node
/**
 * 校验 / 同步 RSS 发现目录。
 * 完整重建请用仓库内历史生成逻辑或扩展 src/shared/data/rss-catalog.json。
 * 本脚本：合并 rssPresets 热门源进目录、确保 ≥1000、写回 JSON。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const catalogPath = join(root, 'src/shared/data/rss-catalog.json')
const assetsPath = join(root, 'assets/rss-catalog.json')
const presetsPath = join(root, 'src/shared/rssPresets.ts')

const presetsTs = readFileSync(presetsPath, 'utf8')
const presetRe =
  /\{\s*id:\s*'([^']+)',\s*name:\s*'((?:\\'|[^'])*)',\s*url:\s*'([^']+)',\s*desc:\s*'((?:\\'|[^'])*)',\s*category:\s*'([^']+)'/g

const payload = JSON.parse(readFileSync(catalogPath, 'utf8'))
const feeds = Array.isArray(payload.feeds) ? [...payload.feeds] : []
const seen = new Set(
  feeds.map((f) => {
    try {
      return new URL(f.url).href.toLowerCase()
    } catch {
      return String(f.url || '').toLowerCase()
    }
  })
)

let m
while ((m = presetRe.exec(presetsTs))) {
  const url = m[3]
  let key
  try {
    key = new URL(url).href.toLowerCase()
  } catch {
    continue
  }
  if (seen.has(key)) continue
  seen.add(key)
  feeds.unshift({
    id: m[1],
    name: m[2].replace(/\\'/g, "'"),
    url: new URL(url).href,
    desc: m[4].replace(/\\'/g, "'"),
    category: m[5]
  })
}

if (feeds.length < 1000) {
  console.error(`rss-catalog too small: ${feeds.length} (need ≥1000)`)
  process.exit(1)
}

const out = {
  version: 1,
  generatedAt: new Date().toISOString(),
  count: feeds.length,
  feeds
}
mkdirSync(dirname(catalogPath), { recursive: true })
writeFileSync(catalogPath, JSON.stringify(out))
writeFileSync(assetsPath, JSON.stringify(out))
console.log(`rss-catalog ok: ${feeds.length} feeds → ${catalogPath}`)
