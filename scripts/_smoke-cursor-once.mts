import cursorMod from '../src/main/cursorAgent.ts'

const { AgentRunner } = cursorMod as { AgentRunner: new () => any }
const runner = new AgentRunner()
const events: any[] = []
const t0 = Date.now()
let firstContentAt = 0
let doneAt = 0

const payload = {
  conversationId: 'smoke-cursor-' + Date.now().toString(36),
  prompt: '只回复两个字：你好。不要用工具，不要解释。',
  cwd: process.cwd(),
  model: 'cursor:auto',
  agentAutonomy: 'agent' as const
}

console.log('START', payload.conversationId)
await runner.run(payload, (e: any) => {
  events.push({ type: e.type, _t: Date.now() - t0, text: e.text?.slice?.(0, 40), message: e.message?.slice?.(0, 80) })
  if (!firstContentAt && (e.type === 'assistant-delta' || e.type === 'reasoning-delta')) {
    firstContentAt = Date.now() - t0
    console.log('FIRST_CONTENT', firstContentAt, e.type)
  }
  if (e.type === 'done' || e.type === 'error' || e.type === 'aborted') {
    doneAt = Date.now() - t0
    console.log('TERMINAL', e.type, doneAt)
  }
})

const text = events.filter((e) => e.type === 'assistant-delta').map((e) => e.text || '').join('')
const reason = events
  .filter((e) => e.type === 'reasoning-delta')
  .map((e) => e.text || '')
  .join('')
const types = events.map((e) => e.type)
const settled = types.includes('done') || types.includes('error') || types.includes('aborted')
const afterDone = events.findIndex((e) => e.type === 'done' || e.type === 'error' || e.type === 'aborted')
const trailing =
  afterDone >= 0
    ? events.slice(afterDone + 1).filter((e) => e.type === 'assistant-delta' || e.type === 'reasoning-delta')
    : []
const again = /用户再次问候|用户发来了问候/.test(reason)
const settleLag = firstContentAt && doneAt ? doneAt - firstContentAt : null

const report = {
  settled,
  ms: Date.now() - t0,
  firstContentAt,
  doneAt,
  settleLag,
  text: text.slice(0, 200),
  reasonHead: reason.slice(0, 160),
  again,
  trailingAfterDone: trailing.length,
  types: [...new Set(types)],
  busyAfter: runner.isBusy,
  err: events.find((e) => e.type === 'error')?.message
}
console.log('__REPORT__' + JSON.stringify(report, null, 2))

const checks = [
  ['settled', settled],
  ['not_busy', !runner.isBusy],
  ['has_output', !!(text.trim() || reason.trim())],
  // 冷启动可能 >45s；关键看首包后收尾是否被重连拖死
  ['settle_lag_le_20s', settleLag != null && settleLag <= 20_000],
  ['total_le_120s', report.ms <= 120_000],
  ['no_again_loop', !again],
  ['no_trailing', trailing.length === 0]
]
let failed = 0
for (const [name, ok] of checks) {
  const extra =
    name === 'settle_lag_le_20s' ? settleLag : name === 'total_le_120s' ? report.ms : ''
  console.log(ok ? `PASS ${name}` : `FAIL ${name}`, extra)
  if (!ok) failed++
}
process.exit(failed ? 1 : 0)
