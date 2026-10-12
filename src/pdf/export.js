// Export helpers — download PDF bytes to the user's machine. Works in the
// browser / PWA and inside Electron (default download is handled by the shell).
// Never overwrites an existing file: the browser appends " (1)" automatically
// and we always build a fresh _processed-style name upstream.

export function downloadBytes(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Download several files with a stagger. Browsers treat rapid programmatic
// downloads as pop-ups, so the first click only authorizes one — spacing them
// keeps the rest unblocked.
export async function downloadMany(items, { gapMs = 350 } = {}) {
  for (const item of items) {
    downloadBytes(item.bytes, item.name)
    if (gapMs) await new Promise((resolve) => setTimeout(resolve, gapMs))
  }
}
