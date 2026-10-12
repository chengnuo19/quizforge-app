import { useState } from 'react'
import { reorderDoc, savePdf } from '../../pdf/engine.js'
import { parsePageRanges, splitEveryN } from '../../pdf/pageRanges.js'
import { outputFilename } from '../../pdf/filename.js'
import { downloadBytes, downloadMany } from '../../pdf/export.js'

// Split tool: break one PDF into parts by explicit page ranges, every N pages,
// or one file per page. Parts are built in memory and shown as a result list
// with per-part download buttons (so N parts never fight over a single user
// gesture).
export default function PdfToolSplit({ file, exportBytes = downloadBytes }) {
  const [mode, setMode] = useState('ranges') // 'ranges' | 'every' | 'single'
  const [rangesText, setRangesText] = useState('')
  const [everyN, setEveryN] = useState(5)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [parts, setParts] = useState([])

  const usable = file && !file.error && file.doc

  const computeRanges = () => {
    if (!usable) return []
    if (mode === 'ranges') return parsePageRanges(rangesText, file.pageCount)
    if (mode === 'every') return splitEveryN(file.pageCount, Number(everyN))
    return splitEveryN(file.pageCount, 1) // single
  }

  const run = async () => {
    setError('')
    setParts([])
    let ranges
    try {
      ranges = computeRanges()
    } catch (err) {
      setError(err.message)
      return
    }
    if (ranges.length === 0) {
      setError('没有可拆分的页面。')
      return
    }
    setBusy(true)
    try {
      const built = []
      for (let i = 0; i < ranges.length; i++) {
        const { start, end } = ranges[i]
        const indices = []
        for (let p = start; p <= end; p++) indices.push(p - 1)
        const out = await reorderDoc(file.doc, indices)
        const bytes = await savePdf(out)
        built.push({
          bytes,
          name: outputFilename(file.name, { suffix: `_split_${i + 1}` }),
          pages: end - start + 1,
          size: bytes.length,
        })
      }
      setParts(built)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (!usable) {
    return (
      <div className="pdfwb-tool-pane">
        <p className="pdfwb-tool-pane__hint">请先在左侧选择或加载一个 PDF 文件。</p>
      </div>
    )
  }

  return (
    <div className="pdfwb-tool-pane">
      <div className="pdfwb-tool-pane__row">
        <label className="pdfwb-radio">
          <input type="radio" name="split-mode" checked={mode === 'ranges'} onChange={() => setMode('ranges')} />
          <span>按页码区间</span>
        </label>
        <label className="pdfwb-radio">
          <input type="radio" name="split-mode" checked={mode === 'every'} onChange={() => setMode('every')} />
          <span>每 N 页一份</span>
        </label>
        <label className="pdfwb-radio">
          <input type="radio" name="split-mode" checked={mode === 'single'} onChange={() => setMode('single')} />
          <span>每页一份</span>
        </label>
      </div>

      {mode === 'ranges' && (
        <div className="pdfwb-tool-pane__row">
          <input
            type="text"
            className="book-editor__input"
            value={rangesText}
            onChange={(e) => setRangesText(e.target.value)}
            placeholder={`如：1-5, 6-10, 15（文档共 ${file.pageCount} 页）`}
            aria-label="页码区间"
          />
        </div>
      )}
      {mode === 'every' && (
        <div className="pdfwb-tool-pane__row">
          <input
            type="number"
            min="1"
            max={file.pageCount}
            className="book-editor__input"
            style={{ width: 120 }}
            value={everyN}
            onChange={(e) => setEveryN(e.target.value)}
            aria-label="每份页数"
          />
          <span className="pdfwb-tool-pane__hint">页/份</span>
        </div>
      )}

      <button type="button" className="button button--primary" onClick={run} disabled={busy}>
        {busy ? '正在拆分…' : '拆分'}
      </button>

      {error && <p className="uploader__error">{error}</p>}

      {parts.length > 0 && (
        <div className="pdfwb-parts">
          <div className="pdfwb-parts__head">
            <span>共 {parts.length} 份</span>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => downloadMany(parts)}
              disabled={busy}
            >
              全部下载
            </button>
          </div>
          <ul className="pdfwb-parts__list">
            {parts.map((p, i) => (
              <li key={i} className="pdfwb-parts__item">
                <span className="pdfwb-parts__name" title={p.name}>{p.name}</span>
                <span className="pdfwb-parts__meta">{p.pages} 页 · {(p.size / 1024).toFixed(1)} KB</span>
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => exportBytes(p.bytes, p.name)}
                >
                  下载
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
