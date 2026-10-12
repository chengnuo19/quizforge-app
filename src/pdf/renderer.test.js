import { describe, it, expect } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import {
  openPdf,
  renderPageToDataUrl,
  renderPageToDataUrlQueued,
  RenderQueue,
  ThumbCache,
  pageViewport,
} from './renderer.js'

// Create a small PDF with `n` pages so real pdf.js can parse and render it.
async function makePdfBytes(n = 3) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 1; i <= n; i++) {
    const page = doc.addPage([200, 300])
    page.drawText(`Page ${i}`, { x: 10, y: 10, size: 12, font })
  }
  return new Uint8Array(await doc.save())
}

// A fake canvas/2D-context that records nothing but produces a stable data URL.
// pdf.js only needs to call methods and set properties to complete a render —
// but a few are read back, so they must return neutral-but-shaped values.
function fakeCanvas() {
  const canvas = {
    width: 0,
    height: 0,
    toDataURL: () => 'data:image/jpeg;base64,ZmFrZQ==', // "fake"
  }
  const ctx = new Proxy(
    {},
    {
      get: (target, prop) => {
        if (prop === 'canvas') return canvas
        if (prop === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
        if (prop === 'measureText') return () => ({ width: 0 })
        return (..._args) => {}
      },
      set: () => true,
    },
  )
  canvas.getContext = () => ctx
  return canvas
}

describe('openPdf', () => {
  it('opens a document and reports the page count', async () => {
    const proxy = await openPdf(await makePdfBytes(4))
    expect(proxy.numPages).toBe(4)
    await proxy.destroy()
  })

  it('rejects non-PDF input', async () => {
    await expect(openPdf(new TextEncoder().encode('hello'))).rejects.toBeTruthy()
  })

  it('supports aborting an open via signal', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(openPdf(await makePdfBytes(2), { signal: controller.signal })).rejects.toThrow(
      '已取消',
    )
  })
})

describe('pageViewport', () => {
  it('computes a scaled, rotated viewport', async () => {
    const proxy = await openPdf(await makePdfBytes(1))
    const page = await proxy.pdf.getPage(1)
    const vp = pageViewport(page, { scale: 2, rotation: 90 })
    // 200x300 page rotated 90° → 600x400 at scale 2.
    expect(vp.width).toBeCloseTo(600, 0)
    expect(vp.height).toBeCloseTo(400, 0)
    await proxy.destroy()
  })
})

describe('renderPageToDataUrl', () => {
  it('renders a page to a JPEG data URL', async () => {
    const proxy = await openPdf(await makePdfBytes(2))
    const url = await renderPageToDataUrl(proxy.pdf, 1, {
      scale: 0.5,
      makeCanvas: fakeCanvas,
    })
    expect(url).toMatch(/^data:image\/jpeg/)
    await proxy.destroy()
  })

  it('returns null instead of throwing when aborted before rendering', async () => {
    const proxy = await openPdf(await makePdfBytes(2))
    const controller = new AbortController()
    controller.abort()
    const url = await renderPageToDataUrl(proxy.pdf, 1, {
      signal: controller.signal,
      makeCanvas: fakeCanvas,
    })
    expect(url).toBeNull()
    await proxy.destroy()
  })

  it('returns null for a page number outside the document', async () => {
    const proxy = await openPdf(await makePdfBytes(2))
    const url = await renderPageToDataUrl(proxy.pdf, 99, { makeCanvas: fakeCanvas })
    expect(url).toBeNull()
    await proxy.destroy()
  })
})

describe('ThumbCache', () => {
  it('stores and returns values, refreshing recency', () => {
    const c = new ThumbCache(3)
    c.set('a', 1)
    c.set('b', 2)
    c.set('c', 3)
    expect(c.get('a')).toBe(1) // a is now most-recent
    c.set('d', 4) // evicts oldest = b
    expect(c.get('b')).toBeUndefined()
    expect(c.get('a')).toBe(1)
    expect(c.get('d')).toBe(4)
  })

  it('never exceeds the cap', () => {
    const c = new ThumbCache(5)
    for (let i = 0; i < 50; i++) c.set(`k${i}`, i)
    expect(c.size).toBe(5)
  })

  it('clear() empties the cache', () => {
    const c = new ThumbCache(10)
    c.set('a', 1)
    c.clear()
    expect(c.size).toBe(0)
  })
})

describe('RenderQueue and renderPageToDataUrlQueued', () => {
  it('serializes tasks within concurrency bound', async () => {
    const q = new RenderQueue(1)
    const order = []
    const t1 = q.enqueue(async () => {
      order.push('start1')
      await new Promise((r) => setTimeout(r, 10))
      order.push('end1')
      return 1
    })
    const t2 = q.enqueue(async () => {
      order.push('start2')
      return 2
    })
    const res = await Promise.all([t1, t2])
    expect(res).toEqual([1, 2])
    expect(order).toEqual(['start1', 'end1', 'start2'])
  })

  it('drops cancelled tasks from queue before running', async () => {
    const q = new RenderQueue(1)
    const controller = new AbortController()
    let ran = false
    const blocker = q.enqueue(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    const cancelled = q.enqueue(
      async () => {
        ran = true
      },
      { signal: controller.signal },
    )
    controller.abort()
    await Promise.all([blocker, cancelled])
    expect(ran).toBe(false)
  })

  it('renders a queued page to a JPEG data URL', async () => {
    const proxy = await openPdf(await makePdfBytes(2))
    const url = await renderPageToDataUrlQueued(proxy.pdf, 1, {
      scale: 0.5,
      makeCanvas: fakeCanvas,
    })
    expect(url).toMatch(/^data:image\/jpeg/)
    await proxy.destroy()
  })
})
