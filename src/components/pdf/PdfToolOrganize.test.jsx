// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest'
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { PDFDocument } from 'pdf-lib'
import PdfToolOrganize from './PdfToolOrganize.jsx'
import { loadPdf, pageCount } from '../../pdf/engine.js'

// Thumbnails render through the pdf.js renderer — mock it so the grid is
// deterministic in jsdom. The organize LOGIC works on file.doc (pdf-lib).
vi.mock('../../pdf/renderer.js', async (importOriginal) => {
  const mod = await importOriginal()
  return {
    ...mod,
    openPdf: vi.fn(async () => ({ pdf: { fake: true }, numPages: 5, destroy: vi.fn() })),
    renderPageToDataUrl: vi.fn(async () => 'data:image/jpeg;base64,ZmFrZQ=='),
  }
})

afterEach(cleanup)

async function makeDoc(n, code = 1) {
  const doc = await PDFDocument.create()
  for (let i = 1; i <= n; i++) doc.addPage([code * 100 + i, 200])
  return doc
}

function fileOf(name, doc) {
  return { id: 'f1', name, pageCount: doc.getPageCount(), doc, renderProxy: { pdf: { fake: true } } }
}

function tiles() {
  return [...document.querySelectorAll('.pdfwb-tile')]
}

async function exportedWidths(downloads) {
  const doc = await loadPdf(downloads[0].bytes)
  return doc.getPages().map((p) => p.getWidth())
}

describe('PdfToolOrganize', () => {
  it('renders one tile per page', async () => {
    const doc = await makeDoc(5, 1)
    render(<PdfToolOrganize file={fileOf('甲.pdf', doc)} exportBytes={() => {}} />)
    await waitFor(() => expect(tiles().length).toBe(5))
  })

  it('deletes the selected page and exports the rest', async () => {
    const doc = await makeDoc(5, 1)
    const downloads = []
    render(<PdfToolOrganize file={fileOf('甲.pdf', doc)} exportBytes={(bytes, name) => downloads.push({ bytes, name })} />)
    await waitFor(() => expect(tiles().length).toBe(5))

    fireEvent.click(tiles()[0]) // select page 1
    fireEvent.click(screen.getByText('删除'))
    await waitFor(() => expect(tiles().length).toBe(4))

    fireEvent.click(screen.getByText('导出 PDF'))
    await waitFor(() => expect(downloads.length).toBe(1))
    expect(downloads[0].name).toMatch(/_organized\.pdf$/)
    expect(await exportedWidths(downloads)).toEqual([102, 103, 104, 105])
  })

  it('rotates the selected page and exports the rotation', async () => {
    const doc = await makeDoc(3, 1)
    const downloads = []
    render(<PdfToolOrganize file={fileOf('乙.pdf', doc)} exportBytes={(bytes) => downloads.push(bytes)} />)
    await waitFor(() => expect(tiles().length).toBe(3))

    fireEvent.click(tiles()[1]) // select page 2
    fireEvent.click(screen.getByText('旋转 90°'))
    fireEvent.click(screen.getByText('导出 PDF'))
    await waitFor(() => expect(downloads.length).toBe(1))

    const out = await loadPdf(downloads[0])
    expect(out.getPage(0).getRotation().angle).toBe(0)
    expect(out.getPage(1).getRotation().angle).toBe(90)
  })

  it('duplicates the selected page at the end', async () => {
    const doc = await makeDoc(3, 1)
    render(<PdfToolOrganize file={fileOf('丙.pdf', doc)} exportBytes={() => {}} />)
    await waitFor(() => expect(tiles().length).toBe(3))

    fireEvent.click(tiles()[0]) // select page 1
    fireEvent.click(screen.getByText('复制'))
    await waitFor(() => expect(tiles().length).toBe(4))
  })

  it('multi-select then extract exports only the selected pages', async () => {
    const doc = await makeDoc(5, 1)
    const downloads = []
    render(<PdfToolOrganize file={fileOf('丁.pdf', doc)} exportBytes={(bytes) => downloads.push({ bytes })} />)
    await waitFor(() => expect(tiles().length).toBe(5))

    fireEvent.click(tiles()[1]) // page 2
    fireEvent.click(tiles()[3], { ctrlKey: true }) // page 4 (additive)
    fireEvent.click(screen.getByText('提取选中'))
    await waitFor(() => expect(downloads.length).toBe(1))

    expect(await exportedWidths(downloads)).toEqual([102, 104])
  })

  it('shows a hint when no file is usable', () => {
    render(<PdfToolOrganize file={null} exportBytes={() => {}} />)
    expect(screen.getByText(/请先加载一个 PDF 文件/)).toBeTruthy()
  })
})
