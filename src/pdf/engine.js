// PDF page-level engine built on pdf-lib (MIT). Pure JS, runs in the browser,
// in Node (unit tests), and inside Electron/Tauri — no native deps, no network.
//
// Design: page ORDER lives in the UI (an array of 0-based indices). The engine
// exposes one rebuild primitive (reorderDoc) that covers reorder / delete /
// duplicate / extract, plus rotate (in-place on the doc) and merge. Everything
// is offline; PDFs never leave the machine except through Prepare-for-Quiz's
// explicit AI step (which lives in src/quiz/ai.js).

import { PDFDocument, PDFName, PDFRawStream, degrees } from 'pdf-lib'

const ENCRYPTED_MSG = 'PDF 已加密或受密码保护，请先解除密码后再处理。'
const CORRUPT_MSG = '无法解析这个 PDF（文件可能已损坏，或不是有效的 PDF）。'

// Map any error thrown while loading/saving into a clear, user-facing message.
// pdf-lib's error classes all surface with name "Error", so encryption is
// detected by the distinctive message pdf-lib emits; everything else that
// fails during a load is treated as a corrupt/unparseable file.
export function pdfErrorMessage(err) {
  if (!err) return 'Unknown error'
  const msg = err.message || ''
  if (/encrypted/i.test(msg)) return ENCRYPTED_MSG
  return msg || 'Unknown error'
}

function toBytes(data) {
  return data instanceof Uint8Array ? data : new Uint8Array(data)
}

// The %PDF- header may legally be preceded by up to 1024 bytes of junk (e.g. a
// BOM), so scan the head rather than requiring it at byte 0.
function looksLikePdf(bytes) {
  const head = bytes.subarray(0, Math.min(bytes.length, 1024))
  const text = new TextDecoder().decode(head)
  return text.includes('%PDF-')
}

// Parse PDF bytes into a PDFDocument. Throws a clear Chinese error for
// empty / corrupt / encrypted input. `password` supports standard (RC4)
// encryption for future password-entry UI.
export async function loadPdf(data, options = {}) {
  const { ignoreEncryption = false, password = '' } = options
  const bytes = toBytes(data)
  if (bytes.length === 0) throw new Error('PDF 文件为空。')
  if (!looksLikePdf(bytes)) {
    throw new Error('不是有效的 PDF 文件（缺少 %PDF- 文件头）。')
  }
  try {
    const loadOpts = { ignoreEncryption, updateMetadata: true }
    if (password) loadOpts.password = password
    const doc = await PDFDocument.load(bytes, loadOpts)
    // pdf-lib resolves the page tree lazily; force it so a corrupt tree fails
    // here with a clear message instead of surfacing later mid-operation.
    doc.getPageCount()
    return doc
  } catch (err) {
    if (!ignoreEncryption && /encrypted/i.test(err.message || '')) {
      throw new Error(ENCRYPTED_MSG)
    }
    const detail = err.message ? `（${err.message}）` : ''
    throw new Error(`${CORRUPT_MSG}${detail}`)
  }
}

export function pageCount(doc) {
  return doc.getPageCount()
}

export function pageIndices(doc) {
  return Array.from({ length: doc.getPageCount() }, (_, i) => i)
}

// Validate 1-based page numbers against the document; throws on any bad index.
export function assertPageNumbers(doc, pageNumbers) {
  const n = doc.getPageCount()
  for (const p of pageNumbers) {
    if (!Number.isInteger(p) || p < 1 || p > n) {
      throw new Error(`页面 ${p} 不存在（文档共 ${n} 页）。`)
    }
  }
}

// Rotate selected pages (1-based numbers) in place. `angle` in degrees is
// normalized to 0..359 (90/180/270 map directly).
export function rotatePages(doc, pageNumbers, angle) {
  const normalized = ((Math.round(angle) % 360) + 360) % 360
  assertPageNumbers(doc, pageNumbers)
  const deg = degrees(normalized)
  for (const p of pageNumbers) {
    doc.getPage(p - 1).setRotation(deg)
  }
  return doc
}

// Apply possibly-different rotations to pages. `entries` = [{ pageNumber, angle }]
// (1-based). Used by Organize export, where each page can carry its own angle.
export function applyRotations(doc, entries) {
  for (const { pageNumber, angle } of entries) {
    rotatePages(doc, [pageNumber], angle)
  }
  return doc
}

// Rebuild a document whose pages follow `order` (0-based indices into `doc`).
// This one primitive powers reorder (permuted indices), delete (omitted
// indices), duplicate (repeated indices) and extract (a subset → new doc).
// The returned document is independent of `doc`; page content and rotation are
// preserved through the page-dictionary copy.
export async function reorderDoc(doc, order) {
  if (!Array.isArray(order) || order.length === 0) {
    throw new Error('没有可导出的页面。')
  }
  const n = doc.getPageCount()
  for (const i of order) {
    if (!Number.isInteger(i) || i < 0 || i >= n) {
      throw new Error(`无效的页面索引 ${i}（文档共 ${n} 页）。`)
    }
  }
  const target = await PDFDocument.create()
  const pages = await target.copyPages(doc, order)
  for (const p of pages) target.addPage(p)
  return target
}

// Merge multiple documents in order into a single new document.
export async function mergeDocs(docs) {
  const target = await PDFDocument.create()
  for (const doc of docs) {
    const n = doc.getPageCount()
    if (n === 0) continue
    const pages = await target.copyPages(doc, Array.from({ length: n }, (_, i) => i))
    for (const p of pages) target.addPage(p)
  }
  return target
}

// Serialize a document back to bytes. useObjectStreams is the cheap, safe
// compression lever; deeper image-based compression lives in the Compress tool.
export async function savePdf(doc, options = {}) {
  const { useObjectStreams = true } = options
  try {
    return await doc.save({ useObjectStreams })
  } catch (err) {
    throw new Error(pdfErrorMessage(err))
  }
}

// ---- Images → PDF ----------------------------------------------------------

// Sniff an image's format from its magic bytes (pdf-lib can only embed
// PNG / JPEG). Returns 'png' | 'jpg' | 'webp' | 'unknown'.
export function detectImageType(bytes) {
  if (!bytes || bytes.length < 8) return 'unknown'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg'
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'png'
  }
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46
  ) {
    return 'webp'
  }
  return 'unknown'
}

// Build a PDF with one page per image, centered and aspect-preserved within
// the target page size (or the image's natural size when pageWidth/Height are
// omitted). `items` = [{ bytes, name }]. Throws a clear error on unsupported
// formats so a bad file never silently produces a broken PDF.
export async function imagesToPdf(items, options = {}) {
  const { pageWidth, pageHeight, margin = 0 } = options
  if (!items || items.length === 0) throw new Error('没有可转换的图片。')
  const doc = await PDFDocument.create()
  for (const item of items) {
    const type = detectImageType(item.bytes)
    if (type === 'webp' || type === 'unknown') {
      throw new Error(`不支持的图片格式：${item.name || '图片'}（仅支持 PNG / JPEG）`)
    }
    const img =
      type === 'png' ? await doc.embedPng(item.bytes) : await doc.embedJpg(item.bytes)
    const w = pageWidth || img.width
    const h = pageHeight || img.height
    const availW = w - margin * 2
    const availH = h - margin * 2
    if (availW <= 0 || availH <= 0) {
      throw new Error('页面留白过大，无法容纳图片。')
    }
    const scale = Math.min(availW / img.width, availH / img.height)
    const dw = img.width * scale
    const dh = img.height * scale
    const page = doc.addPage([w, h])
    page.drawImage(img, { x: (w - dw) / 2, y: (h - dh) / 2, width: dw, height: dh })
  }
  return doc
}

// ---- Compress ---------------------------------------------------------------

// Compression levels. The default strategy never destroys text clarity: text is
// untouched; only embedded /DeviceRGB raster images are re-encoded (at a lower
// JPEG quality, and downsampled on "high"), and the document is re-serialized
// with object streams.
export const COMPRESS_LEVELS = {
  low: { label: '低（质量优先）', maxQuality: 0, maxDim: 0 },
  medium: { label: '中（均衡）', maxQuality: 0.7, maxDim: 0 },
  high: { label: '高（体积优先）', maxQuality: 0.45, maxDim: 1600 },
}

// Rough pre-compression size estimate, shown to the user before running.
export function estimateCompressedSize(originalBytes, level) {
  const ratio = level === 'high' ? 0.45 : level === 'medium' ? 0.7 : 0.92
  return Math.max(1, Math.round((originalBytes || 0) * ratio))
}

// Recompress a document. `reencodeImage(imageBytes, { maxQuality, maxDim })`
// is provided by the browser (canvas-based); it returns { bytes, type } or
// null to leave an image untouched. Returns { bytes, reencodedImages }.
export async function compressPdf(doc, options = {}) {
  const { level = 'medium', reencodeImage } = options
  const cfg = COMPRESS_LEVELS[level] || COMPRESS_LEVELS.medium
  const reencodedImages =
    cfg.maxQuality > 0 && typeof reencodeImage === 'function'
      ? await recompressImages(doc, cfg, reencodeImage)
      : 0
  const bytes = await savePdf(doc, { useObjectStreams: true })
  return { bytes, reencodedImages }
}

async function recompressImages(doc, cfg, reencodeImage) {
  const context = doc.context
  const targets = []
  const seen = new Set()
  for (const [ref, obj] of context.enumerateIndirectObjects()) {
    const key = ref.toString()
    if (seen.has(key)) continue
    seen.add(key)
    // A raw stream with a dict (duck-typed to avoid pdf-lib internals).
    if (!obj || !obj.contents || !(obj.contents instanceof Uint8Array) || !obj.dict) continue
    const dict = obj.dict
    if (dict.lookup(PDFName.of('Subtype')) !== PDFName.of('Image')) continue
    // Only DCTDecode (JPEG) streams hold raw, decodable image bytes; FlateDecode
    // streams hold deflate-compressed PNG data which we cannot inflate here.
    if (dict.lookup(PDFName.of('Filter')) !== PDFName.of('DCTDecode')) continue
    // Re-encoding to an RGB JPEG breaks masks and complex color spaces. The
    // three device spaces convert faithfully to RGB via the canvas.
    if (dict.lookup(PDFName.of('SMask'))) continue
    const cs = dict.lookup(PDFName.of('ColorSpace'))
    // PDFName.toString() is the raw PDF syntax (e.g. "/DeviceRGB").
    if (!(cs instanceof PDFName) || !['/DeviceRGB', '/DeviceGray', '/DeviceCMYK'].includes(cs.toString())) continue
    targets.push({ ref, stream: obj })
  }

  let count = 0
  for (const { ref, stream } of targets) {
    const out = await reencodeImage(stream.contents, {
      maxQuality: cfg.maxQuality,
      maxDim: cfg.maxDim,
    })
    if (!out || !out.bytes || out.bytes.length >= stream.contents.length) continue
    const newDict = stream.dict.clone()
    newDict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'))
    newDict.delete(PDFName.of('DecodeParms'))
    newDict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'))
    context.delete(ref)
    context.assign(ref, PDFRawStream.of(newDict, out.bytes))
    count += 1
  }
  return count
}

export { degrees }
