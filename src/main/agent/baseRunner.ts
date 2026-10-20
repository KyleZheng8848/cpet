/**
 * CLI / HTTP Runner 共用：run 表、busy、cancel、按会话匹配。
 */

import { makeRunKey, matchesConversation } from './keys'
import type { RunContext } from './runContext'

export abstract class BaseAgentRunner<TRun extends { ctx: RunContext; cleanup?: () => void }> {
  protected readonly runs = new Map<string, TRun>()

  get isBusy(): boolean {
    return this.runs.size > 0
  }

  isBusyFor(conversationId: string): boolean {
    for (const key of this.runs.keys()) {
      if (matchesConversation(key, conversationId)) return true
    }
    return false
  }

  protected get(runKey: string): TRun | undefined {
    return this.runs.get(runKey)
  }

  protected set(runKey: string, run: TRun): void {
    this.runs.set(runKey, run)
  }

  protected drop(runKey: string): void {
    const run = this.runs.get(runKey)
    if (!run) return
    try {
      run.cleanup?.()
    } catch {
      // ignore
    }
    this.runs.delete(runKey)
  }

  /** 取消：不传 conversationId 则全部；传 lane/model 则只取消该列。 */
  cancel(conversationId?: string, laneOrModelId?: string): void {
    if (!conversationId) {
      for (const key of [...this.runs.keys()]) this.cancelOne(key)
      return
    }
    if (laneOrModelId) {
      this.cancelOne(makeRunKey(conversationId, laneOrModelId))
      return
    }
    for (const key of [...this.runs.keys()]) {
      if (matchesConversation(key, conversationId)) this.cancelOne(key)
    }
  }

  protected abstract cancelOne(runKey: string): void
}
