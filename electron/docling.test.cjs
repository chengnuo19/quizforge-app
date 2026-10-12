import { describe, it, expect } from 'vitest'
const { EventEmitter } = require('events')
const {
  getDoclingCommand,
  buildDoclingArgs,
  readConvertedMarkdown,
  convertDocumentWithDocling,
} = require('./docling.cjs')

function fakeChild() {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = () => {}
  return child
}

// Minimal happy-path dependency set: one temp dir, one .md file, no real fs.
function fakeDeps(overrides = {}) {
  const removed = []
  return {
    removed,
    deps: {
      env: {},
      mkdtemp: async () => 'C:\\tmp\\quizforge-docling-abc',
      rm: async (dir) => {
        removed.push(dir)
      },
      readdir: async () => ['exam.md'],
      readFile: async () => '# Exam\n\n## 1. 题干\n',
      ...overrides,
    },
  }
}

describe('docling helper', () => {
  it('uses DOCLING_BIN when configured', () => {
    expect(getDoclingCommand({ DOCLING_BIN: 'C:\\tools\\docling.exe' }))
      .toBe('C:\\tools\\docling.exe')
  })

  it('falls back to the docling command on PATH', () => {
    expect(getDoclingCommand({})).toBe('docling')
  })

  it('renders Markdown into an output directory with OCR off by default', () => {
    expect(buildDoclingArgs('C:\\notes\\exam.pdf', 'C:\\tmp\\out')).toEqual([
      'convert',
      'C:\\notes\\exam.pdf',
      '--to',
      'md',
      '--output',
      'C:\\tmp\\out',
      '--no-ocr',
    ])
  })

  it('enables OCR when asked', () => {
    expect(buildDoclingArgs('C:\\notes\\scan.pdf', 'C:\\tmp\\out', { ocr: true }))
      .toContain('--ocr')
  })

  it('rejects when the selected file path is empty', async () => {
    await expect(convertDocumentWithDocling('')).rejects.toThrow(
      'No document file was selected.'
    )
  })

  it('converts a document and streams stderr lines as progress', async () => {
    const calls = []
    const progress = []
    const { deps, removed } = fakeDeps()

    const spawnImpl = (command, args, options) => {
      calls.push({ command, args, options })
      const child = fakeChild()
      setTimeout(() => {
        // \r is how the weight-loading bar redraws; blank runs are noise.
        child.stderr.emit('data', 'Converting page 1\n\rConverting page 2\n')
        child.emit('close', 0)
      }, 0)
      return child
    }

    await expect(convertDocumentWithDocling('C:\\notes\\exam.pdf', {
      ...deps,
      spawnImpl,
      onProgress: (line) => progress.push(line),
    })).resolves.toBe('# Exam\n\n## 1. 题干')

    expect(calls[0].command).toBe('docling')
    expect(calls[0].args[0]).toBe('convert')
    expect(calls[0].args).toContain('--output')
    expect(calls[0].options.shell).toBe(false)
    expect(calls[0].options.windowsHide).toBe(true)
    // Non-ASCII filenames come back as mojibake unless Python is forced to UTF-8.
    expect(calls[0].options.env.PYTHONUTF8).toBe('1')
    expect(calls[0].options.env.PYTHONIOENCODING).toBe('utf-8')
    // Blank runs and \r redraws are both collapsed away.
    expect(progress).toEqual(['Converting page 1', 'Converting page 2'])
    expect(removed).toEqual(['C:\\tmp\\quizforge-docling-abc'])
  })

  it('converts missing command errors into setup guidance', async () => {
    const { deps } = fakeDeps()
    const spawnImpl = () => {
      const child = fakeChild()
      setTimeout(() => {
        const err = new Error('spawn docling ENOENT')
        err.code = 'ENOENT'
        child.emit('error', err)
      }, 0)
      return child
    }

    await expect(convertDocumentWithDocling('C:\\notes\\exam.pdf', { ...deps, spawnImpl }))
      .rejects.toThrow('Docling was not found')
  })

  it('surfaces stderr detail when docling exits non-zero', async () => {
    const { deps } = fakeDeps()
    const spawnImpl = () => {
      const child = fakeChild()
      setTimeout(() => {
        child.stderr.emit('data', 'Unsupported format\n')
        child.emit('close', 1)
      }, 0)
      return child
    }

    await expect(convertDocumentWithDocling('C:\\notes\\exam.xyz', { ...deps, spawnImpl }))
      .rejects.toThrow('Unsupported format')
  })

  it('cleans up the temp directory even when the conversion fails', async () => {
    const { deps, removed } = fakeDeps()
    const spawnImpl = () => {
      const child = fakeChild()
      setTimeout(() => child.emit('close', 1), 0)
      return child
    }

    await expect(convertDocumentWithDocling('C:\\notes\\exam.pdf', { ...deps, spawnImpl }))
      .rejects.toThrow()
    expect(removed).toEqual(['C:\\tmp\\quizforge-docling-abc'])
  })

  it('reads back the largest Markdown file docling wrote', async () => {
    await expect(readConvertedMarkdown('C:\\tmp\\out', {
      readdir: async () => ['exam.md', 'exam-notes.md', 'exam.json'],
      readFile: async (filePath) =>
        filePath.endsWith('exam.md') ? '# Full document body' : '# Side',
    })).resolves.toBe('# Full document body')
  })

  it('fails clearly when docling wrote no Markdown', async () => {
    await expect(readConvertedMarkdown('C:\\tmp\\out', {
      readdir: async () => ['exam.json'],
      readFile: async () => '',
    })).rejects.toThrow('Docling produced no Markdown output.')
  })
})
