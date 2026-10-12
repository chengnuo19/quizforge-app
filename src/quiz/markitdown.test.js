import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  canSelectEngine,
  canUseMarkitdown,
  onConvertProgress,
  selectAndConvertWithEngine,
  selectAndConvertWithMarkitdown,
  saveMarkdownWithMarkitdown,
} from './markitdown.js'

const originalWindow = globalThis.window

beforeEach(() => {
  globalThis.window = {}
})

afterEach(() => {
  globalThis.window = originalWindow
})

describe('markitdown adapter', () => {
  it('is unavailable without the desktop MarkItDown API', () => {
    expect(canUseMarkitdown()).toBe(false)
  })

  it('is available when window.markitdown exposes conversion and save APIs', () => {
    window.markitdown = {
      selectAndConvertFile: vi.fn(),
      saveMarkdownFile: vi.fn(),
    }

    expect(canUseMarkitdown()).toBe(true)
  })

  it('returns converted Markdown from the desktop API', async () => {
    window.markitdown = {
      selectAndConvertFile: vi.fn().mockResolvedValue({
        path: 'C:\\notes\\linear.docx',
        markdown: '# Linear algebra',
      }),
      saveMarkdownFile: vi.fn(),
    }

    await expect(selectAndConvertWithMarkitdown()).resolves.toEqual({
      path: 'C:\\notes\\linear.docx',
      markdown: '# Linear algebra',
    })
  })

  it('returns null when file selection is cancelled', async () => {
    window.markitdown = {
      selectAndConvertFile: vi.fn().mockResolvedValue(null),
      saveMarkdownFile: vi.fn(),
    }

    await expect(selectAndConvertWithMarkitdown()).resolves.toBeNull()
  })

  it('saves Markdown through the desktop API', async () => {
    window.markitdown = {
      selectAndConvertFile: vi.fn(),
      saveMarkdownFile: vi.fn().mockResolvedValue({ path: 'C:\\notes\\linear.md' }),
    }

    await expect(saveMarkdownWithMarkitdown({
      defaultFileName: 'linear.md',
      markdown: '# Linear algebra',
    })).resolves.toEqual({ path: 'C:\\notes\\linear.md' })
  })

  it('throws a clear error when the desktop API is missing', async () => {
    await expect(selectAndConvertWithMarkitdown()).rejects.toThrow(
      'MarkItDown is only available in the desktop app.'
    )
    await expect(saveMarkdownWithMarkitdown({
      defaultFileName: 'notes.md',
      markdown: '# Notes',
    })).rejects.toThrow('MarkItDown is only available in the desktop app.')
  })
})

describe('engine selection', () => {
  it('reports no engine choice on a shell that only knows MarkItDown', () => {
    window.markitdown = {
      selectAndConvertFile: vi.fn(),
      saveMarkdownFile: vi.fn(),
    }

    expect(canSelectEngine()).toBe(false)
  })

  it('reports an engine choice once the shell exposes the engine API', () => {
    window.markitdown = {
      selectAndConvertFile: vi.fn(),
      saveMarkdownFile: vi.fn(),
      selectAndConvertWithEngine: vi.fn(),
    }

    expect(canSelectEngine()).toBe(true)
  })

  it('passes the chosen engine and OCR flag through to the desktop API', async () => {
    const selectAndConvertWithEngineApi = vi.fn().mockResolvedValue({
      path: 'C:\\notes\\exam.pdf',
      markdown: '# Exam',
      engine: 'docling',
    })
    window.markitdown = {
      selectAndConvertFile: vi.fn(),
      saveMarkdownFile: vi.fn(),
      selectAndConvertWithEngine: selectAndConvertWithEngineApi,
    }

    await expect(selectAndConvertWithEngine('docling', { ocr: true })).resolves.toEqual({
      path: 'C:\\notes\\exam.pdf',
      markdown: '# Exam',
      engine: 'docling',
      via: 'cli',
    })
    expect(selectAndConvertWithEngineApi).toHaveBeenCalledWith({ engine: 'docling', ocr: true })
  })

  it('falls back to MarkItDown on an older shell without the engine API', async () => {
    const selectAndConvertFile = vi.fn().mockResolvedValue({
      path: 'C:\\notes\\linear.docx',
      markdown: '# Linear algebra',
    })
    window.markitdown = { selectAndConvertFile, saveMarkdownFile: vi.fn() }

    await expect(selectAndConvertWithEngine('docling')).resolves.toEqual({
      path: 'C:\\notes\\linear.docx',
      markdown: '# Linear algebra',
      engine: 'markitdown',
      via: 'cli',
    })
    expect(selectAndConvertFile).toHaveBeenCalled()
  })

  it('reports when the warm Docling service handled the conversion', async () => {
    window.markitdown = {
      selectAndConvertFile: vi.fn(),
      saveMarkdownFile: vi.fn(),
      selectAndConvertWithEngine: vi.fn().mockResolvedValue({
        path: 'C:\\notes\\exam.pdf',
        markdown: '# Exam',
        engine: 'docling',
        via: 'serve',
      }),
    }

    await expect(selectAndConvertWithEngine('docling')).resolves.toMatchObject({ via: 'serve' })
  })

  it('returns null when engine-aware file selection is cancelled', async () => {
    window.markitdown = {
      selectAndConvertFile: vi.fn(),
      saveMarkdownFile: vi.fn(),
      selectAndConvertWithEngine: vi.fn().mockResolvedValue(null),
    }

    await expect(selectAndConvertWithEngine('docling')).resolves.toBeNull()
  })

  it('subscribes to conversion progress, and no-ops when unsupported', () => {
    const unsubscribe = vi.fn()
    window.markitdown = {
      selectAndConvertFile: vi.fn(),
      saveMarkdownFile: vi.fn(),
      onConvertProgress: vi.fn(() => unsubscribe),
    }

    const callback = vi.fn()
    expect(onConvertProgress(callback)).toBe(unsubscribe)
    expect(window.markitdown.onConvertProgress).toHaveBeenCalledWith(callback)

    window.markitdown = { selectAndConvertFile: vi.fn(), saveMarkdownFile: vi.fn() }
    expect(typeof onConvertProgress(callback)).toBe('function')
  })
})
