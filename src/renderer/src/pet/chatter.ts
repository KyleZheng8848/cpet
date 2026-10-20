import type { BubbleAction } from '@shared/types'
import { chatterFromAgentMemoryHints } from '@shared/agentMemory'
import { chatterFromWorkMemory, type WorkMemory } from '@shared/workMemory'

/** 一条可点击的碎碎念。 */
export interface ChatterItem {
  text: string
  /** 气泡底部提示，如「点击查看」。 */
  hint?: string
  action?: BubbleAction
}

function modKey(): string {
  try {
    return navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl'
  } catch {
    return 'Ctrl'
  }
}

function dayPart(): 'dawn' | 'morning' | 'noon' | 'afternoon' | 'evening' | 'night' {
  const h = new Date().getHours()
  if (h < 5) return 'night'
  if (h < 9) return 'dawn'
  if (h < 12) return 'morning'
  if (h < 14) return 'noon'
  if (h < 18) return 'afternoon'
  if (h < 22) return 'evening'
  return 'night'
}

const TIME_GREET: Record<ReturnType<typeof dayPart>, ChatterItem[]> = {
  dawn: [
    {
      text: '清晨好～咖啡还是代码先来一发？☕',
      hint: '点击打开对话',
      action: { kind: 'chat' }
    },
    {
      text: '这么早？佩服，我再眯五分钟……',
      hint: '点击打开对话',
      action: { kind: 'chat' }
    }
  ],
  morning: [
    {
      text: '上午好！今日待办列好了吗？',
      hint: '点击打开对话',
      action: { kind: 'chat' }
    },
    {
      text: '上午黄金时段，适合啃硬骨头。',
      hint: '点击打开对话',
      action: { kind: 'chat' }
    }
  ],
  noon: [
    {
      text: '中午了，记得吃饭，别用咖啡续命～',
      hint: '点击打开对话',
      action: { kind: 'chat' }
    },
    {
      text: '午间小憩一下，下午更猛。',
      hint: '点击打开对话',
      action: { kind: 'chat' }
    }
  ],
  afternoon: [
    {
      text: '下午好，困了就站起来走两圈。',
      hint: '点击打开对话',
      action: { kind: 'chat' }
    },
    {
      text: '下午茶时间到？或者……再修一个 bug。',
      hint: '点击打开对话',
      action: { kind: 'chat' }
    }
  ],
  evening: [
    {
      text: '晚上好，今天推进了啥值得骄傲的？',
      hint: '点击打开对话',
      action: { kind: 'chat' }
    },
    {
      text: '夜色渐浓，记得留点时间给自己。',
      hint: '点击打开对话',
      action: { kind: 'chat' }
    }
  ],
  night: [
    {
      text: '夜深了，身体比 deadline 重要哦。',
      hint: '点击打开对话',
      action: { kind: 'chat' }
    },
    {
      text: '还在熬？我陪着，但劝你早点睡 🌙',
      hint: '点击打开对话',
      action: { kind: 'chat' }
    }
  ]
}

function tipsPool(): ChatterItem[] {
  const mod = modKey()
  return [
    {
      text: `小提示：${mod}+K 能快速唤起编辑器改代码～`,
      hint: '点击打开 Cursor',
      action: { kind: 'app', name: 'Cursor' }
    },
    {
      text: '记得 git commit，别让努力白费 💾',
      hint: '点击打开对话',
      action: { kind: 'chat' }
    },
    {
      text: '写不出来就先写注释，思路会顺很多。',
      hint: '点击跟我聊聊',
      action: { kind: 'chat' }
    },
    {
      text: '变量名多花 5 秒，未来省 5 小时。',
      hint: '点击打开对话',
      action: { kind: 'chat' }
    },
    {
      text: '卡住了？把问题讲给我听听，说着说着就通了。',
      hint: '点击打开对话',
      action: { kind: 'chat' }
    },
    {
      text: '别忘了喝水，人和 CPU 都怕过热 🥤',
      hint: '点击打开对话',
      action: { kind: 'chat' }
    }
  ]
}

const JOKES: ChatterItem[] = [
  {
    text: '为什么程序员分不清万圣节和圣诞节？因为 Oct 31 == Dec 25 🎃',
    hint: '点击打开对话',
    action: { kind: 'chat' }
  },
  {
    text: '世界上有 10 种人：懂二进制的和不懂的。',
    hint: '点击打开对话',
    action: { kind: 'chat' }
  },
  {
    text: '我没有 bug，只有未被文档化的特性。',
    hint: '点击打开对话',
    action: { kind: 'chat' }
  },
  {
    text: '“它在我这能跑啊”——每个程序员的遗言。',
    hint: '点击打开对话',
    action: { kind: 'chat' }
  },
  {
    text: '删库跑路是门手艺，我劝你别学 🏃',
    hint: '点击打开对话',
    action: { kind: 'chat' }
  }
]

const WORKER: ChatterItem[] = [
  {
    text: '打工人打工魂，打工都是人上人（叹气）。',
    hint: '点击打开对话',
    action: { kind: 'chat' }
  },
  {
    text: '又是元气满满搬砖的一天呢……才怪。',
    hint: '点击打开对话',
    action: { kind: 'chat' }
  },
  {
    text: '老板画的饼，我先帮你 debug 一下。',
    hint: '点击打开对话',
    action: { kind: 'chat' }
  },
  {
    text: '这活干完，能不能加个鸡腿？🍗',
    hint: '点击打开对话',
    action: { kind: 'chat' }
  },
  {
    text: '摸鱼一时爽，一直摸鱼一直爽——但别被我说漏嘴。',
    hint: '点击看看定时任务',
    action: { kind: 'schedules' }
  }
]

const FACTS: ChatterItem[] = [
  {
    text: '冷知识：第一个 bug 是 1947 年一只真的飞蛾 🦋',
    hint: '点击打开对话',
    action: { kind: 'chat' }
  },
  {
    text: '冷知识：章鱼有三颗心脏，比你的 CI 还多。',
    hint: '点击打开对话',
    action: { kind: 'chat' }
  },
  {
    text: '冷知识：蜂蜜放几千年都不会坏，和你的祖传代码一样。',
    hint: '点击打开对话',
    action: { kind: 'chat' }
  },
  {
    text: '冷知识：QWERTY 键盘是为了让打字变慢设计的。',
    hint: '点击打开对话',
    action: { kind: 'chat' }
  }
]

const IDLE_TALK: ChatterItem[] = [
  {
    text: '在忙吗？我在这儿陪你 🐾',
    hint: '点击打开对话',
    action: { kind: 'chat' }
  },
  {
    text: '要不要摸摸我的头？双击就行～',
    hint: '点击打开对话',
    action: { kind: 'chat' }
  },
  {
    text: '发会儿呆也挺好的。',
    hint: '点击打开对话',
    action: { kind: 'chat' }
  },
  {
    text: '有任务尽管点我，随叫随到！',
    hint: '点击打开对话',
    action: { kind: 'chat' }
  },
  {
    text: '想看各引擎最近在干嘛？点我～',
    hint: '点击打开联动活动',
    action: { kind: 'monitor' }
  }
]

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

/** 随机一条本地台词（带可点击动作）；约 1/3 按时段问候；可混入本地工作记忆 / 联想句。 */
export function randomLocalChatter(
  memory?: WorkMemory | null,
  agentHints?: string[] | null
): ChatterItem {
  const memLines = [
    ...(memory ? chatterFromWorkMemory(memory) : []),
    ...chatterFromAgentMemoryHints(agentHints || undefined)
  ]
  // 有记忆时提高命中率，让用户感到「记得上次」
  if (memLines.length && Math.random() < 0.45) {
    const m = pick(memLines)
    return { text: m.text, hint: m.hint, action: m.action as ChatterItem['action'] }
  }
  if (Math.random() < 0.34) {
    return pick(TIME_GREET[dayPart()])
  }
  const pools = [tipsPool(), JOKES, WORKER, FACTS, IDLE_TALK]
  return pick(pick(pools))
}
