// Browser image re-encoder for PDF compression. Decodes an embedded image
// (PNG/JPEG) via createImageBitmap, optionally downsamples, and re-encodes as
// JPEG — the workhorse behind the Compress tool's medium/high levels. Kept
// separate from the engine so the engine stays Node-testable (it receives an
// injected re-encoder).

function base64ToBytes(b64) {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

// Returns { bytes } for a re-encoded JPEG, or null when the source cannot be
// decoded (so the caller leaves the original image untouched).
export async function reencodeImage(bytes, { maxQuality = 0.7, maxDim = 0 } = {}) {
  try {
    const blob = new Blob([bytes], { type: 'application/octet-stream' })
    let bitmap
    try {
      bitmap = await createImageBitmap(blob)
    } catch {
      return null // undecodable image — keep as-is
    }
    let { width, height } = bitmap
    if (maxDim > 0 && Math.max(width, height) > maxDim) {
      const scale = maxDim / Math.max(width, height)
      width = Math.max(1, Math.round(width * scale))
      height = Math.max(1, Math.round(height * scale))
    }
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    // White background so transparent PNGs do not become black when JPEG-ized.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(bitmap, 0, 0, width, height)
    if (typeof bitmap.close === 'function') bitmap.close()
    const dataUrl = canvas.toDataURL('image/jpeg', maxQuality)
    return { bytes: base64ToBytes(dataUrl.split(',')[1]) }
  } catch {
    return null
  }
}
