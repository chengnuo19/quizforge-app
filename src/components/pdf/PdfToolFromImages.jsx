import { useRef, useState } from 'react'
import { imagesToPdf, savePdf, pageCount } from '../../pdf/engine.js'
import { sanitizeFilename } from '../../pdf/filename.js'
import { downloadBytes } from '../../pdf/export.js'

// Images → PDF: collect images, order them, choose a page size + margin, and
// embed them into a single PDF (fully offline, pdf-lib).
const PAGE_SIZES = {
  fit: { label: '适应图片', w: 0, h: 0 },
  a4: { label: 'A4 竖版', w: 595, h: 842 },
  a4l: { label: 'A4 横版', w: 842, h: 595 },
  a3: { label: 'A3 竖版', w: 842, h: 1191 },
  letter: { label: 'Letter', w: 612, h: 792 },
}

function uid() {
  return `img_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

export default function PdfToolFromImages({ exportBytes = downloadBytes }) {
  const inputRef = useRef(null)
  const [images, setImages] = useState([])
  const [pageSize, setPageSize] = useState('fit')
  const [margin, setMargin] = useState(12)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const addImages = async (fileList) => {
    setError('')
    const added = []
    for (const f of fileList) {
      const isPng = f.type === 'image/png' || /\.png$/i.test(f.name)
      const isJpeg = f.type === 'image/jpeg' || /\.jpe?g$/i.test(f.name)
      if (!isPng && !isJpeg) {
        added.push({ id: uid(), name: f.name, error: '不支持的图片格式（仅支持 PNG / JPEG）' })
        continue
      }
      try {
        const bytes = new Uint8Array(await f.arrayBuffer())
        added.push({ id: uid(), name: f.name, bytes })
      } catch (err) {
        added.push({ id: uid(), name: f.name, error: err.message })
      }
    }
    setImages((prev) => [...prev, ...added])
  }

  const move = (index, delta) => {
    setImages((prev) => {
      const next = [...prev]
      const target = index + delta
      if (target < 0 || target >= next.length) return prev
      const tmp = next[index]
      next[index] = next[target]
      next[target] = tmp
      return next
    })
  }

  const remove = (id) => setImages((prev) => prev.filter((i) => i.id !== id))

  const convert = async () => {
    const good = images.filter((i) => !i.error)
    if (good.length === 0) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const size = PAGE_SIZES[pageSize]
      const doc = await imagesToPdf(good, {
        pageWidth: size.w || undefined,
        pageHeight: size.h || undefined,
        margin: Number(margin) || 0,
      })
      const bytes = await savePdf(doc)
      const name =
        good.length === 1
          ? `${sanitizeFilename(good[0].name.replace(/\.[^.]+$/, ''))}_pdf.pdf`
          : `${sanitizeFilename('图片合集')}.pdf`
      exportBytes(bytes, name)
      setMessage(`已生成 ${pageCount(doc)} 页 PDF，开始下载：${name}`)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pdfwb-tool-pane">
      <div
        className="pdfwb-imgdrop"
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            inputRef.current?.click()
          }
        }}
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }}
        onDrop={(e) => {
          e.preventDefault()
          addImages(e.dataTransfer?.files)
        }}
      >
        <p className="pdfwb-tool-pane__hint">点击选择图片（可多选，PNG / JPEG）</p>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,.png,.jpg,.jpeg"
          multiple
          hidden
          onChange={(e) => {
            addImages(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      {images.length > 0 && (
        <ol className="pdfwb-merge-list">
          {images.map((img, index) => (
            <li key={img.id} className="pdfwb-merge-item">
              <span className="pdfwb-merge-item__num">{index + 1}</span>
              <span className="pdfwb-merge-item__name" title={img.name}>{img.name}</span>
              <span className={`pdfwb-merge-item__meta${img.error ? ' pdfwb-file__meta--error' : ''}`}>
                {img.error ? img.error : '图片'}
              </span>
              <div className="pdfwb-merge-item__actions">
                <button type="button" className="button button--secondary" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`上移 ${img.name}`}>↑</button>
                <button type="button" className="button button--secondary" onClick={() => move(index, 1)} disabled={index === images.length - 1} aria-label={`下移 ${img.name}`}>↓</button>
                <button type="button" className="button button--secondary" onClick={() => remove(img.id)} aria-label={`移除 ${img.name}`}>×</button>
              </div>
            </li>
          ))}
        </ol>
      )}

      <div className="pdfwb-tool-pane__row">
        <label className="pdfwb-tool-pane__label">页面尺寸</label>
        <select className="book-editor__input" value={pageSize} onChange={(e) => setPageSize(e.target.value)} aria-label="页面尺寸">
          {Object.entries(PAGE_SIZES).map(([key, s]) => (
            <option key={key} value={key}>{s.label}</option>
          ))}
        </select>
      </div>

      <div className="pdfwb-tool-pane__row">
        <label className="pdfwb-tool-pane__label">留白 {margin} pt</label>
        <input
          type="range"
          min={0}
          max={40}
          step={2}
          value={margin}
          onChange={(e) => setMargin(Number(e.target.value))}
          aria-label="页面留白"
        />
      </div>

      <button type="button" className="button button--primary" onClick={convert} disabled={busy || images.filter((i) => !i.error).length === 0}>
        {busy ? '正在生成…' : '转换为 PDF'}
      </button>

      {message && <p className="pdfwb-tool-pane__result">{message}</p>}
      {error && <p className="uploader__error">{error}</p>}
    </div>
  )
}
