/**
 * 安全边界契约。
 * Agent 在「代理」权限下会真的写文件、跑命令，工作目录判错的代价是用户主目录被改。
 * 这份用例宁可多拦，也不能漏放。
 */
import { describe, it, expect } from 'vitest'
import { isSafeAgentCwd, isUserHomeDir, normalizePathish, UNSAFE_CWD_MESSAGE } from '../src/shared/cwd'
import { isRetriableAgentError } from '../src/shared/agentErrors'

describe('isSafeAgentCwd：不得落在用户主目录', () => {
  const home = '/Users/example'

  it.each([
    ['未选目录', undefined],
    ['空字符串', ''],
    ['只有空白', '   '],
    ['正好是主目录', '/Users/example'],
    ['主目录带结尾斜杠', '/Users/example/'],
    ['主目录大小写不同', '/Users/Example'],
    ['主目录多重斜杠结尾', '/Users/example//']
  ])('拒绝：%s', (_label, cwd) => {
    expect(isSafeAgentCwd(cwd, home)).toBe(false)
  })

  it.each([
    ['主目录下的项目', '/Users/example/Projects/cursor-pet'],
    ['其它盘位', '/Volumes/work/repo'],
    ['名字以主目录为前缀但是别的目录', '/Users/example2']
  ])('放行：%s', (_label, cwd) => {
    expect(isSafeAgentCwd(cwd, home)).toBe(true)
  })

  it('Windows 反斜杠与正斜杠视为同一路径', () => {
    expect(isSafeAgentCwd('C:\\Users\\example\\', 'C:/Users/example')).toBe(false)
    expect(isSafeAgentCwd('C:\\Users\\example\\repo', 'C:/Users/example')).toBe(true)
  })

  it('homeDir 缺失时不误判为「就是主目录」', () => {
    expect(isUserHomeDir('/Users/example', '')).toBe(false)
  })

  it('拦截文案说清了「为什么不行」而不只是「不行」', () => {
    expect(UNSAFE_CWD_MESSAGE).toContain('主目录')
    expect(UNSAFE_CWD_MESSAGE).toMatch(/写入|执行/)
  })
})

describe('normalizePathish', () => {
  it('只用于相等比较：去尾斜杠、统一分隔符、忽略大小写', () => {
    expect(normalizePathish('  /A/B/  ')).toBe('/a/b')
    expect(normalizePathish('C:\\A\\B')).toBe('c:/a/b')
  })
})

describe('isRetriableAgentError：只有真的能重试才提示重试', () => {
  it.each([
    'RetriableError: WritableIterable is closed',
    'WritableIterable is closed',
    'HTTP 429 Too Many Requests',
    'rate limit exceeded',
    'resource_exhausted',
    'ECONNRESET',
    'ETIMEDOUT',
    'socket hang up',
    '连接中断',
    '长时间无响应'
  ])('可重试：%s', (msg) => {
    expect(isRetriableAgentError(msg)).toBe(true)
  })

  it.each([
    ['空值', ''],
    ['null', null],
    ['undefined', undefined],
    ['只有空白', '  '],
    ['模型不存在（重试也没用）', 'unknown model foo-1'],
    ['鉴权失败（重试也没用）', 'Authentication required'],
    ['语法错误（重试也没用）', 'SyntaxError: Unexpected token']
  ])('不可重试：%s', (_label, msg) => {
    expect(isRetriableAgentError(msg)).toBe(false)
  })
})
