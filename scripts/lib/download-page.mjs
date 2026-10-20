/**
 * 生成 OSS 上的静态下载页。
 *
 * 页面内容全部来自 latest.json 与 CHANGELOG.md —— 手写版本号的下载页
 * 一定会漂移，而漂移的表现是「页面写着 0.4.0，按钮下下来是 0.3.9」。
 *
 * 只输出一个自包含 HTML：没有外链 JS/CSS，内网打开不依赖任何 CDN。
 */

const PLATFORMS = [
  {
    id: 'mac-arm',
    label: 'macOS · Apple Silicon',
    hint: 'M1 / M2 / M3 / M4',
    button: 'DMG',
    match: (n) => /arm64\.dmg$/i.test(n),
    zip: (n) => /arm64\.zip$/i.test(n)
  },
  {
    id: 'mac-intel',
    label: 'macOS · Intel',
    hint: 'x64',
    button: 'DMG',
    match: (n) => /(x64|intel)\.dmg$/i.test(n),
    zip: (n) => /(x64|intel)\.zip$/i.test(n)
  },
  {
    id: 'win',
    label: 'Windows · x64',
    hint: 'NSIS 安装包',
    button: '安装程序',
    match: (n) => /\.exe$/i.test(n),
    zip: () => false
  },
  {
    id: 'linux-x64',
    label: 'Linux · x64',
    hint: 'AppImage',
    button: 'AppImage',
    match: (n) => /(x86_64|x64|amd64)\.AppImage$/i.test(n),
    zip: () => false
  },
  {
    id: 'linux-arm',
    label: 'Linux · ARM64',
    hint: 'AppImage',
    button: 'AppImage',
    match: (n) => /(arm64|aarch64)\.AppImage$/i.test(n),
    zip: () => false
  }
]

import {
  APP_ACCENTS,
  releaseAppHeader,
  releaseHubFooter,
  releasePageCss,
  releasePageDecor
} from './release-page-theme.mjs'

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const mb = (n) => `${(n / 1048576).toFixed(0)} MB`

/**
 * 发布页演示视频清单（本地路径相对仓库根）。
 * 新片放前面；旧片保留作 Agent 联动入门。
 */
export const DOWNLOAD_DEMO_VIDEOS = [
  {
    localRel: 'assets/brand/demo-walkthrough.mp4',
    remoteName: 'demo-walkthrough.mp4',
    caption: '演示：画图预览、本机文件和模型对比'
  },
  {
    localRel: 'assets/brand/demo-features.mp4',
    remoteName: 'demo-features.mp4',
    caption: '演示：和宠物聊天、订阅资讯、语音朗读'
  },
  {
    localRel: 'assets/brand/demo.mp4',
    remoteName: 'demo.mp4',
    caption: '演示：桌面宠物跟着编程助手动，一个入口派活'
  }
]

/** 发布页界面截图（本地路径相对仓库根） */
export const DOWNLOAD_SCREENSHOTS = [
  {
    localRel: 'assets/screenshots/ui-main.png',
    remoteName: 'ui-main.png',
    alt: 'CPET 今天工作台界面',
    caption: '今天工作台：资讯、待办和记录同屏查看'
  }
]

/** 发布页固定文案：一句话副标题 + 基础介绍（口袋 sync 会吸取 intro） */
const PAGE_COPY = {
  tagline: '桌面小伙伴 · 对接常用编程助手',
  intro:
    'CPET 是住在 Mac 桌面上的小伙伴。它能在一个窗口里看资讯、待办和记录，还能联动 Cursor、Codex 等编程工具，少来回切窗口。'
}

/**
 * @param {{version:string, publishedAt?:string, assets:Array<{name:string,url:string,size?:number}>,
 *          highlights?:string[], manifestUrl?:string, stableUrl?:(name:string)=>string,
 *          repoUrl?:string, iconUrl?:string,
 *          demoVideoUrl?:string,
 *          demoVideos?: Array<{url:string, caption:string}>,
 *          screenshots?: Array<{url:string, alt?:string, caption?:string}>}} input
 */
export function renderDownloadPage(input) {
  const {
    version,
    publishedAt,
    assets = [],
    highlights = [],
    manifestUrl,
    repoUrl,
    iconUrl,
    demoVideoUrl,
    history = []
  } = input
  const demoVideos = Array.isArray(input.demoVideos)
    ? input.demoVideos.filter((d) => d && d.url)
    : demoVideoUrl
      ? [
          {
            url: demoVideoUrl,
            caption: '演示：桌面小伙伴跟着 Agent 动 · 统一派活入口（不是又一个 IDE）'
          }
        ]
      : []
  const stable = input.stableUrl ?? ((name) => assets.find((a) => a.name === name)?.url ?? '')
  const screenshots = Array.isArray(input.screenshots)
    ? input.screenshots.filter((s) => s && s.url)
    : []

  const cards = []
  for (const p of PLATFORMS) {
    const main = assets.find((a) => p.match(a.name))
    if (!main) continue
    const zip = assets.find((a) => p.zip(a.name))
    cards.push(`
      <div class="card">
        <div class="card-head">
          <span class="card-title">${esc(p.label)}</span>
          <span class="card-hint">${esc(p.hint)}</span>
        </div>
        <a class="btn" href="${esc(stable(main.name))}" download>
          下载 ${esc(p.button)}
          ${main.size ? `<span class="size">${esc(mb(main.size))}</span>` : ''}
        </a>
        ${
          zip
            ? `<a class="alt" href="${esc(stable(zip.name))}" download>免挂载 zip · ${esc(mb(zip.size ?? 0))}</a>`
            : ''
        }
      </div>`)
  }

  const missing = PLATFORMS.filter((p) => !assets.some((a) => p.match(a.name))).map((p) => p.label)

  const date = publishedAt ? new Date(publishedAt).toLocaleDateString('zh-CN') : ''

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CPET ${esc(version)} · 下载</title>
<meta name="color-scheme" content="light">
<style>${releasePageCss(APP_ACCENTS.cpet)}</style>
</head>
<body>
${releasePageDecor()}
<div class="page">
${releaseAppHeader({ appName: 'CPET', version, tagline: PAGE_COPY.tagline, date, iconUrl, esc })}
  <p class="intro">${esc(PAGE_COPY.intro)}</p>

  ${
    screenshots.length
      ? `<section>
    <h2>界面预览</h2>
    <div class="shots">${screenshots
      .map(
        (s) => `<figure>
      <img src="${esc(s.url)}" alt="${esc(s.alt || '界面截图')}" loading="lazy">
      ${s.caption ? `<figcaption>${esc(s.caption)}</figcaption>` : ''}
    </figure>`
      )
      .join('\n    ')}</div>
  </section>`
      : ''
  }

  ${
    demoVideos.length
      ? `<section class="demos" aria-label="演示视频">
    ${demoVideos
      .map(
        (d) => `<div class="demo">
    <video controls playsinline preload="metadata" src="${esc(d.url)}"></video>
    <p class="cap">${esc(d.caption || '演示')}</p>
  </div>`
      )
      .join('\n    ')}
  </section>`
      : ''
  }

  <section>
    <div class="grid">${cards.join('') || '<p class="sub">这一版还没有可下载的安装包。</p>'}</div>
    ${missing.length ? `<p class="sub" style="margin-top:14px">暂未提供：${esc(missing.join('、'))}</p>` : ''}
  </section>

  <section>
    <h2>Mac 怎么装</h2>
    <div class="note">
      <p style="margin:0 0 8px"><strong>不要直接双击 CPET.app。</strong>未公证时系统可能提示「无法验证」——不是软件坏了。</p>
      <p style="margin:0 0 8px">推荐：打开 DMG → 双击 <strong>安装并打开.command</strong>（允许终端运行）→ 自动装好并启动。</p>
      <p style="margin:0 0 8px">若仍被拦：系统设置 → 隐私与安全性 → 找到 CPET → <strong>仍要打开</strong>。或终端执行：</p>
      <pre>xattr -cr "/Applications/CPET.app"
"/Applications/CPET.app/Contents/MacOS/CPET" &amp;</pre>
      <p style="margin:12px 0 0; color:var(--muted)">想彻底免弹窗，需要 Apple 开发者公证。</p>
    </div>
  </section>

  ${
    highlights.length
      ? `<section>
    <h2>${esc(version)} 更新了什么</h2>
    <ul>${highlights.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>
  </section>`
      : ''
  }

  ${
    history.length
      ? `<section>
    <h2>全部版本</h2>
    <div class="note">
      <p style="margin:0 0 14px; color:var(--muted)">最新版在最上面；新版有问题时可以直接退回。只保留最近若干版，更早的会被清掉。</p>
      <ul class="history">${history
        .map((h) => {
          const isCurrent = h.version === version
          return `<li>
            <span class="hv">${esc(h.version)}${isCurrent ? '<span class="now">最新</span>' : ''}</span>
            <span class="hfiles">${h.files
              .map(
                (f) =>
                  `<a class="hchip" href="${esc(f.url)}">${esc(f.label)}<span class="size">${esc(mb(f.size))}</span></a>`
              )
              .join('')}</span>
          </li>`
        })
        .join('')}</ul>
    </div>
  </section>`
      : ''
  }

  ${releaseHubFooter({
    manifestUrl,
    extraHtml: `<p>下载链接固定指向最新版，可以直接分享。${
      manifestUrl ? `应用内「设置 → 关于 → 检查更新」读的是 <a href="${esc(manifestUrl)}">latest.json</a>。` : ''
    }${repoUrl ? ` 源码：<a href="${esc(repoUrl)}">${esc(repoUrl)}</a>` : ''}</p>`,
    esc
  })}
</div>
</body>
</html>
`
}

/** 从 CHANGELOG.md 里取指定版本的条目（取不到就返回空数组，不编内容）。 */
export function changelogHighlights(markdown, version) {
  const lines = markdown.split('\n')
  const out = []
  let inTarget = false
  for (const line of lines) {
    const head = /^##\s+(.+?)\s+[—–-]\s+\d{4}-\d{2}-\d{2}\s*$/.exec(line)
    if (head) {
      if (inTarget) break
      inTarget = head[1].trim() === version
      continue
    }
    if (!inTarget) continue
    const bullet = /^[-*]\s+(.*\S)\s*$/.exec(line)
    if (bullet) out.push(bullet[1].replace(/`/g, ''))
  }
  return out
}
