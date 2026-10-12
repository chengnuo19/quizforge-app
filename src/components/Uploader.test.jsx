// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import Uploader from './Uploader.jsx'

vi.mock('../quiz/ai.js', () => ({
  convertImagesToMarkdown: vi.fn(),
  convertMarkdownToQuizMarkdown: vi.fn(),
}))

vi.mock('../quiz/pdfHelper.js', () => ({
  convertPdfToImages: vi.fn(),
}))

const ai = await import('../quiz/ai.js')

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Uploader', () => {
  it('runs AI cleanup only when the user clicks the cleanup button', async () => {
    ai.convertMarkdownToQuizMarkdown.mockResolvedValue('## Q\n- [x] A\n- [ ] B')

    render(<Uploader onLoad={() => {}} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '# Notes' } })
    fireEvent.click(screen.getByText('用 AI 整理成测验'))

    await waitFor(() => {
      const value = screen.getByRole('textbox').value
      expect(value).toContain('## Q')
      expect(value).toContain('- [x] A')
      expect(value).toContain('- [ ] B')
    })
  })
})
