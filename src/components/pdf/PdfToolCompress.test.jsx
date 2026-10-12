// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest'
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { PDFDocument } from 'pdf-lib'
import PdfToolCompress from './PdfToolCompress.jsx'
import { loadPdf, pageCount } from '../../pdf/engine.js'

// Mock the canvas re-encoder with a tiny JPEG so image replacement triggers.
vi.mock('../../pdf/imageRecompress.js', () => ({
  reencodeImage: vi.fn(async () => ({ bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) })),
}))

afterEach(cleanup)

const JPEG_1PX =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=='

async function makeFile() {
  const doc = await PDFDocument.create()
  const img = await doc.embedJpg(Uint8Array.from(atob(JPEG_1PX), (c) => c.charCodeAt(0)))
  const page = doc.addPage([200, 200])
  page.drawImage(img, { x: 10, y: 10, width: 100, height: 100 })
  const bytes = await doc.save()
  return { id: 'f1', name: '扫描试卷.pdf', size: bytes.length, doc }
}

describe('PdfToolCompress', () => {
  it('compresses and reports original / final sizes', async () => {
    const file = await makeFile()
    const downloads = []
    render(<PdfToolCompress file={file} exportBytes={(bytes, name) => downloads.push({ bytes, name })} />)

    // Shows original size and a low/medium/high estimate.
    expect(screen.getByText('原始大小')).toBeTruthy()
    expect(screen.getByText('预计大小')).toBeTruthy()

    fireEvent.click(screen.getByText('压缩并下载'))
    await waitFor(() => expect(downloads.length).toBe(1))

    expect(downloads[0].name).toMatch(/_compressed\.pdf$/)
    const out = await loadPdf(downloads[0].bytes)
    expect(pageCount(out)).toBe(1)
    // Final size shown with a compression percentage.
    expect(screen.getByText(/最终大小/)).toBeTruthy()
  })

  it('switches levels and updates the estimate', () => {
    render(<PdfToolCompress file={{ id: 'f1', name: 'a.pdf', size: 100000, doc: {} }} exportBytes={() => {}} />)
    fireEvent.click(screen.getByText('高（体积优先）'))
    expect(screen.getByText(/约 -55%/)).toBeTruthy() // 100000 → 45000
  })

  it('shows a hint when no file is loaded', () => {
    render(<PdfToolCompress file={null} exportBytes={() => {}} />)
    expect(screen.getByText(/请先加载一个 PDF 文件/)).toBeTruthy()
  })
})
