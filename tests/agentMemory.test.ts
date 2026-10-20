import { describe, expect, it } from 'vitest'
import {
  EMPTY_AGENT_MEMORY_GRAPH,
  agentMemoryStatusReason,
  buildExtractSystemPrompt,
  formatAgentMemoryStatusLine,
  formatPreferenceBrief,
  formatRecallBlock,
  preferenceKeywordList,
  formatRecentFactLines,
  looksLikeRecallAsk,
  mergeChatterHints,
  mergeSystemWithAgentMemory,
  normalizeAgentMemorySettings,
  parseTriplesFromModelText,
  seedTermsFromText,
  upsertTriples
} from '../src/shared/agentMemory'

describe('agentMemory', () => {
  it('defaults disabled', () => {
    expect(normalizeAgentMemorySettings(undefined).enabled).toBe(false)
    expect(normalizeAgentMemorySettings({ enabled: true }).enabled).toBe(true)
  })

  it('parses triples from fenced JSON', () => {
    const text = '```json\n[{"s":"我","p":"用过","o":"EdgeTTS","kindO":"tech"}]\n```'
    const triples = parseTriplesFromModelText(text)
    expect(triples).toEqual([
      {
        subject: '我',
        predicate: '用过',
        object: 'EdgeTTS',
        subjectKind: undefined,
        objectKind: 'tech',
        note: undefined
      }
    ])
  })

  it('upsert invalidates old object for same subject+predicate', () => {
    let g = EMPTY_AGENT_MEMORY_GRAPH
    const a = upsertTriples(g, [{ subject: '我', predicate: '用过', object: 'CosyVoice' }])
    g = a.graph
    const b = upsertTriples(g, [{ subject: '我', predicate: '用过', object: 'EdgeTTS' }])
    const live = b.graph.edges.filter((e) => !e.invalid)
    expect(live).toHaveLength(1)
    expect(live[0]!.objectId).toContain('edgetts')
    expect(b.graph.edges.some((e) => e.invalid)).toBe(true)
  })

  it('formatRecallBlock returns 1-hop lines for seeds', () => {
    const { graph } = upsertTriples(EMPTY_AGENT_MEMORY_GRAPH, [
      { subject: '项目', predicate: '用过', object: 'EdgeTTS' },
      { subject: '项目', predicate: '相关', object: 'TTS' }
    ])
    const block = formatRecallBlock(graph, seedTermsFromText('EdgeTTS 慢吗'))
    expect(block).toContain('【联想记忆】')
    expect(block).toMatch(/EdgeTTS|TTS/)
  })

  it('mergeSystemWithAgentMemory appends block', () => {
    expect(mergeSystemWithAgentMemory('sys', '【联想记忆】\n- a')).toBe('sys\n\n【联想记忆】\n- a')
    expect(mergeSystemWithAgentMemory('', '【联想记忆】')).toBe('【联想记忆】')
  })

  it('mergeChatterHints keeps newest first and caps', () => {
    const m = mergeChatterHints(['旧1', '旧2'], ['新A', '新B', '新C', '新D'])
    expect(m[0]).toBe('新A')
    expect(m).toHaveLength(3)
  })

  it('status reason strings stay user-facing', () => {
    expect(agentMemoryStatusReason('no_model')).toBe('没配默认引擎')
    expect(agentMemoryStatusReason('empty_output')).toBe('模型空转')
    expect(agentMemoryStatusReason('no_triples')).toBe('解析不到关系')
    expect(agentMemoryStatusReason('error')).toBe('上次出错')
    expect(agentMemoryStatusReason('extract_busy')).toBe('上一轮还在记，这轮已排队')
    expect(agentMemoryStatusReason('no_complete_fn')).toBe('抽取通道未就绪')
  })

  it('formats settings status line', () => {
    expect(formatAgentMemoryStatusLine({ nodes: 0, edges: 0 })).toBe(
      '还没聊过（开启后先在这窗说一轮）'
    )
    expect(formatAgentMemoryStatusLine({ nodes: 3, edges: 2 })).toBe('已记住 3 件事')
    expect(
      formatAgentMemoryStatusLine({
        nodes: 0,
        edges: 0,
        lastStatus: { ok: false, at: 1, reason: agentMemoryStatusReason('no_model') }
      })
    ).toBe('抽不出来：没配默认引擎')
    expect(
      formatAgentMemoryStatusLine({
        nodes: 0,
        edges: 0,
        lastStatus: { ok: false, at: 1, reason: agentMemoryStatusReason('no_triples') }
      })
    ).toBe('抽不出来：解析不到关系')
    expect(
      formatAgentMemoryStatusLine({
        nodes: 4,
        edges: 3,
        lastStatus: { ok: true, at: 1, reason: agentMemoryStatusReason('ok'), added: 2 }
      })
    ).toBe('已记住 4 件事')
  })

  it('parses triples from prose plus fence', () => {
    const text = [
      '好的，这是数组：',
      '```json',
      '[{"s":"Kyle","p":"在做","o":"CPET","kindS":"person","kindO":"project"}]',
      '```',
      '以上仅供参考'
    ].join('\n')
    expect(parseTriplesFromModelText(text)).toEqual([
      {
        subject: 'Kyle',
        predicate: '在做',
        object: 'CPET',
        subjectKind: 'person',
        objectKind: 'project',
        note: undefined
      }
    ])
  })

  it('parses a single JSON object as one triple', () => {
    expect(parseTriplesFromModelText('{"s":"Kyle","p":"在做","o":"CPET"}')).toEqual([
      {
        subject: 'Kyle',
        predicate: '在做',
        object: 'CPET',
        subjectKind: undefined,
        objectKind: undefined,
        note: undefined
      }
    ])
    expect(
      parseTriplesFromModelText('好的：{"subject":"Kyle","predicate":"在做","object":"CPET"} 完')
    ).toEqual([
      {
        subject: 'Kyle',
        predicate: '在做',
        object: 'CPET',
        subjectKind: undefined,
        objectKind: undefined,
        note: undefined
      }
    ])
  })

  it('parses array with trailing junk and rejects garbage', () => {
    expect(
      parseTriplesFromModelText('[{"s":"Kyle","p":"在做","o":"CPET"}] 好的我抽完了')
    ).toHaveLength(1)
    expect(parseTriplesFromModelText('这不是 JSON，也没有三元组。')).toEqual([])
    expect(parseTriplesFromModelText('')).toEqual([])
  })

  it('extract prompt forbids prose and tools', () => {
    const first = buildExtractSystemPrompt().split('\n')[0]
    expect(first).toContain('只输出 JSON 数组')
    expect(first).toContain('禁止 markdown')
    expect(first).toContain('禁止解释')
    expect(first).toContain('禁止工具调用')
    expect(first).toContain('[]')
  })

  it('formatRecentFactLines lists newest live edges', () => {
    const { graph } = upsertTriples(EMPTY_AGENT_MEMORY_GRAPH, [
      { subject: 'Kyle', predicate: '在做', object: 'CPET' },
      { subject: 'Kyle', predicate: '用过', object: 'EdgeTTS' }
    ])
    const lines = formatRecentFactLines(graph, 5)
    expect(lines[0]).toBe('Kyle 用过 EdgeTTS')
    expect(lines).toContain('Kyle 在做 CPET')
    expect(lines).toHaveLength(2)
    expect(formatRecentFactLines(EMPTY_AGENT_MEMORY_GRAPH)).toEqual([])
    expect(formatRecentFactLines(graph, 1)).toEqual(['Kyle 用过 EdgeTTS'])
  })

  it('looksLikeRecallAsk covers 还记得 / remember and not small talk', () => {
    expect(looksLikeRecallAsk('还记得我的项目吗')).toBe(true)
    expect(looksLikeRecallAsk('上次说过什么')).toBe(true)
    expect(looksLikeRecallAsk('之前说过 CosyVoice')).toBe(true)
    expect(looksLikeRecallAsk('remember what I said')).toBe(true)
    expect(looksLikeRecallAsk('今天天气如何')).toBe(false)
    expect(looksLikeRecallAsk('')).toBe(false)
  })

  it('formatRecallBlock falls back to recent only on recall-ask', () => {
    const { graph } = upsertTriples(EMPTY_AGENT_MEMORY_GRAPH, [
      { subject: 'Kyle', predicate: '在做', object: 'CPET' }
    ])
    expect(formatRecallBlock(graph, seedTermsFromText('今天天气如何'), '今天天气如何')).toBe('')
    const ask = '还记得上次说的吗'
    const block = formatRecallBlock(graph, seedTermsFromText(ask), ask)
    expect(block).toContain('【联想记忆】')
    expect(block).toContain('Kyle 在做 CPET')
    expect(formatRecallBlock(graph, seedTermsFromText('hello'), 'hello')).toBe('')
  })

  it('偏好短表和关键词给资讯评分用', () => {
    const { graph } = upsertTriples(EMPTY_AGENT_MEMORY_GRAPH, [
      { subject: 'Kyle', predicate: '关心', object: 'OpenAI', objectKind: 'tech' },
      { subject: 'Kyle', predicate: '在做', object: 'CPET', objectKind: 'project' }
    ])
    const brief = formatPreferenceBrief(graph)
    expect(brief).toContain('【用户偏好')
    expect(brief).toContain('OpenAI')
    expect(preferenceKeywordList(graph)).toEqual(expect.arrayContaining(['OpenAI', 'CPET']))
  })
})
