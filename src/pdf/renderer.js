// pdf.js thumbnail / preview rendering for the Workbench.
//
// Design goals (large PDFs must stay usable):
//  - Lazy: only visible pages are rendered (the grid asks for one at a time).
//  - Cancellable: an AbortSignal cancels a stale render; renderPageToDataUrl
//    resolves to null instead of throwing, so callers never see an exception.
//  - Cached: ThumbCache bounds the number of kept data URLs (LRU) so a
//    300+ page document does not grow memory without limit.
//  - Queued: Concurrency queue ensures large documents do not starve the
//    worker thread or trip per-tile timeout bounds.

import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'

// Configure the pdf.js worker once. The legacy build runs in browsers AND
// Node (the modern build is browser-only), and src/quiz/pdfHelper.js is
// aligned on the same URL so the two consumers never clobber each other.
if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/legacy/build/pdf.worker.mjs',
    import.meta.url,
  ).toString()
}

// Open a PDF for rendering. Returns a proxy exposing numPages and destroy().
// `signal` lets the caller cancel an in-flight open.
export async function openPdf(data, { signal } = {}) {
  const isBrowser = typeof window !== 'undefined'
  let wasmUrl = null
  let cMapUrl = null
  let standardFontDataUrl = null

  if (isBrowser && window.location) {
    try {
      wasmUrl = new URL('pdfjs/wasm/', window.location.href).toString()
      cMapUrl = new URL('pdfjs/cmaps/', window.location.href).toString()
      standardFontDataUrl = new URL('pdfjs/standard_fonts/', window.location.href).toString()
    } catch {
      wasmUrl = '/pdfjs/wasm/'
      cMapUrl = '/pdfjs/cmaps/'
      standardFontDataUrl = '/pdfjs/standard_fonts/'
    }
  }

  const docParams = {
    data: data instanceof Uint8Array ? data : new Uint8Array(data),
    cMapPacked: true,
    ...(wasmUrl ? { wasmUrl } : {}),
    ...(cMapUrl ? { cMapUrl } : {}),
    ...(standardFontDataUrl ? { standardFontDataUrl } : {}),
  }
  const task = pdfjsLib.getDocument(docParams)
  if (signal) {
    if (signal.aborted) {
      task.destroy()
      throw new Error('已取消')
    }
    signal.addEventListener('abort', () => task.destroy(), { once: true })
  }
  const pdf = await task.promise
  return {
    pdf,
    numPages: pdf.numPages,
    destroy: () => task.destroy(),
  }
}

// Pure viewport math, extracted so it can be unit-tested without a DOM.
// The requested `rotation` is the user-visible angle; pdf.js's getViewport
// replaces the page's inherent rotation when given an explicit value, so we
// accumulate: (page.rotate + requested) % 360.
export function pageViewport(page, { scale = 1, rotation = 0 } = {}) {
  const total = ((page.rotate || 0) + (rotation || 0)) % 360
  return page.getViewport({ scale, rotation: total })
}

function browserMakeCanvas(width, height) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

// Render one page to a JPEG data URL. Resolves to null when aborted or when
// rendering fails (e.g. a corrupt page), never throws.
//
// `makeCanvas` is injectable so tests can stub the 2D context; in the browser
// it defaults to document.createElement.
export async function renderPageToDataUrl(pdf, pageNumber, options = {}) {
  const {
    scale = 1,
    rotation = 0,
    signal,
    makeCanvas = browserMakeCanvas,
    dataUrlType = 'image/jpeg',
    dataUrlQuality = 0.82,
  } = options

  let page
  try {
    page = await pdf.getPage(pageNumber)
  } catch {
    return null // page tree is corrupt or the doc was destroyed
  }

  const viewport = pageViewport(page, { scale, rotation })
  const canvas = makeCanvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)))
  const ctx = canvas.getContext('2d')

  // Explicit white background so transparent PDF pages render cleanly to JPEG
  if (ctx && typeof ctx.fillRect === 'function') {
    try {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    } catch {
      // ignore stub canvas issues in tests
    }
  }

  const renderTask = page.render({ canvasContext: ctx, viewport })

  let done = false
  const onAbort = () => {
    done = true
    renderTask.cancel()
  }
  if (signal) {
    if (signal.aborted) {
      renderTask.cancel()
      // cancel() rejects the task promise; nothing will await it here, so
      // swallow the expected cancellation to avoid an unhandled rejection.
      renderTask.promise.catch(() => {})
      return null
    }
    signal.addEventListener('abort', onAbort)
  }
  try {
    await renderTask.promise
    return canvas.toDataURL(dataUrlType, dataUrlQuality)
  } catch {
    return null // cancelled or render failure — caller shows a placeholder
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort)
  }
}

// Light-weight FIFO concurrency queue to serialize heavy render tasks.
export class RenderQueue {
  constructor(concurrency = 2) {
    this.concurrency = concurrency
    this.running = 0
    this.queue = []
  }

  enqueue(taskFn, { signal } = {}) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        resolve(null)
        return
      }

      const item = { taskFn, signal, resolve, reject }

      const onAbort = () => {
        const idx = this.queue.indexOf(item)
        if (idx !== -1) {
          this.queue.splice(idx, 1)
        }
        resolve(null)
      }

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true })
        item.onAbort = onAbort
      }

      this.queue.push(item)
      this.pump()
    })
  }

  pump() {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const item = this.queue.shift()
      if (item.signal?.aborted) {
        item.resolve(null)
        continue
      }
      this.running++
      Promise.resolve()
        .then(() => item.taskFn())
        .then((result) => {
          if (item.signal && item.onAbort) {
            item.signal.removeEventListener('abort', item.onAbort)
          }
          item.resolve(result)
        })
        .catch((err) => {
          if (item.signal && item.onAbort) {
            item.signal.removeEventListener('abort', item.onAbort)
          }
          item.reject(err)
        })
        .finally(() => {
          this.running--
          this.pump()
        })
    }
  }

  clear() {
    while (this.queue.length > 0) {
      const item = this.queue.shift()
      if (item.signal && item.onAbort) {
        item.signal.removeEventListener('abort', item.onAbort)
      }
      item.resolve(null)
    }
  }
}

export const defaultRenderQueue = new RenderQueue(2)

// Render a page through the queue to avoid worker contention and timeout kills.
export async function renderPageToDataUrlQueued(pdf, pageNumber, options = {}) {
  const { queue = defaultRenderQueue, ...renderOptions } = options
  if (!queue) {
    return renderPageToDataUrl(pdf, pageNumber, renderOptions)
  }
  return queue.enqueue(
    () => renderPageToDataUrl(pdf, pageNumber, renderOptions),
    { signal: renderOptions.signal },
  )
}

// Bounded LRU cache for rendered thumbnails. Keys are caller-chosen strings
// (e.g. "12:0:0.5" = page 12, rotation 0, scale 0.5).
export class ThumbCache {
  constructor(max = 240) {
    this.max = max
    this.map = new Map()
  }

  get(key) {
    if (!this.map.has(key)) return undefined
    const value = this.map.get(key)
    // Refresh recency: move to the end.
    this.map.delete(key)
    this.map.set(key, value)
    return value
  }

  set(key, value) {
    if (this.map.has(key)) this.map.delete(key)
    this.map.set(key, value)
    if (this.map.size > this.max) {
      // Evict least-recently-used (first inserted).
      this.map.delete(this.map.keys().next().value)
    }
  }

  clear() {
    this.map.clear()
  }

  get size() {
    return this.map.size
  }
}
