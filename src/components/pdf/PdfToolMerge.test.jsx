// @vitest-environment jsdom
import { afterEach, describe, it, expect } from 'vitest'
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { PDFDocument } from 'pdf-lib'
import PdfToolMerge from './PdfToolMerge.jsx'
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

describe('PdfToolMerge', () => {
  it('merges two files in order (A+B → combined pages)', async () => {
    const a = await makeDoc(2, 1)
    const b = await makeDoc(3, 2)
    const downloads = []
    render(
      <PdfToolMerge
        files={[fileOf('a', '甲.pdf', a), fileOf('b', '乙.pdf', b)]}
        exportBytes={(bytes, name) => downloads.push({ bytes, name })}
      />,
    )
    fireEvent.click(screen.getByText('合并 PDF'))
    await waitFor(() => expect(downloads.length).toBe(1))

    const doc = await loadPdf(downloads[0].bytes)
    expect(pageCount(doc)).toBe(5)
    expect(downloads[0].name).toMatch(/_merged\.pdf$/)
    // Page order preserved: widths 101,102 then 201,202,203.
    expect(doc.getPages().map((p) => p.getWidth())).toEqual([101, 102, 201, 202, 203])
  })

  it('honors a reorder before merging', async () => {
    const a = await makeDoc(2, 1)
    const b = await makeDoc(2, 2)
    const downloads = []
    render(
      <PdfToolMerge
        files={[fileOf('a', '甲.pdf', a), fileOf('b', '乙.pdf', b)]}
        exportBytes={(bytes) => downloads.push(bytes)}
      />,
    )
    const upButtons = screen.getAllByRole('button', { name: /上移/ })
    fireEvent.click(upButtons[1]) // move 乙 to the front
    fireEvent.click(screen.getByText('合并 PDF'))
    await waitFor(() => expect(downloads.length).toBe(1))

    const doc = await loadPdf(downloads[0])
    expect(doc.getPages().map((p) => p.getWidth())).toEqual([201, 202, 101, 102])
  })

  it('prompts when fewer than two files are available', () => {
    render(<PdfToolMerge files={[]} exportBytes={() => {}} />)
    expect(screen.getByText(/至少需要 2 个 PDF/)).toBeTruthy()
  })
})
