/** Agent 运行时核心：归一化 + RunContext + Runner 基类。 */

export { resolveTextPiece, sliceCumulativeDelta, SMALL_DELTA_MAX, type TextMode } from './normalize'
export { makeRunKey, matchesConversation, resolveRunIdentity } from './keys'
export { RunContext, type Emit, type RunIdentity, type ControlAction } from './runContext'
export { BaseAgentRunner } from './baseRunner'
export { extractRunUsage, mergeRunUsage } from './usage'
export { LineBuffer, SseFrameParser, appendBounded, MAX_LINE_CHARS } from './lineStream'
export type { LineSink, CursorLineSink } from './parse/sink'
