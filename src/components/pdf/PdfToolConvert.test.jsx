// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest'
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import PdfToolConvert from './PdfToolConvert.jsx'
import { loadPdf, pageCount } from '../../pdf/engine.js'

// Thumbnails/PDF→images render through the pdf.js renderer — mock it.
vi.mock('../../pdf/renderer.js', async (importOriginal) => {
  const mod = await importOriginal()
  return {
    ...mod,
    openPdf: vi.fn(async () => ({ pdf: { fake: true }, numPages: 5, destroy: vi.fn() })),
    renderPageToDataUrl: vi.fn(async () => 'data:image/jpeg;base64,ZmFrZQ=='),
  }
})

// Capture the items PDF→Images tries to download.
let capturedItems = null
vi.mock('../../pdf/export.js', () => ({
  downloadMany: vi.fn(async (items) => {
    capturedItems = items
  }),
  downloadBytes: vi.fn(),
}))

const PNG_1PX_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

afterEach(() => {
  cleanup()
  capturedItems = null
})

function rendererFile(pageCount) {
  return {
    id: 'f1',
    name: '甲.pdf',
    pageCount,
    doc: {},
    renderProxy: { pdf: { fake: true }, numPages: pageCount },
  }
}

describe('PdfToolConvert (PDF → 图片)', () => {
  it('renders the requested page range as image downloads', async () => {
    render(<PdfToolConvert file={rendererFile(5)} exportBytes={() => {}} />)
    await waitFor(() => expect(screen.getByText('转换为图片')).toBeTruthy())

    fireEvent.change(screen.getByLabelText('页面范围'), { target: { value: '1-2, 4' } })
    fireEvent.click(screen.getByText('转换为图片'))

    await waitFor(() => expect(capturedItems).not.toBeNull())
    expect(capturedItems.map((i) => i.name)).toEqual([
      '甲_page_1.jpg',
      '甲_page_2.jpg',
      '甲_page_4.jpg',
    ])
  })

  it('converts all pages when the range is empty', async () => {
    render(<PdfToolConvert file={rendererFile(3)} exportBytes={() => {}} />)
    await waitFor(() => expect(screen.getByText('转换为图片')).toBeTruthy())
    fireEvent.click(screen.getByText('转换为图片'))
    await waitFor(() => expect(capturedItems).not.toBeNull())
    expect(capturedItems.length).toBe(3)
  })
})

describe('PdfToolConvert (图片 → PDF)', () => {
  it('builds a PDF from added images with the chosen page size', async () => {
    const downloads = []
    render(<PdfToolConvert file={null} exportBytes={(bytes, name) => downloads.push({ bytes, name })} />)
    fireEvent.click(screen.getByText('图片 → PDF'))
    await waitFor(() => expect(screen.getByText('转换为 PDF')).toBeTruthy())

    const input = document.querySelector('.pdfwb-imgdrop input[type="file"]')
    fireEvent.change(input, {
      target: {
        files: [new File([Uint8Array.from(atob(PNG_1PX_B64), (c) => c.charCodeAt(0))], '题目.png', { type: 'image/png' })],
      },
    })
    await waitFor(() => expect(screen.getByText('题目.png')).toBeTruthy())

    fireEvent.change(screen.getByLabelText('页面尺寸'), { target: { value: 'a4' } })
    fireEvent.click(screen.getByText('转换为 PDF'))
    await waitFor(() => expect(downloads.length).toBe(1))

    expect(downloads[0].name).toBe('题目_pdf.pdf')
    const out = await loadPdf(downloads[0].bytes)
    expect(pageCount(out)).toBe(1)
    expect(out.getPage(0).getWidth()).toBe(595)
    expect(out.getPage(0).getHeight()).toBe(842)
  })

  it('flags an unsupported image format with a clear error', async () => {
    render(<PdfToolConvert file={null} exportBytes={() => {}} />)
    fireEvent.click(screen.getByText('图片 → PDF'))
    await waitFor(() => expect(screen.getByText('转换为 PDF')).toBeTruthy())

    const input = document.querySelector('.pdfwb-imgdrop input[type="file"]')
    fireEvent.change(input, {
      target: {
        files: [new File(['gif data'], '动画.gif', { type: 'image/gif' })],
      },
    })
    await waitFor(() => expect(screen.getByText(/不支持的图片格式/)).toBeTruthy())
  })
})
