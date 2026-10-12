import { describe, it, expect } from 'vitest'
import {
  splitExt,
  lastSegment,
  sanitizeFilename,
  dedupeFilename,
  outputFilename,
} from './filename.js'

describe('splitExt', () => {
  it('splits base and extension', () => {
    expect(splitExt('foo.pdf')).toEqual({ base: 'foo', ext: '.pdf' })
    expect(splitExt('noext')).toEqual({ base: 'noext', ext: '' })
  })
})

describe('lastSegment', () => {
  it('returns the trailing path segment', () => {
    expect(lastSegment('C:\\dir\\sub\\文件.pdf')).toBe('文件.pdf')
    expect(lastSegment('/home/user/a b.pdf')).toBe('a b.pdf')
  })
})

describe('sanitizeFilename', () => {
  it('keeps Chinese filenames', () => {
    expect(sanitizeFilename('高等数学-第二章.pdf')).toBe('高等数学-第二章.pdf')
  })

  it('strips illegal characters', () => {
    expect(sanitizeFilename('我的 试卷:final?.pdf')).toBe('我的 试卷final.pdf')
  })

  it('collapses a full path to the file name', () => {
    expect(sanitizeFilename('C:\\试题库\\普通物理：上册.pdf')).toBe('普通物理：上册.pdf')
  })

  it('prefixes Windows reserved names', () => {
    expect(sanitizeFilename('con.pdf')).toBe('_con.pdf')
    expect(sanitizeFilename('CON.pdf')).toBe('_CON.pdf')
  })

  it('trims trailing dots and spaces', () => {
    expect(sanitizeFilename('quiz...pdf')).toBe('quiz.pdf')
    expect(sanitizeFilename('quiz   .pdf')).toBe('quiz.pdf')
  })

  it('truncates very long names while keeping the extension', () => {
    const long = `${'题'.repeat(300)}.pdf`
    const out = sanitizeFilename(long, { maxLen: 120 })
    expect(out.length).toBe(120)
    expect(out.endsWith('.pdf')).toBe(true)
  })
})

describe('dedupeFilename', () => {
  it('returns the name when unused', () => {
    expect(dedupeFilename('a.pdf', new Set(['b.pdf']))).toBe('a.pdf')
  })

  it('appends (1), (2), … on collision', () => {
    const taken = new Set(['a.pdf', 'a (1).pdf'])
    expect(dedupeFilename('a.pdf', taken)).toBe('a (2).pdf')
  })

  it('appends before the extension', () => {
    expect(dedupeFilename('我的测验.pdf', new Set(['我的测验.pdf']))).toBe(
      '我的测验 (1).pdf',
    )
  })
})

describe('outputFilename', () => {
  it('builds <base>_processed.pdf by default', () => {
    expect(outputFilename('试卷.pdf')).toBe('试卷_processed.pdf')
  })

  it('supports a custom suffix', () => {
    expect(outputFilename('试卷.pdf', { suffix: '_split_1' })).toBe('试卷_split_1.pdf')
  })

  it('sanitizes the source name first', () => {
    expect(outputFilename('试卷:最终版.pdf')).toBe('试卷最终版_processed.pdf')
  })
})
