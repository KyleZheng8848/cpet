/**
 * CPET 内置「AI」RSS 任务精选源（HTTPS + 可解析；剔除失效 RSSHub / 停更 / 洪水源）。
 * 维护此列表后运行 `npx tsx scripts/patch-ai-rss.mts` 同步到本机 chat-store。
 */

export type AiRssFeed = {
  title: string
  url: string
}

/** 精选 AI 订阅：中英搭配、偏信号、控制 arXiv 等洪水源。 */
export const AI_RSS_CURATED_FEEDS: ReadonlyArray<AiRssFeed> = [
  // —— 中文 AI 媒体 ——
  { title: '36氪', url: 'https://36kr.com/feed' },
  { title: '量子位', url: 'https://www.qbitai.com/feed' },
  { title: '雷峰网', url: 'https://www.leiphone.com/feed' },

  // —— 官方 / 实验室 ——
  { title: 'OpenAI News', url: 'https://openai.com/news/rss.xml' },
  {
    title: 'Anthropic News',
    url: 'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_news.xml'
  },
  { title: 'Google DeepMind', url: 'https://deepmind.google/blog/rss.xml' },
  { title: 'Google AI Blog', url: 'https://blog.google/technology/ai/rss/' },
  { title: 'Apple ML', url: 'https://machinelearning.apple.com/rss.xml' },
  { title: 'NVIDIA Blog', url: 'https://blogs.nvidia.com/feed/' },
  { title: 'Ollama Blog', url: 'https://ollama.com/blog/rss.xml' },
  { title: 'PyTorch Blog', url: 'https://pytorch.org/blog/feed.xml' },

  // —— 高质量通讯 / 个人 ——
  { title: 'Simon Willison', url: 'https://simonwillison.net/atom/everything/' },
  { title: 'Import AI', url: 'https://jack-clark.net/feed/' },
  { title: 'Latent Space', url: 'https://www.latent.space/feed' },
  { title: 'Sebastian Raschka', url: 'https://sebastianraschka.com/rss_feed.xml' },
  { title: 'Ahead of AI', url: 'https://magazine.sebastianraschka.com/feed' },
  { title: 'Lilian Weng', url: 'https://lilianweng.github.io/index.xml' },
  { title: 'One Useful Thing', url: 'https://www.oneusefulthing.org/feed' },
  { title: 'Last Week in AI', url: 'https://lastweekin.ai/feed' },

  // —— 英文媒体 AI 栏目 ——
  { title: 'WIRED AI', url: 'https://www.wired.com/feed/tag/ai/latest/rss' },
  { title: 'TechCrunch AI', url: 'https://techcrunch.com/category/artificial-intelligence/feed/' },
  {
    title: 'MIT Tech Review AI',
    url: 'https://www.technologyreview.com/topic/artificial-intelligence/feed'
  },
  { title: 'The Verge AI', url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml' },
  { title: 'SemiAnalysis', url: 'https://www.semianalysis.com/feed' },
  { title: 'The Gradient', url: 'https://thegradient.pub/rss/' },

  // —— 社区信号 ——
  { title: 'HN · AI', url: 'https://hnrss.org/newest?q=AI' },
  { title: 'HN · LLM', url: 'https://hnrss.org/newest?q=LLM' },
  { title: 'Lobsters · AI', url: 'https://lobste.rs/t/ai.rss' }
]

export const AI_RSS_TASK_TITLE = 'AI'
export const AI_RSS_TASK_ID = 'cms9pk57c7h8'

export function aiRssCuratedUrls(): string[] {
  return AI_RSS_CURATED_FEEDS.map((f) => f.url)
}
