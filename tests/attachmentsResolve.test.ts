import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveAttachmentPaths } from '../src/main/attachments'

describe('resolveAttachmentPaths', () => {
  it('expands a folder into files and skips junk dirs', () => {
    const root = mkdtempSync(join(tmpdir(), 'cpet-attach-'))
    try {
      writeFileSync(join(root, 'a.txt'), 'hello')
      writeFileSync(join(root, 'b.md'), '# hi')
      mkdirSync(join(root, 'node_modules'))
      writeFileSync(join(root, 'node_modules', 'skip.js'), 'x')
      mkdirSync(join(root, 'sub'))
      writeFileSync(join(root, 'sub', 'c.py'), 'print(1)')
      const out = resolveAttachmentPaths([root])
      const names = out.map((a) => a.name).sort()
      expect(names).toEqual(['a.txt', 'b.md', 'c.py'])
      expect(out.every((a) => a.path.includes(root))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('keeps plain files and respects max', () => {
    const root = mkdtempSync(join(tmpdir(), 'cpet-attach-'))
    try {
      const files = Array.from({ length: 5 }, (_, i) => {
        const p = join(root, `f${i}.txt`)
        writeFileSync(p, String(i))
        return p
      })
      const out = resolveAttachmentPaths(files, 3)
      expect(out).toHaveLength(3)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
