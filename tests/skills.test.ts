/**
 * 技能注入：历史 bug 是 SKILL.md 正文从来没被读出来过，
 * 用户以为选上了技能，实际只有一个字面 `/名字` 被发出去（Cursor 之外全部静默失效）。
 * 这份测试锁住「正文真的进了 systemPrompt」以及预算 / 分流 / 路径三条边界。
 */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  applyNativeSkillInvocation,
  applySkillsToPrompt,
  buildSkillCatalogBlock,
  buildSkillPromptBlock,
  engineExpandsSkills,
  formatSkillReportText,
  injectSkillBodies,
  injectSkillCatalog,
  parseLeadingSkillIds,
  resolveSkillDelivery,
  resolveSkillRelPaths,
  skillMarkerForEngine,
  skillUsableOnEngine,
  splitFrontmatter,
  stripSkillPrefix
} from '../src/shared/skills'
import { loadSkillBodies, readSkillBody } from '../src/main/skills'

describe('正文提取 / frontmatter 剥离', () => {
  it('剥掉 frontmatter，只留正文', () => {
    const raw = '---\nname: demo\ndescription: 演示\n---\n# 标题\n正文一行'
    const { frontmatter, body } = splitFrontmatter(raw)
    expect(frontmatter).toContain('name: demo')
    expect(body).toBe('# 标题\n正文一行')
  })

  it('没有 frontmatter 时整篇都是正文', () => {
    const { frontmatter, body } = splitFrontmatter('# 直接开写\n第二行')
    expect(frontmatter).toBe('')
    expect(body).toBe('# 直接开写\n第二行')
  })

  it('frontmatter 没闭合时不吞正文', () => {
    const raw = '---\nname: broken\n# 忘了闭合'
    expect(splitFrontmatter(raw).body).toBe(raw)
  })

  it('正文里的 --- 分隔线不会被当成 frontmatter 结束后再切一刀', () => {
    const raw = '---\nname: demo\n---\n前言\n\n---\n\n后记'
    expect(splitFrontmatter(raw).body).toBe('前言\n\n---\n\n后记')
  })

  it('容忍 BOM 开头', () => {
    expect(splitFrontmatter('\uFEFF---\nname: a\n---\n正文').body).toBe('正文')
  })
})

describe('相对路径解析', () => {
  const dir = '/tmp/skills/demo'

  it('把子文件相对路径展开成绝对路径', () => {
    const out = resolveSkillRelPaths('先读 references/harsh-bar.md 再动手', dir, () => true)
    expect(out).toBe('先读 /tmp/skills/demo/references/harsh-bar.md 再动手')
  })

  it('去掉 ./ 前缀后一样能展开', () => {
    expect(resolveSkillRelPaths('见 ./catalogs/A.json', dir, () => true)).toBe(
      '见 /tmp/skills/demo/catalogs/A.json'
    )
  })

  it('文件不存在就原样保留（宁可不改也别造出假路径）', () => {
    const text = '见 references/nope.md'
    expect(resolveSkillRelPaths(text, dir, () => false)).toBe(text)
  })

  it('不动 URL 和已经是绝对路径的写法', () => {
    const text = '见 https://example.com/docs/a.md 与 /etc/hosts/x.md 与 ~/.cursor/skills/b.md'
    expect(resolveSkillRelPaths(text, dir, () => true)).toBe(text)
  })

  it('不动没有目录层级的裸文件名', () => {
    expect(resolveSkillRelPaths('见 SKILL.md', dir, () => true)).toBe('见 SKILL.md')
  })
})

describe('按引擎分流', () => {
  it('只有 Cursor 走服务端展开', () => {
    expect(engineExpandsSkills('cursor')).toBe(true)
    for (const e of ['opencode', 'codex', 'claude-code', 'openclaw', undefined]) {
      expect(engineExpandsSkills(e)).toBe(false)
    }
  })

  it('Cursor 下没有正文的技能也可选（服务端认这个斜杠命令）', () => {
    expect(skillUsableOnEngine({ hasBody: false }, 'cursor')).toBe(true)
  })

  it('其它引擎下没有正文就是空操作，不可选', () => {
    expect(skillUsableOnEngine({ hasBody: false }, 'opencode')).toBe(false)
    expect(skillUsableOnEngine({}, 'openclaw')).toBe(false)
    expect(skillUsableOnEngine({ hasBody: true }, 'opencode')).toBe(true)
  })

  it('auto 默认：CLI 原版点名，直连 inject，直连 API inject', () => {
    expect(resolveSkillDelivery('claude-code', 'auto')).toBe('native')
    expect(resolveSkillDelivery('codex', 'auto')).toBe('native')
    expect(resolveSkillDelivery('openclaw', 'auto')).toBe('native')
    expect(resolveSkillDelivery('custom-api', 'auto')).toBe('inject')
  })

  it('对没有 Skill 运行时的引擎，强制 native 会降为 catalog', () => {
    expect(resolveSkillDelivery('custom-api', 'native')).toBe('catalog')
  })

  it('Codex 用 $ 标记，其余用 /', () => {
    expect(skillMarkerForEngine('codex')).toBe('$')
    expect(skillMarkerForEngine('claude-code')).toBe('/')
  })
})

describe('字面 /技能名 前缀', () => {
  it('渲染进程拼的前缀行整行去掉', () => {
    expect(stripSkillPrefix('/demo\n帮我看看', ['demo'])).toBe('帮我看看')
    expect(stripSkillPrefix('/a /b\n正文', ['a', 'b'])).toBe('正文')
  })

  it('首行混了正文就不动（别削掉用户的话）', () => {
    expect(stripSkillPrefix('/demo 顺手看下\n第二行', ['demo'])).toBe('/demo 顺手看下\n第二行')
  })

  it('不去掉没选中的斜杠词', () => {
    expect(stripSkillPrefix('/other\n正文', ['demo'])).toBe('/other\n正文')
  })

  it('没选技能时原样返回', () => {
    expect(stripSkillPrefix('/demo\n正文', [])).toBe('/demo\n正文')
  })

  it('同样能剥掉 Codex 的 $技能名 前缀', () => {
    expect(stripSkillPrefix('$demo\n帮我看看', ['demo'])).toBe('帮我看看')
  })

  it('native 模式会把 / 改写成 Codex 的 $', () => {
    const out = applyNativeSkillInvocation('/demo\n跑', undefined, ['demo'], '$')
    expect(out.prompt).toBe('$demo\n跑')
    expect(out.systemPrompt).toBeUndefined()
    expect(out.mode).toBe('native')
  })

  it('catalog 模式只注入目录不注入正文', () => {
    const out = injectSkillCatalog(
      '/demo\n跑',
      undefined,
      ['demo'],
      [{ id: 'demo', description: '演示', path: '/s/demo/SKILL.md' }],
      [],
      '/'
    )
    expect(out.systemPrompt).toContain('技能目录')
    expect(out.systemPrompt).toContain('/demo')
    expect(out.systemPrompt).toContain('/s/demo/SKILL.md')
    expect(out.systemPrompt).not.toContain('第一步')
    expect(out.prompt).toBe('/demo\n跑')
    expect(out.mode).toBe('catalog')
  })

  it('buildSkillCatalogBlock 列出缺失项', () => {
    const { block, injected } = buildSkillCatalogBlock([], ['ghost'], '/')
    expect(injected).toEqual([])
    expect(block).toContain('/ghost')
  })
})

/**
 * 定时任务没有技能选单，只能从自由文本的 prompt 开头认斜杠词。
 * 这里的重点全在误判防护：认错一个词，用户的定时任务就会被塞进一整篇不相关的 SKILL.md。
 */
describe('从 prompt 开头解析技能', () => {
  const known = ['demo', 'daily-report', 'tmp', 'Users']

  it('认出单个技能', () => {
    expect(parseLeadingSkillIds('/demo 帮我跑一遍', known)).toEqual(['demo'])
  })

  it('连写多个技能都认出来，且去重保序', () => {
    expect(parseLeadingSkillIds('/demo /daily-report 干活', known)).toEqual(['demo', 'daily-report'])
    expect(parseLeadingSkillIds('/demo /demo 干活', known)).toEqual(['demo'])
  })

  it('技能名后紧跟标点或换行也算', () => {
    expect(parseLeadingSkillIds('/demo，帮我看看', known)).toEqual(['demo'])
    expect(parseLeadingSkillIds('/demo\n帮我看看', known)).toEqual(['demo'])
    expect(parseLeadingSkillIds('/demo', known)).toEqual(['demo'])
  })

  it('绝对路径开头不算技能（即使某个技能刚好叫 Users / tmp）', () => {
    expect(parseLeadingSkillIds('/Users/example/x 看看这个文件', known)).toEqual([])
    expect(parseLeadingSkillIds('/tmp/out.log 里有报错', known)).toEqual([])
  })

  it('未知斜杠词不被吃掉，也不继续往后认', () => {
    expect(parseLeadingSkillIds('/unknown 干活', known)).toEqual([])
    expect(parseLeadingSkillIds('/unknown /demo 干活', known)).toEqual([])
  })

  it('正则、裸斜杠、普通句子都不算技能', () => {
    expect(parseLeadingSkillIds('/^abc$/ 这个正则匹配什么', known)).toEqual([])
    expect(parseLeadingSkillIds('/demo/ 这是个正则', known)).toEqual([])
    expect(parseLeadingSkillIds('/ 帮我干活', known)).toEqual([])
    expect(parseLeadingSkillIds('帮我跑 /demo', known)).toEqual([])
  })

  it('空 prompt 与空技能表都返回空数组', () => {
    expect(parseLeadingSkillIds('', known)).toEqual([])
    expect(parseLeadingSkillIds('   ', known)).toEqual([])
    expect(parseLeadingSkillIds(undefined, known)).toEqual([])
    expect(parseLeadingSkillIds('/demo 干活', [])).toEqual([])
  })
})

describe('token 预算与截断', () => {
  const long = 'x'.repeat(500)

  it('超出单技能预算时截断并明说，且给出原文路径', () => {
    const { block, truncated } = buildSkillPromptBlock(
      [{ id: 'big', body: long, path: '/s/big/SKILL.md' }],
      [],
      10_000,
      100
    )
    expect(truncated).toEqual(['big'])
    expect(block).toContain('[已截断')
    expect(block).toContain('/s/big/SKILL.md')
    expect(block.length).toBeLessThan(long.length)
  })

  it('总预算用完后剩下的技能整个不注入，但会记在 truncated 里', () => {
    const { injected, truncated } = buildSkillPromptBlock(
      [
        { id: 'a', body: long },
        { id: 'b', body: long }
      ],
      [],
      120,
      120
    )
    expect(injected).toEqual(['a'])
    expect(truncated).toContain('b')
  })

  it('没超预算就一字不改', () => {
    const { block, truncated } = buildSkillPromptBlock([{ id: 'a', body: '短正文' }])
    expect(truncated).toEqual([])
    expect(block).toContain('短正文')
    expect(block).not.toContain('已截断')
  })

  it('读不出正文的技能会写进块里，不做静默丢弃', () => {
    const { block } = buildSkillPromptBlock([], ['ghost'])
    expect(block).toContain('/ghost')
    expect(block).toContain('找不到 SKILL.md')
  })
})

describe('内联进 systemPrompt', () => {
  const loaded = {
    bodies: [{ id: 'demo', body: '第一步：做 A。第二步：做 B。', path: '/s/demo/SKILL.md' }],
    missing: []
  }

  it('正文进 systemPrompt，用户消息只剩真正的问题', () => {
    const out = injectSkillBodies('/demo\n帮我跑一遍', '你是助手', ['demo'], loaded)
    expect(out.systemPrompt).toContain('你是助手')
    expect(out.systemPrompt).toContain('第一步：做 A')
    expect(out.prompt).toBe('帮我跑一遍')
    expect(out.injected).toEqual(['demo'])
  })

  it('原本没有 systemPrompt 时技能块自己成为 systemPrompt', () => {
    const out = injectSkillBodies('/demo\n跑', undefined, ['demo'], loaded)
    expect(out.systemPrompt?.startsWith('【已启用技能】')).toBe(true)
  })

  it('只选了技能没写正文时给一句兜底指令，不发空消息', () => {
    const out = injectSkillBodies('/demo', undefined, ['demo'], loaded)
    expect(out.prompt).toBe('按所选技能执行。')
  })

  it('没选技能时 prompt / systemPrompt 都不动', () => {
    const out = injectSkillBodies('普通问题', '你是助手', [], { bodies: [], missing: [] })
    expect(out.prompt).toBe('普通问题')
    expect(out.systemPrompt).toBe('你是助手')
  })

  it('一个正文都没读到时也要明说，而不是发一个模型不认识的字面前缀', () => {
    const out = injectSkillBodies('/ghost\n跑', undefined, ['ghost'], {
      bodies: [],
      missing: ['ghost']
    })
    expect(out.prompt).toBe('跑')
    expect(out.systemPrompt).toContain('/ghost')
    expect(out.missing).toEqual(['ghost'])
  })

  it('Cursor 那条路（applySkillsToPrompt）行为不变：只加前缀，不带正文', () => {
    const out = applySkillsToPrompt('帮我跑一遍', ['demo'])
    expect(out).toBe('/demo\n帮我跑一遍')
    expect(out).not.toContain('第一步')
  })

  it('formatSkillReportText：inline 写明已注入，missing 警告未加载', () => {
    const text = formatSkillReportText({
      mode: 'inline',
      injected: ['cpet-cute-skins'],
      missing: ['ghost'],
      truncated: []
    })
    expect(text).toContain('正文已注入')
    expect(text).toContain('/cpet-cute-skins')
    expect(text).toContain('技能未加载')
    expect(text).toContain('/ghost')
  })

  it('formatSkillReportText：cursor-slash 说明服务端展开', () => {
    const text = formatSkillReportText({
      mode: 'cursor-slash',
      injected: ['shell'],
      missing: [],
      truncated: []
    })
    expect(text).toContain('Cursor')
    expect(text).toContain('/shell')
  })

  it('formatSkillReportText：native / catalog 文案可区分', () => {
    expect(
      formatSkillReportText({
        mode: 'native',
        injected: ['demo'],
        missing: [],
        truncated: []
      })
    ).toContain('原版点名')
    expect(
      formatSkillReportText({
        mode: 'catalog',
        injected: ['demo'],
        missing: [],
        truncated: []
      })
    ).toContain('薄目录')
  })
})

describe('从磁盘读正文', () => {
  // 临时目录放在仓库内：CI / 沙箱只保证工作区可写
  function makeSkillDir(): { root: string; file: string } {
    const root = mkdtempSync(join(process.cwd(), 'tests', '.tmp-skill-'))
    const dir = join(root, '.claude', 'skills', 'cpet-test-skill')
    mkdirSync(join(dir, 'references'), { recursive: true })
    writeFileSync(join(dir, 'references', 'bar.md'), '子文件')
    const file = join(dir, 'SKILL.md')
    writeFileSync(
      file,
      '---\nname: cpet-test-skill\ndescription: 测试用\n---\n第一步：先读 references/bar.md。'
    )
    return { root, file }
  }

  it('读出正文并把子文件相对路径展开成绝对路径', () => {
    const { root, file } = makeSkillDir()
    try {
      const body = readSkillBody(file)
      expect(body).toContain('第一步')
      expect(body).not.toContain('name: cpet-test-skill')
      expect(body).toContain(
        join(root, '.claude', 'skills', 'cpet-test-skill', 'references', 'bar.md')
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('文件改了缓存要失效', () => {
    const { root, file } = makeSkillDir()
    try {
      expect(readSkillBody(file)).toContain('第一步')
      writeFileSync(file, '---\nname: cpet-test-skill\n---\n换成了完全不同的一段正文内容。')
      expect(readSkillBody(file)).toContain('换成了完全不同的一段正文内容')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('文件不存在时返回空串而不是抛错', () => {
    expect(readSkillBody(join(process.cwd(), 'tests', '.no-such-skill', 'SKILL.md'))).toBe('')
  })

  it('按工作目录取正文；查无此技能进 missing', () => {
    const { root } = makeSkillDir()
    try {
      const out = loadSkillBodies(['cpet-test-skill', 'cpet-no-such-skill'], root)
      expect(out.bodies.map((b) => b.id)).toEqual(['cpet-test-skill'])
      expect(out.bodies[0].body).toContain('第一步')
      expect(out.missing).toEqual(['cpet-no-such-skill'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
