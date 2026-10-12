// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest'
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { PDFDocument } from 'pdf-lib'
import PdfToolBatch from './PdfToolBatch.jsx'

let downloads = []
vi.mock('../../pdf/export.js', () => ({
  downloadBytes: vi.fn((_bytes, name) => downloads.push(name)),
  downloadMany: vi.fn(),
}))

// Real engine, but compressPdf: first call fails, second succeeds — proves a
// failing file never stops the batch.
vi.mock('../../pdf/engine.js', async (importOriginal) => {
  const mod = await importOriginal()
  return {
    ...mod,
    compressPdf: vi
      .fn()
      .mockImplementationOnce(async () => {
        throw new Error('模拟压缩失败')
      })
      .mockImplementationOnce(async () => ({ bytes: new Uint8Array([1, 2, 3]), reencodedImages: 0 })),
  }
})

vi.mock('../../pdf/imageRecompress.js', () => ({ reencodeImage: vi.fn() }))
vi.mock('../../pdf/renderer.js', () => ({ renderPageToDataUrl: vi.fn(async () => 'data:image/jpeg;base64,x') }))

afterEach(() => {
  cleanup()
  downloads = []
})

async function makeDoc(n, code = 1) {
  const doc = await PDFDocument.create()
  for (let i = 1; i <= n; i++) doc.addPage([code * 100 + i, 200])
  return doc
}

function fileOf(id, name, doc) {
  return { id, name, pageCount: doc.getPageCount(), doc, renderProxy: { pdf: {} } }
}

function doneCount() {
  return document.querySelectorAll('.pdfwb-batch__status--done').length
}
function failedCount() {
  return document.querySelectorAll('.pdfwb-batch__status--failed').length
}

describe('PdfToolBatch', () => {
  it('rotates all files and marks every item done', async () => {
    const a = await makeDoc(2, 1)
    const b = await makeDoc(2, 2)
    render(<PdfToolBatch files={[fileOf('a', '甲.pdf', a), fileOf('b', '乙.pdf', b)]} />)

    fireEvent.click(screen.getByText('全部旋转 90°'))
    fireEvent.click(screen.getByText('开始批量处理'))

    await waitFor(() => expect(doneCount()).toBe(2))
    expect(downloads.length).toBe(2)
    expect(downloads[0]).toMatch(/_rotated\.pdf$/)
  })

  it('continues past a failing file', async () => {
    const a = await makeDoc(2, 1)
    const b = await makeDoc(2, 2)
    render(<PdfToolBatch files={[fileOf('a', '甲.pdf', a), fileOf('b', '乙.pdf', b)]} />)

    fireEvent.click(screen.getByText('全部压缩（中）'))
    fireEvent.click(screen.getByText('开始批量处理'))

    await waitFor(() => expect(failedCount()).toBe(1))
    expect(doneCount()).toBe(1)
    expect(screen.getByText(/模拟压缩失败/)).toBeTruthy()
  })
})
