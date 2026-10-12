// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MarkitdownPanel from './MarkitdownPanel.jsx'

vi.mock('../quiz/markitdown.js', () => ({
  DEFAULT_ENGINE: 'markitdown',
  ENGINES: [
    { id: 'markitdown', label: 'MarkItDown', hint: '快 · 轻量' },
    { id: 'docling', label: 'Docling', hint: '慢 · 版面分析' },
  ],
  engineLabel: (id) => (id === 'docling' ? 'Docling' : 'MarkItDown'),
  canUseMarkitdown: vi.fn(),
  canSelectEngine: vi.fn(),
  selectAndConvertWithEngine: vi.fn(),
  saveMarkdownWithMarkitdown: vi.fn(),
  onConvertProgress: vi.fn(() => () => {}),
}))

vi.mock('../quiz/books.js', () => ({
  createBook: vi.fn(({ name }) => ({ id: `book:${name}`, name })),
  listBooks: vi.fn(() => [{ id: 'book-a', name: '线性代数', builtin: false }]),
}))

vi.mock('../quiz/resources.js', () => ({
  appendResource: vi.fn(resource => resource),
  createDocumentResource: vi.fn(input => ({
    id: 'qfr_doc',
    type: 'document',
    notebookId: input.notebookId,
    notebookName: input.notebookName,
    title: input.title || 'linear',
    contentMarkdown: input.markdown,
    sourcePath: input.sourcePath,
    sourceSite: input.sourceSite,
  })),
  getDocumentResourceTitle: vi.fn(() => 'linear'),
}))

const markitdown = await import('../quiz/markitdown.js')
const resources = await import('../quiz/resources.js')

beforeEach(() => {
  markitdown.canUseMarkitdown.mockReturnValue(true)
  markitdown.canSelectEngine.mockReturnValue(true)
  markitdown.onConvertProgress.mockImplementation(() => () => {})
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('MarkitdownPanel', () => {
  it('shows a desktop-only unavailable message outside the desktop app', () => {
    markitdown.canUseMarkitdown.mockReturnValue(false)

    render(<MarkitdownPanel onExit={() => {}} />)

    expect(screen.getByText(/desktop app/)).toBeTruthy()
  })

  it('converts a selected file and previews editable Markdown', async () => {
    markitdown.selectAndConvertWithEngine.mockResolvedValue({
      path: 'C:\\notes\\linear.docx',
      markdown: '# Linear algebra',
      engine: 'markitdown',
    })

    render(<MarkitdownPanel onExit={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '选择文件并转换' }))

    await waitFor(() => {
      expect(screen.getByRole('textbox').value).toBe('# Linear algebra')
    })
    expect(screen.getByText('C:\\notes\\linear.docx')).toBeTruthy()
    expect(markitdown.selectAndConvertWithEngine).toHaveBeenCalledWith('markitdown', { ocr: false })
  })

  it('saves converted Markdown as an md file', async () => {
    markitdown.selectAndConvertWithEngine.mockResolvedValue({
      path: 'C:\\notes\\linear.docx',
      markdown: '# Linear algebra',
      engine: 'markitdown',
    })
    markitdown.saveMarkdownWithMarkitdown.mockResolvedValue({ path: 'C:\\notes\\linear.md' })

    render(<MarkitdownPanel onExit={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '选择文件并转换' }))
    await screen.findByText('C:\\notes\\linear.docx')
    fireEvent.click(screen.getByRole('button', { name: '保存为 .md' }))

    await waitFor(() => {
      expect(markitdown.saveMarkdownWithMarkitdown).toHaveBeenCalledWith({
        defaultFileName: 'linear.md',
        markdown: '# Linear algebra',
      })
      expect(screen.getByText(/已保存/)).toBeTruthy()
    })
  })

  it('imports converted Markdown into notebook resources', async () => {
    markitdown.selectAndConvertWithEngine.mockResolvedValue({
      path: 'C:\\notes\\linear.docx',
      markdown: '# Linear algebra',
      engine: 'markitdown',
    })

    render(<MarkitdownPanel onExit={() => {}} onResourcesChange={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '选择文件并转换' }))
    await screen.findByText('C:\\notes\\linear.docx')
    fireEvent.click(screen.getByRole('button', { name: '导入到笔记本资料' }))

    await waitFor(() => {
      expect(resources.createDocumentResource).toHaveBeenCalledWith({
        notebookId: 'book-a',
        notebookName: '线性代数',
        title: 'linear',
        markdown: '# Linear algebra',
        sourcePath: 'C:\\notes\\linear.docx',
        sourceSite: 'MarkItDown',
      })
      expect(resources.appendResource).toHaveBeenCalled()
      expect(screen.getByText(/已导入资料/)).toBeTruthy()
    })
  })

  it('converts with Docling and offers an OCR toggle for scans', async () => {
    markitdown.selectAndConvertWithEngine.mockResolvedValue({
      path: 'C:\\notes\\exam.pdf',
      markdown: '# Exam',
      engine: 'docling',
    })

    render(<MarkitdownPanel onExit={() => {}} />)
    expect(screen.queryByRole('checkbox')).toBeNull()

    fireEvent.click(screen.getByRole('radio', { name: /Docling/ }))
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: '选择文件并转换' }))

    await waitFor(() => {
      expect(markitdown.selectAndConvertWithEngine).toHaveBeenCalledWith('docling', { ocr: true })
    })
  })

  it('warns when Docling fell back to the slow one-shot path', async () => {
    markitdown.selectAndConvertWithEngine.mockResolvedValue({
      path: 'C:\\notes\\exam.pdf',
      markdown: '# Exam',
      engine: 'docling',
      via: 'cli',
    })

    render(<MarkitdownPanel onExit={() => {}} />)
    fireEvent.click(screen.getByRole('radio', { name: /Docling/ }))
    fireEvent.click(screen.getByRole('button', { name: '选择文件并转换' }))

    expect(await screen.findByText(/docling-serve/)).toBeTruthy()
  })

  it('stays quiet when Docling used the warm service', async () => {
    markitdown.selectAndConvertWithEngine.mockResolvedValue({
      path: 'C:\\notes\\exam.pdf',
      markdown: '# Exam',
      engine: 'docling',
      via: 'serve',
    })

    render(<MarkitdownPanel onExit={() => {}} />)
    fireEvent.click(screen.getByRole('radio', { name: /Docling/ }))
    fireEvent.click(screen.getByRole('button', { name: '选择文件并转换' }))

    await screen.findByText('C:\\notes\\exam.pdf')
    expect(screen.queryByText(/docling-serve/)).toBeNull()
  })

  it('records Docling as the source of the imported resource', async () => {
    markitdown.selectAndConvertWithEngine.mockResolvedValue({
      path: 'C:\\notes\\exam.pdf',
      markdown: '# Exam',
      engine: 'docling',
    })

    render(<MarkitdownPanel onExit={() => {}} />)
    fireEvent.click(screen.getByRole('radio', { name: /Docling/ }))
    fireEvent.click(screen.getByRole('button', { name: '选择文件并转换' }))
    await screen.findByText('C:\\notes\\exam.pdf')
    fireEvent.click(screen.getByRole('button', { name: '导入到笔记本资料' }))

    await waitFor(() => {
      expect(resources.createDocumentResource).toHaveBeenCalledWith(
        expect.objectContaining({ sourceSite: 'Docling' })
      )
    })
  })

  it('hides the engine picker on a desktop shell that only knows MarkItDown', () => {
    markitdown.canSelectEngine.mockReturnValue(false)

    render(<MarkitdownPanel onExit={() => {}} />)

    expect(screen.queryByRole('radio')).toBeNull()
    expect(screen.getByRole('button', { name: '选择文件并转换' })).toBeTruthy()
  })

  it('shows streamed conversion progress while a slow engine runs', async () => {
    let progressCallback
    markitdown.onConvertProgress.mockImplementation((cb) => {
      progressCallback = cb
      return () => {}
    })
    let finishConvert
    markitdown.selectAndConvertWithEngine.mockImplementation(
      () => new Promise(resolve => { finishConvert = resolve })
    )

    render(<MarkitdownPanel onExit={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '选择文件并转换' }))

    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy())
    act(() => progressCallback('Converting page 3'))
    expect(screen.getByRole('status').textContent).toContain('Converting page 3')

    await act(async () => {
      finishConvert(null)
    })
    expect(screen.queryByRole('status')).toBeNull()
  })
})
