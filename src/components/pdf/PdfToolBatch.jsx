import { useState } from 'react'
import { rotatePages, mergeDocs, compressPdf, savePdf, pageCount } from '../../pdf/engine.js'
import { reencodeImage } from '../../pdf/imageRecompress.js'
import { renderPageToDataUrl } from '../../pdf/renderer.js'
import { outputFilename, sanitizeFilename } from '../../pdf/filename.js'
import { downloadBytes, downloadMany } from '../../pdf/export.js'

// Batch tool: run one operation over every loaded PDF with a per-file queue
// (待处理 → 处理中 → 完成 / 失败). A failing file never stops the batch.

const STATUS = {
  pending: '待处理',
  processing: '处理中…',
  done: '完成',
  failed: '失败',
}

function statusClass(s) {
  return `pdfwb-batch__status pdfwb-batch__status--${s}`
}

export default function PdfToolBatch({ files }) {
  const goodFiles = files.filter((f) => !f.error && f.doc)
  const [op, setOp] = useState('compress')
  const [running, setRunning] = useState(false)
  const [statuses, setStatuses] = useState({}) // fileId -> { status, error? }

  const setStatus = (id, status, error) =>
    setStatuses((prev) => ({ ...prev, [id]: { status, error } }))

  const run = async () => {
    if (goodFiles.length === 0) return
    setRunning(true)
    setStatuses({})
    try {
      if (op === 'merge') {
        await runMerge()
      } else {
        for (const file of goodFiles) {
          setStatus(file.id, 'processing')
          try {
            await runOne(file)
            setStatus(file.id, 'done')
          } catch (err) {
            setStatus(file.id, 'failed', err.message)
          }
        }
      }
    } finally {
      setRunning(false)
    }
  }

  const runOne = async (file) => {
    if (op === 'rotate') {
      const out = await savePdf(rotatePages(file.doc, Array.from({ length: file.pageCount }, (_, i) => i + 1), 90))
      downloadBytes(out, outputFilename(file.name, { suffix: '_rotated' }))
    } else if (op === 'compress') {
      const { bytes } = await compressPdf(file.doc, { level: 'medium', reencodeImage })
      downloadBytes(bytes, outputFilename(file.name, { suffix: '_compressed' }))
    } else if (op === 'convert') {
      const base = sanitizeFilename(file.name).replace(/\.pdf$/i, '')
      const items = []
      for (let p = 1; p <= file.pageCount; p++) {
        const dataUrl = await renderPageToDataUrl(file.renderProxy?.pdf, p, { scale: 1.5 })
        if (dataUrl) {
          const b64 = dataUrl.split(',')[1]
          const bin = atob(b64)
          const bytes = new Uint8Array(bin.length)
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
          items.push({ bytes, name: `${base}_page_${p}.jpg` })
        }
      }
      if (items.length) await downloadMany(items)
    }
  }

  const runMerge = async () => {
    const merged = await mergeDocs(goodFiles.map((f) => f.doc))
    const bytes = await savePdf(merged)
    const name = outputFilename(goodFiles[0].name, { suffix: `_merged_${goodFiles.length}` })
    downloadBytes(bytes, name)
    // Mark every file done for the merge pass.
    setStatuses(
      Object.fromEntries(goodFiles.map((f) => [f.id, { status: 'done' }])),
    )
  }

  if (goodFiles.length < 2) {
    return (
      <div className="pdfwb-tool-pane">
        <p className="pdfwb-tool-pane__hint">至少需要 2 个 PDF 才能批量处理（合并需要 ≥2 个）。</p>
      </div>
    )
  }

  const ops = [
    { id: 'rotate', label: '全部旋转 90°' },
    { id: 'compress', label: '全部压缩（中）' },
    { id: 'convert', label: '全部转图片' },
    { id: 'merge', label: '全部合并为一个' },
  ]

  return (
    <div className="pdfwb-tool-pane">
      <div className="pdfwb-tool-pane__row">
        {ops.map((o) => (
          <label key={o.id} className="pdfwb-radio">
            <input type="radio" name="batch-op" checked={op === o.id} onChange={() => setOp(o.id)} disabled={running} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>

      <button type="button" className="button button--primary" onClick={run} disabled={running}>
        {running ? '处理中…' : '开始批量处理'}
      </button>

      <ul className="pdfwb-batch-list">
        {goodFiles.map((f) => {
          const s = statuses[f.id]?.status || 'pending'
          return (
            <li key={f.id} className="pdfwb-batch-item">
              <span className="pdfwb-batch__name" title={f.name}>{f.name}</span>
              <span className="pdfwb-batch__meta">{f.pageCount} 页</span>
              <span className={statusClass(s)}>{STATUS[s]}</span>
              {statuses[f.id]?.error && (
                <span className="pdfwb-batch__error" title={statuses[f.id].error}>{statuses[f.id].error}</span>
              )}
            </li>
          )
        })}
      </ul>

      {running && (
        <p className="pdfwb-tool-pane__hint">
          已完成 {Object.values(statuses).filter((s) => s.status === 'done').length} / {goodFiles.length}，单个文件出错不会中断批量任务。
        </p>
      )}
    </div>
  )
}
