/**
 * 发布产物的命名规则与版本分组。
 *
 * 发布脚本和 README 生成器都要按同一套规则理解 OSS 上那堆文件名。
 * 各写一份的话，迟早出现「发布页删了某版、README 还在链它」这种自相矛盾，
 * 所以规则只留这一份。
 */

export const ARTIFACT_RE =
  /^CPET-(\d+\.\d+\.\d+(?:-[\w.]+)?)-.+\.(?:dmg|zip|exe|AppImage)(?:\.blockmap)?$/i

/** 语义化版本比较，预发布版（1.0.0-beta.1）排在正式版之前。 */
export function compareVersions(a, b) {
  const split = (v) => {
    const [core, ...pre] = v.split('-')
    return { nums: core.split('.').map((n) => Number.parseInt(n, 10) || 0), pre: pre.join('-') }
  }
  const x = split(a)
  const y = split(b)
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0)
    if (d) return d > 0 ? 1 : -1
  }
  if (x.pre === y.pre) return 0
  if (!x.pre) return 1
  if (!y.pre) return -1
  return x.pre > y.pre ? 1 : -1
}

/** CPET-0.4.0-arm64.dmg → CPET-latest-arm64.dmg（认不出版本号就原样返回）。 */
export function stableName(name) {
  return name.replace(/^CPET-[\d.]+(?:-[\w.]+)?-/, 'CPET-latest-')
}

/**
 * 把 OSS 列表按版本分组。latest.json / index.html / CPET-latest-* 不是版本产物，直接跳过。
 * @param {Array<{key:string,size:number}>} items
 * @param {string} keyPrefix
 * @returns {{byVersion:Map<string,Array<{name:string,size:number}>>, versions:string[]}} versions 从新到旧
 */
export function groupRemoteArtifacts(items, keyPrefix) {
  const byVersion = new Map()
  for (const { key, size, lastModified } of items) {
    const name = key.startsWith(keyPrefix) ? key.slice(keyPrefix.length) : key
    if (name.includes('/')) continue // 子目录不归这里管
    const hit = ARTIFACT_RE.exec(name)
    if (!hit) continue
    if (!byVersion.has(hit[1])) byVersion.set(hit[1], [])
    byVersion.get(hit[1]).push({ name, size, lastModified })
  }
  return { byVersion, versions: [...byVersion.keys()].sort(compareVersions).reverse() }
}

/** 给用户看的短标签；别用完整文件名，历史列表会挤爆。 */
export function artifactLabel(name) {
  if (/\.dmg$/i.test(name)) {
    if (/arm64/i.test(name)) return 'mac arm64'
    if (/x64|intel/i.test(name)) return 'mac Intel'
    return 'mac'
  }
  if (/\.exe$/i.test(name)) return 'Windows'
  if (/\.AppImage$/i.test(name)) {
    if (/arm64|aarch64/i.test(name)) return 'Linux arm64'
    if (/x86_64|x64|amd64/i.test(name)) return 'Linux x64'
    return 'Linux'
  }
  return name
}

/**
 * 历史版本只列安装包本身：blockmap 是给增量更新用的，用户点了没意义。
 * 默认包含当前版（排在最前），方便从同一张表回退或重下。
 * @param {{exclude?: string, limit?: number, baseUrl: string}} opts
 *   exclude 仅在需要刻意跳过某版时使用；下载页应不传，让最新版也出现在列表顶。
 */
export function historyEntries({ byVersion, versions }, { exclude, limit, baseUrl }) {
  return versions
    .filter((v) => (exclude ? v !== exclude : true))
    .slice(0, limit)
    .map((v) => ({
      version: v,
      files: byVersion
        .get(v)
        .filter((f) => /\.(dmg|exe|AppImage)$/i.test(f.name))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((f) => ({
          label: artifactLabel(f.name),
          url: `${baseUrl}${f.name}`,
          size: f.size
        }))
    }))
    .filter((h) => h.files.length)
}
