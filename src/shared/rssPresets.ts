/** 公共 RSS 精选目录（Folo Discover 心智：分类多、可搜、一键加）。
 * 收录以 HTTPS + 可解析 item/entry 探测为准；剔除失效 RSSHub / 返回 HTML 的伪源。
 */

export type RssPresetCategory =
  | 'hot'
  | 'tech'
  | 'news'
  | 'dev'
  | 'design'
  | 'world'
  | 'ai'
  | 'finance'
  | 'life'
  | 'social'
  | 'media'
  | 'game'
  | 'science'
  | 'blog'

export const RSS_PRESET_CATEGORIES: ReadonlyArray<{
  id: RssPresetCategory | 'all'
  label: string
}> = [
  { id: 'all', label: '全部' },
  { id: 'hot', label: '热榜' },
  { id: 'news', label: '资讯' },
  { id: 'tech', label: '科技' },
  { id: 'ai', label: 'AI' },
  { id: 'dev', label: '开发' },
  { id: 'finance', label: '财经' },
  { id: 'world', label: '国际' },
  { id: 'science', label: '科学' },
  { id: 'social', label: '社交' },
  { id: 'media', label: '影视' },
  { id: 'game', label: '游戏' },
  { id: 'design', label: '设计' },
  { id: 'blog', label: '博客' },
  { id: 'life', label: '生活' }
]

const RSS_PRESET_CATEGORY_SET = new Set<string>(
  RSS_PRESET_CATEGORIES.filter((c) => c.id !== 'all').map((c) => c.id)
)

export function isRssPresetCategory(raw: unknown): raw is RssPresetCategory {
  return typeof raw === 'string' && RSS_PRESET_CATEGORY_SET.has(raw)
}

/** 按名称 / URL / 描述推断目录分类（新增分类时供入库与重标）。 */
export function inferRssPresetCategory(
  name: string,
  url: string,
  desc = ''
): RssPresetCategory {
  const blob = `${name} ${desc} ${url}`.toLowerCase()
  if (
    /tophub\/|热搜|热榜|hot-list|hotlist|trending|排行榜|ranking\/all|热点榜|realtimehot/.test(
      blob
    )
  ) {
    return 'hot'
  }
  if (
    /openai|anthropic|deepmind|huggingface|llm|gpt-|claude|qwen|机器学习|人工智能|\bai\b|aigc|stable.?diffusion/.test(
      blob
    )
  ) {
    return 'ai'
  }
  if (
    /财经|证券|股票|fund|crypto|bitcoin|wallstreet|bloomberg|jin10|雪球|eastmoney|coin|blockchain|金融/.test(
      blob
    )
  ) {
    return 'finance'
  }
  if (
    /steam|nintendo|epicgames|playstation|xbox|游戏|gamekee|gamersky|ign\.com|3dmgame|taptap|switch|手游/.test(
      blob
    )
  ) {
    return 'game'
  }
  if (
    /bilibili|youtube|douban\/movie|影视|电影|电视剧|netflix|imdb|综艺|番组|bangumi|acfun|纪录片/.test(
      blob
    )
  ) {
    return 'media'
  }
  if (
    /twitter|weibo|xiaohongshu|douyin|telegram|mastodon|bluesky|bsky|instagram|threads|社交|即刻|okjike/.test(
      blob
    )
  ) {
    return 'social'
  }
  if (
    /nasa|nature\.com|science\.org|arxiv|科学|科研|sciencenet|量子|航天|天文|biology|physics/.test(
      blob
    )
  ) {
    return 'science'
  }
  if (/dribbble|behance|站酷|design|设计|figma|ui\/ux|摄影|500px/.test(blob)) {
    return 'design'
  }
  if (
    /github|v2ex|掘金|juejin|programming|linux|hackernews|hnrss|stackoverflow|dev\.to|rust|golang|kubernetes|docker|开源/.test(
      blob
    )
  ) {
    return 'dev'
  }
  if (
    /nytimes|reuters|bbc|economist|国际|早报|zaobao|apnews|washingtonpost|theguardian|世界/.test(
      blob
    )
  ) {
    return 'world'
  }
  if (/substack|medium\.com|blog|博客|newsletter|周刊|ruanyifeng|paulgraham/.test(blob)) {
    return 'blog'
  }
  if (
    /新闻|news|资讯|虎嗅|huxiu|36kr|澎湃|thepaper|ithome|cnbeta|读报|快讯|头条|sina\/|ifeng/.test(
      blob
    )
  ) {
    return 'news'
  }
  if (/科技|tech|sspai|少数派|geek|数码|gadget|product.?hunt/.test(blob)) {
    return 'tech'
  }
  if (/播客|podcast|生活|美食|旅行|健康|xiaoyuzhou|spotif/.test(blob)) {
    return 'life'
  }
  return 'tech'
}

export type RssFeedPreset = {
  id: string
  name: string
  url: string
  desc: string
  category: RssPresetCategory
  /** 可选：目录/内置指标（订阅热度）。 */
  subscribers?: number
  /** 可选：目录/内置指标（最近更新 ms）。 */
  updatedAt?: number
}

/** 精选订阅库；条目均经可用性探测（HTTPS + RSS/Atom 条目）。 */
export const RSS_FEED_PRESETS: ReadonlyArray<RssFeedPreset> = [
  // —— 流媒体 / 热搜榜（今日热榜 tophub + 可用 RSSHub；已探测可解析）——
  {
    id: 'folo-weibo-hot',
    name: '微博热搜',
    url: 'https://rsshub.rssforever.com/tophub/KqndgxeLl9',
    desc: '微博实时热搜榜',
    category: 'hot',
    subscribers: 42000
  },
  {
    id: 'folo-toutiao-hot',
    name: '今日头条 · 热榜',
    url: 'https://rsshub.rssforever.com/tophub/x9ozB4KoXb',
    desc: '今日头条热榜',
    category: 'hot',
    subscribers: 18000
  },
  {
    id: 'folo-douyin-hot',
    name: '抖音 · 热点榜',
    url: 'https://rsshub.rssforever.com/tophub/K7GdaMgdQy',
    desc: '抖音热点榜',
    category: 'hot',
    subscribers: 22000
  },
  {
    id: 'folo-baidu-hot',
    name: '百度热搜',
    url: 'https://rsshub.rssforever.com/tophub/Jb0vmloB1G',
    desc: '百度实时热点',
    category: 'hot',
    subscribers: 20000
  },
  {
    id: 'folo-bilibili-rank',
    name: 'B站 · 全站排行',
    url: 'https://rsshub.rssforever.com/bilibili/ranking/all',
    desc: '哔哩哔哩全站排行榜',
    category: 'media',
    subscribers: 16000
  },
  {
    id: 'folo-thepaper-featured',
    name: '澎湃新闻 · 首页头条',
    url: 'https://rsshub.rssforever.com/thepaper/featured',
    desc: '澎湃精选头条',
    category: 'news',
    subscribers: 9000
  },
  {
    id: 'folo-wallstreetcn-live',
    name: '华尔街见闻 · 快讯',
    url: 'https://rsshub.rssforever.com/wallstreetcn/live',
    desc: '华尔街见闻实时快讯',
    category: 'finance',
    subscribers: 8500
  },
  {
    id: 'folo-wallstreetcn-hot',
    name: '华尔街见闻 · 最热',
    url: 'https://rsshub.rssforever.com/wallstreetcn/hot',
    desc: '华尔街见闻热门文章',
    category: 'finance',
    subscribers: 7200
  },
  {
    id: 'folo-ithome-rank',
    name: 'IT之家 · 24小时榜',
    url: 'https://rsshub.rssforever.com/ithome/ranking/24h',
    desc: 'IT之家 24 小时热榜',
    category: 'tech',
    subscribers: 6500
  },
  {
    id: 'folo-sina-roll',
    name: '新浪新闻 · 滚动',
    url: 'https://rsshub.rssforever.com/sina/rollnews',
    desc: '新浪滚动新闻',
    category: 'news',
    subscribers: 5000
  },
  {
    id: 'folo-ifeng-news',
    name: '凤凰网 · 资讯',
    url: 'https://rsshub.rssforever.com/ifeng/news',
    desc: '凤凰网资讯',
    category: 'news',
    subscribers: 4800
  },
  {
    id: 'folo-zhihu-pin-hot',
    name: '知乎想法 · 热榜',
    url: 'https://rsshub.rssforever.com/zhihu/pin/hotlist',
    desc: '知乎想法热榜',
    category: 'hot',
    subscribers: 7000
  },
  {
    id: 'folo-douban-movie-weekly',
    name: '豆瓣 · 一周口碑榜',
    url: 'https://rsshub.rssforever.com/douban/movie/weekly',
    desc: '豆瓣电影一周口碑榜',
    category: 'media',
    subscribers: 5500
  },
  {
    id: 'folo-v2ex-hot',
    name: 'V2EX · 热门',
    url: 'https://rsshub.rssforever.com/v2ex/topics/hot',
    desc: 'V2EX 今日热门',
    category: 'dev',
    subscribers: 11000
  },
  // —— Folo Discover 风格热门（中文热榜 / 社区 / 早报）——
  // RSSHub 路由优先可用镜像；直连源优先官方 HTTPS。
  {
    id: 'folo-36kr-hot',
    name: '36氪 · 24小时热榜',
    url: 'https://rsshub.rssforever.com/36kr/hot-list',
    desc: '36氪热榜',
    category: 'tech',
    subscribers: 15300
  },
  {
    id: 'folo-gh-trending',
    name: 'GitHub Trending',
    url: 'https://rsshub.rssforever.com/github/trending/daily/any',
    desc: 'GitHub 每日热门仓库',
    category: 'dev',
    subscribers: 46500
  },
  {
    id: 'folo-wechat-hot',
    name: '微信 · 24h热文榜',
    url: 'https://rsshub.rssforever.com/tophub/WnBe01o371',
    desc: '微信热文榜',
    category: 'hot',
    subscribers: 2800
  },
  {
    id: 'folo-huxiu',
    name: '虎嗅',
    url: 'https://rss.huxiu.com/',
    desc: '商业与科技评论',
    category: 'tech',
    subscribers: 2500
  },
  {
    id: 'folo-cnbeta',
    name: 'cnBeta',
    url: 'https://rsshub.rssforever.com/cnbeta',
    desc: '中文业界资讯',
    category: 'tech',
    subscribers: 2300
  },
  {
    id: 'folo-ezindie',
    name: 'ezindie 独立变现',
    url: 'https://www.ezindie.com/feed/rss.xml',
    desc: '独立产品与变现周刊',
    category: 'tech',
    subscribers: 3000
  },
  {
    id: 'folo-economist-zh',
    name: '经济学人最新报道',
    url: 'https://economistnew.buzzing.cc/feed.xml',
    desc: '经济学人中文精选',
    category: 'world',
    subscribers: 2200
  },
  {
    id: 'folo-ph-hot',
    name: 'Product Hunt 热门',
    url: 'https://ph.buzzing.cc/feed.xml',
    desc: 'Product Hunt 中文热门',
    category: 'tech',
    subscribers: 1200
  },
  {
    id: 'folo-anthropic-research',
    name: 'Anthropic Research',
    url: 'https://rsshub.rssforever.com/anthropic/research',
    desc: 'Anthropic 研究文章',
    category: 'ai',
    subscribers: 2800
  },
  {
    id: 'folo-bookfere-weekly',
    name: '每周一书 · 书伴',
    url: 'https://rsshub.rssforever.com/bookfere/weekly',
    desc: '书伴每周一书',
    category: 'life',
    subscribers: 2100
  },
  {
    id: 'folo-sciencenet',
    name: '科学网 · 精选博文',
    url: 'https://rsshub.rssforever.com/sciencenet/blog',
    desc: '科学网博客精选',
    category: 'world',
    subscribers: 2900
  },
  {
    id: 'folo-tmtpost',
    name: '钛媒体',
    url: 'https://www.tmtpost.com/rss.xml',
    desc: '科技与商业媒体',
    category: 'tech'
  },
  {
    id: 'folo-bookfere',
    name: '书伴',
    url: 'https://feeds.feedburner.com/bookfere',
    desc: '电子书与阅读',
    category: 'life'
  },
  // —— Folo Discover「全部分类」热门补齐（api.follow.is/trending/feeds）——
  {
    id: 'folo-zhihu-hot',
    name: '知乎热榜',
    url: 'https://rsshub.rssforever.com/zhihu/hot',
    desc: '知乎热榜',
    category: 'hot',
    subscribers: 15669
  },
  {
    id: 'folo-ahead-of-ai',
    name: 'Ahead of AI',
    url: 'https://magazine.sebastianraschka.com/feed',
    desc: 'Sebastian Raschka AI 通讯',
    category: 'ai',
    subscribers: 45605
  },
  {
    id: 'folo-last-week-in-ai',
    name: 'Last Week in AI',
    url: 'https://lastweekin.ai/feed',
    desc: 'AI 周报',
    category: 'ai',
    subscribers: 48568
  },
  {
    id: 'folo-zaobao-world',
    name: '联合早报 · 国际即时',
    url: 'https://plink.anyfeeder.com/zaobao/realtime/world',
    desc: '联合早报国际即时',
    category: 'world',
    subscribers: 2089
  },
  {
    id: 'folo-sv101',
    name: '硅谷101',
    url: 'https://rsshub.rssforever.com/xiaoyuzhou/podcast/5e5c52c9418a84a04625e6cc',
    desc: '硅谷101 播客',
    category: 'tech',
    subscribers: 1619
  },
  {
    id: 'folo-hacker-news-thn',
    name: 'The Hacker News',
    url: 'https://feeds.feedburner.com/TheHackersNews',
    desc: '信息安全新闻',
    category: 'tech',
    subscribers: 691
  },
  {
    id: 'folo-schneier',
    name: 'Schneier on Security',
    url: 'https://www.schneier.com/feed/',
    desc: '安全评论',
    category: 'tech',
    subscribers: 104
  },
  {
    id: 'folo-mckinsey-cn',
    name: '麦肯锡中国洞察',
    url: 'https://rsshub.rssforever.com/mckinsey/cn/25',
    desc: '麦肯锡中国洞察',
    category: 'finance',
    subscribers: 1266
  },
  {
    id: 'folo-gcores',
    name: '机核',
    url: 'https://www.gcores.com/rss',
    desc: '游戏与玩家文化',
    category: 'life',
    subscribers: 1948
  },
  {
    id: 'folo-street-photo-cn',
    name: '街拍中国',
    url: 'https://rsshub.rssforever.com/500px/tribe/set/9f09736f0a6a436ca46bf2b6f4779bcd',
    desc: '街拍摄影精选',
    category: 'design',
    subscribers: 1929
  },
  {
    id: 'folo-baoyu',
    name: '宝玉的博客',
    url: 'https://s.baoyu.io/feed.xml',
    desc: '宝玉的技术与产品博客',
    category: 'dev'
  },
  {
    id: 'folo-ruanyifeng-blog',
    name: '阮一峰的网络日志',
    url: 'https://feeds.feedburner.com/ruanyifeng',
    desc: '阮一峰博客',
    category: 'dev',
    subscribers: 15512
  },
  {
    id: 'folo-hacker-podcast',
    name: 'Hacker Podcast',
    url: 'https://hacker-podcast.agi.li/rss.xml',
    desc: 'Agili 的 Hacker Podcast',
    category: 'dev',
    subscribers: 2844
  },
  {
    id: 'folo-openclaw-releases',
    name: 'OpenClaw Releases',
    url: 'https://github.com/openclaw/openclaw/releases.atom',
    desc: 'OpenClaw 发布说明',
    category: 'dev',
    subscribers: 113
  },
  {
    id: 'folo-nasa-apod',
    name: 'NASA APOD',
    url: 'https://apod.nasa.gov/apod.rss',
    desc: 'NASA 每日天文一图',
    category: 'world'
  },
  // —— Folo Discover 热门榜其余条目（含社交/视频；RSSHub 镜像，与榜单一致）——
  {
    id: 'folo-linuxdo-welfare',
    name: '福利羊毛 · LINUX DO',
    url: 'https://linux.do/c/welfare/36.rss',
    desc: 'LINUX DO 福利羊毛板块',
    category: 'life',
    subscribers: 2600
  },
  {
    id: 'folo-juya-ai-daily',
    name: '橘鸦AI早报',
    url: 'https://imjuya.github.io/juya-ai-daily/rss.xml',
    desc: '橘鸦 AI 早报（Folo 热门）',
    category: 'ai',
    subscribers: 2700
  },
  {
    id: 'folo-wsj-zh',
    name: '华尔街日报中文',
    url: 'https://cn.wsj.com/rss-news-and-feeds/zh-hans',
    desc: '华尔街日报中文资讯',
    category: 'finance',
    subscribers: 2700
  },
  {
    id: 'folo-tw-tw93',
    name: 'Twitter · Tw93',
    url: 'https://rsshub.rssforever.com/twitter/user/HiTw93',
    desc: 'Twitter @Tw93',
    category: 'life',
    subscribers: 4800
  },
  {
    id: 'folo-tw-guizang',
    name: 'Twitter · 歸藏',
    url: 'https://rsshub.rssforever.com/twitter/user/op7418',
    desc: 'Twitter @歸藏(guizang.ai)',
    category: 'ai',
    subscribers: 2400
  },
  {
    id: 'folo-tw-steipete',
    name: 'Twitter · Peter Steinberger',
    url: 'https://rsshub.rssforever.com/twitter/user/steipete',
    desc: 'Twitter @steipete',
    category: 'dev',
    subscribers: 2000
  },
  {
    id: 'folo-tw-elon',
    name: 'Twitter · Elon Musk',
    url: 'https://rsshub.rssforever.com/twitter/user/elonmusk',
    desc: 'Twitter @elonmusk',
    category: 'life',
    subscribers: 5000
  },
  {
    id: 'folo-tw-fxtrader',
    name: 'Twitter · 外汇交易员',
    url: 'https://rsshub.rssforever.com/twitter/user/fxtrader',
    desc: 'Twitter @外汇交易员',
    category: 'finance',
    subscribers: 2000
  },
  {
    id: 'folo-tw-anthropic',
    name: 'Twitter · Anthropic',
    url: 'https://rsshub.rssforever.com/twitter/user/AnthropicAI',
    desc: 'Twitter @AnthropicAI',
    category: 'ai',
    subscribers: 2000
  },
  {
    id: 'folo-tw-karpathy',
    name: 'Twitter · Andrej Karpathy',
    url: 'https://rsshub.rssforever.com/twitter/user/karpathy',
    desc: 'Twitter @karpathy',
    category: 'ai',
    subscribers: 3000
  },
  {
    id: 'folo-yt-lexfridman',
    name: 'YouTube · Lex Fridman',
    url: 'https://rsshub.rssforever.com/youtube/user/@lexfridman',
    desc: 'Lex Fridman Podcast',
    category: 'life',
    subscribers: 691
  },
  {
    id: 'folo-yt-karpathy',
    name: 'YouTube · Andrej Karpathy',
    url: 'https://rsshub.rssforever.com/youtube/user/@AndrejKarpathy',
    desc: 'Andrej Karpathy 视频',
    category: 'ai',
    subscribers: 1500
  },
  {
    id: 'folo-yt-lingdu',
    name: 'YouTube · 零度解说',
    url: 'https://rsshub.rssforever.com/youtube/user/@lingdujieshuo',
    desc: '零度解说',
    category: 'tech',
    subscribers: 1000
  },
  {
    id: 'folo-tg-alyp',
    name: '网盘影视 · Telegram',
    url: 'https://rsshub.rssforever.com/telegram/channel/alyp_1',
    desc: 'Telegram 频道 alyp_1',
    category: 'life',
    subscribers: 1000
  },
  {
    id: 'folo-weibo-smx',
    name: '微博 · 数码闲聊站',
    url: 'https://rsshub.rssforever.com/weibo/user/6048569942',
    desc: '数码闲聊站微博',
    category: 'tech',
    subscribers: 1500
  },
  {
    id: 'folo-baoyu-rsshub',
    name: '宝玉的博客（RSSHub）',
    url: 'https://rsshub.rssforever.com/baoyu/blog',
    desc: '宝玉博客 RSSHub 路由',
    category: 'dev'
  },
  {
    id: 'folo-nasa-apod-rsshub',
    name: 'NASA APOD（RSSHub）',
    url: 'https://rsshub.rssforever.com/nasa/apod',
    desc: 'NASA 每日天文一图（RSSHub）',
    category: 'world'
  },

  // —— 科技 ——
  { id: '36kr', name: '36氪', url: 'https://36kr.com/feed', desc: '创投与商业科技', category: 'tech' },
  { id: '9to5mac', name: '9to5Mac', url: 'https://9to5mac.com/feed/', desc: 'Apple 生态', category: 'tech' },
  { id: 'ifanr', name: '爱范儿', url: 'https://www.ifanr.com/feed', desc: '消费电子与数字生活', category: 'tech' },
  { id: 'geekpark', name: '极客公园', url: 'https://www.geekpark.net/rss', desc: '创新与科技评论', category: 'tech' },
  { id: 'dgtle', name: '数字尾巴', url: 'https://www.dgtle.com/rss/dgtle.xml', desc: '数字生活社区', category: 'tech' },
  { id: 'arstechnica', name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index', desc: '硬核科技', category: 'tech' },
  { id: 'cnet', name: 'CNET', url: 'https://www.cnet.com/rss/news/', desc: '消费科技评测', category: 'tech' },
  { id: 'fastcompany', name: 'Fast Company', url: 'https://www.fastcompany.com/latest/rss', desc: '创新与商业', category: 'tech' },
  { id: 'gsmarena', name: 'GSMArena', url: 'https://www.gsmarena.com/rss-news-reviews.php3', desc: '手机与移动设备', category: 'tech' },
  { id: 'hnrss', name: 'HN 头条', url: 'https://hnrss.org/frontpage', desc: 'Hacker News 首页', category: 'tech' },
  { id: 'hn-ask', name: 'HN Ask', url: 'https://hnrss.org/ask', desc: 'HN Ask HN', category: 'tech' },
  { id: 'hn-best', name: 'HN Best', url: 'https://hnrss.org/best', desc: 'HN 高分帖', category: 'tech' },
  {
    id: 'hn-show',
    name: 'HN Show',
    url: 'https://hnrss.org/show',
    desc: 'HN Show HN',
    category: 'tech',
    subscribers: 426
  },
  { id: 'ieee-spectrum', name: 'IEEE Spectrum', url: 'https://spectrum.ieee.org/feeds/feed.rss', desc: '工程与科技', category: 'tech' },
  { id: 'ithome', name: 'IT之家', url: 'https://www.ithome.com/rss/', desc: '数码与科技快讯', category: 'tech' },
  { id: 'lobsters', name: 'Lobsters', url: 'https://lobste.rs/rss', desc: '极客链接收藏', category: 'tech' },
  { id: 'macrumors', name: 'MacRumors', url: 'https://feeds.macrumors.com/MacRumors-All', desc: 'Apple 传闻与评测', category: 'tech' },
  { id: 'mittr', name: 'MIT Tech Review', url: 'https://www.technologyreview.com/feed/', desc: '麻省理工科技评论', category: 'tech' },
  { id: 'platformer', name: 'Platformer', url: 'https://www.platformer.news/rss/', desc: '平台与科技政策', category: 'tech' },
  { id: 'solidot', name: 'Solidot', url: 'https://www.solidot.org/index.rss', desc: '中文科技奇闻', category: 'tech' },
  { id: 'techinasia', name: 'Tech in Asia', url: 'https://www.techinasia.com/feed', desc: '亚洲科技创业', category: 'tech' },
  { id: 'techcrunch', name: 'TechCrunch', url: 'https://techcrunch.com/feed/', desc: '创业与科技新闻', category: 'tech' },
  { id: 'techmeme', name: 'Techmeme', url: 'https://www.techmeme.com/feed.xml', desc: '科技头条聚合', category: 'tech' },
  { id: 'verge', name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', desc: '科技与文化', category: 'tech' },
  { id: 'tomshardware', name: 'Tom\'s Hardware', url: 'https://www.tomshardware.com/feeds/all', desc: '硬件评测', category: 'tech' },
  { id: 'venturebeat', name: 'VentureBeat', url: 'https://venturebeat.com/feed/', desc: '科技与创业', category: 'tech' },
  { id: 'wired', name: 'WIRED', url: 'https://www.wired.com/feed/rss', desc: '科技深度报道', category: 'tech' },
  { id: 'ycombinator', name: 'YC Blog', url: 'https://www.ycombinator.com/blog/rss/', desc: 'Y Combinator 博客', category: 'tech' },
  { id: 'zdnet', name: 'ZDNET', url: 'https://www.zdnet.com/news/rss.xml', desc: '企业科技新闻', category: 'tech' },

  // —— AI ——
  { id: 'leiphone', name: '雷峰网', url: 'https://www.leiphone.com/feed', desc: '智能硬件与 AI', category: 'ai' },
  { id: 'qbitai', name: '量子位', url: 'https://www.qbitai.com/feed', desc: 'AI 与前沿科技', category: 'ai' },
  { id: 'anthropic', name: 'Anthropic News', url: 'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_news.xml', desc: 'Anthropic 动态（镜像）', category: 'ai' },
  { id: 'arxiv-cs', name: 'arXiv cs', url: 'https://rss.arxiv.org/rss/cs', desc: '计算机科学预印本', category: 'ai' },
  { id: 'arxiv-ai', name: 'arXiv cs.AI', url: 'https://rss.arxiv.org/rss/cs.AI', desc: '人工智能预印本', category: 'ai' },
  { id: 'arxiv-cl', name: 'arXiv cs.CL', url: 'https://rss.arxiv.org/rss/cs.CL', desc: '计算语言学预印本', category: 'ai' },
  { id: 'arxiv-lg', name: 'arXiv cs.LG', url: 'https://rss.arxiv.org/rss/cs.LG', desc: '机器学习预印本', category: 'ai' },
  { id: 'distill', name: 'Distill', url: 'https://distill.pub/rss.xml', desc: '可交互机器学习', category: 'ai' },
  { id: 'deepmind', name: 'Google DeepMind', url: 'https://deepmind.google/blog/rss.xml', desc: 'DeepMind 研究博客', category: 'ai' },
  { id: 'huggingface', name: 'Hugging Face', url: 'https://hf-mirror.com/blog/feed.xml', desc: 'HF Blog 镜像', category: 'ai' },
  { id: 'importai', name: 'Import AI', url: 'https://jack-clark.net/feed/', desc: 'AI 产业周报', category: 'ai' },
  { id: 'latent', name: 'Latent Space', url: 'https://www.latent.space/feed', desc: 'AI 工程播客/通讯', category: 'ai' },
  { id: 'lilian', name: 'Lilian Weng', url: 'https://lilianweng.github.io/index.xml', desc: 'LLM 综述', category: 'ai' },
  { id: 'marktechpost', name: 'MarkTechPost', url: 'https://www.marktechpost.com/feed/', desc: 'AI 研究速递', category: 'ai' },
  { id: 'ollama', name: 'Ollama Blog', url: 'https://ollama.com/blog/rss.xml', desc: '本地模型与工具', category: 'ai' },
  { id: 'openai-blog', name: 'OpenAI Blog', url: 'https://openai.com/blog/rss.xml', desc: 'OpenAI 官方博客', category: 'ai' },
  { id: 'openai-news', name: 'OpenAI News', url: 'https://openai.com/news/rss.xml', desc: 'OpenAI 新闻', category: 'ai' },
  { id: 'pytorch', name: 'PyTorch Blog', url: 'https://pytorch.org/blog/feed.xml', desc: 'PyTorch 官方', category: 'ai' },
  { id: 'sebastian', name: 'Sebastian Raschka', url: 'https://sebastianraschka.com/rss_feed.xml', desc: 'ML 教育与研究', category: 'ai' },
  { id: 'semianalysis', name: 'SemiAnalysis', url: 'https://www.semianalysis.com/feed', desc: '芯片与 AI 基础设施', category: 'ai' },
  { id: 'simonw', name: 'Simon Willison', url: 'https://simonwillison.net/atom/everything/', desc: 'LLM 实践笔记', category: 'ai' },
  { id: 'tensorflow', name: 'TensorFlow Blog', url: 'https://blog.tensorflow.org/feeds/posts/default?alt=rss', desc: 'TensorFlow 官方', category: 'ai' },
  { id: 'wired-ai', name: 'WIRED AI', url: 'https://www.wired.com/feed/tag/ai/latest/rss', desc: 'WIRED 人工智能', category: 'ai' },

  // —— 开发 ——
  { id: 'dotnet', name: '.NET Blog', url: 'https://devblogs.microsoft.com/dotnet/feed/', desc: '.NET 官方', category: 'dev' },
  { id: 'juejin', name: '掘金', url: 'https://juejin.cn/rss', desc: '中文技术社区', category: 'dev' },
  { id: 'oschina', name: '开源中国', url: 'https://www.oschina.net/news/rss', desc: '开源资讯', category: 'dev' },
  { id: 'coolshell', name: '酷壳 CoolShell', url: 'https://coolshell.cn/feed', desc: '编程思考', category: 'dev' },
  { id: 'ruanyifeng', name: '阮一峰周刊', url: 'https://www.ruanyifeng.com/blog/atom.xml', desc: '科技爱好者周刊', category: 'dev' },
  { id: 'astro', name: 'Astro', url: 'https://astro.build/rss.xml', desc: 'Astro 官方', category: 'dev' },
  { id: 'aws-blog', name: 'AWS Blog', url: 'https://aws.amazon.com/blogs/aws/feed/', desc: 'AWS 工程博客', category: 'dev' },
  { id: 'aws-news', name: 'AWS News', url: 'https://aws.amazon.com/about-aws/whats-new/recent/feed/', desc: 'AWS 新功能', category: 'dev' },
  { id: 'berthub', name: 'Bert Hubert', url: 'https://berthub.eu/articles/index.xml', desc: '系统与安全', category: 'dev' },
  { id: 'bun', name: 'Bun Blog', url: 'https://bun.sh/rss.xml', desc: 'Bun 运行时', category: 'dev' },
  { id: 'bytebytego', name: 'ByteByteGo', url: 'https://blog.bytebytego.com/feed', desc: '系统与架构图解', category: 'dev' },
  { id: 'changelog', name: 'Changelog', url: 'https://changelog.com/feed', desc: '开发者播客/通讯', category: 'dev' },
  { id: 'changelog-news', name: 'Changelog News', url: 'https://changelog.com/news/feed', desc: '开发者新闻', category: 'dev' },
  { id: 'cloudflare', name: 'Cloudflare Blog', url: 'https://blog.cloudflare.com/rss/', desc: '网络与边缘计算', category: 'dev' },
  { id: 'cloudflare-radar', name: 'Cloudflare Radar', url: 'https://blog.cloudflare.com/tag/cloudflare-radar/rss/', desc: '互联网观测', category: 'dev' },
  { id: 'css-tricks', name: 'CSS-Tricks', url: 'https://css-tricks.com/feed/', desc: '前端与 CSS', category: 'dev' },
  { id: 'danluu', name: 'Dan Luu', url: 'https://danluu.com/atom.xml', desc: '工程随笔', category: 'dev' },
  { id: 'dbweekly', name: 'DB Weekly', url: 'https://dbweekly.com/rss/', desc: '数据库周刊', category: 'dev' },
  { id: 'deno', name: 'Deno', url: 'https://deno.com/feed', desc: 'Deno 官方', category: 'dev' },
  { id: 'devto', name: 'DEV', url: 'https://dev.to/feed', desc: '开发者社区', category: 'dev' },
  { id: 'dropbox-tech', name: 'Dropbox Tech', url: 'https://dropbox.tech/feed', desc: 'Dropbox 技术', category: 'dev' },
  { id: 'electron', name: 'Electron', url: 'https://www.electronjs.org/blog/rss.xml', desc: 'Electron 官方', category: 'dev' },
  { id: 'frontendfocus', name: 'Frontend Focus', url: 'https://frontendfoc.us/rss/', desc: '前端周刊', category: 'dev' },
  { id: 'github-blog', name: 'GitHub Blog', url: 'https://github.blog/feed/', desc: 'GitHub 官方博客', category: 'dev' },
  { id: 'github-changelog', name: 'GitHub Changelog', url: 'https://github.blog/changelog/feed/', desc: 'GitHub 产品更新', category: 'dev' },
  { id: 'github-eng', name: 'GitHub Engineering', url: 'https://github.blog/category/engineering/feed/', desc: 'GitHub 工程', category: 'dev' },
  { id: 'golang-blog', name: 'Go Blog', url: 'https://go.dev/blog/feed.atom', desc: 'Go 官方博客', category: 'dev' },
  { id: 'golangweekly', name: 'Go Weekly', url: 'https://golangweekly.com/rss/', desc: 'Go 周刊', category: 'dev' },
  { id: 'infoq-en', name: 'InfoQ', url: 'https://feed.infoq.com/', desc: '英文工程实践', category: 'dev' },
  { id: 'infoq-cn', name: 'InfoQ 中文', url: 'https://www.infoq.cn/feed', desc: '架构与工程实践', category: 'dev' },
  { id: 'java-blog', name: 'Inside Java', url: 'https://inside.java/feed.xml', desc: 'Java 官方', category: 'dev' },
  { id: 'joelonsoftware', name: 'Joel on Software', url: 'https://www.joelonsoftware.com/feed/', desc: '软件工程随笔', category: 'dev' },
  { id: 'joshwcomeau', name: 'Josh Comeau', url: 'https://www.joshwcomeau.com/rss.xml', desc: '前端与动画', category: 'dev' },
  { id: 'jsweekly', name: 'JS Weekly', url: 'https://javascriptweekly.com/rss/', desc: 'JavaScript 周刊', category: 'dev' },
  { id: 'kotlin-blog', name: 'Kotlin Blog', url: 'https://blog.jetbrains.com/kotlin/feed/', desc: 'Kotlin 官方', category: 'dev' },
  { id: 'kubernetes', name: 'Kubernetes Blog', url: 'https://kubernetes.io/feed.xml', desc: 'K8s 官方', category: 'dev' },
  { id: 'lwn', name: 'LWN', url: 'https://lwn.net/headlines/rss', desc: 'Linux 与开源深度', category: 'dev' },
  { id: 'kernel', name: 'LWN Features', url: 'https://lwn.net/headlines/Features', desc: 'LWN 专题', category: 'dev' },
  { id: 'martinfowler', name: 'Martin Fowler', url: 'https://martinfowler.com/feed.atom', desc: '软件设计', category: 'dev' },
  { id: 'meta-eng', name: 'Meta Engineering', url: 'https://engineering.fb.com/feed/', desc: 'Meta 工程', category: 'dev' },
  { id: 'netflix-tech', name: 'Netflix TechBlog', url: 'https://netflixtechblog.com/feed', desc: 'Netflix 技术', category: 'dev' },
  { id: 'nextjs', name: 'Next.js', url: 'https://nextjs.org/feed.xml', desc: 'Next.js 官方', category: 'dev' },
  { id: 'nodeweekly', name: 'Node Weekly', url: 'https://nodeweekly.com/rss/', desc: 'Node 周刊', category: 'dev' },
  { id: 'nodejs', name: 'Node.js Blog', url: 'https://nodejs.org/en/feed/blog.xml', desc: 'Node.js 官方', category: 'dev' },
  { id: 'overreacted', name: 'overreacted', url: 'https://overreacted.io/rss.xml', desc: 'React 深度文章', category: 'dev' },
  { id: 'phodal', name: 'Phodal', url: 'https://www.phodal.com/blog/feeds/rss/', desc: '架构与工程', category: 'dev' },
  { id: 'phoronix', name: 'Phoronix', url: 'https://www.phoronix.com/rss.php', desc: 'Linux 硬件与性能', category: 'dev' },
  { id: 'python-blog', name: 'Python Blog', url: 'https://blog.python.org/feeds/posts/default?alt=rss', desc: 'Python 官方', category: 'dev' },
  { id: 'rubyweekly', name: 'Ruby Weekly', url: 'https://rubyweekly.com/rss/', desc: 'Ruby 周刊', category: 'dev' },
  { id: 'rust-blog', name: 'Rust Blog', url: 'https://blog.rust-lang.org/feed.xml', desc: 'Rust 语言官方', category: 'dev' },
  { id: 'sdtimes', name: 'SD Times', url: 'https://sdtimes.com/feed/', desc: '软件开发产业', category: 'dev' },
  { id: 'segmentfault', name: 'SegmentFault', url: 'https://segmentfault.com/feeds', desc: '中文开发者社区', category: 'dev' },
  {
    id: 'spotify-eng',
    name: 'Spotify Engineering',
    url: 'https://engineering.atspotify.com/feed',
    desc: 'Spotify 工程',
    category: 'dev',
    subscribers: 234
  },
  { id: 'stackoverflow-blog', name: 'Stack Overflow', url: 'https://stackoverflow.blog/feed/', desc: '开发者博客', category: 'dev' },
  { id: 'svelte', name: 'Svelte', url: 'https://svelte.dev/blog/rss.xml', desc: 'Svelte 官方', category: 'dev' },
  { id: 'swift-blog', name: 'Swift.org', url: 'https://www.swift.org/atom.xml', desc: 'Swift 官方', category: 'dev' },
  { id: 'systemdesign', name: 'System Design', url: 'https://newsletter.systemdesign.one/feed', desc: '系统设计通讯', category: 'dev' },
  { id: 'thenewstack', name: 'The New Stack', url: 'https://thenewstack.io/feed/', desc: '云原生与平台', category: 'dev' },
  { id: 'thisweekinrust', name: 'This Week in Rust', url: 'https://this-week-in-rust.org/rss.xml', desc: 'Rust 周报', category: 'dev' },

  // —— 资讯 ——
  { id: 'jiemian', name: '界面新闻', url: 'https://a.jiemian.com/index.php?m=article&a=rss', desc: '商业与时事', category: 'news' },
  { id: 'people-tech', name: '人民网科技', url: 'https://www.people.com.cn/rss/it.xml', desc: '科技要闻', category: 'news' },
  { id: 'sina-news', name: '新浪国内', url: 'https://rss.sina.com.cn/news/china/focus15.xml', desc: '国内焦点', category: 'news' },
  { id: 'china-news', name: '中新网滚动', url: 'https://www.chinanews.com.cn/rss/scroll-news.xml', desc: '时事滚动', category: 'news' },
  { id: 'chinadaily', name: 'China Daily', url: 'https://www.chinadaily.com.cn/rss/china_rss.xml', desc: '中国日报英文', category: 'news' },

  // —— 国际 / 科学 ——
  { id: 'people-world', name: '人民网国际', url: 'https://www.people.com.cn/rss/world.xml', desc: '国际要闻', category: 'world' },
  { id: 'sina-world', name: '新浪国际', url: 'https://rss.sina.com.cn/news/world/focus15.xml', desc: '国际焦点', category: 'world' },
  { id: 'esa', name: 'ESA', url: 'https://www.esa.int/rssfeed/TopNews', desc: '欧洲航天局', category: 'world' },
  { id: 'mit-news', name: 'MIT News', url: 'https://news.mit.edu/rss/feed', desc: '麻省理工新闻', category: 'world' },
  { id: 'nasa', name: 'NASA', url: 'https://www.nasa.gov/rss/dyn/breaking_news.rss', desc: '航天新闻', category: 'world' },
  { id: 'nature', name: 'Nature', url: 'https://www.nature.com/nature.rss', desc: '自然科学', category: 'world' },
  { id: 'newscientist', name: 'New Scientist', url: 'https://www.newscientist.com/feed/home/', desc: '科学杂志', category: 'world' },
  { id: 'physorg', name: 'Phys.org', url: 'https://phys.org/rss-feed/', desc: '科学与技术', category: 'world' },
  { id: 'quantamag', name: 'Quanta Magazine', url: 'https://www.quantamagazine.org/feed/', desc: '基础科学深度', category: 'world' },
  { id: 'science', name: 'Science', url: 'https://www.science.org/rss/news_current.xml', desc: '科学新闻', category: 'world' },
  { id: 'un-news', name: 'UN News', url: 'https://news.un.org/feed/subscribe/en/news/all/rss.xml', desc: '联合国新闻', category: 'world' },
  { id: 'who', name: 'WHO News', url: 'https://www.who.int/rss-feeds/news-english.xml', desc: '世界卫生组织', category: 'world' },
  { id: 'wired-science', name: 'WIRED Science', url: 'https://www.wired.com/feed/category/science/latest/rss', desc: 'WIRED 科学', category: 'world' },

  // —— 设计 ——
  { id: 'sspai', name: '少数派', url: 'https://sspai.com/feed', desc: '效率与数字生活', category: 'design' },
  { id: 'appinn', name: '小众软件', url: 'https://www.appinn.com/feed/', desc: '软件发现', category: 'design' },
  { id: 'zhangxinxu', name: '张鑫旭', url: 'https://www.zhangxinxu.com/wordpress/feed/', desc: '前端与体验', category: 'design' },
  { id: 'alistapart', name: 'A List Apart', url: 'https://alistapart.com/main/feed/', desc: 'Web 设计与内容', category: 'design' },
  { id: 'creativebloq', name: 'Creative Bloq', url: 'https://www.creativebloq.com/feed', desc: '创意设计', category: 'design' },
  { id: 'cssauthor', name: 'CSS Author', url: 'https://cssauthor.com/feed/', desc: '设计资源', category: 'design' },
  { id: 'cssweekly', name: 'CSS Weekly', url: 'https://css-weekly.com/feed/', desc: 'CSS 周刊', category: 'design' },
  { id: 'dezeen', name: 'Dezeen', url: 'https://www.dezeen.com/feed/', desc: '建筑与设计', category: 'design' },
  { id: 'nn-group', name: 'NN/g', url: 'https://www.nngroup.com/feed/rss/', desc: '可用性研究', category: 'design' },
  { id: 'sidebar', name: 'Sidebar', url: 'https://sidebar.io/feed.xml', desc: '设计链接收藏', category: 'design' },
  { id: 'smashing', name: 'Smashing Magazine', url: 'https://www.smashingmagazine.com/feed/', desc: '设计与前端', category: 'design' },
  { id: 'uxdesign', name: 'UX Collective', url: 'https://uxdesign.cc/feed', desc: '用户体验', category: 'design' },

  // —— 财经 ——
  { id: 'cnbc', name: 'CNBC', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114', desc: '财经市场', category: 'finance' },
  { id: 'cointelegraph', name: 'Cointelegraph', url: 'https://cointelegraph.com/rss', desc: '加密货币资讯', category: 'finance' },
  { id: 'eeo', name: '经济观察报', url: 'https://www.eeo.com.cn/rss.xml', desc: '经济与商业', category: 'finance' },
  { id: 'inc', name: 'Inc.', url: 'https://www.inc.com/rss/', desc: '创业与管理', category: 'finance' },
  { id: 'jisilu', name: '集思录', url: 'https://www.jisilu.cn/feed', desc: '投资社区精选', category: 'finance' },
  { id: 'marketwatch', name: 'MarketWatch', url: 'https://feeds.marketwatch.com/marketwatch/topstories/', desc: '市场快讯', category: 'finance' },
  { id: 'seekingalpha', name: 'Seeking Alpha', url: 'https://seekingalpha.com/feed.xml', desc: '投资分析', category: 'finance' },
  { id: 'sequoia', name: 'Sequoia', url: 'https://www.sequoiacap.com/feed/', desc: '红杉观点', category: 'finance' },
  { id: 'wsj-world', name: 'WSJ World', url: 'https://feeds.a.dj.com/rss/RSSWorldNews.xml', desc: '华尔街日报国际', category: 'finance' },
  { id: 'xueqiu', name: '雪球热帖', url: 'https://xueqiu.com/hots/topic/rss', desc: '投资讨论热帖', category: 'finance' },

  // —— 生活 / 文化 ——
  { id: 'aeon', name: 'Aeon', url: 'https://aeon.co/feed.rss', desc: '思想与文化长文', category: 'life' },
  { id: 'boingboing', name: 'Boing Boing', url: 'https://boingboing.net/feed', desc: '文化与科技杂记', category: 'life' },
  { id: 'lifehacker', name: 'Lifehacker', url: 'https://lifehacker.com/feed/rss', desc: '生活技巧', category: 'life' },
  { id: 'lithub', name: 'Literary Hub', url: 'https://lithub.com/feed/', desc: '文学与书评', category: 'life' },
  { id: 'longreads', name: 'Longreads', url: 'https://longreads.com/feed/', desc: '长文精选', category: 'life' },
  { id: 'smithsonian', name: 'Smithsonian', url: 'https://www.smithsonianmag.com/rss/latest_articles/', desc: '博物与文化', category: 'life' },
  { id: 'brainpickings', name: 'The Marginalian', url: 'https://www.themarginalian.org/feed/', desc: '阅读与文化', category: 'life' }
]
