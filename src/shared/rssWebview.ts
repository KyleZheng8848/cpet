/** RSS「网页」栏 webview 分区与 UA。 */

export const RSS_WEBVIEW_PARTITION = 'persist:rss-article'

/** 桌面 Chrome UA（去 Electron）；中间栏按真实宽度渲染。 */
export const RSS_WEBVIEW_DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/** @deprecated 兼容旧引用 */
export const RSS_WEBVIEW_MOBILE_UA = RSS_WEBVIEW_DESKTOP_UA

/** 内嵌 webview 常只出顶栏、正文空白的站点 → 直接走简洁。 */
const EXTRACT_ONLY_HOST_RE =
  /(?:^|\.)(?:ithome\.com|36kr\.com|huxiu\.com|sspai\.com|geekpark\.net|ifanr\.com|pingwest\.com)$/i

export function rssHostPrefersExtract(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, '')
    return EXTRACT_ONLY_HOST_RE.test(host)
  } catch {
    return false
  }
}

export type RssWebviewProbe = {
  /** 整页可见文字 */
  total: number
  /** 疑似正文区文字（article / 长段落） */
  article: number
  /** 较长段落数 */
  paras: number
}

/** 顶栏有字、正文几乎没有 → 典型内嵌被拦。 */
export function rssWebviewIsShellOnly(p: RssWebviewProbe): boolean {
  if (p.article < 100 && p.paras < 2) return true
  if (p.total < 160) return true
  // 有导航字数但正文极少
  if (p.total >= 160 && p.article < 80) return true
  return false
}

/**
 * 注入阅读增强并探测正文量。
 * 返回 RssWebviewProbe JSON（失败返回 { total:-1, article:-1, paras:0 }）。
 */
export const RSS_WEBVIEW_READER_SCRIPT = `(function () {
  try {
    var head = document.head || document.documentElement;
    // 按宿主真实宽度排版，避免站点按固定窄屏出「手机框」
    var vp = document.querySelector('meta[name="viewport"]');
    if (!vp) {
      vp = document.createElement('meta');
      vp.setAttribute('name', 'viewport');
      (head || document.documentElement).appendChild(vp);
    }
    vp.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=5, viewport-fit=cover');
    if (!document.getElementById('cpet-rss-reader-style')) {
      var st = document.createElement('style');
      st.id = 'cpet-rss-reader-style';
      st.textContent = [
        'html, body { width: 100% !important; max-width: 100% !important; min-width: 0 !important; overflow-x: auto !important; }',
        '[class*="open-app"], [class*="openApp"], [class*="OpenApp"],',
        '[class*="download-app"], [class*="downloadApp"], [class*="app-download"],',
        '[class*="appDownload"], [class*="downloadbar"], [class*="download-bar"],',
        '[id*="openApp"], [id*="open-app"], [class*="launch-app"], [class*="get-app"],',
        '.app_download, .app-open { display: none !important; }'
      ].join(' ');
      (head || document.documentElement).appendChild(st);
    }
    var hideNearby = function (el) {
      if (!el || el === document.body || el === document.documentElement) return;
      var node = el;
      for (var i = 0; i < 4 && node && node !== document.body; i++) {
        var text = (node.innerText || '').replace(/\\s+/g, ' ').trim();
        if (text.length > 0 && text.length < 80) {
          node.style.setProperty('display', 'none', 'important');
          return;
        }
        node = node.parentElement;
      }
      el.style.setProperty('display', 'none', 'important');
    };
    var nodes = document.querySelectorAll('a, button, div, span');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var t = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
      if (!t || t.length > 24) continue;
      if (/打开\\s*APP|打开应用|立即打开|下载\\s*APP|App\\s*内打开|打开客户端/i.test(t)) {
        hideNearby(el);
      }
    }
    var inputs = document.querySelectorAll('input, textarea, [contenteditable="true"]');
    for (var j = 0; j < inputs.length; j++) {
      var ph = (inputs[j].getAttribute('placeholder') || '').trim();
      if (/说两句|写评论|发表评论|留下评论/.test(ph)) hideNearby(inputs[j]);
    }

    var len = function (s) {
      return (s || '').replace(/\\s+/g, ' ').trim().length;
    };
    var total = len(document.body && document.body.innerText);
    var article = 0;
    var sels = [
      'article',
      'main',
      '[role="main"]',
      '.post-content',
      '.post_content',
      '.article-content',
      '.article_content',
      '.news-content',
      '.content',
      '#content',
      '.entry-content',
      '#paragraph',
      '.c-article-content'
    ];
    for (var s = 0; s < sels.length; s++) {
      var list = document.querySelectorAll(sels[s]);
      for (var k = 0; k < list.length; k++) {
        var n = list[k];
        if (n.closest && n.closest('header, nav, footer, aside')) continue;
        article = Math.max(article, len(n.innerText));
      }
    }
    var paras = 0;
    var paraLen = 0;
    var ps = document.querySelectorAll('p');
    for (var p = 0; p < ps.length; p++) {
      var pt = len(ps[p].innerText);
      if (pt >= 40) {
        paras += 1;
        paraLen += pt;
      }
    }
    article = Math.max(article, paraLen);
    return { total: total, article: article, paras: paras };
  } catch (e) {
    return { total: -1, article: -1, paras: 0 };
  }
})()`
