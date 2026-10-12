// Safe output filenames. Handles Chinese filenames, illegal characters,
// Windows reserved names, trailing dots/spaces, very long names, and
// duplicate collision — without ever touching the user's original file.

const DEFAULT_MAX_LEN = 120

// Characters illegal in filenames on Windows / most filesystems, plus control
// characters (0x00–0x1F, escaped so the source file stays clean ASCII text).
const INVALID_CHARS = /[\/:*?"<>|\u0000-\u001f]/g
// Windows reserved device names (CON, PRN, AUX, NUL, COM1..9, LPT1..9).
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

// Split a filename into { base, ext }; ext includes the leading dot ("" if none).
export function splitExt(filename) {
  const raw = String(filename || '').trim()
  const m = /^(.*?)(\.[^.]+)?$/.exec(raw)
  return { base: m[1] || '', ext: m[2] || '' }
}

// Strip path separators so a full path collapses to its last segment.
export function lastSegment(filename) {
  const segments = String(filename || '')
    .split(/[\\/]/)
    .filter(Boolean)
  return segments[segments.length - 1] || ''
}

// Return a filesystem-safe filename (extension preserved, Chinese kept).
export function sanitizeFilename(filename, { maxLen = DEFAULT_MAX_LEN } = {}) {
  const { base, ext } = splitExt(lastSegment(filename))
  let cleanBase = base.replace(INVALID_CHARS, '').replace(/[.\s]+$/g, '').trim()
  if (RESERVED_NAMES.test(cleanBase)) cleanBase = `_${cleanBase}`
  // Trim the whole name to maxLen, keeping the extension.
  const maxBase = Math.max(1, maxLen - ext.length)
  if (cleanBase.length > maxBase) {
    cleanBase = cleanBase.slice(0, maxBase).replace(/[.\s]+$/g, '')
  }
  return cleanBase + ext
}

// Ensure `filename` does not collide with names already in `taken` (a Set).
// Appends " (1)", " (2)", … before the extension.
export function dedupeFilename(filename, taken = new Set()) {
  if (!taken.has(filename)) return filename
  const { base, ext } = splitExt(filename)
  let i = 1
  let candidate
  do {
    candidate = `${base} (${i})${ext}`
    i += 1
  } while (taken.has(candidate))
  return candidate
}

// Build an output name like "foo_processed.pdf" for a given input name.
export function outputFilename(filename, { suffix = '_processed' } = {}) {
  const { base, ext } = splitExt(sanitizeFilename(filename))
  return `${base}${suffix}${ext}`
}
