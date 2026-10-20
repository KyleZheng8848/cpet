import ocMod from '../src/main/openclawAgent.ts'

const { OpenClawRunner } = ocMod as { OpenClawRunner: new () => any }
const runner = new OpenClawRunner()
const events: any[] = []
const t0 = Date.now()
const TIMEOUT_MS = 100_000

const payload = {
  conversationId: 'smoke-oc-' + Date.now().toString(36),
  prompt: '只回复两个字：你好。不要用工具。',
  cwd: process.cwd(),
  model: 'openclaw:main',
  agentAutonomy: 'ask' as const
}

console.log('START', payload.conversationId)

await new Promise<void>((resolve, reject) => {
  const timer = setTimeout(() => {
    runner.cancel(payload.conversationId)
    reject(new Error(`timeout ${TIMEOUT_MS}ms`))
  }, TIMEOUT_MS)

  runner
    .run(payload, (e: any) => {
      events.push({
        type: e.type,
        _t: Date.now() - t0,
        text: e.text?.slice?.(0, 40),
        message: e.message?.slice?.(0, 120)
      })
      if (e.type === 'done' || e.type === 'error' || e.type === 'aborted') {
        console.log('TERMINAL', e.type, Date.now() - t0)
        clearTimeout(timer)
        // 给 drop 一点时间
        setTimeout(() => resolve(), 50)
      }
    })
    .catch((err: unknown) => {
      clearTimeout(timer)
      reject(err)
    })
}).catch((err) => {
  console.error('SMOKE_ERR', err instanceof Error ? err.message : err)
})

const text = events.filter((e) => e.type === 'assistant-delta').map((e) => e.text || '').join('')
const settled = events.some((e) => e.type === 'done' || e.type === 'error' || e.type === 'aborted')
const report = {
  engine: 'openclaw',
  settled,
  ms: Date.now() - t0,
  text: text.slice(0, 200),
  types: [...new Set(events.map((e) => e.type))],
  busyAfter: runner.isBusy,
  err: events.find((e) => e.type === 'error')?.message
}
console.log('__REPORT__' + JSON.stringify(report, null, 2))
// error 终态也算跑通（网关/鉴权问题），关键是 settled 且不卡 busy
const ok = settled && !runner.isBusy
console.log(ok ? 'PASS' : 'FAIL')
process.exit(ok ? 0 : 1)
