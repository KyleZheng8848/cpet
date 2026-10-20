import { readFileSync, existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  extractReadableFromHtml,
  sanitizeArticleHtml,
  scoreArticleCandidate,
  separateAdjacentInlineTags,
  stripChromeBlocks
} from '../src/main/rssTask'
import {
  articleLooksComplete,
  articleLooksLikeChrome,
  articleNeedsWebHint,
  isThinArticleHtml,
  reviveEscapedMediaInHtml
} from '../src/shared/rssTask'

describe('rss article extract', () => {
  it('treats short header-only html as thin', () => {
    const thin =
      '<div class="article"><h1>标题</h1><div class="article_info">henry 来源：量子位</div></div>'
    expect(isThinArticleHtml(sanitizeArticleHtml(thin))).toBe(true)
  })

  it('does not treat complete short newsflash as thin', () => {
    const flash =
      '<p>据《华尔街日报》8月9日报道，苹果公司正在其iPhone和MacBook等产品线中测试长鑫存储（CXMT）的存储芯片，以缓解因人工智能热潮引发的内存短缺问题。报道援引知情人士称，苹果公司已与中国最大的芯片制造商长鑫存储就零部件供应展开初步洽谈，目标是在中国销售的部分设备中使用这些芯片。路透社此前报道称，长鑫存储正考虑在北京建设第二座存储芯片工厂，以提高产能。此外，笔记本电脑制造商惠普（HP）和宏碁（Acer）已开始在销往美国以外市场的设备中使用长鑫存储的芯片，以缓解供应短缺。（中新经纬）</p>'
    expect(articleLooksComplete(flash)).toBe(true)
    expect(isThinArticleHtml(flash)).toBe(false)
  })

  it('still treats mid-sentence RSS truncation as thin', () => {
    const cut =
      '<p>据《华尔街日报》8月9日报道，苹果公司正在其iPhone和MacBook等产品线中测试长鑫存储（CXMT）的存储芯片，以缓解因人工智能热潮引发的内存短缺问题。报道援引知情人士称，苹果公司已与中国最大的芯片制造商长鑫存储就零部件供应展开初步洽谈，目标是在中国销售的部分设备中使用这些芯片。路透社此前报道称，长鑫存储正考虑在</p>'
    expect(articleLooksComplete(cut)).toBe(false)
    expect(isThinArticleHtml(cut)).toBe(true)
  })

  it('extracts jiemian newsflash even when wrapper content outscores article-content', () => {
    const body =
      '据《华尔街日报》8月9日报道，苹果公司正在其iPhone和MacBook等产品线中测试长鑫存储（CXMT）的存储芯片，以缓解因人工智能热潮引发的内存短缺问题。报道援引知情人士称，苹果公司已与中国最大的芯片制造商长鑫存储就零部件供应展开初步洽谈，目标是在中国销售的部分设备中使用这些芯片。路透社此前报道称，长鑫存储正考虑在北京建设第二座存储芯片工厂，以提高产能。此外，笔记本电脑制造商惠普（HP）和宏碁（Acer）已开始在销往美国以外市场的设备中使用长鑫存储的芯片，以缓解供应短缺。（中新经纬）'
    const page = `<!doctype html><html><body>
      <div class="content">
        <div class="article-view">
          <div class="article-main">
            <div class="article-content"><p>${body}</p></div>
            <a href="/about/copyright.html">本文为转载内容</a>
            <div class="article-navbar">
              <a href="#">点赞</a><a href="#">收藏</a><a href="#">评论</a>
              <a href="#">微博</a><a href="#">微信</a><a href="#">QQ</a>
              <div>下一篇</div>
              <a href="/1">相关1</a><a href="/2">相关2</a><a href="/3">相关3</a>
              <a href="/4">相关4</a><a href="/5">相关5</a>
            </div>
          </div>
        </div>
      </div>
    </body></html>`
    const { html } = extractReadableFromHtml(page, 'https://www.jiemian.com/article/14896274.html')
    expect(html).toContain('北京建设第二座')
    expect(html).toContain('中新经纬')
    expect(html).not.toContain('下一篇')
    expect(isThinArticleHtml(html)).toBe(false)
  })

  it('balances nested article div instead of stopping at first close', () => {
    const page = `<!doctype html><html><body>
      <div class="article">
        <h1>完整标题</h1>
        <div class="article_info"><span>作者</span></div>
        <p>${'正文段落。'.repeat(40)}</p>
        <p>${'更多内容。'.repeat(40)}</p>
        <p>${'收尾。'.repeat(20)}</p>
      </div>
    </body></html>`
    const { html } = extractReadableFromHtml(page, 'https://example.com/a')
    expect(isThinArticleHtml(html)).toBe(false)
    expect(html).toContain('正文段落')
    expect(html).toContain('更多内容')
  })

  it('keeps safe svg charts and strips scripts inside', () => {
    const html = sanitizeArticleHtml(
      `<p>等待</p>
      <svg viewBox="0 0 100 80" onclick="alert(1)">
        <script>evil()</script>
        <rect x="10" y="20" width="12" height="40" style="fill:#333;stroke:none"/>
        <text x="4" y="70">1</text>
        <foreignObject><body>x</body></foreignObject>
      </svg>`,
      'https://example.com/a'
    )
    expect(html).toContain('<svg')
    expect(html).toContain('<rect')
    expect(html).toContain('viewBox=')
    expect(html).toContain('fill="#333"')
    expect(html).toContain('>1</text>')
    expect(html).not.toContain('onclick')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('foreignObject')
  })

  it('keeps data:image and srcset fallback', () => {
    const data =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const withData = sanitizeArticleHtml(`<img alt="c" src="${data}">`, 'https://example.com/a')
    expect(withData).toContain('data:image/png')
    const withSet = sanitizeArticleHtml(
      `<img alt="r" srcset="/charts/a.png 1x, /charts/a2.png 2x">`,
      'https://example.com/a'
    )
    expect(withSet).toContain('src="https://example.com/charts/a.png"')
  })

  it('revives entity-escaped media tags instead of showing them as text', () => {
    const escaped =
      '&lt;p&gt;正文&lt;/p&gt;&lt;img src=&quot;https://www.qbitai.com/wp-content/uploads/imgs/qbitai-logo-1.png&quot; width=&quot;400&quot; height=&quot;400&quot;&gt;' +
      '&lt;video src=&quot;https://cdn.example.com/a.mp4&quot;&gt;&lt;/video&gt;'
    const html = sanitizeArticleHtml(escaped, 'https://www.qbitai.com/p/1')
    expect(html).toContain('<img')
    expect(html).toContain('src="https://www.qbitai.com/wp-content/uploads/imgs/qbitai-logo-1.png"')
    expect(html).not.toContain('&lt;img')
    expect(html).toContain('<video')
    expect(html).toContain('controls')
    // width/height 已剥掉，避免布局怪盒
    expect(html).not.toMatch(/<img\b[^>]*\bwidth=/i)
  })

  it('does not force no-referrer on img (CDN hotlink needs site Referer)', () => {
    const html = sanitizeArticleHtml(
      '<img src="https://i.qbitai.com/wp-content/uploads/a.webp" />',
      'https://www.qbitai.com/p/1'
    )
    expect(html).toContain('src="https://i.qbitai.com/wp-content/uploads/a.webp"')
    expect(html).not.toMatch(/referrerpolicy/i)
    expect(html).not.toMatch(/<img[^>]*\s\/\s/i)
  })

  it('decodes &amp; in img src and strips #fragment', () => {
    const html = sanitizeArticleHtml(
      '<img src="https://mmbiz.qpic.cn/mmbiz_png/x/0?wx_fmt=png&amp;from=appmsg#imgIndex=0">',
      'https://mp.weixin.qq.com/s/x'
    )
    expect(html).toContain('src="https://mmbiz.qpic.cn/mmbiz_png/x/0?wx_fmt=png&from=appmsg"')
    expect(html).not.toContain('#imgIndex')
    expect(html).not.toContain('&amp;')
  })

  it('revives double-encoded media tags (&amp;lt;img)', () => {
    const doubleEnc =
      '&amp;lt;img src=&amp;quot;https://cdn.example.com/photo.jpg&amp;quot;&amp;gt;'
    const html = sanitizeArticleHtml(doubleEnc, 'https://example.com/a')
    expect(html).toContain('<img')
    expect(html).toContain('https://cdn.example.com/photo.jpg')
    expect(html).not.toContain('&lt;img')
    expect(html).not.toContain('&amp;lt;')
  })

  it('display helper revives cached escaped img without touching scripts', () => {
    const raw =
      '&lt;img src=&quot;https://cdn.example.com/a.png&quot;&gt;&lt;script&gt;x&lt;/script&gt;'
    const out = reviveEscapedMediaInHtml(raw)
    expect(out).toContain('<img src="https://cdn.example.com/a.png">')
    expect(out).toContain('&lt;script&gt;')
  })

  it('keeps video/audio with controls and safe iframe hosts', () => {
    const html = sanitizeArticleHtml(
      `<p>播</p>
      <video autoplay src="/clip.mp4" width="1920" height="1080"></video>
      <audio src="https://cdn.example.com/a.mp3"></audio>
      <iframe src="https://www.youtube.com/embed/abc"></iframe>
      <iframe src="https://evil.example/track"></iframe>`,
      'https://example.com/a'
    )
    expect(html).toContain('<video')
    expect(html).toContain('src="https://example.com/clip.mp4"')
    expect(html).toContain('controls')
    expect(html).not.toMatch(/<video\b[^>]*\bautoplay\b/i)
    expect(html).toContain('<audio')
    expect(html).toContain('https://cdn.example.com/a.mp3')
    expect(html).toContain('youtube.com/embed/abc')
    expect(html).toContain('rss-embed')
    expect(html).not.toContain('evil.example')
  })

  it('hints web mode when chart-heavy and text-thin', () => {
    const chart =
      '<svg viewBox="0 0 10 10"><rect width="4" height="8" fill="#000"/></svg><p>短</p>'
    expect(articleNeedsWebHint(sanitizeArticleHtml(chart))).toBe(true)
    expect(articleNeedsWebHint(`<p>${'长文。'.repeat(80)}</p>`)).toBe(false)
  })

  it('cuts 下一篇 related tail and rejects summary+link dumps', () => {
    const html = sanitizeArticleHtml(
      `<div class="article">
        <p>${'电投产融公告项目获核准，公司将推进后续工作。'.repeat(6)}</p>
        <h3>下一篇</h3>
        <ul>
          <li><a href="/1">油价新闻</a></li>
          <li><a href="/2">美股盘前</a></li>
          <li><a href="/3">DeepSeek</a></li>
          <li><a href="/4">OpenAI</a></li>
          <li><a href="/5">苹果财报</a></li>
          <li><a href="/6">城市合作</a></li>
        </ul>
      </div>`,
      'https://36kr.com/p/1'
    )
    // polish 在 extract 路径调用；这里直接测 strip + chrome 判定
    const page = `<!doctype html><body>
      <main><div class="article-content">
        <p>${'正文段落说明项目进展与后续安排。'.repeat(20)}</p>
        <p>${'更多细节与市场影响分析如下。'.repeat(20)}</p>
        <div class="related"><h3>下一篇</h3>
          <a href="/a">链1</a><a href="/b">链2</a><a href="/c">链3</a>
          <a href="/d">链4</a><a href="/e">链5</a><a href="/f">链6</a>
        </div>
      </div></main>
    </body>`
    const { html: extracted } = extractReadableFromHtml(page, 'https://36kr.com/p/1')
    expect(extracted).toContain('正文段落')
    expect(extracted).not.toContain('下一篇')
    expect(articleLooksLikeChrome(html)).toBe(true)
  })

  it('cuts hot-tag / related-news chrome from article extract', () => {
    const page = `<!doctype html><body>
      <div class="article-content">
        <p>${'外交部发言人就欧盟投资限制回答记者提问。'.repeat(16)}</p>
        <p>${'保护主义换不来竞争力，只会损害各国企业信心。'.repeat(12)}</p>
        <div class="hot-tags"><a>智能</a><a>手机</a><a>AI</a><a>技术</a></div>
        <div class="related"><h3>相关新闻</h3>
          <a href="/1">链1</a><a href="/2">链2</a><a href="/3">链3</a>
          <a href="/4">链4</a><a href="/5">链5</a>
        </div>
      </div>
    </body>`
    const { html } = extractReadableFromHtml(page, 'https://www.chinanews.com/a/1.html')
    expect(html).toContain('外交部')
    expect(html).not.toContain('相关新闻')
    expect(html).not.toMatch(/hot-tags|智能手机/)
  })

  it('strips site chrome and prefers real article body', () => {
    const page = `<!doctype html><html><body>
      <header><a href="/login">登录</a><form><input placeholder="搜索"/></form></header>
      <nav class="navbar"><ul><li><a>媒体品牌</a></li><li><a>企业服务</a></li><li><a>政府服务</a></li></ul></nav>
      <div class="sidebar"><ul class="menu"><li><a>栏目一</a></li><li><a>栏目二</a></li></ul></div>
      <main>
        <div class="channel-nav"><a>热点</a><a>财经</a><a>科技</a></div>
        <div class="article-content">
          <h1>交大昂立公告</h1>
          <p>${'公司股票将实施其他风险警示，详情如下。'.repeat(12)}</p>
          <p>${'投资者应关注后续进展与风险提示。'.repeat(12)}</p>
        </div>
      </main>
      <footer>网站地图 投诉举报</footer>
    </body></html>`
    const stripped = stripChromeBlocks(page)
    expect(stripped).not.toContain('登录')
    expect(stripped).not.toContain('媒体品牌')
    const { html } = extractReadableFromHtml(page, 'https://news.example.com/a')
    expect(html).toContain('交大昂立')
    expect(html).toContain('风险警示')
    expect(html).not.toMatch(/登录|媒体品牌|企业服务|政府服务/)
    expect(scoreArticleCandidate(html)).toBeGreaterThan(
      scoreArticleCandidate('<nav><a>登录</a><a>搜索</a><a>媒体品牌</a></nav>')
    )
  })

  it('rejects nav-only SPA shells instead of showing login chrome', () => {
    const shell = `<!doctype html><html><body>
      <div class="header"><a>登录</a><a>搜索</a></div>
      <div class="kr-footer">
        <h3>媒体矩阵</h3><ul><li><a>a</a></li><li><a>b</a></li></ul>
        <h3>企业服务</h3><ul><li><a>c</a></li></ul>
        <h3>政府服务</h3><ul><li><a>d</a></li></ul>
      </div>
    </body></html>`
    const { html } = extractReadableFromHtml(shell, 'https://36kr.com/p/1')
    expect(html).toBe('')
  })

  it('reads articleBody from json-ld when DOM is empty shell', () => {
    const body = `${'欧盟人工智能法将带来透明度要求。'.repeat(20)}`
    const page = `<!doctype html><html><body>
      <div><a>登录</a><a>搜索</a></div>
      <script type="application/ld+json">${JSON.stringify({
        '@type': 'NewsArticle',
        headline: 'AI Act',
        articleBody: body
      })}</script>
    </body></html>`
    const { html } = extractReadableFromHtml(page, 'https://36kr.com/p/2')
    expect(html).toContain('人工智能法')
    expect(html).not.toMatch(/登录|搜索/)
  })

  it('extracts real qbitai page when fixture present', () => {
    const path = new URL('../.tmp-qbit.html', import.meta.url)
    // optional local fixture; skip if absent
    const file = path.pathname
    if (!existsSync(file)) return
    const page = readFileSync(file, 'utf8')
    const { html } = extractReadableFromHtml(page, 'https://www.qbitai.com/2026/07/463297.html')
    expect(isThinArticleHtml(html)).toBe(false)
    expect(html).toMatch(/RSI|Kernel|OpenAI/)
  })

  it('puts spaces between adjacent inline tags so words do not glue', () => {
    expect(separateAdjacentInlineTags('<span>OpenAI</span><span>buys</span>')).toBe(
      '<span>OpenAI</span> <span>buys</span>'
    )
    const html = sanitizeArticleHtml(
      '<p><span>OpenAI</span><span>buys</span><a href="https://ex.com/x">Glass</a></p>',
      'https://ex.com/a'
    )
    expect(html).toContain('OpenAI</span> <span>buys')
    expect(html).not.toContain('</span><span>')
  })
})
