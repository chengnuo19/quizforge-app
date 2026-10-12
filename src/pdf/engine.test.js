import { describe, it, expect, vi } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import {
  loadPdf,
  savePdf,
  pageCount,
  pageIndices,
  rotatePages,
  applyRotations,
  reorderDoc,
  mergeDocs,
  imagesToPdf,
  detectImageType,
  compressPdf,
  estimateCompressedSize,
  pdfErrorMessage,
} from './engine.js'

// A valid 1×1 transparent PNG (67-byte base64) for imagesToPdf tests.
const PNG_1PX = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  ),
)

// A valid 1×1 JPEG (for compress tests — JPEGs embed as raw DCTDecode bytes).
const JPEG_1PX = Uint8Array.from(
  Buffer.from(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
    'base64',
  ),
)

// ---- Helpers ---------------------------------------------------------------

// Create a doc with `n` pages. Each page has a UNIQUE width (code*100 + index)
// so order and duplication can be asserted from page dimensions alone after
// copy/merge operations (MediaBox travels with the page dictionary).
function makePdf(n, code = 1) {
  return PDFDocument.create().then((doc) => {
    for (let i = 1; i <= n; i++) doc.addPage([code * 100 + i, 200])
    return doc
  })
}

async function widthsOf(doc) {
  return doc.getPages().map((p) => p.getWidth())
}

// Build a minimal-but-valid PDF that carries an /Encrypt entry, so pdf-lib
// throws its "document is encrypted" error. xref offsets are computed from the
// real byte lengths so the file parses far enough to detect encryption.
function buildEncryptedPdfBytes() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>',
    '<< /Filter /Standard /V 1 /R 2 /Length 40 >>',
  ]
  const header = '%PDF-1.4\n'
  let body = header
  const offsets = [0]
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(body, 'utf-8'))
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`
  }
  const xrefOffset = Buffer.byteLength(body, 'utf-8')
  const count = objects.length + 1
  const lines = ['xref', `0 ${count}`, '0000000000 65535 f ']
  for (let i = 0; i < objects.length; i++) {
    lines.push(String(offsets[i + 1]).padStart(10, '0') + ' 00000 n ')
  }
  body += lines.join('\n') + '\n'
  body += `trailer\n<< /Root 1 0 R /Size ${count} /Encrypt 4 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  return new TextEncoder().encode(body)
}

// A file with a valid %PDF- header but a broken page tree — pdf-lib must
// reject it as corrupt, not silently succeed.
function buildCorruptPdfBytes() {
  return new TextEncoder().encode(
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\nstartxref\n0\n%%EOF',
  )
}

// ---- loadPdf / savePdf -----------------------------------------------------

describe('loadPdf', () => {
  it('loads a valid PDF', async () => {
    const doc = await makePdf(3)
    const bytes = await savePdf(doc)
    const loaded = await loadPdf(bytes)
    expect(pageCount(loaded)).toBe(3)
  })

  it('accepts a header preceded by junk bytes (legal per PDF spec)', async () => {
    const doc = await makePdf(1)
    const bytes = await savePdf(doc)
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes]) // UTF-8 BOM + PDF
    const loaded = await loadPdf(withBom)
    expect(pageCount(loaded)).toBe(1)
  })

  it('rejects empty bytes', async () => {
    await expect(loadPdf(new Uint8Array([]))).rejects.toThrow('PDF 文件为空')
  })

  it('rejects a missing %PDF- header', async () => {
    await expect(loadPdf(new TextEncoder().encode('hello world'))).rejects.toThrow(
      '不是有效的 PDF',
    )
  })

  it('reports corrupt PDFs with a clear message, not an internal error', async () => {
    await expect(loadPdf(buildCorruptPdfBytes())).rejects.toThrow(/无法解析这个 PDF/)
  })

  it('reports password-protected PDFs with a clear message', async () => {
    await expect(loadPdf(buildEncryptedPdfBytes())).rejects.toThrow(
      'PDF 已加密或受密码保护',
    )
  })
})

describe('savePdf', () => {
  it('round-trips a loaded document to bytes', async () => {
    const doc = await makePdf(2)
    const bytes = await savePdf(doc)
    const reloaded = await loadPdf(bytes)
    expect(await widthsOf(reloaded)).toEqual([101, 102])
  })
})

// ---- page helpers ----------------------------------------------------------

describe('pageIndices', () => {
  it('returns 0-based indices for all pages', async () => {
    const doc = await makePdf(4)
    expect(pageIndices(doc)).toEqual([0, 1, 2, 3])
  })
})

describe('rotatePages', () => {
  it('rotates only the selected pages in place', async () => {
    const doc = await makePdf(3)
    rotatePages(doc, [1, 3], 90)
    expect(doc.getPage(0).getRotation().angle).toBe(90)
    expect(doc.getPage(2).getRotation().angle).toBe(90)
    expect(doc.getPage(1).getRotation().angle).toBe(0)
  })

  it('normalizes out-of-range angles (270 stays 270, 360 → 0)', async () => {
    const doc = await makePdf(1)
    rotatePages(doc, [1], 270)
    expect(doc.getPage(0).getRotation().angle).toBe(270)
    rotatePages(doc, [1], 360)
    expect(doc.getPage(0).getRotation().angle).toBe(0)
  })

  it('throws on a page number outside the document', async () => {
    const doc = await makePdf(2)
    expect(() => rotatePages(doc, [3], 90)).toThrow('页面 3 不存在（文档共 2 页）')
  })

  it('preserves rotation when the doc is rebuilt', async () => {
    const doc = await makePdf(3)
    rotatePages(doc, [2], 90)
    const rebuilt = await reorderDoc(doc, [0, 1, 2])
    expect(rebuilt.getPage(1).getRotation().angle).toBe(90)
  })
})

describe('applyRotations', () => {
  it('applies a different rotation per page', async () => {
    const doc = await makePdf(3)
    applyRotations(doc, [
      { pageNumber: 1, angle: 90 },
      { pageNumber: 3, angle: 270 },
    ])
    expect(doc.getPage(0).getRotation().angle).toBe(90)
    expect(doc.getPage(1).getRotation().angle).toBe(0)
    expect(doc.getPage(2).getRotation().angle).toBe(270)
  })
})

// ---- reorderDoc (reorder / delete / duplicate / extract) -------------------

describe('reorderDoc', () => {
  it('reorders pages', async () => {
    const doc = await makePdf(5)
    const out = await reorderDoc(doc, [3, 0, 4, 1, 2]) // pages 4,1,5,2,3
    expect(await widthsOf(out)).toEqual([104, 101, 105, 102, 103])
  })

  it('deletes pages when indices are omitted', async () => {
    const doc = await makePdf(5)
    const out = await reorderDoc(doc, [0, 2, 4]) // keep pages 1,3,5
    expect(await widthsOf(out)).toEqual([101, 103, 105])
  })

  it('duplicates pages when indices repeat', async () => {
    const doc = await makePdf(3)
    const out = await reorderDoc(doc, [0, 1, 1, 2, 0]) // 1,2,2,3,1
    expect(await widthsOf(out)).toEqual([101, 102, 102, 103, 101])
  })

  it('extracts a subset into an independent doc', async () => {
    const doc = await makePdf(5)
    const out = await reorderDoc(doc, [1, 3]) // pages 2,4
    expect(await widthsOf(out)).toEqual([102, 104])
    // Original untouched.
    expect(pageCount(doc)).toBe(5)
  })

  it('throws on an empty selection', async () => {
    const doc = await makePdf(3)
    await expect(reorderDoc(doc, [])).rejects.toThrow('没有可导出的页面')
  })

  it('throws on an out-of-range index', async () => {
    const doc = await makePdf(3)
    await expect(reorderDoc(doc, [0, 5])).rejects.toThrow('无效的页面索引')
  })
})

// ---- mergeDocs -------------------------------------------------------------

describe('mergeDocs', () => {
  it('merges A+B with correct page count and order', async () => {
    const a = await makePdf(2, 1) // widths 101,102
    const b = await makePdf(3, 2) // widths 201,202,203
    const merged = await mergeDocs([a, b])
    expect(await widthsOf(merged)).toEqual([101, 102, 201, 202, 203])
  })

  it('handles empty documents without error', async () => {
    const a = await makePdf(1, 1)
    const empty = await PDFDocument.create()
    const merged = await mergeDocs([a, empty])
    expect(await widthsOf(merged)).toEqual([101])
  })
})

// ---- imagesToPdf / detectImageType -----------------------------------------

describe('detectImageType', () => {
  it('detects PNG, JPEG and unknown bytes', () => {
    expect(detectImageType(PNG_1PX)).toBe('png')
    expect(detectImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]))).toBe('jpg')
    expect(detectImageType(new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]))).toBe('unknown')
  })
})

describe('imagesToPdf', () => {
  it('creates one page per image with the requested page size', async () => {
    const doc = await imagesToPdf(
      [{ bytes: PNG_1PX, name: 'a.png' }, { bytes: PNG_1PX, name: 'b.png' }],
      { pageWidth: 200, pageHeight: 300, margin: 10 },
    )
    const bytes = await savePdf(doc)
    const out = await loadPdf(bytes)
    expect(pageCount(out)).toBe(2)
    expect(out.getPage(0).getWidth()).toBe(200)
    expect(out.getPage(0).getHeight()).toBe(300)
  })

  it('throws a clear error for an unsupported image format', async () => {
    const doc = PDFDocument.create()
    await expect(
      imagesToPdf([{ bytes: new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4]), name: 'x.webp' }]),
    ).rejects.toThrow(/不支持的图片格式：x\.webp/)
  })

  it('rejects an empty image list', async () => {
    await expect(imagesToPdf([])).rejects.toThrow('没有可转换的图片')
  })
})

// ---- compressPdf / estimateCompressedSize ----------------------------------

async function makeImagePdf() {
  const doc = await PDFDocument.create()
  const img = await doc.embedJpg(JPEG_1PX)
  const page = doc.addPage([200, 200])
  page.drawImage(img, { x: 10, y: 10, width: 50, height: 50 })
  return doc
}

describe('estimateCompressedSize', () => {
  it('applies a per-level ratio', () => {
    expect(estimateCompressedSize(1000, 'low')).toBe(920)
    expect(estimateCompressedSize(1000, 'medium')).toBe(700)
    expect(estimateCompressedSize(1000, 'high')).toBe(450)
  })
})

describe('compressPdf', () => {
  it('re-encodes embedded RGB images on medium/high', async () => {
    const doc = await makeImagePdf()
    const bytes = await savePdf(doc)
    const reloaded = await loadPdf(bytes)

    const stubReencode = vi.fn(async (_imageBytes, opts) => {
      expect(opts.maxQuality).toBe(0.7)
      return { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) }
    })
    const { bytes: outBytes, reencodedImages } = await compressPdf(reloaded, {
      level: 'medium',
      reencodeImage: stubReencode,
    })
    expect(reencodedImages).toBeGreaterThanOrEqual(1)
    const out = await loadPdf(outBytes)
    expect(pageCount(out)).toBe(1)
  })

  it('skips replacement when the re-encode is not smaller', async () => {
    const doc = await makeImagePdf()
    const reloaded = await loadPdf(await savePdf(doc))
    const big = vi.fn(async () => ({
      bytes: new Uint8Array(1000), // larger than the 67-byte PNG
    }))
    const { reencodedImages } = await compressPdf(reloaded, { level: 'medium', reencodeImage: big })
    expect(reencodedImages).toBe(0)
  })

  it('does not re-encode images on the low level', async () => {
    const doc = await makeImagePdf()
    const reloaded = await loadPdf(await savePdf(doc))
    const reencode = vi.fn(async () => ({ bytes: new Uint8Array([1]) }))
    const { reencodedImages } = await compressPdf(reloaded, { level: 'low', reencodeImage: reencode })
    expect(reencodedImages).toBe(0)
    expect(reencode).not.toHaveBeenCalled()
  })
})

// ---- error mapping ---------------------------------------------------------

describe('pdfErrorMessage', () => {
  it('maps the encrypted message', () => {
    const err = new Error(
      'Input document to `PDFDocument.load` is encrypted. You can use ... ignoreEncryption',
    )
    expect(pdfErrorMessage(err)).toMatch(/已加密或受密码保护/)
  })

  it('keeps unknown messages', () => {
    expect(pdfErrorMessage(new Error('磁盘空间不足'))).toBe('磁盘空间不足')
  })

  it('never returns the literal "Unknown error" for a real error', () => {
    expect(pdfErrorMessage(new Error('x'))).not.toBe('Unknown error')
  })
})
