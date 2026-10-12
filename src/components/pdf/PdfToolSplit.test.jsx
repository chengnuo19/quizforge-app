// @vitest-environment jsdom
import { afterEach, describe, it, expect } from 'vitest'
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { PDFDocument } from 'pdf-lib'
import PdfToolSplit from './PdfToolSplit.jsx'
import { loadPdf, pageCount } from '../../pdf/engine.js'

afterEach(cleanup)

async function makeDoc(n, code = 1) {
  const doc = await PDFDocument.create()
  for (let i = 1; i <= n; i++) doc.addPage([code * 100 + i, 200])
  return doc
}

function fileOf(id, name, doc) {
  return { id, name, pageCount: doc.getPageCount(), doc }
}

function downloadButtons() {
  return screen.getAllByRole('button', { name: '下载' })
}

describe('PdfToolSplit', () => {
  it('splits by explicit page ranges', async () => {
    const doc = await makeDoc(5, 1)
    const downloads = []
    render(
      <PdfToolSplit
        file={fileOf('f', '试卷.pdf', doc)}
        exportBytes={(bytes, name) => downloads.push({ bytes, name })}
      />,
    )
    fireEvent.change(screen.getByLabelText('页码区间'), { target: { value: '1-2, 4-5' } })
    fireEvent.click(screen.getByText('拆分'))
    await waitFor(() => expect(downloadButtons().length).toBe(2))

    // Download the first part → 2 pages, name *_split_1.pdf.
    fireEvent.click(downloadButtons()[0])
    expect(downloads.length).toBe(1)
    const part = await loadPdf(downloads[0].bytes)
    expect(pageCount(part)).toBe(2)
    expect(downloads[0].name).toMatch(/_split_1\.pdf$/)
  })

  it('splits every N pages', async () => {
    const doc = await makeDoc(10, 1)
    const downloads = []
    render(
      <PdfToolSplit
        file={fileOf('f', '课件.pdf', doc)}
        exportBytes={(bytes, name) => downloads.push({ bytes, name })}
      />,
    )
    fireEvent.click(screen.getByText('每 N 页一份'))
    fireEvent.change(screen.getByLabelText('每份页数'), { target: { value: '4' } })
    fireEvent.click(screen.getByText('拆分'))
    await waitFor(() => expect(downloadButtons().length).toBe(3)) // 4 + 4 + 2
  })

  it('shows a clear error for an out-of-range range', async () => {
    const doc = await makeDoc(5, 1)
    render(
      <PdfToolSplit file={fileOf('f', '试卷.pdf', doc)} exportBytes={() => {}} />,
    )
    fireEvent.change(screen.getByLabelText('页码区间'), { target: { value: '1-99' } })
    fireEvent.click(screen.getByText('拆分'))
    await waitFor(() => expect(screen.getByText(/99 超出范围（文档共 5 页）/)).toBeTruthy())
  })
})
