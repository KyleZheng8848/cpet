import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { zipBuffer } from '../src/main/zipUtil'
import { readOfficePreviewText } from '../src/main/officePreview'
import { csvToMarkdown, parseCsv } from '../src/shared/csvPreview'

function writeZip(root: string, name: string, entries: Array<{ name: string; data: Buffer }>): string {
  const file = join(root, name)
  writeFileSync(file, zipBuffer(entries))
  return file
}

describe('readOfficePreviewText', () => {
  it('renders a minimal docx as HTML', () => {
    const root = mkdtempSync(join(tmpdir(), 'cpet-docx-'))
    try {
      const xml =
        '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>标题</w:t></w:r></w:p><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>你好 CPET</w:t></w:r></w:p></w:body></w:document>'
      const r = readOfficePreviewText(
        writeZip(root, 'note.docx', [{ name: 'word/document.xml', data: Buffer.from(xml, 'utf8') }])
      )
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.format).toBe('docx')
        expect(r.html).toContain('<h1>')
        expect(r.html).toContain('标题')
        expect(r.html).toContain('<strong>你好 CPET</strong>')
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('maps Chinese style ids from styles.xml and keeps large font', () => {
    const root = mkdtempSync(join(tmpdir(), 'cpet-docx-'))
    try {
      const styles =
        '<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="1"><w:name w:val="heading 1"/></w:style></w:styles>'
      const xml =
        '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="1"/></w:pPr><w:r><w:t>一、做了多久？</w:t></w:r></w:p><w:p><w:r><w:rPr><w:sz w:val="44"/></w:rPr><w:t>大标题</w:t></w:r></w:p></w:body></w:document>'
      const r = readOfficePreviewText(
        writeZip(root, 'cn.docx', [
          { name: 'word/styles.xml', data: Buffer.from(styles, 'utf8') },
          { name: 'word/document.xml', data: Buffer.from(xml, 'utf8') }
        ])
      )
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.html).toContain('<h1')
        expect(r.html).toContain('一、做了多久？')
        expect(r.html).toContain('font-size:22pt')
        expect(r.html).toContain('大标题')
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('uses the first short paragraph as the document title', () => {
    const root = mkdtempSync(join(tmpdir(), 'cpet-docx-title-'))
    try {
      const xml =
        '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>AoE 开发周期与历史关键点</w:t></w:r></w:p><w:p><w:r><w:t>正文说明。</w:t></w:r></w:p></w:body></w:document>'
      const r = readOfficePreviewText(
        writeZip(root, 'title.docx', [{ name: 'word/document.xml', data: Buffer.from(xml, 'utf8') }])
      )
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.html).toMatch(/<h1[^>]*>AoE 开发周期与历史关键点<\/h1>/)
        expect(r.html).toContain('<p>正文说明。</p>')
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('treats 一、 as a heading and keeps table cells after inner paragraphs', () => {
    const root = mkdtempSync(join(tmpdir(), 'cpet-docx-'))
    try {
      const xml =
        '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
        '<w:p><w:r><w:t>一、做了多久？</w:t></w:r></w:p>' +
        '<w:tbl><w:tr><w:tc><w:tcPr><w:shd w:fill="1F4E79"/></w:tcPr><w:p><w:r><w:t>节点</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>时间</w:t></w:r></w:p></w:tc></w:tr>' +
        '<w:tr><w:tc><w:p><w:r><w:t>立项</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>2026-02</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
        '<w:p><w:pPr><w:shd w:fill="D6EAF8"/></w:pPr><w:r><w:t>可直接作答</w:t></w:r></w:p>' +
        '</w:body></w:document>'
      const r = readOfficePreviewText(
        writeZip(root, 'report.docx', [{ name: 'word/document.xml', data: Buffer.from(xml, 'utf8') }])
      )
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.html).toContain('<h2')
        expect(r.html).toContain('一、做了多久？')
        expect(r.html).toContain('<th')
        expect(r.html).toContain('节点')
        expect(r.html).toContain('立项')
        expect(r.html).toContain('2026-02')
        expect(r.html).toContain('office-callout')
        expect(r.html).toContain('可直接作答')
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('renders pptx slides as a 16:9 canvas with readable contrast', () => {
    const root = mkdtempSync(join(tmpdir(), 'cpet-pptx-'))
    try {
      const slide =
        '<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="111111"/></a:solidFill></p:bgPr></p:bg><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:rPr sz="3200" b="1"/><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:t>医疗大模型</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>27B 全激活稠密</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>'
      const r = readOfficePreviewText(
        writeZip(root, 'deck.pptx', [
          { name: 'ppt/slides/slide1.xml', data: Buffer.from(slide, 'utf8') }
        ])
      )
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.format).toBe('pptx')
        expect(r.html).toContain('office-slide-canvas')
        expect(r.html).toContain('office-slide-title')
        expect(r.html).toContain('医疗大模型')
        expect(r.html).toContain('27B')
        expect(r.html).toMatch(/color:\s*#FFFFFF/i)
        expect(r.html).toMatch(/font-size:\s*3\.33cqw/)
        expect(r.html).not.toContain('is-dark')
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('places pptx shapes by EMU coordinates', () => {
    const root = mkdtempSync(join(tmpdir(), 'cpet-pptx-pos-'))
    try {
      const slide =
        '<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree>' +
        '<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="609600" y="274320"/><a:ext cx="10972800" cy="1143000"/></a:xfrm><a:solidFill><a:srgbClr val="1F4E79"/></a:solidFill></p:spPr><p:txBody><a:p><a:r><a:t>POSITIONING</a:t></a:r></a:p></p:txBody></p:sp>' +
        '<p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="609600" y="1828800"/><a:ext cx="10972800" cy="3657600"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>端到端服务</a:t></a:r></a:p></p:txBody></p:sp>' +
        '</p:spTree></p:cSld></p:sld>'
      const r = readOfficePreviewText(
        writeZip(root, 'pos.pptx', [
          { name: 'ppt/slides/slide1.xml', data: Buffer.from(slide, 'utf8') }
        ])
      )
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.html).toContain('left:5.00%')
        expect(r.html).toContain('top:4.00%')
        expect(r.html).toContain('background:#1F4E79')
        expect(r.html).toContain('POSITIONING')
        expect(r.html).toContain('端到端服务')
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('xlsx keeps sparse cells and merges', () => {
    const root = mkdtempSync(join(tmpdir(), 'cpet-xlsx-'))
    try {
      const sheet =
        '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><mergeCells><mergeCell ref="A1:B1"/></mergeCells><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="C2" t="s"><v>1</v></c></row></sheetData></worksheet>'
      const shared =
        '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>合并标题</t></si><si><t>角落</t></si></sst>'
      const r = readOfficePreviewText(
        writeZip(root, 't.xlsx', [
          { name: 'xl/sharedStrings.xml', data: Buffer.from(shared, 'utf8') },
          { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheet, 'utf8') }
        ])
      )
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.html).toContain('colspan="2"')
        expect(r.html).toContain('合并标题')
        expect(r.html).toContain('角落')
        expect(r.html).toContain('office-grid')
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('csvToMarkdown', () => {
  it('builds a GFM table and keeps latex cells', () => {
    const md = csvToMarkdown('id,question\n1,$\\int x dx$\n2,hello').markdown
    expect(md).toContain('| id | question |')
    expect(md).toContain('| --- | --- |')
    expect(md).toContain('$\\int x dx$')
  })

  it('parses quoted commas', () => {
    expect(parseCsv('a,b\n"x,y",z')).toEqual([
      ['a', 'b'],
      ['x,y', 'z']
    ])
  })
})
