// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest'
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { PDFDocument } from 'pdf-lib'
import PdfWorkbench from './PdfWorkbench.jsx'

// Mock the pdf.js renderer so the virtual grid renders deterministically in
// jsdom (no real worker / canvas needed). ThumbCache stays real.
vi.mock('../../pdf/renderer.js', async (importOriginal) => {
  const mod = await importOriginal()
  return {
    ...mod,
    openPdf: vi.fn(async () => ({ pdf: { fake: true }, numPages: 3, destroy: vi.fn() })),
    renderPageToDataUrl: vi.fn(async () => 'data:image/jpeg;base64,ZmFrZQ=='),
  }
})

afterEach(cleanup)

async function makePdfBytes(n = 3) {
  const doc = await PDFDocument.create()
  for (let i = 0; i < n; i++) doc.addPage([200, 200])
  return new Uint8Array(await doc.save())
}

function makeFile(name, bytes) {
  return new File([bytes], name, { type: 'application/pdf' })
}

describe('PdfWorkbench', () => {
  it('renders the tool rail', () => {
    render(<PdfWorkbench onExit={() => {}} />)
    for (const label of ['整理页面', '合并 PDF', '拆分 PDF', '压缩 PDF', '图片转换', '准备测验']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeTruthy()
    }
  })

  it('shows the dropzone when empty', () => {
    render(<PdfWorkbench onExit={() => {}} />)
    expect(screen.getByText(/拖拽 PDF 到这里/)).toBeTruthy()
  })

  it('loads a dropped PDF and shows its page count', async () => {
    const bytes = await makePdfBytes(4)
    const file = makeFile('高等数学测验.pdf', bytes)
    render(<PdfWorkbench onExit={() => {}} />)

    const input = document.querySelector('.pdfwb-dropzone input[type="file"]')
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      // The name appears in the file card, canvas subtitle and properties panel.
      expect(screen.getAllByText('高等数学测验.pdf').length).toBeGreaterThanOrEqual(1)
      // One virtualized thumbnail tile per page in the grid.
      expect(document.querySelectorAll('.pdfwb-tile').length).toBe(4)
    })
  })

  it('shows a clear error for a corrupt PDF without blocking others', async () => {
    const bad = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]) // "%PDF-"
    const good = await makePdfBytes(2)
    render(<PdfWorkbench onExit={() => {}} />)

    const input = document.querySelector('.pdfwb-dropzone input[type="file"]')
    fireEvent.change(input, {
      target: { files: [makeFile('损坏.pdf', bad), makeFile('正常.pdf', good)] },
    })

    await waitFor(() => {
      // Error shows on the bad file card (and the properties panel).
      expect(screen.getAllByText(/无法解析这个 PDF/).length).toBeGreaterThanOrEqual(1)
      // The good file still loads and reports its 2 pages in its own card.
      expect(screen.getAllByText(/2 页 ·/).length).toBeGreaterThanOrEqual(1)
    })
  })

  it('rejects non-PDF files with a clear message', async () => {
    const notPdf = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    render(<PdfWorkbench onExit={() => {}} />)
    const input = document.querySelector('.pdfwb-dropzone input[type="file"]')
    fireEvent.change(input, { target: { files: [notPdf] } })
    await waitFor(() =>
      expect(screen.getAllByText(/不是 PDF 文件/).length).toBeGreaterThanOrEqual(1),
    )
  })
})
