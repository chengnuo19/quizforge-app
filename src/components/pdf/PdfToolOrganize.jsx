import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import PdfPageGrid from './PdfPageGrid.jsx'
import { reorderDoc, savePdf, applyRotations } from '../../pdf/engine.js'
import { outputFilename } from '../../pdf/filename.js'
import { downloadBytes } from '../../pdf/export.js'

// Organize tool — the visual page editor: reorder (drag&drop), rotate, delete,
// duplicate, multi-select, extract selected pages, and export. Runs entirely
// on the ORIGINAL render proxy (no re-open per op): the display order lives in
// `order` and per-page user rotation in `rotMap`; the working PDF is only
// rebuilt when exporting.

export default function PdfToolOrganize({ file, exportBytes = downloadBytes }) {
  const usable = file && !file.error && file.doc && file.renderProxy

  const [order, setOrder] = useState(() =>
    usable ? Array.from({ length: file.pageCount }, (_, i) => i) : [],
  )
  const [rotMap, setRotMap] = useState(() => new Map())
  const [selectedOrig, setSelectedOrig] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lastClickPos = useRef(null)
  const dragPos = useRef(null)

  // Reset per-file session state when switching files.
  useEffect(() => {
    setOrder(usable ? Array.from({ length: file.pageCount }, (_, i) => i) : [])
    setRotMap(new Map())
    setSelectedOrig(new Set())
    lastClickPos.current = null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.id, usable])

  // Display positions of the currently selected original pages.
  const selectedPositions = useMemo(() => {
    const set = new Set()
    order.forEach((orig, pos) => {
      if (selectedOrig.has(orig)) set.add(pos)
    })
    return set
  }, [order, selectedOrig])

  const toggleSelect = useCallback(
    (pos, { additive = false, range = false } = {}) => {
      const orig = order[pos]
      if (orig === undefined) return
      setSelectedOrig((prev) => {
        const next = new Set(prev)
        if (range && lastClickPos.current != null) {
          const from = Math.min(lastClickPos.current, pos)
          const to = Math.max(lastClickPos.current, pos)
          for (let p = from; p <= to; p++) next.add(order[p])
        } else if (additive) {
          if (next.has(orig)) next.delete(orig)
          else next.add(orig)
        } else {
          const onlyThisSelected = next.size === 1 && next.has(orig)
          next.clear()
          if (!onlyThisSelected) next.add(orig)
        }
        return next
      })
      lastClickPos.current = pos
    },
    [order],
  )

  const clearSelection = () => setSelectedOrig(new Set())

  const rotateSelected = (angle) => {
    if (selectedOrig.size === 0) return
    setRotMap((prev) => {
      const next = new Map(prev)
      for (const orig of selectedOrig) {
        next.set(orig, ((next.get(orig) || 0) + angle) % 360)
      }
      return next
    })
  }

  const deleteSelected = () => {
    if (selectedOrig.size === 0) return
    setOrder((prev) => prev.filter((orig) => !selectedOrig.has(orig)))
    setSelectedOrig(new Set())
  }

  const duplicateSelected = () => {
    if (selectedOrig.size === 0) return
    setOrder((prev) => [...prev, ...prev.filter((orig) => selectedOrig.has(orig))])
  }

  const selectAll = () => {
    setSelectedOrig(new Set(order))
  }

  // Move the pages currently at `fromPositions` so they land at `toPos`
  // (0-based, clamped). Used by drag&drop.
  const moveGroup = (fromPositions, toPos) => {
    if (!fromPositions.length) return
    setOrder((prev) => {
      const moving = fromPositions.map((p) => prev[p]).filter((o) => o !== undefined)
      const movingSet = new Set(moving)
      const remaining = prev.filter((o) => !movingSet.has(o))
      const insertAt = Math.max(0, Math.min(toPos, remaining.length))
      return [
        ...remaining.slice(0, insertAt),
        ...moving,
        ...remaining.slice(insertAt),
      ]
    })
  }

  const onDrop = (toPos) => {
    const from = dragPos.current
    dragPos.current = null
    if (from == null || from === toPos) return
    // Dragging a selected tile moves the whole selection; otherwise one tile.
    const fromPositions = selectedPositions.has(from) ? [...selectedPositions] : [from]
    moveGroup(fromPositions, toPos)
  }

  // Rebuild a PDF that reflects current order + per-page rotations.
  const buildCurrentPdf = useCallback(async () => {
    const out = await reorderDoc(file.doc, order)
    const entries = []
    order.forEach((orig, pos) => {
      const angle = rotMap.get(orig)
      if (angle) entries.push({ pageNumber: pos + 1, angle })
    })
    applyRotations(out, entries)
    return out
  }, [file, order, rotMap])

  const exportPdf = async (suffix) => {
    setBusy(true)
    setError('')
    try {
      const out = await buildCurrentPdf()
      const bytes = await savePdf(out)
      exportBytes(bytes, outputFilename(file.name, { suffix }))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const extractSelected = async () => {
    if (selectedOrig.size === 0) return
    setBusy(true)
    setError('')
    try {
      const selOrder = order.filter((orig) => selectedOrig.has(orig))
      const out = await reorderDoc(file.doc, selOrder)
      const entries = selOrder
        .map((orig, pos) => ({ angle: rotMap.get(orig) || 0, pos }))
        .filter((e) => e.angle)
        .map((e) => ({ pageNumber: e.pos + 1, angle: e.angle }))
      applyRotations(out, entries)
      const bytes = await savePdf(out)
      exportBytes(bytes, outputFilename(file.name, { suffix: '_extracted' }))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  // Keyboard shortcuts (focus is on the grid container).
  const onKeyDown = (e) => {
    if (e.key === 'Escape') clearSelection()
    else if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      selectAll()
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      deleteSelected()
    } else if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey) {
      rotateSelected(90)
    } else if ((e.key === 'd' || e.key === 'D') && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      duplicateSelected()
    }
  }

  if (!usable) {
    return (
      <div className="pdfwb-tool-pane">
        <p className="pdfwb-tool-pane__hint">请先加载一个 PDF 文件。</p>
      </div>
    )
  }

  const selCount = selectedOrig.size

  return (
    <div className="pdfwb-tool-pane pdfwb-tool-pane--organize">
      <div className="pdfwb-organize-toolbar">
        <button type="button" className="button button--secondary" onClick={() => rotateSelected(90)} disabled={!selCount || busy}>
          旋转 90°<span className="pdfwb-kbd">R</span>
        </button>
        <button type="button" className="button button--secondary" onClick={() => rotateSelected(180)} disabled={!selCount || busy}>
          旋转 180°
        </button>
        <button type="button" className="button button--secondary" onClick={() => rotateSelected(270)} disabled={!selCount || busy}>
          旋转 270°
        </button>
        <button type="button" className="button button--secondary" onClick={duplicateSelected} disabled={!selCount || busy}>
          复制<span className="pdfwb-kbd">Ctrl+D</span>
        </button>
        <button type="button" className="button button--secondary" onClick={deleteSelected} disabled={!selCount || busy}>
          删除<span className="pdfwb-kbd">Del</span>
        </button>
        <button type="button" className="button button--secondary" onClick={extractSelected} disabled={!selCount || busy}>
          提取选中
        </button>
        <button type="button" className="button button--secondary" onClick={selectAll} disabled={busy}>
          全选<span className="pdfwb-kbd">Ctrl+A</span>
        </button>
      </div>

      <div className="pdfwb-organize-status">
        {selCount > 0 ? `已选择 ${selCount} 页` : `${order.length} 页`} · 拖拽可排序
      </div>

      <div
        className="pdfwb-organize-grid"
        tabIndex={0}
        onKeyDown={onKeyDown}
        aria-label="页面整理画布（可旋转、删除、排序）"
      >
        <PdfPageGrid
          pdf={file.renderProxy.pdf}
          pageCount={order.length}
          order={order}
          rotationByPage={(pos) => rotMap.get(order[pos]) || 0}
          selected={selectedPositions}
          onPageClick={(pos, e) =>
            toggleSelect(pos, { additive: e?.ctrlKey || e?.metaKey, range: e?.shiftKey })
          }
          onTileDragStart={(pos) => {
            dragPos.current = pos
          }}
          onTileDrop={(pos) => onDrop(pos)}
          ariaLabel={`${file.name} 页面网格（整理）`}
        />
      </div>

      <div className="pdfwb-organize-footer">
        <button type="button" className="button button--primary" onClick={() => exportPdf('_organized')} disabled={busy || order.length === 0}>
          {busy ? '正在导出…' : '导出 PDF'}
        </button>
        {error && <p className="uploader__error">{error}</p>}
      </div>
    </div>
  )
}
