import { useMemo, useState } from 'react'
import { mergeDocs, savePdf, pageCount } from '../../pdf/engine.js'
import { outputFilename } from '../../pdf/filename.js'
import { downloadBytes } from '../../pdf/export.js'

// Merge tool: pick several loaded PDFs, reorder them, combine into one.
// Reorders via accessible up/down buttons (drag-reorder is reserved for the
// Organize tool). Works entirely offline.
export default function PdfToolMerge({ files, exportBytes = downloadBytes }) {
  const goodFiles = useMemo(() => files.filter((f) => !f.error), [files])
  const [order, setOrder] = useState(() => goodFiles.map((f) => f.id))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  const ordered = useMemo(
    () => order.map((id) => goodFiles.find((f) => f.id === id)).filter(Boolean),
    [order, goodFiles],
  )

  const move = (index, delta) => {
    setOrder((prev) => {
      const next = [...prev]
      const target = index + delta
      if (target < 0 || target >= next.length) return prev
      const tmp = next[index]
      next[index] = next[target]
      next[target] = tmp
      return next
    })
  }

  const merge = async () => {
    if (ordered.length < 1) return
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const merged = await mergeDocs(ordered.map((f) => f.doc))
      const bytes = await savePdf(merged)
      const name = outputFilename(ordered[0].name, { suffix: '_merged' })
      exportBytes(bytes, name)
      setResult({ name, pages: pageCount(merged), size: bytes.length, count: ordered.length })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (goodFiles.length < 2) {
    return (
      <div className="pdfwb-tool-pane">
        <p className="pdfwb-tool-pane__hint">
          至少需要 2 个 PDF 才能合并。请先在左侧加载多个文件。
        </p>
      </div>
    )
  }

  return (
    <div className="pdfwb-tool-pane">
      <p className="pdfwb-tool-pane__hint">调整合并顺序，然后点击「合并 PDF」。</p>
      <ol className="pdfwb-merge-list">
        {ordered.map((f, index) => (
          <li key={f.id} className="pdfwb-merge-item">
            <span className="pdfwb-merge-item__num">{index + 1}</span>
            <span className="pdfwb-merge-item__name" title={f.name}>{f.name}</span>
            <span className="pdfwb-merge-item__meta">{f.pageCount} 页</span>
            <div className="pdfwb-merge-item__actions">
              <button
                type="button"
                className="button button--secondary"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                aria-label={`上移 ${f.name}`}
              >
                ↑
              </button>
              <button
                type="button"
                className="button button--secondary"
                onClick={() => move(index, 1)}
                disabled={index === ordered.length - 1}
                aria-label={`下移 ${f.name}`}
              >
                ↓
              </button>
            </div>
          </li>
        ))}
      </ol>

      <button
        type="button"
        className="button button--primary"
        onClick={merge}
        disabled={busy || ordered.length < 1}
      >
        {busy ? '正在合并…' : '合并 PDF'}
      </button>

      {error && <p className="uploader__error">{error}</p>}
      {result && (
        <p className="pdfwb-tool-pane__result">
          已合并 {result.count} 个文件共 {result.pages} 页（{(result.size / 1024).toFixed(1)} KB），已开始下载：{result.name}
        </p>
      )}
    </div>
  )
}
