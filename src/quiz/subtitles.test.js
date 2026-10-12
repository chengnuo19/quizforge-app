import { describe, it, expect, vi } from 'vitest'
import {
  detectLang,
  resegment,
  needsTranslation,
  translateSegments,
  toSrt,
  toAss,
  formatSrtTime,
  formatAssTime,
  resolveLayout,
} from './subtitles.js'

const settings = { apiKey: 'k', baseUrl: 'https://api.example.com/v1', model: 'm' }

function words(list) {
  return list.map(([word, start, end]) => ({ word, start, end }))
}

function replyFetch(builder) {
  return vi.fn(async (_url, init) => {
    const items = JSON.parse(JSON.parse(init.body).messages[1].content).items
    return { ok: true, json: async () => ({ choices: [{ message: { content: builder(items) } }] }) }
  })
}

describe('detectLang', () => {
  it('detects Chinese, English and mixed lines', () => {
    expect(detectLang('今天我们讲一下')).toBe('zh')
    expect(detectLang('Hello everyone, welcome back')).toBe('en')
    expect(detectLang('这个 API 很好用')).toBe('zh')
    expect(detectLang('')).toBe('en')
  })
})

describe('resegment', () => {
  it('splits long English segments at sentence ends and length limits', () => {
    const seg = {
      start: 0,
      end: 8,
      text: 'Hello world. This is a very long sentence that keeps going on and on.',
      words: words([
        [' Hello', 0, 0.4], [' world.', 0.4, 0.9],
        [' This', 1, 1.2], [' is', 1.2, 1.3], [' a', 1.3, 1.4], [' very', 1.4, 1.7], [' long', 1.7, 2],
        [' sentence', 2, 2.5], [' that', 2.5, 2.7], [' keeps', 2.7, 3], [' going', 3, 3.3],
        [' on', 3.3, 3.5], [' and', 3.5, 3.7], [' on.', 3.7, 4],
      ]),
    }
    const cues = resegment([seg])
    expect(cues[0].text).toBe('Hello world.')
    expect(cues.every((c) => c.text.length <= 42)).toBe(true)
    expect(cues.map((c) => c.text).join(' ')).toBe(seg.text)
    expect(cues.map((c) => c.id)).toEqual(cues.map((_, i) => i + 1))
    expect(cues.every((c) => c.lang === 'en' && c.translation === '')).toBe(true)
  })

  it('keeps Chinese cues within 16 characters', () => {
    const chars = '我们今天来聊一聊如何把一个小时的视频自动加上双语字幕'.split('')
    const seg = { start: 0, end: 6, text: chars.join(''), words: chars.map((c, i) => ({ word: c, start: i * 0.2, end: i * 0.2 + 0.2 })) }
    const cues = resegment([seg])
    expect(cues.length).toBeGreaterThan(1)
    expect(cues.every((c) => c.text.length <= 16 && c.lang === 'zh')).toBe(true)
  })

  it('breaks on long pauses, extends very short cues and never overlaps the next one', () => {
    const seg = { start: 0, end: 5, text: 'Yes. Okay', words: words([[' Yes.', 0, 0.3], [' Okay', 4, 4.4]]) }
    const cues = resegment([seg])
    expect(cues).toHaveLength(2)
    expect(cues[0].end).toBe(1)
    expect(cues[0].end).toBeLessThanOrEqual(cues[1].start)
  })

  it('falls back to the whole segment when there are no word timestamps', () => {
    expect(resegment([{ start: 1, end: 3, text: ' 你好 ', words: [] }])[0]).toMatchObject({ start: 1, end: 3, text: '你好', lang: 'zh' })
  })
})

describe('needsTranslation', () => {
  it('depends on the target mode', () => {
    expect(needsTranslation({ lang: 'zh', translation: '' }, 'zh')).toBe(false)
    expect(needsTranslation({ lang: 'zh', translation: '' }, 'en')).toBe(true)
    expect(needsTranslation({ lang: 'zh', translation: '' }, 'bilingual')).toBe(true)
    expect(needsTranslation({ lang: 'en', translation: '你好' }, 'bilingual')).toBe(false)
  })
})

describe('translateSegments', () => {
  const segs = [
    { id: 1, start: 0, end: 1, lang: 'en', text: 'Hello', translation: '' },
    { id: 2, start: 1, end: 2, lang: 'zh', text: '你好', translation: '' },
    { id: 3, start: 2, end: 3, lang: 'en', text: 'Bye', translation: '再见' },
  ]

  it('translates only pending cues in batches and reports progress', async () => {
    const fetchImpl = replyFetch((items) => JSON.stringify(items.map((it) => ({ i: it.i, t: `T:${it.text}` }))))
    const onProgress = vi.fn()
    const result = await translateSegments(segs, { settings, fetchImpl, batchSize: 1, onProgress })
    expect(result.map((s) => s.translation)).toEqual(['T:Hello', 'T:你好', '再见'])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.example.com/v1/chat/completions')
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ done: 2, total: 2 }))
    expect(segs[0].translation).toBe('')
  })

  it('accepts fenced JSON and splits the batch when the count is wrong', async () => {
    const fetchImpl = replyFetch((items) => {
      const list = items.length > 1 ? items.slice(1) : items
      return '```json\n' + JSON.stringify(list.map((it) => ({ i: it.i, t: `T:${it.text}` }))) + '\n```'
    })
    const result = await translateSegments(segs, { settings, fetchImpl })
    expect(result.map((s) => s.translation)).toEqual(['T:Hello', 'T:你好', '再见'])
  })

  it('requires an API key and surfaces HTTP errors', async () => {
    await expect(translateSegments(segs, { settings: { apiKey: '' } })).rejects.toThrow('未配置 AI API Key')
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: { message: 'bad key' } }) })
    await expect(translateSegments(segs, { settings, fetchImpl })).rejects.toThrow('HTTP 401')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('formatting', () => {
  const segs = [
    { start: 0, end: 1.5, lang: 'en', text: 'Hello', translation: '你好' },
    { start: 3661.25, end: 3662, lang: 'zh', text: '谢谢{大家}', translation: 'Thanks' },
  ]

  it('formats times', () => {
    expect(formatSrtTime(3661.25)).toBe('01:01:01,250')
    expect(formatAssTime(3661.256)).toBe('1:01:01.26')
  })

  it('writes SRT for each mode', () => {
    expect(toSrt(segs, 'bilingual')).toBe('1\n00:00:00,000 --> 00:00:01,500\n你好\nHello\n\n2\n01:01:01,250 --> 01:01:02,000\n谢谢{大家}\nThanks\n')
    expect(toSrt(segs, 'zh')).toContain('\n你好\n')
    expect(toSrt(segs, 'en')).toContain('\nThanks\n')
  })

  it('writes ASS with Chinese on top, English below and escaped braces', () => {
    const ass = toAss(segs, 'bilingual', { width: 1080, height: 1920 })
    expect(ass).toContain('PlayResX: 1080')
    expect(ass).toContain('Dialogue: 0,0:00:00.00,0:00:01.50,Main,,0,0,0,,你好\\N{\\rSub}Hello')
    expect(ass).toContain('谢谢（大家）')
    expect(ass).toMatch(/Style: Main,.*,346,1$/m)
    expect(toAss(segs, 'en', { width: 1920, height: 1080 })).toMatch(/Style: Main,.*,65,1$/m)
  })

  it('resolves layout from the frame unless overridden', () => {
    expect(resolveLayout(1080, 1920)).toBe('vertical')
    expect(resolveLayout(1920, 1080)).toBe('horizontal')
    expect(resolveLayout(1920, 1080, 'vertical')).toBe('vertical')
  })
})
