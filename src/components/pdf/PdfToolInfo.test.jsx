// @vitest-environment jsdom
import { afterEach, describe, it, expect } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { PDFDocument } from 'pdf-lib'
import PdfToolInfo from './PdfToolInfo.jsx'

afterEach(cleanup)

describe('PdfToolInfo', () => {
  it('shows metadata and per-page sizes', async () => {
    const doc = await PDFDocument.create()
    doc.setTitle('线性代数讲义')
    doc.setAuthor('chengnuo19')
    doc.addPage([200, 300])
    doc.addPage([300, 200])

    render(<PdfToolInfo file={{ id: 'f1', name: '线性代数讲义.pdf', pageCount: 2, size: 2048, doc }} />)

    expect(screen.getByText('线性代数讲义')).toBeTruthy()
    expect(screen.getByText('chengnuo19')).toBeTruthy()
    expect(screen.getAllByText('2')).toHaveLength(1) // page count row
    expect(screen.getByText('第 1 页')).toBeTruthy()
    expect(screen.getByText('200 × 300 pt')).toBeTruthy()
    expect(screen.getByText('第 2 页')).toBeTruthy()
  })

  it('shows a hint when no file is loaded', () => {
    render(<PdfToolInfo file={null} />)
    expect(screen.getByText(/请先加载一个 PDF 文件/)).toBeTruthy()
  })
})
