// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest'
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import PdfToolPrepareQuiz from './PdfToolPrepareQuiz.jsx'

vi.mock('../../pdf/renderer.js', async (importOriginal) => {
  const mod = await importOriginal()
  return {
    ...mod,
    openPdf: vi.fn(),
    renderPageToDataUrl: vi.fn(async () => 'data:image/jpeg;base64,ZmFrZQ=='),
  }
})

// Reuse-of-pipeline: the component calls the SAME ai.js function the rest of
// QuizForge uses; here we stub the network call.
vi.mock('../../quiz/ai.js', () => ({
  convertImagesToMarkdown: vi.fn(async (images, onProgress) => {
    if (onProgress) onProgress('working…')
    return '## 问题\n- [x] 答案A\n- [ ] 答案B'
  }),
}))

vi.mock('../../quiz/books.js', () => ({
  listBooks: vi.fn(() => []),
  createBook: vi.fn(({ name }) => ({ id: 'new-book', name })),
  addQuizToBook: vi.fn(),
}))

vi.mock('../../quiz/storage.js', () => ({
  loadAiSettings: vi.fn(() => ({ apiKey: 'test-key' })),
}))

afterEach(cleanup)

function fileOf(pageCount) {
  return { id: 'f1', name: '高等数学.pdf', pageCount, doc: {}, renderProxy: { pdf: { fake: true } } }
}

describe('PdfToolPrepareQuiz', () => {
  it('sends only the checked pages to the existing AI pipeline', async () => {
    const ai = await import('../../quiz/ai.js')
    const books = await import('../../quiz/books.js')
    render(<PdfToolPrepareQuiz file={fileOf(3)} />)

    expect(screen.getByText(/已选 3 页/)).toBeTruthy()
    // Deselect page 1.
    fireEvent.click(document.querySelectorAll('.pdfwb-tile')[0])
    expect(screen.getByText(/已选 2 页/)).toBeTruthy()

    fireEvent.click(screen.getByText('Generate Quiz from Selected Pages'))
    await waitFor(() => expect(screen.getByText(/共 1 道题/)).toBeTruthy())

    expect(ai.convertImagesToMarkdown).toHaveBeenCalledTimes(1)
    const imagesSent = ai.convertImagesToMarkdown.mock.calls[0][0]
    expect(imagesSent.length).toBe(2) // only pages 2 and 3

    fireEvent.click(screen.getByText('导入到笔记本'))
    await waitFor(() => expect(books.addQuizToBook).toHaveBeenCalledTimes(1))
    const [bookId, source] = books.addQuizToBook.mock.calls[0]
    expect(bookId).toBe('new-book')
    expect(source).toContain('## 问题')
  })

  it('warns when no page is checked', async () => {
    render(<PdfToolPrepareQuiz file={fileOf(2)} />)
    fireEvent.click(document.querySelectorAll('.pdfwb-tile')[0])
    fireEvent.click(document.querySelectorAll('.pdfwb-tile')[1])
    fireEvent.click(screen.getByText('Generate Quiz from Selected Pages'))
    await waitFor(() => expect(screen.getByText(/请至少勾选一页/)).toBeTruthy())
  })

  it('warns when no AI key is configured', async () => {
    const storage = vi.mocked(await import('../../quiz/storage.js'))
    storage.loadAiSettings.mockReturnValue({ apiKey: '' })
    render(<PdfToolPrepareQuiz file={fileOf(1)} />)
    expect(screen.getByText(/未配置 AI：/)).toBeTruthy()
  })
})
