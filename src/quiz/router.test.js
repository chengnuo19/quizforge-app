import { describe, it, expect } from 'vitest'
import { parseHash, libraryHash, bookHash, playHash, markitdownHash, mediaDownloaderHash } from './router.js'

describe('router', () => {
  it('parses an empty hash as the library view', () => {
    expect(parseHash('')).toEqual({ view: 'library' })
    expect(parseHash('#')).toEqual({ view: 'library' })
  })

  it('parses the MarkItDown route', () => {
    expect(parseHash('#markitdown')).toEqual({ view: 'markitdown' })
  })

  it('builds the MarkItDown route', () => {
    expect(markitdownHash()).toBe('#markitdown')
  })

  it('parses and builds the media downloader route', () => {
    expect(parseHash('#media-downloader')).toEqual({ view: 'media-downloader' })
    expect(mediaDownloaderHash()).toBe('#media-downloader')
  })

  it('parses a book hash', () => {
    expect(parseHash('#book=builtin:算法')).toEqual({
      view: 'book',
      bookId: 'builtin:算法',
    })
  })

  it('parses a play hash, splitting on the first slash only', () => {
    // Built-in quiz ids are full paths containing slashes.
    const h = playHash('builtin:数据结构', '/content/数据结构/排序.md')
    expect(parseHash(h)).toEqual({
      view: 'play',
      bookId: 'builtin:数据结构',
      quizId: '/content/数据结构/排序.md',
    })
  })

  it('parses a shared hash', () => {
    expect(parseHash('#q=ABC123')).toEqual({ view: 'shared', shared: 'ABC123' })
  })

  it('round-trips through the hash builders', () => {
    expect(parseHash(libraryHash())).toEqual({ view: 'library' })
    expect(parseHash(bookHash('user:abc'))).toEqual({ view: 'book', bookId: 'user:abc' })
    expect(parseHash(playHash('user:abc', 'q1'))).toEqual({
      view: 'play',
      bookId: 'user:abc',
      quizId: 'q1',
    })
  })

  it('falls back to library on a malformed play hash', () => {
    expect(parseHash('#play=noSlashHere')).toEqual({ view: 'library' })
  })
})
