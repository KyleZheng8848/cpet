#!/usr/bin/env node
/**
 * Create a new CPET skin workdir + skin.json / identity.json.
 *
 * Usage:
 *   cpet new --id strawberry-pudding --name 草莓布丁 --prompt "a round strawberry pudding creature..."
 */
import { writeSkin, WORK, describePaths } from './lib/skin-catalog.mjs'

function parseArgs(argv) {
  const o = { id: '', name: '', prompt: '', model: '' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const n = argv[i + 1]
    if (a === '--id') {
      o.id = n
      i++
    } else if (a === '--name') {
      o.name = n
      i++
    } else if (a === '--prompt') {
      o.prompt = n
      i++
    } else if (a === '--model') {
      o.model = n
      i++
    }
  }
  return o
}

const opts = parseArgs(process.argv.slice(2))
if (!opts.id || !opts.name || !opts.prompt) {
  console.error(`Usage: cpet new --id <skinId> --name <中文包名> --prompt "<character lock>"`)
  console.error(`Creates: ${WORK}/<skinId>/skin.json + identity.json`)
  process.exit(1)
}
if (!/^[a-z][a-z0-9-]{1,48}$/.test(opts.id)) {
  console.error('id must be kebab-case ascii: ^[a-z][a-z0-9-]{1,48}$')
  process.exit(1)
}

const path = writeSkin({
  id: opts.id,
  packName: opts.name,
  characterPrompt: opts.prompt,
  identityRef: 'raw/idle.png',
  model: opts.model
})
console.log('wrote', path)
console.log(describePaths())
console.log('next: supply generated PNGs in raw/ and anim/<stem>/00..03.png, then:')
console.log(`  cpet pick ${opts.id} <n>      # lock the winner as raw/idle.png`)
console.log(`  cpet qa ${opts.id}`)
console.log(`  cpet gif ${opts.id}`)
console.log(`  cpet dock "${opts.name}"`)
console.log(`  cpet validate --strict-actions "${opts.name}"`)
