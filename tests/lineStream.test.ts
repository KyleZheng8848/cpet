/**
 * 行缓冲 / SSE 分帧 / 多字节解码。
 * 这层出错的表现全是「用户看得见」的：中文变问号、正文凭空少一段、
 * 或者一个失控的 CLI 把主进程内存吃光。
 */
import { describe, it, expect } from 'vitest'
import { LineBuffer, SseFrameParser, appendBounded } from '../src/main/agent/lineStream'

describe('LineBuffer：跨 chunk 行拼接', () => {
  it('半行被 chunk 切断时不吐出，等下一段补齐', () => {
    const lb = new LineBuffer()
    expect(lb.push('{"type":"assis')).toEqual([])
    expect(lb.push('tant"}\n')).toEqual(['{"type":"assistant"}'])
  })

  it('一个 chunk 里多行全部吐出，残留留在缓冲里', () => {
    const lb = new LineBuffer()
    expect(lb.push('a\nb\nc')).toEqual(['a', 'b'])
    expect(lb.pending).toBe('c')
  })

  it('flush 把最后一段没有换行收尾的输出交出来（CLI 退出前常见）', () => {
    const lb = new LineBuffer()
    lb.push('{"type":"result"}')
    expect(lb.flush()).toEqual(['{"type":"result"}'])
  })

  it('保留行内空白：--stream-partial-output 的前导空格是正文的一部分', () => {
    const lb = new LineBuffer()
    expect(lb.push('  两个空格开头\n')).toEqual(['  两个空格开头'])
  })
})

describe('LineBuffer：多字节 UTF-8 跨 chunk', () => {
  it('中文字被字节边界切开时不会变成 U+FFFD', () => {
    const lb = new LineBuffer()
    const bytes = Buffer.from('你好世界\n', 'utf8')
    // 切在「世」的第 1 个字节之后
    const cut = bytes.indexOf(Buffer.from('世', 'utf8')) + 1
    expect(lb.push(bytes.subarray(0, cut))).toEqual([])
    expect(lb.push(bytes.subarray(cut))).toEqual(['你好世界'])
  })

  it('对照：直接 toString 会产生替换字符（这就是要修的老行为）', () => {
    const bytes = Buffer.from('你好世界', 'utf8')
    const cut = bytes.indexOf(Buffer.from('世', 'utf8')) + 1
    const naive = bytes.subarray(0, cut).toString('utf8') + bytes.subarray(cut).toString('utf8')
    expect(naive).toContain('\ufffd')
    expect(naive).not.toBe('你好世界')
  })

  it('emoji（4 字节）逐字节喂进来也能还原', () => {
    const lb = new LineBuffer()
    const bytes = Buffer.from('🐼ok\n', 'utf8')
    const out: string[] = []
    for (const b of bytes) out.push(...lb.push(Buffer.from([b])))
    expect(out).toEqual(['🐼ok'])
  })

  it('流结束时末尾残留的半个字符会被冲刷，不会静默吞掉', () => {
    const lb = new LineBuffer()
    const bytes = Buffer.from('中', 'utf8')
    lb.push(bytes.subarray(0, 2))
    // 只有半个字符：flush 后至少要吐出点东西，而不是当作「什么都没收到」
    expect(lb.flush().join('')).not.toBe('')
  })
})

describe('LineBuffer：超长单行止损', () => {
  it('超过上限的行被丢弃，且不影响后续行', () => {
    const lb = new LineBuffer(64)
    lb.push('x'.repeat(200))
    expect(lb.push('尾巴\n{"type":"result"}\n')).toEqual(['{"type":"result"}'])
    expect(lb.droppedLines).toBe(1)
  })

  it('未超限时不丢任何东西', () => {
    const lb = new LineBuffer(64)
    expect(lb.push('x'.repeat(60) + '\n')).toEqual(['x'.repeat(60)])
    expect(lb.droppedLines).toBe(0)
  })
})

describe('SseFrameParser', () => {
  it('普通逐帧：data 行按空行成帧', () => {
    const p = new SseFrameParser()
    expect(p.push('data: {"a":1}\n\ndata: {"a":2}\n\n')).toEqual(['{"a":1}', '{"a":2}'])
  })

  it('CRLF 网关也能分帧', () => {
    const p = new SseFrameParser()
    expect(p.push('data: {"a":1}\r\n\r\n')).toEqual(['{"a":1}'])
  })

  it('同一事件的多条 data 行按 \\n 拼接后才是完整 JSON', () => {
    const p = new SseFrameParser()
    const frames = p.push('data: {"choices":[\ndata: {"delta":{"content":"嗨"}}]}\n\n')
    expect(frames).toHaveLength(1)
    expect(JSON.parse(frames[0]).choices[0].delta.content).toBe('嗨')
  })

  it('注释行（心跳 :ping）与 event/id 字段被忽略', () => {
    const p = new SseFrameParser()
    expect(p.push(': ping\n\nevent: message\nid: 7\ndata: {"a":1}\n\n')).toEqual(['{"a":1}'])
  })

  it('末帧没有空行也没有换行时，flush 补出来', () => {
    const p = new SseFrameParser()
    expect(p.push('data: [DONE]')).toEqual([])
    expect(p.flush()).toEqual(['[DONE]'])
  })

  it('data 值只吃掉一个前导空格，正文里的空格保留', () => {
    const p = new SseFrameParser()
    expect(p.push('data:   两个空格\n\n')).toEqual(['  两个空格'])
  })

  it('字节流被切在中文中间时帧内容仍然正确', () => {
    const p = new SseFrameParser()
    const bytes = Buffer.from('data: {"t":"中文"}\n\n', 'utf8')
    const cut = bytes.indexOf(Buffer.from('中', 'utf8')) + 2
    const frames = [...p.push(bytes.subarray(0, cut)), ...p.push(bytes.subarray(cut))]
    expect(frames).toEqual(['{"t":"中文"}'])
  })
})

describe('appendBounded', () => {
  it('未超限时就是普通拼接', () => {
    expect(appendBounded('a', 'b', 10)).toBe('ab')
  })

  it('超限时只留尾部（报错时有用的是最后几行）', () => {
    expect(appendBounded('12345', '6789', 4)).toBe('6789')
  })
})
