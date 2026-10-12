import { useMemo, useState } from 'react'
import { compressPdf, estimateCompressedSize, COMPRESS_LEVELS } from '../../pdf/engine.js'
import { reencodeImage } from '../../pdf/imageRecompress.js'
import { outputFilename } from '../../pdf/filename.js'
import { downloadBytes } from '../../pdf/export.js'

function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

// Compress tool: re-serialize with object streams + re-encode embedded JPEG
// images (medium/high). Text is never touched; the default level is medium.
export default function PdfToolCompress({ file, exportBytes = downloadBytes }) {
  const usable = file && !file.error && file.doc
  const [level, setLevel] = useState('medium')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  const originalSize = usable ? file.size : 0
  const estimated = useMemo(() => estimateCompressedSize(originalSize, level), [originalSize, level])

  const run = async () => {
    if (!usable) return
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const { bytes, reencodedImages } = await compressPdf(file.doc, { level, reencodeImage })
      const name = outputFilename(file.name, { suffix: '_compressed' })
      exportBytes(bytes, name)
      setResult({
        name,
        original: originalSize,
        final: bytes.length,
        reencodedImages,
      })
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

  const compression = result ? Math.max(0, Math.round((1 - result.final / result.original) * 100)) : null

  return (
    <div className="pdfwb-tool-pane">
      <p className="pdfwb-tool-pane__hint">
        压缩只重新编码文档内嵌的 JPEG 图片（默认不改变文字清晰度），并重新序列化文档。
      </p>

      <div className="pdfwb-compress-levels">
        {Object.entries(COMPRESS_LEVELS).map(([key, cfg]) => (
          <label key={key} className={`pdfwb-compress-level${level === key ? ' pdfwb-compress-level--active' : ''}`}>
            <input
              type="radio"
              name="compress-level"
              checked={level === key}
              onChange={() => setLevel(key)}
            />
            <span className="pdfwb-compress-level__title">{cfg.label}</span>
          </label>
        ))}
      </div>

      <div className="pdfwb-compress-sizes">
        <div className="pdfwb-compress-size">
          <span className="pdfwb-compress-size__label">原始大小</span>
          <strong>{formatSize(originalSize)}</strong>
        </div>
        <div className="pdfwb-compress-size">
          <span className="pdfwb-compress-size__label">预计大小</span>
          <strong>{formatSize(estimated)}</strong>
          <span className="pdfwb-compress-size__delta">
            （约 -{Math.max(0, Math.round((1 - estimated / originalSize) * 100))}%）
          </span>
        </div>
        {result && (
          <div className="pdfwb-compress-size">
            <span className="pdfwb-compress-size__label">最终大小</span>
            <strong>{formatSize(result.final)}</strong>
            <span className="pdfwb-compress-size__delta">
              （-{compression}%，重编码 {result.reencodedImages} 张图片）
            </span>
          </div>
        )}
      </div>

      <button type="button" className="button button--primary" onClick={run} disabled={busy}>
        {busy ? '正在压缩…' : '压缩并下载'}
      </button>

      {error && <p className="uploader__error">{error}</p>}
    </div>
  )
}
