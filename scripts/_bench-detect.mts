import mod from '../src/main/agentDetect.ts'

const { detectAllEngines } = mod as { detectAllEngines: () => Promise<any[]> }
const t0 = Date.now()
const engines = await detectAllEngines()
console.log('__DETECT__', Date.now() - t0, 'ms')
for (const e of engines) {
  console.log(`${e.id}: installed=${e.installed} bin=${e.binPath || '-'}`)
}
