/**
 * CLI 输出清洗契约。
 * 这层过滤既要滤掉终端装饰，又绝不能吃掉模型正文——过滤太狠比不过滤更难查。
 */
import { describe, it, expect } from 'vitest'
import {
  stripAnsi,
  isCliNoiseLine,
  cleanCliLine,
  stripContentChrome,
  humanizeAgentError,
  buildQuietCliEnv
} from '../src/main/cliSanitize'

describe('stripAnsi', () => {
  it('去掉颜色序列', () => {
    expect(stripAnsi('\u001b[32mhello\u001b[0m')).toBe('hello')
  })

  it('去掉光标显隐等私有参数序列', () => {
    expect(stripAnsi('\u001b[?25hloading')).toBe('loading')
  })

  it('去掉 OSC 标题序列', () => {
    expect(stripAnsi('\u001b]0;title\u0007body')).toBe('body')
  })

  it('去掉回车（防止 \\r 覆盖行造成重复）', () => {
    expect(stripAnsi('abc\rdef')).toBe('abcdef')
  })

  it('干净文本原样返回', () => {
    expect(stripAnsi('普通正文')).toBe('普通正文')
  })
})

describe('isCliNoiseLine', () => {
  it('空行是噪音', () => {
    expect(isCliNoiseLine('   ')).toBe(true)
  })

  it('纯品牌 emoji 行是噪音', () => {
    expect(isCliNoiseLine('🐼')).toBe(true)
    expect(isCliNoiseLine('🐾🐾')).toBe(true)
  })


  it('登录态提示是噪音', () => {
    expect(isCliNoiseLine('登录态失效，请重新登录')).toBe(true)
  })

  it('控制序列残留是噪音', () => {
    expect(isCliNoiseLine('[?25l')).toBe(true)
  })

  // 回归：emoji 字符类缺少 u 标志时会被拆成代理对的两半，
  // 于是任何「高位半 + 低位半」都落在集合里的 emoji 都会被误杀。
  // 🔖(U+1F516) 的两半正好是 🐼 的高位半 + 🤖 的低位半。
  it('不得误杀共用代理对半个字符的其它 emoji（🔖 是正文，不是品牌装饰）', () => {
    expect(isCliNoiseLine('🔖')).toBe(false)
    expect(cleanCliLine('🔖')).toBe('🔖')
  })

  it('正常正文不是噪音', () => {
    expect(isCliNoiseLine('好的，我来改这个函数')).toBe(false)
    expect(isCliNoiseLine('🐼 已完成')).toBe(false)
  })
})

describe('stripContentChrome', () => {
  it('滤掉装饰行但保留正文与段落结构', () => {
    const raw = ['🐼', '\u001b[32m第一行\u001b[0m', '', '第二行', '🐾'].join('\n')
    expect(stripContentChrome(raw)).toBe('第一行\n\n第二行')
  })

  // 回归：空行曾被当成噪音行一起删掉，导致整段 Markdown 被糊成一坨
  it('保留 Markdown 分段空行（段落、列表前的空行不能丢）', () => {
    const raw = '这是段落。\n\n- 第一项\n- 第二项\n\n结尾。'
    expect(stripContentChrome(raw)).toBe(raw)
  })

  it('保留代码块内部空行（否则等于改了模型给的代码）', () => {
    const raw = ['```py', 'def a():', '    pass', '', 'def b():', '    pass', '```'].join('\n')
    expect(stripContentChrome(raw)).toBe(raw)
  })

  it('去掉正文开头夹带的品牌 emoji', () => {
    expect(stripContentChrome('🐼 这是回答')).toBe('这是回答')
  })

  it('只含 🔖 的回复不会被清成空字符串', () => {
    expect(stripContentChrome('🔖')).toBe('🔖')
  })
})

describe('humanizeAgentError', () => {
  it('空错误有兜底文案，不出现空白提示', () => {
    expect(humanizeAgentError('')).toBe('Agent 出错了')
  })

  it('Cursor 流中断给出可操作建议', () => {
    const msg = humanizeAgentError('RetriableError: WritableIterable is closed')
    expect(msg).toContain('再试一次')
  })

  it('限流类错误被归一', () => {
    expect(humanizeAgentError('HTTP 429 rate limit exceeded')).toContain('限流')
  })

  it('模型不存在时指向设置页而不是丢原始英文', () => {
    expect(humanizeAgentError('unknown model foo-1')).toContain('设置')
  })

  it('超长 stderr 被截断，不刷满整屏', () => {
    const out = humanizeAgentError('E'.repeat(2000))
    expect(out.length).toBeLessThanOrEqual(601)
    expect(out.endsWith('…')).toBe(true)
  })

  it('未识别的短错误保留原文（不要把有用信息吃掉）', () => {
    expect(humanizeAgentError('some odd failure')).toBe('some odd failure')
  })

  it('Cursor 登录失效不得写成去跑 claude', () => {
    const msg = humanizeAgentError('Authentication required. 请先登录', 'cursor')
    expect(msg).toContain('cursor-agent login')
    expect(msg).not.toMatch(/claude/i)
  })

})

describe('buildQuietCliEnv', () => {
  it('剥掉 Electron 泄漏变量，避免子进程当成 Electron 跑', () => {
    const env = buildQuietCliEnv({
      PATH: '/usr/bin',
      ELECTRON_RUN_AS_NODE: '1',
      ATOM_SHELL_INTERNAL_RUN_AS_NODE: '1'
    })
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(env.ATOM_SHELL_INTERNAL_RUN_AS_NODE).toBeUndefined()
    expect(env.PATH).toBe('/usr/bin')
  })

  it('强制关闭彩色与交互 TUI', () => {
    const env = buildQuietCliEnv({})
    expect(env.NO_COLOR).toBe('1')
    expect(env.FORCE_COLOR).toBe('0')
    expect(env.TERM).toBe('dumb')
  })

  it('不修改传入的 env 对象', () => {
    const base = { ELECTRON_RUN_AS_NODE: '1' }
    buildQuietCliEnv(base)
    expect(base.ELECTRON_RUN_AS_NODE).toBe('1')
  })
})
