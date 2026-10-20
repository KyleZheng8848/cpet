/**
 * 解析器与 Runner 之间的最小接口。
 *
 * 解析器只做「一行原始输出 → 该调 RunContext 的哪个方法」这一件事；
 * 杀子进程、看门狗续命、run 表清理这些副作用留在 Runner 里。
 * 这样每个引擎的映射逻辑都能脱离 Electron / child_process 单测。
 */

import type { RunContext } from '../runContext'

export interface LineSink {
  readonly ctx: RunContext
  settleDone(result?: string): void
  settleError(message: string): void
  /** 解析到实质推进（正文/思考/工具）时调用：续命 idle 看门狗。 */
  keepAlive(): void
}

/** cursor-agent 多一条路径：流被提前掐断时，有正文就当正常结束。 */
export interface CursorLineSink extends LineSink {
  settleAfterStreamBreak(detail: string): void
}
