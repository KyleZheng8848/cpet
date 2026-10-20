import { describe, expect, it } from 'vitest'
import {
  attachmentReadHint,
  classifyAttachmentMedia,
  mergeAttachmentSkills,
  skillIdsForAttachments
} from '../src/shared/attachmentMedia'

describe('skillIdsForAttachments', () => {
  it('maps office/pdf extensions to skill ids', () => {
    expect(
      skillIdsForAttachments([
        { name: 'a.docx' },
        { path: '/tmp/b.PDF' },
        { name: 'c.xlsx' },
        { name: 'd.pptx' },
        { name: 'notes.md' }
      ])
    ).toEqual(['docx', 'pdf', 'xlsx', 'pptx'])
  })

  it('dedupes same skill from multiple files', () => {
    expect(
      skillIdsForAttachments([{ name: '1.docx' }, { name: '2.doc' }, { name: '3.docx' }])
    ).toEqual(['docx'])
  })
})

describe('mergeAttachmentSkills', () => {
  it('only adds skills that exist in knownIds', () => {
    expect(
      mergeAttachmentSkills(['harsh-optimize-loop'], [{ name: 'x.docx' }, { name: 'y.pdf' }], [
        'docx',
        'harsh-optimize-loop'
      ])
    ).toEqual(['harsh-optimize-loop', 'docx'])
  })

  it('keeps manual selection when no matching skill installed', () => {
    expect(mergeAttachmentSkills(['manual'], [{ name: 'a.pptx' }], ['docx'])).toEqual([
      'manual'
    ])
  })
})

describe('classifyAttachmentMedia office', () => {
  it('does not treat openxml office mime as text', () => {
    expect(
      classifyAttachmentMedia(
        'a.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      )
    ).toBe('file')
    expect(
      classifyAttachmentMedia(
        'a.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      )
    ).toBe('file')
    expect(
      classifyAttachmentMedia(
        'a.pptx',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      )
    ).toBe('file')
  })
})

describe('attachmentReadHint', () => {
  it('points office files at the matching skill', () => {
    expect(attachmentReadHint('report.docx')).toContain('/docx')
    expect(attachmentReadHint('sheet.xlsx')).toContain('/xlsx')
    expect(attachmentReadHint('deck.pptx')).toContain('/pptx')
    expect(attachmentReadHint('paper.pdf')).toContain('/pdf')
  })

  it('points text at Read', () => {
    expect(attachmentReadHint('readme.md')).toContain('Read')
  })

  it('points images at Read instead of pretending pixels are already in the prompt', () => {
    expect(attachmentReadHint('shot.png')).toContain('Read')
    expect(attachmentReadHint('photo.heic')).toMatch(/PNG\/JPEG/)
  })

  it('points audio/video at tools instead of a generic 音视频 shrug', () => {
    expect(attachmentReadHint('note.mp3')).toMatch(/音频/)
    expect(attachmentReadHint('clip.mp4')).toMatch(/视频/)
  })
})
