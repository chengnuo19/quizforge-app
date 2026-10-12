import { useState } from 'react'
import { renderPageToDataUrl } from '../../pdf/renderer.js'
import { sanitizeFilename } from '../../pdf/filename.js'
import { downloadMany } from '../../pdf/export.js'
import { parsePageRanges, expandRanges } from '../../pdf/pageRanges.js'

function base64ToBytes(b64) {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

// PDF → Images: render each page (or a chosen range) to PNG/JPEG at a chosen
// DPI. Used for question screenshots, courseware and study materials.
export default function PdfToolToImages({ file }) {
  const usable = file && !file.error && file.renderProxy
  const [format, setFormat] = useState('jpeg')
  const [dpi, setDpi] = useState(144)
  const [quality, setQuality] = useState(0.85)
  const [range, setRange] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const convert = async () => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      let pageNumbers
      if (range.trim()) {
        pageNumbers = expandRanges(parsePageRanges(range, file.pageCount))
      } else {
        pageNumbers = Array.from({ length: file.pageCount }, (_, i) => i + 1)
      }
      const base = sanitizeFilename(file.name).replace(/\.pdf$/i, '')
      const ext = format === 'png' ? 'png' : 'jpg'
      const scale = Number(dpi) / 72
      const items = []
      for (let i = 0; i < pageNumbers.length; i++) {
        setMessage(`正在转换第 ${i + 1}/${pageNumbers.length} 页…`)
        const dataUrl = await renderPageToDataUrl(file.renderProxy.pdf, pageNumbers[i], {
          scale,
          dataUrlType: format === 'png' ? 'image/png' : 'image/jpeg',
          dataUrlQuality: quality,
        })
        if (dataUrl) {
          items.push({
            bytes: base64ToBytes(dataUrl.split(',')[1]),
            name: `${base}_page_${pageNumbers[i]}.${ext}`,
          })
        }
      }
      if (items.length === 0) throw new Error('没有成功转换出任何图片。')
      await downloadMany(items)
      setMessage(`已生成 ${items.length} 张图片（${Number(dpi)} DPI）。`)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (!usable) {
    return (
      <div className="pdfwb-tool-pane">
        <p className="pdfwb-tool-pane__hint">请先加载一个 PDF 文件。</p>
      </div>
    )
  }

  return (
    <div className="pdfwb-tool-pane">
      <div className="pdfwb-tool-pane__row">
        <label className="pdfwb-radio">
          <input type="radio" name="img-format" checked={format === 'png'} onChange={() => setFormat('png')} />
          <span>PNG</span>
        </label>
        <label className="pdfwb-radio">
          <input type="radio" name="img-format" checked={format === 'jpeg'} onChange={() => setFormat('jpeg')} />
          <span>JPEG</span>
        </label>
      </div>

      <div className="pdfwb-tool-pane__row">
        <label className="pdfwb-tool-pane__label">DPI</label>
        <select className="book-editor__input" value={dpi} onChange={(e) => setDpi(Number(e.target.value))} aria-label="DPI">
          <option value={72}>72（屏幕）</option>
          <option value={96}>96</option>
          <option value={144}>144</option>
          <option value={192}>192</option>
          <option value={288}>288（打印）</option>
        </select>
      </div>

      {format === 'jpeg' && (
        <div className="pdfwb-tool-pane__row">
          <label className="pdfwb-tool-pane__label">质量 {Math.round(quality * 100)}%</label>
          <input
            type="range"
            min={0.4}
            max={1}
            step={0.05}
            value={quality}
            onChange={(e) => setQuality(Number(e.target.value))}
            aria-label="JPEG 质量"
          />
        </div>
      )}

      <div className="pdfwb-tool-pane__row">
        <label className="pdfwb-tool-pane__label">页面</label>
        <input
          type="text"
          className="book-editor__input"
          value={range}
          onChange={(e) => setRange(e.target.value)}
          placeholder={`留空 = 全部（共 ${file.pageCount} 页），或如：1-3, 5`}
          aria-label="页面范围"
        />
      </div>

      <button type="button" className="button button--primary" onClick={convert} disabled={busy}>
        {busy ? '正在转换…' : '转换为图片'}
      </button>

      {message && <p className="pdfwb-tool-pane__result">{message}</p>}
      {error && <p className="uploader__error">{error}</p>}
    </div>
  )
}
