import { useCallback, useEffect, useRef, useState } from 'react'
import PdfThumb from './PdfThumb.jsx'
import { ThumbCache } from '../../pdf/renderer.js'

// Virtualized, lazy page grid. Only rows near the scroll window are mounted as
// tiles (each tile renders its thumbnail on demand and cancels on unmount);
// completed thumbnails are cached so scrolling back is instant and memory stays
// bounded even for 300+ page documents.

const TILE_W = 150
const GAP = 12
const ROW_RATIO = 4 / 3 // tile aspect (3:4 portrait)
const MARGIN_ROWS = 2 // render this many extra rows above/below the viewport

export default function PdfPageGrid({
  pdf,
  pageCount,
  thumbScale = 0.5,
  rotationByPage,
  order,
  selected,
  onPageClick,
  onTileDragStart,
  onTileDrop,
  ariaLabel,
}) {
  const containerRef = useRef(null)
  const cacheRef = useRef(new ThumbCache(240))
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 600 })
  const [columns, setColumns] = useState(4)

  const rowH = TILE_W * ROW_RATIO + GAP

  const updateLayout = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    setColumns(Math.max(1, Math.floor((el.clientWidth - GAP) / (TILE_W + GAP))))
    // clientHeight can be 0 before layout (or in test environments); fall back
    // to a screenful so the grid still mounts tiles until real layout arrives.
    setViewport({ scrollTop: el.scrollTop, height: el.clientHeight || 600 })
  }, [])

  useEffect(() => {
    updateLayout()
    const el = containerRef.current
    if (!el) return
    el.addEventListener('scroll', updateLayout, { passive: true })
    let ro
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(updateLayout)
      ro.observe(el)
    }
    return () => {
      el.removeEventListener('scroll', updateLayout)
      if (ro) ro.disconnect()
    }
  }, [updateLayout, pdf, pageCount])

  const rows = Math.max(1, Math.ceil(pageCount / columns))
  const firstRow = Math.max(0, Math.floor(viewport.scrollTop / rowH) - MARGIN_ROWS)
  const lastRow = Math.min(rows, Math.ceil((viewport.scrollTop + viewport.height) / rowH) + MARGIN_ROWS)

  const visible = []
  for (let r = firstRow; r < lastRow; r++) {
    for (let c = 0; c < columns; c++) {
      const idx = r * columns + c
      if (idx < pageCount) visible.push(idx)
    }
  }

  const rotationFn = rotationByPage || (() => 0)
  // `order` maps display positions → original page indices (0-based). Without
  // it the grid is identity (page N renders page N).
  const pageNumOf = (idx) => (order ? order[idx] + 1 : idx + 1)

  return (
    <div className="pdfwb-gridscroll" ref={containerRef} aria-label={ariaLabel}>
      <div className="pdfwb-gridspacer" style={{ height: rows * rowH + GAP }}>
        {visible.map((idx) => (
          <div
            key={idx}
            className={`pdfwb-tile${onPageClick ? ' pdfwb-tile--clickable' : ''}${
              selected?.has(idx) ? ' pdfwb-tile--selected' : ''
            }`}
            style={{
              position: 'absolute',
              top: Math.floor(idx / columns) * rowH + GAP,
              left: (idx % columns) * (TILE_W + GAP) + GAP,
              width: TILE_W,
            }}
            data-page={pageNumOf(idx)}
            onClick={onPageClick ? (e) => onPageClick(idx, e) : undefined}
            onKeyDown={
              onPageClick
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onPageClick(idx, e)
                    }
                  }
                : undefined
            }
            role={onPageClick ? 'button' : undefined}
            tabIndex={onPageClick ? 0 : undefined}
            aria-label={`第 ${pageNumOf(idx)} 页${selected?.has(idx) ? '（已选择）' : ''}`}
            draggable={onTileDragStart ? true : undefined}
            onDragStart={
              onTileDragStart
                ? (e) => {
                    onTileDragStart(idx)
                    e.dataTransfer.effectAllowed = 'move'
                    try {
                      e.dataTransfer.setData('text/plain', String(idx))
                    } catch {
                      /* some browsers require a value */
                    }
                  }
                : undefined
            }
            onDragOver={
              onTileDrop
                ? (e) => {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                  }
                : undefined
            }
            onDrop={
              onTileDrop
                ? (e) => {
                    e.preventDefault()
                    onTileDrop(idx)
                  }
                : undefined
            }
          >
            <PdfThumb
              pdf={pdf}
              pageNumber={pageNumOf(idx)}
              scale={thumbScale}
              rotation={rotationFn(idx)}
              cache={cacheRef.current}
            />
            <span className="pdfwb-tile__num">{pageNumOf(idx)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
