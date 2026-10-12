import { useEffect, useState } from 'react'
import { renderPageToDataUrlQueued } from '../../pdf/renderer.js'

// One lazy page thumbnail. Renders on mount (or serves from `cache`), cancels
// its own render on unmount — so a fast-scrolling grid automatically aborts
// stale tasks without any cross-component signal plumbing.
// Uses a FIFO concurrency queue to prevent worker starvation and timeouts on large docs.
export default function PdfThumb({ pdf, pageNumber, scale = 0.5, rotation = 0, cache }) {
  const cacheKey = `${pageNumber}:${rotation}:${scale}`
  const [url, setUrl] = useState(() => cache?.get(cacheKey) || '')
  const [error, setError] = useState(false)
  const [retryCount, setRetryCount] = useState(0)

  useEffect(() => {
    const cached = cache?.get(cacheKey)
    if (cached) {
      setUrl(cached)
      setError(false)
      return
    }
    const controller = new AbortController()
    let cancelled = false
    // 30s timeout to allow heavy/scanned pages sufficient decode & render time in the queue
    const timeout = setTimeout(() => controller.abort(), 30000)

    renderPageToDataUrlQueued(pdf, pageNumber, {
      scale,
      rotation,
      signal: controller.signal,
    })
      .then((dataUrl) => {
        if (cancelled) return
        if (dataUrl) {
          cache?.set(cacheKey, dataUrl)
          setUrl(dataUrl)
          setError(false)
        } else {
          setError(true)
        }
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })

    return () => {
      cancelled = true
      clearTimeout(timeout)
      controller.abort()
    }
  }, [cacheKey, pdf, cache, retryCount])

  if (url) {
    return (
      <img
        className="pdfwb-thumb__img"
        src={url}
        alt={`第 ${pageNumber} 页`}
        draggable={false}
      />
    )
  }

  if (error) {
    return (
      <div
        className="pdfwb-thumb pdfwb-thumb--error"
        title="点击重新加载该页"
        aria-label={`第 ${pageNumber} 页渲染失败`}
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation()
          setError(false)
          setRetryCount((c) => c + 1)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.stopPropagation()
            e.preventDefault()
            setError(false)
            setRetryCount((c) => c + 1)
          }
        }}
      >
        <span className="pdfwb-thumb__error-icon" aria-hidden="true">⚠️</span>
        <span className="pdfwb-thumb__error-text">加载失败</span>
        <span className="pdfwb-thumb__retry-btn">点击重试</span>
      </div>
    )
  }

  return (
    <div className="pdfwb-thumb pdfwb-thumb--loading" aria-label={`第 ${pageNumber} 页加载中`}>
      <div className="pdfwb-thumb__spinner" aria-hidden="true" />
    </div>
  )
}
