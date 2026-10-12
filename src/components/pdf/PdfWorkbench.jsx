import { useEffect, useMemo, useState } from 'react'
import ThemeToggle from '../ThemeToggle.jsx'
import PdfDropzone from './PdfDropzone.jsx'
import PdfToolOrganize from './PdfToolOrganize.jsx'
import PdfToolMerge from './PdfToolMerge.jsx'
import PdfToolSplit from './PdfToolSplit.jsx'
import PdfToolConvert from './PdfToolConvert.jsx'
import PdfToolCompress from './PdfToolCompress.jsx'
import PdfToolPrepareQuiz from './PdfToolPrepareQuiz.jsx'
import PdfToolBatch from './PdfToolBatch.jsx'
import PdfToolInfo from './PdfToolInfo.jsx'
import { loadPdf, pageCount } from '../../pdf/engine.js'
import { openPdf } from '../../pdf/renderer.js'
import { sanitizeFilename } from '../../pdf/filename.js'
import { listBooks } from '../../quiz/books.js'
import { getVaultPath } from '../../quiz/localFsStorage.js'
import { canUsePdfFiles, writePdfBytes, consumePendingOpen } from '../../quiz/pdfBridge.js'
import { appendResource, createPdfResource } from '../../quiz/resources.js'
import './pdf-workbench.css'

// PDF Workbench shell: a three-pane work area (tools | canvas | properties)
// that lives inside the QuizForge design system. Files are loaded with the
// shared engine; per-file errors surface inline so one bad PDF never blocks
// the batch. Tool panels slot into the canvas in later phases.

const TOOLS = [
  { id: 'organize', label: '整理页面', icon: '🗂️' },
  { id: 'merge', label: '合并 PDF', icon: '🔗' },
  { id: 'split', label: '拆分 PDF', icon: '✂️' },
  { id: 'compress', label: '压缩 PDF', icon: '📦' },
  { id: 'convert', label: '图片转换', icon: '🖼️' },
  { id: 'prepare', label: '准备测验', icon: '🧠' },
  { id: 'batch', label: '批量处理', icon: '⚡' },
  { id: 'info', label: 'PDF 信息', icon: '📋' },
]

function uid() {
  return `pdf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export default function PdfWorkbench({ onExit, theme, onToggleTheme }) {
  // A file: { id, name, pageCount, size, doc?, error? } — doc is the parsed
  // PDFDocument (missing when load failed). Kept so later tools reuse it
  // without re-reading the file.
  const [files, setFiles] = useState([])
  const [activeTool, setActiveTool] = useState('organize')
  const [activeFileId, setActiveFileId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveTargetBookId, setSaveTargetBookId] = useState('')
  const [saveMessage, setSaveMessage] = useState('')

  // A PDF opened from the Document Library hands off via pdfBridge; load it.
  useEffect(() => {
    const pending = consumePendingOpen()
    if (pending) {
      addBytes(pending.bytes, pending.name)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const userBooks = useMemo(() => listBooks().filter((b) => !b.builtin), [])

  const activeFile = useMemo(
    () => files.find((f) => f.id === activeFileId) || files[0] || null,
    [files, activeFileId],
  )

  // Load one PDF from raw bytes (used by drag-drop AND library "open").
  const addBytes = async (bytes, name) => {
    const isPdf = /\.pdf$/i.test(name)
    if (!isPdf) {
      setFiles((prev) => [...prev, { id: uid(), name, error: '不是 PDF 文件。' }])
      return
    }
    try {
      const doc = await loadPdf(bytes)
      setFiles((prev) => [
        ...prev,
        { id: uid(), name, pageCount: pageCount(doc), size: bytes.length, bytes, doc },
      ])
    } catch (err) {
      setFiles((prev) => [...prev, { id: uid(), name, error: err.message }])
    }
  }

  const addFiles = async (fileList) => {
    setBusy(true)
    const added = []
    for (const file of fileList) {
      const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf'
      if (!isPdf) {
        added.push({ id: uid(), name: file.name, error: '不是 PDF 文件。' })
        continue
      }
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const doc = await loadPdf(bytes)
        added.push({
          id: uid(),
          name: file.name,
          pageCount: pageCount(doc),
          size: file.size,
          bytes,
          doc,
        })
      } catch (err) {
        added.push({ id: uid(), name: file.name, error: err.message })
      }
    }
    setFiles((prev) => [...prev, ...added])
    setBusy(false)
  }

  const removeFile = (id) => {
    setFiles((prev) => prev.filter((f) => f.id !== id))
  }

  // Desktop: copy the active file's bytes into the Vault and register a PDF
  // resource — the same storage system the Document Library uses.
  const saveToLibrary = async () => {
    if (!activeFile || activeFile.error || !activeFile.bytes) return
    const target = userBooks.find((b) => b.id === saveTargetBookId)
    if (!target) {
      setSaveMessage('请先选择目标笔记本。')
      return
    }
    setSaveMessage('')
    try {
      const vault = getVaultPath()
      const workDir = await window.electronAPI.joinPath(vault, '.quizforge', 'workbench')
      await window.electronAPI.mkdir(workDir)
      const filePath = await window.electronAPI.joinPath(workDir, sanitizeFilename(activeFile.name))
      await writePdfBytes(filePath, activeFile.bytes)
      appendResource(
        createPdfResource({
          notebookId: target.id,
          notebookName: target.name,
          title: activeFile.name.replace(/\.pdf$/i, ''),
          sourcePath: filePath,
        }),
      )
      setSaveOpen(false)
      setSaveMessage(`已存入资料库：${target.name}`)
    } catch (err) {
      setSaveMessage(`保存失败：${err.message}`)
    }
  }

  // Lazily open the pdf.js render proxy for the active file. The proxy is
  // heavy (worker-backed), so it is only created for the file actually shown.
  useEffect(() => {
    if (!activeFile || activeFile.error || activeFile.renderProxy) return
    let cancelled = false
    openPdf(activeFile.bytes)
      .then((proxy) => {
        if (cancelled) {
          proxy.destroy()
          return
        }
        setFiles((prev) =>
          prev.map((f) => (f.id === activeFile.id ? { ...f, renderProxy: proxy } : f)),
        )
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [activeFile?.id, activeFile?.error])

  const activeToolDef = TOOLS.find((t) => t.id === activeTool)

  return (
    <div className="pdfwb" style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--canvas)', color: 'var(--ink)' }}>
      <div className="pdfwb-topbar">
        <button type="button" className="button button--secondary" onClick={onExit}>
          ← 笔记本
        </button>
        <h1 className="pdfwb-topbar__title">PDF 工作台</h1>
        <div className="pdfwb-topbar__spacer" />
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </div>

      <div className="pdfwb-body">
        <aside className="pdfwb-tools">
          <div className="pdfwb-pane-title">工具</div>
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`pdfwb-tool${activeTool === t.id ? ' pdfwb-tool--active' : ''}`}
              onClick={() => setActiveTool(t.id)}
            >
              <span className="pdfwb-tool__icon" aria-hidden="true">{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </aside>

        <main className="pdfwb-canvas">
          {files.length === 0 ? (
            <PdfDropzone onFiles={addFiles} busy={busy} />
          ) : (
            <>
              <div className="pdfwb-canvas__head">
                <span className="pdfwb-canvas__title">
                  {activeToolDef.label}
                  {activeFile && !activeFile.error && (
                    <span className="pdfwb-canvas__subtitle">
                      {activeFile.name} · {activeFile.pageCount} 页
                    </span>
                  )}
                </span>
                <div className="pdfwb-canvas__head-actions">
                  <button type="button" className="button button--secondary" onClick={() => setFiles([])}>
                    清空
                  </button>
                  <label className="pdfwb-add-button">
                    <span>＋ 添加 PDF</span>
                    <input
                      type="file"
                      accept="application/pdf,.pdf"
                      multiple
                      hidden
                      onChange={(e) => {
                        addFiles(e.target.files)
                        e.target.value = ''
                      }}
                    />
                  </label>
                </div>
              </div>

              <div className="pdfwb-files">
                {files.map((f) => (
                  <div key={f.id} className={`pdfwb-file${f.id === activeFile?.id ? ' pdfwb-file--active' : ''}`}>
                    <div className="pdfwb-file__info">
                      <span className="pdfwb-file__name" title={f.name}>{f.name}</span>
                      <span className={`pdfwb-file__meta${f.error ? ' pdfwb-file__meta--error' : ''}`}>
                        {f.error ? f.error : `${f.pageCount} 页 · ${formatSize(f.size)}`}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="pdfwb-file__open"
                      onClick={() => setActiveFileId(f.id)}
                      disabled={!!f.error}
                    >
                      {f.id === activeFile?.id ? '当前' : '打开'}
                    </button>
                    <button type="button" className="pdfwb-file__remove" onClick={() => removeFile(f.id)} aria-label={`移除 ${f.name}`}>×</button>
                  </div>
                ))}
              </div>

                {activeTool === 'organize' &&
                  (activeFile.renderProxy ? (
                    <PdfToolOrganize file={activeFile} />
                  ) : (
                    <p className="home__empty">正在准备页面预览…</p>
                  ))}
                {activeTool === 'merge' && <PdfToolMerge files={files} />}
                {activeTool === 'split' && <PdfToolSplit file={activeFile} />}
                {activeTool === 'convert' && <PdfToolConvert file={activeFile} />}
                {activeTool === 'compress' && <PdfToolCompress file={activeFile} />}
                {activeTool === 'prepare' && <PdfToolPrepareQuiz file={activeFile} />}
                {activeTool === 'batch' && <PdfToolBatch files={files} />}
                {activeTool === 'info' && <PdfToolInfo file={activeFile} />}
            </>
          )}
        </main>

        <aside className="pdfwb-props">
          <div className="pdfwb-pane-title">属性</div>
          {activeFile ? (
            <dl className="pdfwb-props__list">
              <dt>文件名</dt>
              <dd title={activeFile.name}>{activeFile.name}</dd>
              <dt>页数</dt>
              <dd>{activeFile.error ? '—' : activeFile.pageCount}</dd>
              <dt>大小</dt>
              <dd>{activeFile.error ? '—' : formatSize(activeFile.size)}</dd>
              {activeFile.error && (
                <>
                  <dt>错误</dt>
                  <dd className="pdfwb-props__error">{activeFile.error}</dd>
                </>
              )}
              <dt>操作</dt>
              <dd style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="button button--secondary" onClick={() => removeFile(activeFile.id)}>
                  移除文件
                </button>
                {canUsePdfFiles() && !activeFile.error && (
                  <button type="button" className="button button--secondary" onClick={() => setSaveOpen((v) => !v)}>
                    存入资料库
                  </button>
                )}
              </dd>
              {saveOpen && canUsePdfFiles() && !activeFile.error && (
                <dd>
                  {userBooks.length === 0 ? (
                    <p className="pdfwb-props__error">请先在首页「新建笔记本」。</p>
                  ) : (
                    <>
                      <select
                        className="book-editor__input"
                        value={saveTargetBookId || userBooks[0]?.id || ''}
                        onChange={(e) => setSaveTargetBookId(e.target.value)}
                        aria-label="目标笔记本"
                      >
                        {userBooks.map((b) => (
                          <option key={b.id} value={b.id}>{b.icon} {b.name}</option>
                        ))}
                      </select>
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <button type="button" className="button button--primary" onClick={saveToLibrary}>
                          保存
                        </button>
                        <button type="button" className="button button--secondary" onClick={() => setSaveOpen(false)}>
                          取消
                        </button>
                      </div>
                    </>
                  )}
                </dd>
              )}
              {saveMessage && <dd className={saveMessage.startsWith('已存入') ? undefined : 'pdfwb-props__error'}>{saveMessage}</dd>}
            </dl>
          ) : (
            <p className="pdfwb-props__empty">尚未加载文件。拖入 PDF 开始。</p>
          )}
        </aside>
      </div>
    </div>
  )
}
