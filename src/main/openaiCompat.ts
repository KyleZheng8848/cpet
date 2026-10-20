/**
 * 自定义提供商 HTTP 调用：
 * - openai：Chat Completions（SSE / 非流）
 * - anthropic：Messages API（SSE / 非流）
 * 事件形态对齐 AgentEvent，供对比 / 普通对话共用。
 */
import type {
  AgentEvent,
  ChatTurnMessage,
  ModelProvider,
  SendPromptPayload
} from '../shared/types'
import { parseModelRef } from '../shared/models'
import { applySkillsForEngine } from './skills'
import { normalizeSystemPrompt } from '../shared/prompts'
import { getSettings } from './store'
import { BaseAgentRunner, RunContext, resolveRunIdentity, extractRunUsage } from './agent'
import { SseFrameParser } from './agent/lineStream'
import { openaiChatBody, type ThinkingStyle } from './agent/parse/openaiRequest'
import {
  budgetNativeMedia,
  buildApiChatMessages,
  classifyMediaReject,
  defaultVideoPack,
  formatInlinedDocuments,
  leftoverAttachmentNote,
  leftoverUserNotice,
  resolveNativePackStyle,
  type ApiChatMessage,
  type HistoryMediaTurn,
  type LoadedMedia,
  type NativePackStyle,
  type VideoPack
} from '../shared/multimodal'
import { loadInlineDocuments, loadNativeMedia, loadRemoteVisionImages } from './attachments'
import {
  applyAnthropicStreamData,
  applyOpenAIStreamData,
  reasoningFromPayload,
  textFromContent,
  thinkingFromAnthropicContent
} from './agent/parse/sseChunk'

type Emit = (event: AgentEvent) => void
type ApiFormat = 'openai' | 'anthropic'

interface ActiveRun {
  ctx: RunContext
  abort: AbortController
}

function resolveProvider(providerId: string): ModelProvider | undefined {
  const settings = getSettings()
  return (settings.modelProviders ?? []).find((p) => p.id === providerId)
}

function resolveApiFormat(provider: ModelProvider): ApiFormat {
  if (provider.apiFormat === 'anthropic' || provider.apiFormat === 'openai') {
    return provider.apiFormat
  }
  const base = (provider.baseUrl || '').toLowerCase()
  if (base.includes('anthropic.com') || /\/v1\/messages\/?$/.test(base)) {
    return 'anthropic'
  }
  return 'openai'
}

function chatCompletionsUrl(baseUrl: string): string {
  const b = baseUrl.replace(/\/+$/, '')
  if (b.endsWith('/chat/completions')) return b
  if (b.endsWith('/v1')) return `${b}/chat/completions`
  return `${b}/v1/chat/completions`
}

function anthropicMessagesUrl(baseUrl: string): string {
  const b = baseUrl.replace(/\/+$/, '')
  if (b.endsWith('/messages')) return b
  if (b.endsWith('/v1')) return `${b}/messages`
  return `${b}/v1/messages`
}

function openaiAuthHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`
  }
}

function anthropicAuthHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01'
  }
}

function loadTurnMedia(
  attachments?: Array<{ path: string; name: string; mime?: string }>
): LoadedMedia[] {
  return loadNativeMedia(attachments)
}

function filterDropped(media: LoadedMedia[], dropAudio: boolean, dropVideo: boolean): LoadedMedia[] {
  return media.filter((m) => {
    if (dropAudio && m.kind === 'audio') return false
    if (dropVideo && m.kind === 'video') return false
    return true
  })
}

function buildMediaMessages(opts: {
  format: ApiFormat
  pack: NativePackStyle
  videoPack: VideoPack
  history: ChatTurnMessage[] | undefined
  prompt: string
  attachments: SendPromptPayload['attachments']
  extraMedia?: LoadedMedia[]
  systemPrompt?: string
  dropAudio?: boolean
  dropVideo?: boolean
}): { messages: ApiChatMessage[]; leftover: string; leftoverUser: string } {
  const dropAudio = !!opts.dropAudio || opts.pack === 'anthropic'
  const dropVideo = !!opts.dropVideo || opts.pack === 'anthropic'
  const currentLoaded = [
    ...filterDropped(loadTurnMedia(opts.attachments), dropAudio, dropVideo),
    ...(opts.extraMedia || [])
  ]
  const currentDocs = loadInlineDocuments(opts.attachments)
  const historyTurns: HistoryMediaTurn[] = []
  const historyLoadedNewestFirst: LoadedMedia[][] = []
  for (const turn of opts.history ?? []) {
    if (turn.role !== 'user' && turn.role !== 'assistant') continue
    const media =
      turn.role === 'user' ? filterDropped(loadTurnMedia(turn.attachments), dropAudio, dropVideo) : []
    const docs = turn.role === 'user' ? loadInlineDocuments(turn.attachments) : []
    const content = [turn.content || '', formatInlinedDocuments(docs)].filter(Boolean).join('\n\n')
    historyTurns.push({ role: turn.role, content, media })
    if (turn.role === 'user') historyLoadedNewestFirst.push(media)
  }
  const newestFirst = historyLoadedNewestFirst.slice().reverse()
  const budget = budgetNativeMedia(currentLoaded, newestFirst)
  const keptOldestFirst = budget.split.history.slice().reverse()
  let histIdx = 0
  const budgetedHistory = historyTurns.map((turn) => {
    if (turn.role !== 'user') return { ...turn, media: [] }
    const media = keptOldestFirst[histIdx] || []
    const original = turn.media || []
    histIdx++
    const keptPaths = new Set(media.map((m) => m.path).filter((p): p is string => !!p))
    const dropped = original.filter((m) => m.path && !keptPaths.has(m.path))
    let content = turn.content || ''
    if (dropped.length) {
      const note = leftoverAttachmentNote(
        dropped.map((m) => ({ path: m.path || '', name: m.name, mime: m.mime })),
        new Set(),
        { includeNonImages: false, pack: opts.pack, budgetDropped: true }
      )
      if (note) content = [content.trim(), note].filter(Boolean).join('\n\n')
    }
    return { ...turn, media, content }
  })
  const nativePaths = new Set(
    budget.split.current.map((x) => x.path).filter((p): p is string => !!p)
  )
  const inlinedPaths = currentDocs.map((d) => d.path)
  const leftoverOpts = {
    includeNonImages: !opts.prompt.includes('[附件]'),
    pack: opts.pack,
    rejected: { audio: !!opts.dropAudio, video: !!opts.dropVideo },
    budgetDroppedPaths: budget.dropped
      .map((m) => m.path)
      .filter((p): p is string => !!p),
    inlinedPaths
  }
  const leftover = leftoverAttachmentNote(opts.attachments, nativePaths, leftoverOpts)
  const prompt = [opts.prompt, formatInlinedDocuments(currentDocs)].filter(Boolean).join('\n\n')
  return {
    leftover,
    leftoverUser: leftoverUserNotice(opts.attachments, nativePaths, leftoverOpts),
    messages: buildApiChatMessages({
      format: opts.format,
      pack: opts.pack,
      videoPack: opts.videoPack,
      history: budgetedHistory,
      prompt,
      promptMedia: budget.split.current,
      leftoverNote: leftover,
      systemPrompt: opts.format === 'openai' ? normalizeSystemPrompt(opts.systemPrompt) : undefined
    })
  }
}

export class OpenAICompatRunner extends BaseAgentRunner<ActiveRun> {
  private pushReasoning(run: ActiveRun, text: string): boolean {
    return run.ctx.reasoning(text)
  }

  private pushAssistant(run: ActiveRun, text: string): boolean {
    return run.ctx.assistant(text)
  }

  async run(payload: SendPromptPayload, emit: Emit): Promise<void> {
    const identity = resolveRunIdentity(payload)
    const ref = payload.model?.trim() || ''
    const ctx = new RunContext(
      {
        ...identity,
        modelId: ref || identity.modelId
      },
      emit
    )

    if (this.runs.has(identity.runKey)) {
      ctx.error('该列还有请求在进行中，请先等待或取消。')
      return
    }

    const provider = resolveProvider(parseModelRef(ref).provider)
    if (!provider || provider.kind !== 'custom') {
      ctx.error(`未找到自定义提供商「${parseModelRef(ref).provider}」。请先在设置中配置。`)
      return
    }
    if (!provider.baseUrl?.trim()) {
      ctx.error(`提供商「${provider.label}」未配置 Base URL。`)
      return
    }
    if (!provider.apiKey?.trim()) {
      ctx.error(`提供商「${provider.label}」未配置 API Key。`)
      return
    }

    const abort = new AbortController()
    const run: ActiveRun = { ctx, abort }
    ctx.setSettleHook(() => {
      if (run.ctx.settled || run.ctx.aborting) return
      try {
        run.abort.abort()
      } catch {
        // ignore
      }
      run.ctx.done()
      this.drop(identity.runKey)
    })
    this.set(identity.runKey, run)

    // 直连默认 inject；用户可改成 catalog。native 会被降为 catalog。
    const withSkills = applySkillsForEngine(emit, payload, 'custom-api')
    const prompt = withSkills.prompt
    const format = resolveApiFormat(provider)
    const pack = resolveNativePackStyle(format, provider.baseUrl)
    let videoPack = defaultVideoPack(pack)
    let dropAudio = false
    let dropVideo = false
    let lastNotice = ''
    const extraMedia = await loadRemoteVisionImages(payload.remoteImages)
    const assemble = () => {
      const built = buildMediaMessages({
        format,
        pack,
        videoPack,
        history: payload.history,
        prompt,
        attachments: payload.attachments,
        extraMedia,
        systemPrompt: withSkills.systemPrompt,
        dropAudio,
        dropVideo
      })
      if (built.leftoverUser && built.leftoverUser !== lastNotice) {
        lastNotice = built.leftoverUser
        ctx.notice(built.leftoverUser)
      }
      return built
    }
    const { messages } = assemble()
    const { model } = parseModelRef(ref)
    // 任务级开关优先，否则用提供商默认
    const enableThinking =
      typeof payload.enableThinking === 'boolean'
        ? payload.enableThinking
        : !!provider.enableThinking
    ctx.state('thinking')
    ctx.session(payload.sessionId || `${format}-${identity.runKey}`)

    try {
      if (format === 'anthropic') {
        await this.runAnthropic(
          run,
          provider,
          model,
          messages,
          withSkills.systemPrompt,
          enableThinking
        )
      } else {
        await this.runOpenAI(run, provider, model, messages, enableThinking, (errText) => {
          const action = classifyMediaReject(errText, videoPack)
          if (!action) return null
          const before = `${videoPack}|${dropAudio}|${dropVideo}`
          if (action.kind === 'switch-video') videoPack = action.videoPack
          if (action.kind === 'drop-audio' || action.kind === 'drop-av') dropAudio = true
          if (action.kind === 'drop-video' || action.kind === 'drop-av') dropVideo = true
          if (`${videoPack}|${dropAudio}|${dropVideo}` === before) return null
          return assemble().messages
        })
      }
    } catch (err) {
      if (!run.ctx.aborting) {
        ctx.error(err instanceof Error ? err.message : String(err))
      }
    } finally {
      this.drop(identity.runKey)
    }
  }

  private async fetchOpenAIStream(
    url: string,
    apiKey: string,
    body: Record<string, unknown>,
    signal: AbortSignal
  ): Promise<{ res: Response; errText: string }> {
    const res = await fetch(url, {
      method: 'POST',
      headers: openaiAuthHeaders(apiKey),
      body: JSON.stringify(body),
      signal
    })
    if (res.ok) return { res, errText: '' }
    const errText = await res.text().catch(() => '')
    return { res, errText }
  }

  private async runOpenAI(
    run: ActiveRun,
    provider: ModelProvider,
    model: string,
    messages: ApiChatMessage[],
    enableThinking = false,
    onMediaReject?: (errText: string) => ApiChatMessage[] | null
  ): Promise<void> {
    const url = chatCompletionsUrl(provider.baseUrl || '')
    const apiKey = (provider.apiKey || '').trim()
    let activeMessages = messages

    // 先试完整参数；400/422 再降级，避免只发旧字段被新 API 忽略/拒绝后静默关掉思考
    const styles: Array<ThinkingStyle> = enableThinking
      ? ['full', 'thinking', 'flag', 'plain']
      : ['full', 'plain']

    let lastErr = ''
    let lastStatus = 0
    for (const style of styles) {
      if (run.ctx.aborting) return
      const body = openaiChatBody(model, activeMessages, true, enableThinking, style)
      const { res, errText } = await this.fetchOpenAIStream(url, apiKey, body, run.abort.signal)
      if (res.ok) {
        if (!res.body) {
          await this.runOpenAINonStream(
            run,
            url,
            apiKey,
            model,
            activeMessages,
            enableThinking,
            style,
            onMediaReject
          )
          return
        }
        run.ctx.state(enableThinking && style !== 'plain' ? 'thinking' : 'talking')
        const gotDelta = await this.readOpenAISSE(run, res.body)
        if (!run.ctx.aborting && !gotDelta) {
          await this.runOpenAINonStream(
            run,
            url,
            apiKey,
            model,
            activeMessages,
            enableThinking,
            style,
            onMediaReject
          )
          return
        }
        if (!run.ctx.aborting && gotDelta) run.ctx.done()
        return
      }
      lastErr = errText
      lastStatus = res.status
      if ((res.status === 400 || res.status === 422) && onMediaReject) {
        const rebuilt = onMediaReject(errText)
        if (rebuilt) {
          activeMessages = rebuilt
          continue
        }
      }
      const retryable =
        res.status === 400 ||
        res.status === 422 ||
        (style !== 'plain' && /enable_thinking|include_reasoning|thinking|unsupported|unknown|temperature/i.test(errText))
      if (!retryable) break
      // 非思考相关错误且不是参数类，别空转 styles
      if (style === 'plain') break
    }

    if (lastStatus === 400 || lastStatus === 404 || /stream/i.test(lastErr)) {
      await this.runOpenAINonStream(
        run,
        url,
        apiKey,
        model,
        activeMessages,
        enableThinking,
        'full',
        onMediaReject
      )
      return
    }
    run.ctx.error(`API ${lastStatus}: ${lastErr.slice(0, 400) || 'request failed'}`)
  }

  private async readOpenAISSE(
    run: ActiveRun,
    body: ReadableStream<Uint8Array>
  ): Promise<boolean> {
    const reader = body.getReader()
    const frames = new SseFrameParser()
    let gotDelta = false
    let terminal = false

    const apply = (payloads: string[]): void => {
      for (const data of payloads) {
        const r = applyOpenAIStreamData(run.ctx, data)
        if (r.gotDelta) gotDelta = true
        if (r.terminal) terminal = true
      }
    }

    while (true) {
      if (run.ctx.aborting) break
      const { done, value } = await reader.read()
      if (done) break
      apply(frames.push(Buffer.from(value)))
    }
    // 冲刷尾部残留（部分网关不在最后一条 data 后加换行/空行）
    apply(frames.flush())
    return gotDelta || terminal
  }

  private async runOpenAINonStream(
    run: ActiveRun,
    url: string,
    apiKey: string,
    model: string,
    messages: ApiChatMessage[],
    enableThinking = false,
    preferredStyle: ThinkingStyle = 'full',
    onMediaReject?: (errText: string) => ApiChatMessage[] | null
  ): Promise<void> {
    if (run.ctx.aborting) return
    const styles: Array<ThinkingStyle> = enableThinking
      ? preferredStyle === 'plain'
        ? ['plain']
        : [preferredStyle, 'thinking', 'flag', 'plain'].filter(
            (s, i, arr): s is ThinkingStyle => arr.indexOf(s) === i
          )
      : [preferredStyle === 'plain' ? 'plain' : 'full', 'plain'].filter(
          (s, i, arr): s is ThinkingStyle => arr.indexOf(s) === i
        )

    let lastErr = ''
    let lastStatus = 0
    let activeMessages = messages
    for (const style of styles) {
      if (run.ctx.aborting) return
      const res = await fetch(url, {
        method: 'POST',
        headers: openaiAuthHeaders(apiKey),
        body: JSON.stringify(openaiChatBody(model, activeMessages, false, enableThinking, style)),
        signal: run.abort.signal
      })
      const text = await res.text()
      if (!res.ok) {
        lastErr = text
        lastStatus = res.status
        if ((res.status === 400 || res.status === 422) && onMediaReject) {
          const rebuilt = onMediaReject(text)
          if (rebuilt) {
            activeMessages = rebuilt
            continue
          }
        }
        if (res.status === 400 || res.status === 422) continue
        run.ctx.error(`API ${res.status}: ${text.slice(0, 400)}`)
        return
      }
      let content: string
      let reasoning = ''
      try {
        const json = JSON.parse(text)
        run.ctx.noteUsage(extractRunUsage(json))
        const msg = json.choices?.[0]?.message
        content = textFromContent(msg?.content)
        reasoning = reasoningFromPayload(msg)
      } catch {
        content = text
      }
      if (reasoning) this.pushReasoning(run, reasoning)
      if (content) this.pushAssistant(run, content)
      else run.ctx.state('talking')
      run.ctx.done()
      return
    }
    run.ctx.error(`API ${lastStatus}: ${lastErr.slice(0, 400) || 'request failed'}`)
  }

  private anthropicHeaders(apiKey: string, enableThinking: boolean): Record<string, string> {
    const h = anthropicAuthHeaders(apiKey)
    if (enableThinking) {
      // 扩展思考：部分版本需要 beta；未知时网关会忽略
      h['anthropic-beta'] = 'interleaved-thinking-2025-05-14'
    }
    return h
  }

  private anthropicBody(
    model: string,
    messages: ApiChatMessage[],
    stream: boolean,
    systemPrompt: string | undefined,
    enableThinking: boolean
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model,
      max_tokens: enableThinking ? 16000 : 4096,
      messages,
      stream
    }
    if (systemPrompt) body.system = systemPrompt
    if (enableThinking) {
      body.thinking = { type: 'enabled', budget_tokens: 8000 }
    }
    return body
  }

  private async runAnthropic(
    run: ActiveRun,
    _provider: ModelProvider,
    model: string,
    messages: ApiChatMessage[],
    systemPrompt?: string,
    enableThinking = false
  ): Promise<void> {
    const url = anthropicMessagesUrl(_provider.baseUrl || '')
    const apiKey = (_provider.apiKey || '').trim()
    const sys = normalizeSystemPrompt(systemPrompt)
    const body = this.anthropicBody(model, messages, true, sys, enableThinking)

    const res = await fetch(url, {
      method: 'POST',
      headers: this.anthropicHeaders(apiKey, enableThinking),
      body: JSON.stringify(body),
      signal: run.abort.signal
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      if (
        enableThinking &&
        (res.status === 400 || res.status === 422) &&
        /thinking|budget|beta|unsupported/i.test(errText)
      ) {
        // 不支持 extended thinking 时降级普通请求
        const retry = await fetch(url, {
          method: 'POST',
          headers: anthropicAuthHeaders(apiKey),
          body: JSON.stringify(this.anthropicBody(model, messages, true, sys, false)),
          signal: run.abort.signal
        })
        if (retry.ok && retry.body) {
          run.ctx.state('talking')
          const got = await this.readAnthropicSSE(run, retry.body)
          if (!run.ctx.aborting && got) run.ctx.done()
          else if (!run.ctx.aborting && !got) {
            await this.runAnthropicNonStream(run, url, apiKey, model, messages, sys, false)
          }
          return
        }
      }
      if (res.status === 400 || res.status === 404 || /stream/i.test(errText)) {
        await this.runAnthropicNonStream(run, url, apiKey, model, messages, sys, enableThinking)
        return
      }
      run.ctx.error(`Anthropic API ${res.status}: ${errText.slice(0, 400) || res.statusText}`)
      return
    }

    if (!res.body) {
      await this.runAnthropicNonStream(run, url, apiKey, model, messages, sys, enableThinking)
      return
    }

    run.ctx.state('talking')
    const gotDelta = await this.readAnthropicSSE(run, res.body)
    if (!run.ctx.aborting && !gotDelta) {
      await this.runAnthropicNonStream(run, url, apiKey, model, messages, sys, enableThinking)
      return
    }
    if (!run.ctx.aborting && gotDelta) run.ctx.done()
  }

  private async readAnthropicSSE(
    run: ActiveRun,
    body: ReadableStream<Uint8Array>
  ): Promise<boolean> {
    const reader = body.getReader()
    const frames = new SseFrameParser()
    let gotDelta = false
    let terminal = false

    const apply = (payloads: string[]): void => {
      for (const data of payloads) {
        const r = applyAnthropicStreamData(run.ctx, data)
        if (r.gotDelta) gotDelta = true
        if (r.terminal) terminal = true
      }
    }

    while (true) {
      if (run.ctx.aborting) break
      const { done, value } = await reader.read()
      if (done) break
      apply(frames.push(Buffer.from(value)))
    }
    apply(frames.flush())
    return gotDelta || terminal
  }

  private async runAnthropicNonStream(
    run: ActiveRun,
    url: string,
    apiKey: string,
    model: string,
    messages: ApiChatMessage[],
    systemPrompt?: string,
    enableThinking = false
  ): Promise<void> {
    if (run.ctx.aborting) return
    const body = this.anthropicBody(model, messages, false, systemPrompt, enableThinking)
    const res = await fetch(url, {
      method: 'POST',
      headers: this.anthropicHeaders(apiKey, enableThinking),
      body: JSON.stringify(body),
      signal: run.abort.signal
    })
    const text = await res.text()
    if (!res.ok) {
      run.ctx.error(`Anthropic API ${res.status}: ${text.slice(0, 400)}`)
      return
    }
    let content: string
    let reasoning = ''
    try {
      const json = JSON.parse(text)
      run.ctx.noteUsage(extractRunUsage(json))
      content = textFromContent(json.content)
      if (!content && typeof json.content === 'string') content = json.content
      reasoning = thinkingFromAnthropicContent(json.content)
    } catch {
      content = text
    }
    if (reasoning) this.pushReasoning(run, reasoning)
    if (content) this.pushAssistant(run, content)
    else run.ctx.state('talking')
    run.ctx.done()
  }

  protected cancelOne(runKey: string): void {
    const run = this.get(runKey)
    if (!run) return
    try {
      run.ctx.aborted()
    } catch {
      // ignore
    }
    try {
      run.abort.abort()
    } catch {
      // ignore
    }
    this.runs.delete(runKey)
  }
}
