import LZString from 'lz-string'

// Encode/decode a quiz's markdown source into a URL hash so it can be shared as
// a self-contained link (no server, no file).

export function encodeShare(source) {
  return LZString.compressToEncodedURIComponent(source)
}

export function decodeShare(str) {
  try {
    return LZString.decompressFromEncodedURIComponent(str) || null
  } catch {
    return null
  }
}

export function shareUrl(source) {
  const base = location.origin + location.pathname
  return `${base}#q=${encodeShare(source)}`
}

// Reads a shared quiz source from the current location hash, if present.
export function readHashSource() {
  const m = location.hash.match(/[#&]q=([^&]+)/)
  return m ? decodeShare(m[1]) : null
}
