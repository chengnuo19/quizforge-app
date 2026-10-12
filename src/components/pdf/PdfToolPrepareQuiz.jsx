import { useEffect, useMemo, useState } from 'react'
import PdfPageGrid from './PdfPageGrid.jsx'
import { renderPageToDataUrl } from '../../pdf/renderer.js'
import { convertImagesToMarkdown } from '../../quiz/ai.js'
import { parseQuiz } from '../../quiz/parseQuiz.js'
import { listBooks, createBook, addQuizToBook } from '../../quiz/books.js'
import { loadAiSettings } from '../../quiz/storage.js'
import { isAiConfigured } from '../../quiz/aiClient.js'

// Prepare for Quiz — the QuizForge-differentiating tool. The user checks the
// pages worth studying (skipping cover / TOC / answer pages), then the tool
// renders exactly those pages and hands them to the EXISTING QuizForge AI
// pipeline (convertImagesToMarkdown → parseQuiz → addQuizToBook). No second
// AI-generation logic is introduced.
export default function PdfToolPrepareQuiz({ file }) {
  const usable = file && !file.error && file.renderProxy
  const [checked, setChecked] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [markdown, setMarkdown] = useState('')
  const [targetBookId, setTargetBookId] = useState('')
  const [saved, setSaved] = useState(null)

  const books = useMemo(() => listBooks().filter((b) => !b.builtin), [])
  const aiConfigured = useMemo(() => isAiConfigured(loadAiSettings()), [saved])

  // Reset per-file: select every page by default.
  useEffect(() => {
    if (usable) setChecked(new Set(Array.from({ length: file.pageCount }, (_, i) => i + 1)))
    setMarkdown('')
    setError('')
    setSaved(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.id, usable])

  const checkedCount = checked.size
  const preview = useMemo(() => {
    if (!markdown.trim()) return null
    try {
      return parseQuiz(markdown)
    } catch {
      return null
    }
  }, [markdown])

  const togglePage = (num) => {
    setChecked((prev) => {
      const next = new Set(prev)
      next.has(num) ? next.delete(num) : next.add(num)
      return next
    })
  }

  const selectAll = () => setChecked(new Set(Array.from({ length: file.pageCount }, (_, i) => i + 1)))
  const clearAll = () => setChecked(new Set())

  const generate = async () => {
    if (checkedCount === 0) {
      setError('请至少勾选一页。')
      return
    }
    setBusy(true)
    setError('')
    setProgress('')
    setMarkdown('')
    setSaved(null)
    try {
      const pages = [...checked].sort((a, b) => a - b)
      const base64Images = []
      for (let i = 0; i < pages.length; i++) {
        setProgress(`正在渲染第 ${i + 1}/${pages.length} 页…`)
        const dataUrl = await renderPageToDataUrl(file.renderProxy.pdf, pages[i], {
          scale: 2.0,
        })
        if (dataUrl) base64Images.push(dataUrl)
      }
      if (base64Images.length === 0) {
        throw new Error('页面渲染失败，无法生成测验。')
      }
      setProgress('正在调用 AI 识别题目…')
      // Reuse the existing QuizForge AI pipeline (same function Uploader uses).
      const md = await convertImagesToMarkdown(base64Images, setProgress)
      setMarkdown(md)
      setProgress('')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const importToBook = () => {
    try {
      const quiz = parseQuiz(markdown)
      let bookId = targetBookId
      if (!bookId) {
        const book = createBook({ name: quiz.title })
        bookId = book.id
      }
      addQuizToBook(bookId, markdown)
      setSaved({ bookId, quizId: undefined, title: quiz.title })
    } catch (err) {
      setError(err.message)
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
    <div className="pdfwb-tool-pane pdfwb-tool-pane--organize">
      <div className="pdfwb-organize-toolbar">
        <span className="pdfwb-tool-pane__hint">
          勾选要学习的页面，可跳过封面 / 目录 / 答案页。已选 {checkedCount} 页。
        </span>
        <button type="button" className="button button--secondary" onClick={selectAll} disabled={busy}>
          全选
        </button>
        <button type="button" className="button button--secondary" onClick={clearAll} disabled={busy}>
          清空
        </button>
        <button type="button" className="button button--primary" onClick={generate} disabled={busy}>
          {busy ? '生成中…' : 'Generate Quiz from Selected Pages'}
        </button>
      </div>

      {!aiConfigured && (
        <p className="uploader__error" style={{ margin: '8px 16px 0' }}>
          未配置 AI：请在右上角「设置」中填写 API Key 或选择订阅后再生成测验。
        </p>
      )}

      {progress && (
        <p className="pdfwb-tool-pane__hint" style={{ padding: '0 16px' }}>{progress}</p>
      )}

      <div className="pdfwb-organize-grid">
        <PdfPageGrid
          pdf={file.renderProxy.pdf}
          pageCount={file.pageCount}
          selected={checked}
          onPageClick={(pos, e) => togglePage(pos + 1)}
          ariaLabel={`${file.name} 页面选择（准备测验）`}
        />
      </div>

      {markdown && (
        <div className="pdfwb-prepare-result">
          <div className="pdfwb-organize-toolbar">
            <span className="pdfwb-tool-pane__hint">AI 生成的测验 Markdown（可编辑后导入）</span>
            <select
              className="book-editor__input"
              value={targetBookId}
              onChange={(e) => setTargetBookId(e.target.value)}
              aria-label="目标笔记本"
            >
              <option value="">-- 新建笔记本 --</option>
              {books.map((b) => (
                <option key={b.id} value={b.id}>{b.icon} {b.name}</option>
              ))}
            </select>
            <button type="button" className="button button--primary" onClick={importToBook} disabled={!markdown.trim()}>
              导入到笔记本
            </button>
          </div>
          <div className="uploader__split" style={{ padding: '0 16px 16px' }}>
            <div className="uploader__pane">
              <textarea
                className="uploader__textarea"
                value={markdown}
                onChange={(e) => setMarkdown(e.target.value)}
                rows={14}
                aria-label="测验 Markdown"
              />
            </div>
            <div className="uploader__pane uploader__pane--preview">
              <p className="uploader__pane-title">实时预览</p>
              {preview ? (
                <div className="uploader__preview-success">
                  <h4>{preview.title}</h4>
                  <p>共 {preview.questions.length} 道题</p>
                  <ul className="uploader__preview-list">
                    {preview.questions.slice(0, 8).map((q, i) => (
                      <li key={i}>{q.prompt.substring(0, 40)}{q.prompt.length > 40 ? '…' : ''}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="uploader__hint">生成后这里会显示题目预览。</p>
              )}
            </div>
          </div>
        </div>
      )}

      {error && <p className="uploader__error" style={{ padding: '0 16px' }}>{error}</p>}
      {saved && (
        <p className="pdfwb-tool-pane__result" style={{ padding: '0 16px' }}>
          已导入测验：{saved.title}
        </p>
      )}
    </div>
  )
}
