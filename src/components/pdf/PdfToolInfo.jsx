import { useEffect, useState } from 'react'

// PDF 信息 (Academic PDF Inspector, lightweight v1): metadata + per-page info.
// Heavier analysis (color/blank page detection, embedded fonts, DPI) is a
// later phase — this focuses on what pdf-lib exposes cheaply and offline.
function fmtDate(v) {
  if (!v) return '—'
  try {
    return v.toISOString().slice(0, 10)
  } catch {
    return '—'
  }
}

export default function PdfToolInfo({ file }) {
  const usable = file && !file.error && file.doc
  const [meta, setMeta] = useState(null)
  const [pages, setPages] = useState([])

  useEffect(() => {
    if (!usable) {
      setMeta(null)
      setPages([])
      return
    }
    const doc = file.doc
    setMeta({
      title: doc.getTitle() || '—',
      author: doc.getAuthor() || '—',
      creator: doc.getCreator() || '—',
      producer: doc.getProducer() || '—',
      created: fmtDate(doc.getCreationDate()),
      modified: fmtDate(doc.getModificationDate()),
    })
    setPages(doc.getPages().map((p, i) => {
      const s = p.getSize()
      return { n: i + 1, w: Math.round(s.width), h: Math.round(s.height) }
    }))
  }, [usable, file])

  if (!usable) {
    return (
      <div className="pdfwb-tool-pane">
        <p className="pdfwb-tool-pane__hint">请先加载一个 PDF 文件。</p>
      </div>
    )
  }

  return (
    <div className="pdfwb-tool-pane">
      <h3 className="pdfwb-tool-pane__hint" style={{ fontWeight: 600, color: 'var(--body-strong)' }}>
        {file.name}
      </h3>
      <dl className="pdfwb-info-list">
        <dt>标题</dt><dd>{meta?.title}</dd>
        <dt>作者</dt><dd>{meta?.author}</dd>
        <dt>创建工具</dt><dd>{meta?.creator}</dd>
        <dt>生成程序</dt><dd>{meta?.producer}</dd>
        <dt>创建日期</dt><dd>{meta?.created}</dd>
        <dt>修改日期</dt><dd>{meta?.modified}</dd>
        <dt>页数</dt><dd>{file.pageCount}</dd>
        <dt>文件大小</dt><dd>{file.size ? `${(file.size / 1024).toFixed(1)} KB` : '—'}</dd>
      </dl>

      <h4 className="pdfwb-pane-title" style={{ margin: 'var(--space-md) 0 var(--space-xs)' }}>
        页面尺寸（前 20 页）
      </h4>
      <ul className="pdfwb-info-pages">
        {pages.slice(0, 20).map((p) => (
          <li key={p.n} className="pdfwb-info-page">
            <span>第 {p.n} 页</span>
            <span>{p.w} × {p.h} pt</span>
          </li>
        ))}
        {pages.length > 20 && (
          <li className="pdfwb-info-page"><span>…共 {pages.length} 页</span></li>
        )}
      </ul>
    </div>
  )
}
