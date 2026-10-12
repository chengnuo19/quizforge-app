import { useRef, useState } from 'react'

// Multi-file PDF dropzone. Collects files only — parsing/error handling lives
// in the parent so one bad file never blocks the others.
export default function PdfDropzone({ onFiles, busy }) {
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)

  const pick = (fileList) => {
    const files = Array.from(fileList || [])
    if (files.length) onFiles(files)
  }

  return (
    <div
      className={`pdfwb-dropzone${dragging ? ' pdfwb-dropzone--active' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        pick(e.dataTransfer?.files)
      }}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          inputRef.current?.click()
        }
      }}
      role="button"
      tabIndex={0}
      aria-label="拖拽或选择 PDF 文件"
    >
      <span className="pdfwb-dropzone__icon" aria-hidden="true">📄</span>
      <p className="pdfwb-dropzone__title">{busy ? '正在读取 PDF…' : '拖拽 PDF 到这里'}</p>
      <p className="pdfwb-dropzone__hint">或点击选择文件（可多选，支持中文文件名）</p>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        hidden
        onChange={(e) => {
          pick(e.target.files)
          e.target.value = '' // allow re-selecting the same file
        }}
      />
    </div>
  )
}
