/** 本地工作记忆：失败引擎 / 最近项目目录（不上云，只喂 idle 碎碎念）。 */

export interface WorkMemory {
  /** 最近用过的项目目录（新在前）。 */
  recentCwds: string[]
  /** 最近失败的引擎/提供商 id（如 openclaw、cursor）。 */
  failedEngines: Array<{ id: string; at: number; note?: string }>
}

export const EMPTY_WORK_MEMORY: WorkMemory = { recentCwds: [], failedEngines: [] }

const MAX_CWDS = 8
const MAX_FAILS = 12
/** 失败记录超过此时长不再念叨。 */
const FAIL_TTL_MS = 7 * 24 * 60 * 60 * 1000

export function normalizeWorkMemory(raw: unknown): WorkMemory {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_WORK_MEMORY, recentCwds: [], failedEngines: [] }
  const o = raw as Partial<WorkMemory>
  const recentCwds = Array.isArray(o.recentCwds)
    ? o.recentCwds.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).slice(0, MAX_CWDS)
    : []
  const failedEngines = Array.isArray(o.failedEngines)
    ? o.failedEngines
        .filter(
          (x): x is { id: string; at: number; note?: string } =>
            !!x &&
            typeof x === 'object' &&
            typeof (x as { id?: unknown }).id === 'string' &&
            typeof (x as { at?: unknown }).at === 'number'
        )
        .slice(0, MAX_FAILS)
    : []
  return { recentCwds, failedEngines }
}

export function rememberCwd(mem: WorkMemory, cwd: string): WorkMemory {
  const c = cwd.trim()
  if (!c) return mem
  const rest = mem.recentCwds.filter((x) => x !== c)
  return { ...mem, recentCwds: [c, ...rest].slice(0, MAX_CWDS) }
}

export function rememberEngineFailure(
  mem: WorkMemory,
  engineId: string,
  note?: string,
  at = Date.now()
): WorkMemory {
  const id = engineId.trim()
  if (!id) return mem
  const rest = mem.failedEngines.filter((x) => x.id !== id)
  return {
    ...mem,
    failedEngines: [{ id, at, note: note?.slice(0, 120) }, ...rest].slice(0, MAX_FAILS)
  }
}

function basename(p: string): string {
  const parts = p.replace(/[/\\]+$/, '').split(/[/\\]/)
  return parts[parts.length - 1] || p
}

export interface MemoryChatter {
  text: string
  hint?: string
  action?:
    | { kind: 'chat' }
    | { kind: 'settings'; section?: string }
    | { kind: 'monitor' }
    | { kind: 'schedules' }
}

/** 从记忆抽出 0～2 条可念台词（调用方再与通用池混抽）。 */
export function chatterFromWorkMemory(mem: WorkMemory, now = Date.now()): MemoryChatter[] {
  const out: MemoryChatter[] = []
  const freshFail = mem.failedEngines.find((f) => now - f.at < FAIL_TTL_MS)
  if (freshFail) {
    out.push({
      text: freshFail.note
        ? `上次 ${freshFail.id} 出过状况：${freshFail.note.slice(0, 40)}…要不要去设置看看？`
        : `上次 ${freshFail.id} 好像不太顺，设置里刷新一下引擎？`,
      hint: '点击打开设置',
      action: { kind: 'settings', section: 'settings-setup' }
    })
  }
  const cwd = mem.recentCwds[0]
  if (cwd) {
    out.push({
      text: `还在「${basename(cwd)}」里干活吗？点我开对话接着派。`,
      hint: '点击打开对话',
      action: { kind: 'chat' }
    })
  }
  return out
}

/** 从 modelRef（如 openclaw:main）抽出引擎 id。 */
export function engineIdFromModelRef(modelRef?: string): string | undefined {
  if (!modelRef || typeof modelRef !== 'string') return undefined
  const i = modelRef.indexOf(':')
  const id = (i >= 0 ? modelRef.slice(0, i) : modelRef).trim()
  return id || undefined
}
