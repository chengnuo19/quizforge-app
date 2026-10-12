import { useEffect, useMemo, useState } from 'react'
import ThemeToggle from './ThemeToggle.jsx'
import { listBooks, createBook } from '../quiz/books.js'
import {
  DEFAULT_ENGINE,
  ENGINES,
  canSelectEngine,
  canUseMarkitdown,
  engineLabel,
  onConvertProgress,
  saveMarkdownWithMarkitdown,
  selectAndConvertWithEngine,
} from '../quiz/markitdown.js'
import {
  appendResource,
  createDocumentResource,
  getDocumentResourceTitle,
} from '../quiz/resources.js'

function mdFileName(sourcePath) {
  const base = String(sourcePath || 'markitdown-output')
    .split(/[\\/]/)
    .filter(Boolean)
    .pop()
    .replace(/\.[^.]+$/, '')
  return `${base || 'markitdown-output'}.md`
}

export default function MarkitdownPanel({ onExit, theme, onToggleTheme, onResourcesChange }) {
  const available = canUseMarkitdown()
  const engineChoice = canSelectEngine()
  const books = useMemo(() => listBooks().filter(book => !book.builtin), [])
  const [selectedBookId, setSelectedBookId] = useState(books[0]?.id || 'new')
  const [newBookName, setNewBookName] = useState('')
  const [engine, setEngine] = useState(DEFAULT_ENGINE)
  const [ocr, setOcr] = useState(false)
  const [sourcePath, setSourcePath] = useState('')
  const [markdown, setMarkdown] = useState('')
  // The engine that actually produced the Markdown on screen — the radio may
  // have moved on since, and the resource should record what really ran.
  const [resultEngine, setResultEngine] = useState(DEFAULT_ENGINE)
  const [progress, setProgress] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const selectedBook = books.find(book => book.id === selectedBookId)

  // Docling streams stage-by-stage progress; a long run should not look hung.
  useEffect(() => onConvertProgress(line => setProgress(String(line || ''))), [])

  const convert = async () => {
    setBusy(true)
    setError('')
    setMessage('')
    setProgress('')
    try {
      const result = await selectAndConvertWithEngine(engine, { ocr })
      if (!result) return
      setSourcePath(result.path)
      setMarkdown(result.markdown)
      setResultEngine(result.engine || engine)
      // Tell the user when Docling fell back to the slow one-shot path.
      if (result.engine === 'docling' && result.via === 'cli') {
        setMessage('本次使用单次转换（较慢）。安装 docling-serve 可让后续转换快 5 倍以上。')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
      setProgress('')
    }
  }

  const saveMd = async () => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await saveMarkdownWithMarkitdown({
        defaultFileName: mdFileName(sourcePath),
        markdown,
      })
      if (result) setMessage(`已保存：${result.path}`)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const importResource = () => {
    try {
      const title = getDocumentResourceTitle({ markdown, path: sourcePath })
      const targetBook = selectedBookId === 'new'
        ? createBook({ name: newBookName || title })
        : selectedBook
      const resource = createDocumentResource({
        notebookId: targetBook.id,
        notebookName: targetBook.name,
        title,
        markdown,
        sourcePath,
        sourceSite: engineLabel(resultEngine),
      })
      appendResource(resource)
      onResourcesChange?.()
      setMessage(`已导入资料：${resource.title}`)
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }

  const activeEngine = ENGINES.find(e => e.id === engine)

  return (
    <div className="home">
      <div className="home__topbar">
        <button type="button" className="button button--secondary" onClick={onExit}>
          ← 笔记本
        </button>
        {onToggleTheme && <ThemeToggle theme={theme} onToggle={onToggleTheme} />}
      </div>

      <section className="markitdown-panel">
        <h1 className="home__heading">文档转换</h1>
        {!available ? (
          <p className="home__empty">MarkItDown is only available in the desktop app.</p>
        ) : (
          <>
            {engineChoice && (
              <fieldset className="markitdown-panel__engines">
                <legend className="book-editor__label">转换引擎</legend>
                {ENGINES.map(item => (
                  <label key={item.id} className="markitdown-panel__engine">
                    <input
                      type="radio"
                      name="convert-engine"
                      value={item.id}
                      checked={engine === item.id}
                      onChange={() => setEngine(item.id)}
                      disabled={busy}
                    />
                    <span className="markitdown-panel__engine-label">{item.label}</span>
                    <span className="markitdown-panel__engine-hint">{item.hint}</span>
                  </label>
                ))}
              </fieldset>
            )}

            {engineChoice && engine === 'docling' && (
              <label className="markitdown-panel__engine">
                <input
                  type="checkbox"
                  checked={ocr}
                  onChange={event => setOcr(event.target.checked)}
                  disabled={busy}
                />
                <span className="markitdown-panel__engine-hint">
                  对扫描件启用 OCR（更慢，但能读出图片里的文字）
                </span>
              </label>
            )}

            <div className="markitdown-panel__toolbar">
              <button type="button" className="button button--primary" onClick={convert} disabled={busy}>
                选择文件并转换
              </button>
              <button type="button" className="button button--secondary" onClick={saveMd} disabled={busy || !markdown.trim()}>
                保存为 .md
              </button>
            </div>

            {busy && (
              <p className="uploader__hint" role="status">
                {progress || `正在用 ${activeEngine?.label || engine} 转换…`}
              </p>
            )}

            {sourcePath && <p className="uploader__hint">{sourcePath}</p>}

            <textarea
              className="uploader__textarea markitdown-panel__textarea"
              value={markdown}
              onChange={event => setMarkdown(event.target.value)}
              placeholder="转换后的 Markdown 会显示在这里。"
              rows={18}
              disabled={busy}
            />

            <div className="book-editor__field">
              <span className="book-editor__label">导入到笔记本资料</span>
              <select
                className="book-editor__input"
                value={selectedBookId}
                onChange={event => setSelectedBookId(event.target.value)}
              >
                <option value="new">-- 新建笔记本 --</option>
                {books.map(book => (
                  <option key={book.id} value={book.id}>{book.icon} {book.name}</option>
                ))}
              </select>
            </div>

            {selectedBookId === 'new' && (
              <div className="book-editor__field">
                <span className="book-editor__label">新笔记本名称</span>
                <input
                  className="book-editor__input"
                  value={newBookName}
                  onChange={event => setNewBookName(event.target.value)}
                  placeholder="留空时使用文档标题"
                />
              </div>
            )}

            <button
              type="button"
              className="button button--primary"
              onClick={importResource}
              disabled={busy || !markdown.trim()}
            >
              导入到笔记本资料
            </button>
          </>
        )}

        {message && <p className="uploader__hint">{message}</p>}
        {error && <p className="uploader__error">{error}</p>}
      </section>
    </div>
  )
}
