/**
 * 生成 README 里的下载区块（最新版 + 历史版本表）。
 *
 * 为什么必须生成：手写的下载表会烂。这个仓库里已经有过活证据 ——
 * README 一度还写着早就不存在的仓库地址、写死的测试用例数、写死的 lint 上限，
 * 全都对不上了。下载链接烂掉更糟：用户点了 404，然后就不再回来。
 *
 * 区块由标记包住，只替换标记之间的内容，标记之外的手写正文一律不动。
 */

export const START = '<!-- CPET:DOWNLOADS:START 由 npm run docs:downloads 生成，别手改 -->'
export const END = '<!-- CPET:DOWNLOADS:END -->'

const PLATFORMS = [
  { label: 'macOS · Apple Silicon', dmg: /arm64\.dmg$/i, zip: /arm64\.zip$/i },
  { label: 'macOS · Intel', dmg: /(x64|intel)\.dmg$/i, zip: /(x64|intel)\.zip$/i },
  { label: 'Windows · x64', dmg: /(x64|win).*?\.exe$/i, zip: null },
  // AppImage 必须带架构：两个 Linux 包都叫 *.AppImage，不写死会互相盖掉
  // electron-builder 给 x64 Linux 起的是 x86_64，不是 x64
  { label: 'Linux · x64', dmg: /(x86_64|x64|amd64)\.AppImage$/i, zip: null },
  { label: 'Linux · ARM64', dmg: /(arm64|aarch64)\.AppImage$/i, zip: null }
]

const mb = (n) => (n ? `${(n / 1048576).toFixed(0)} MB` : '')

/**
 * @param {{version:string, publishedAt?:string,
 *          assets:Array<{name:string,size?:number}>,
 *          stableUrl:(name:string)=>string,
 *          history?:Array<{version:string, files:Array<{label:string,url:string,size:number}>}>,
 *          highlights?:string[], pageUrl?:string}} data
 */
export function renderDownloadsBlock(data) {
  const {
    version,
    publishedAt,
    assets = [],
    stableUrl,
    history = [],
    highlights = [],
    pageUrl
  } = data
  const date = publishedAt ? new Date(publishedAt).toISOString().slice(0, 10) : ''

  const rows = PLATFORMS.map((p) => {
    const dmg = assets.find((a) => p.dmg.test(a.name))
    if (!dmg) return `| ${p.label} | — | |`
    const zip = p.zip ? assets.find((a) => p.zip.test(a.name)) : null
    const dmgUrl = stableUrl(dmg.name)
    // 链接文字用固定名本身：用户复制走的是这个名字，跟落到硬盘上的文件名对得上
    const main = `[⬇️ ${dmgUrl.split('/').pop()}](${dmgUrl}) · ${mb(dmg.size)}`
    const alt = zip ? `[免挂载 zip](${stableUrl(zip.name)}) · ${mb(zip.size)}` : ''
    return `| ${p.label} | ${main} | ${alt} |`
  })

  const lines = [
    START,
    '',
    `### 最新版本 ${version}${date ? ` · ${date}` : ''}`,
    '',
    '| 平台 | 安装包 | 备用 |',
    '|:--|:--|:--|',
    ...rows,
    '',
    '`—` 表示这一版没有出该平台的包。上面的链接**固定指向最新版**，发新版不会失效，可以直接转给别人。',
    ''
  ]

  // 让人在点下载之前就知道这版改了什么，否则「要不要更新」只能靠猜
  if (highlights.length) {
    lines.push(
      '**这一版改了什么**',
      '',
      ...highlights.slice(0, 5).map((h) => `- ${h}`),
      '',
      `更早的改动看 [CHANGELOG.md](CHANGELOG.md)。`,
      ''
    )
  }

  if (history.length) {
    lines.push(
      '### 全部版本',
      '',
      '最新版在最上面；新版有问题时可以退回来。只保留最近若干版，更早的已经从分发源删掉。',
      '',
      '| 版本 | 下载 |',
      '|:--|:--|',
      ...history.map(
        (h) =>
          `| ${h.version}${h.version === version ? '（最新）' : ''} | ${h.files
            .map((f) => `[${f.label}](${f.url}) · ${mb(f.size)}`)
            .join(' · ')} |`
      ),
      ''
    )
  }

  if (pageUrl) lines.push(`完整发布页（含更新说明）：<${pageUrl}>`, '')
  lines.push(END)
  return lines.join('\n')
}

/** 用新区块替换 README 里标记之间的内容；没有标记就报错，不做猜测式插入。 */
export function replaceBlock(markdown, block) {
  const s = markdown.indexOf(START)
  const e = markdown.indexOf(END)
  if (s < 0 || e < 0 || e < s) {
    throw new Error(`README 里找不到下载区块标记，请确认这两行还在：\n  ${START}\n  ${END}`)
  }
  return markdown.slice(0, s) + block + markdown.slice(e + END.length)
}
