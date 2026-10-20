import { describe, expect, it } from 'vitest'
import {
  describeAgentError,
  formatAgentErrorNotice,
  stripAgentErrorNotice
} from '../src/renderer/src/agentErrorInfo'
import { UNSAFE_CWD_MESSAGE } from '../src/shared/cwd'

describe('describeAgentError：四种最常见的失败都要能自救', () => {
  it('引擎没装：指向安装助手，不吐 ENOENT', () => {
    const info = describeAgentError('启动 cursor-agent 失败：spawn cursor-agent ENOENT')
    expect(info.fix).toBe('engine-setup')
    expect(info.summary).not.toMatch(/ENOENT/)
    expect(info.steps.length).toBeGreaterThan(0)
    // 原始信息仍要留一份，便于排查
    expect(info.detail).toMatch(/ENOENT/)
  })

  it('没登录：给出终端登录 + 刷新的顺序，不建议盲目重试', () => {
    const info = describeAgentError('Codex 需要先登录。', 'codex')
    expect(info.fix).toBe('engine-setup')
    expect(info.retriable).toBe(false)
    expect(info.steps.join(' ')).toMatch(/登录/)
    expect(info.steps.join(' ')).toMatch(/codex login/i)
  })

  it('Cursor 登录失败的下一步只提 cursor-agent，不提 claude', () => {
    const info = describeAgentError('引擎登录已失效。请执行 `cursor-agent login` 完成鉴权后，回 CPET 刷新再试。')
    expect(info.steps.join(' ')).toContain('cursor-agent login')
    expect(info.steps.join(' ')).not.toMatch(/claude/i)
  })

  it('顶栏是 Cursor 时，即使原文误写了 claude，下一步也只提 cursor-agent', () => {
    const info = describeAgentError(
      '引擎登录已失效。请在系统终端执行 `claude`（或对应 CLI login）完成鉴权后，回 CPET 刷新再试。',
      'cursor'
    )
    expect(info.summary).toMatch(/登录/)
    expect(info.steps.join(' ')).toContain('cursor-agent login')
    expect(info.steps.join(' ')).not.toMatch(/claude/i)
  })

  it('API Key 错：从 JSON 里抽出人能读的那句，并指向自定义 API 配置', () => {
    const info = describeAgentError(
      'API 401: {"error":{"message":"Incorrect API key provided: sk-abc","type":"invalid_request_error"}}'
    )
    expect(info.fix).toBe('api-config')
    expect(info.detail).toBe('HTTP 401 · Incorrect API key provided: sk-abc')
    expect(info.detail).not.toMatch(/[{}]/)
  })

  it('网络断了：可重试，且不误导成去配置 API', () => {
    const info = describeAgentError('TypeError: fetch failed')
    expect(info.retriable).toBe(true)
    expect(info.fix).toBe('none')
    expect(info.summary).toMatch(/网络/)
  })
})

describe('describeAgentError：修复入口不能指错地方', () => {
  it('限流可重试，但不该让用户去改配置', () => {
    const info = describeAgentError('API 429: {"error":{"message":"rate limit exceeded"}}')
    expect(info.retriable).toBe(true)
    expect(info.fix).toBe('none')
  })

  it('服务端 5xx 归到可重试，而不是 API Key 错', () => {
    const info = describeAgentError('API 503: upstream unavailable')
    expect(info.fix).toBe('none')
    expect(info.retriable).toBe(true)
    expect(info.summary).toMatch(/503/)
  })

  it('Gateway 未连通要挡在「网络不通」之前，否则用户会去查代理', () => {
    const info = describeAgentError('OpenClaw Gateway 未连通，无法发送。ECONNREFUSED')
    expect(info.fix).toBe('engine-setup')
    expect(info.summary).toMatch(/Gateway/)
  })

  it('模型无效指向模型配置', () => {
    const info = describeAgentError('unknown model: gpt-9')
    expect(info.fix).toBe('model-config')
  })

  it('工作目录未选指向目录选择，不可重试', () => {
    expect(describeAgentError('未设置工作目录，已取消（请选择项目目录后再发）。').fix).toBe('pick-dir')
    expect(describeAgentError(UNSAFE_CWD_MESSAGE).fix).toBe('pick-dir')
    expect(describeAgentError(UNSAFE_CWD_MESSAGE).retriable).toBe(false)
  })

  it('空消息也要给出可操作的下一步', () => {
    const info = describeAgentError('')
    expect(info.steps.length).toBeGreaterThan(0)
    expect(info.detail).toBe('')
  })

  it('未识别的错误保留原文供排查，且长堆栈会截断', () => {
    const raw = 'Weird failure ' + 'x'.repeat(500)
    const info = describeAgentError(raw)
    expect(info.detail.length).toBeLessThan(240)
    expect(info.detail).toMatch(/^Weird failure/)
  })
})

describe('stripAgentErrorNotice：CPET 自己的报错不能混进模型上下文', () => {
  it('剔除提示段，保留模型正文', () => {
    const info = describeAgentError('API 429: rate limit')
    const body = '这是模型已经写出的一半回答。' + formatAgentErrorNotice(info)
    expect(stripAgentErrorNotice(body)).toBe('这是模型已经写出的一半回答。')
  })

  it('模型自己写的普通引用块不能被误删', () => {
    const text = '参考：\n\n> 引用一段文档\n> 第二行\n\n结论如上。'
    expect(stripAgentErrorNotice(text)).toBe(text)
  })

  it('只有提示段时返回空串，避免留下空气泡文本', () => {
    const notice = formatAgentErrorNotice(describeAgentError('fetch failed'))
    expect(stripAgentErrorNotice(notice)).toBe('')
  })
})
