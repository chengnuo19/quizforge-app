import { useCallback, useEffect, useRef, useState } from 'react'
import { parseQuiz } from '../quiz/parseQuiz.js'
import { convertImagesToMarkdown, convertMarkdownToQuizMarkdown } from '../quiz/ai.js'
import { convertPdfToImages } from '../quiz/pdfHelper.js'

// Lets the user load an ad-hoc quiz at runtime: drag a .md file, pick one, or
// paste markdown text. On success it hands the parsed quiz + its source to
// `onLoad(quiz, source)`. `initialText` prefills the editor (e.g. from "edit").
export default function Uploader({
  onLoad,
  initialText = '',
  submitLabel = '生成测验',
}) {
  const [text, setText] = useState(initialText)
  const [error, setError] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [previewQuiz, setPreviewQuiz] = useState(null)
  const [previewError, setPreviewError] = useState(null)
  const [aiProgress, setAiProgress] = useState(null)
  
  const fileInput = useRef(null)
  const imageInput = useRef(null)
  const pdfInput = useRef(null)

  // Keep the textarea in sync when an external prefill arrives (edit flow).
  useEffect(() => {
    if (initialText) setText(initialText)
  }, [initialText])

  // Real-time preview parsing
  useEffect(() => {
    if (!text.trim()) {
      setPreviewQuiz(null)
      setPreviewError(null)
      return
    }
    const timer = setTimeout(() => {
      try {
        const q = parseQuiz(text)
        setPreviewQuiz(q)
        setPreviewError(null)
      } catch (err) {
        setPreviewQuiz(null)
        setPreviewError(err.message)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [text])

  const tryLoad = (source) => {
    try {
      onLoad(parseQuiz(source), source)
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }

  const readMarkdownFile = (file) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const source = String(reader.result)
      setText(source)
      tryLoad(source)
    }
    reader.readAsText(file)
  }

  const processImageFile = async (file) => {
    if (!file) return
    try {
      setAiProgress('正在读取图片...')
      const reader = new FileReader()
      const base64 = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result)
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      
      const md = await convertImagesToMarkdown([base64], setAiProgress)
      setText(md)
    } catch (err) {
      setError(err.message)
    } finally {
      setAiProgress(null)
    }
  }

  const processPdfFile = async (file) => {
    if (!file) return
    try {
      setAiProgress('正在解析 PDF...')
      const base64Images = await convertPdfToImages(file, setAiProgress)
      if (base64Images.length === 0) {
        throw new Error("未能从 PDF 中提取出页面")
      }
      const md = await convertImagesToMarkdown(base64Images, setAiProgress)
      setText(md)
    } catch (err) {
      setError(err.message)
    } finally {
      setAiProgress(null)
    }
  }

  const cleanupMarkdownWithAi = async () => {
    try {
      setAiProgress('正在用 AI 整理成测验格式...')
      const md = await convertMarkdownToQuizMarkdown(text, setAiProgress)
      setText(md)
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setAiProgress(null)
    }
  }

  const handleTextChange = (e) => {
    setText(e.target.value)
  }

  const onDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    
    if (file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf') {
      processPdfFile(file)
    } else if (file.type.startsWith('image/')) {
      processImageFile(file)
    } else {
      readMarkdownFile(file)
    }
  }

  return (
    <div className="uploader">
      {aiProgress && (
        <div style={{ marginBottom: '16px', padding: '12px', background: 'var(--primary)', color: 'white', borderRadius: '8px', textAlign: 'center' }}>
          {aiProgress}
        </div>
      )}
      
      <div className="uploader__split">
        <div className="uploader__pane">
          <div
            className={`uploader__drop${dragging ? ' uploader__drop--active' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => fileInput.current?.click()}
            role="button"
            tabIndex={0}
            style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '12px' }}
          >
            <p className="uploader__hint">拖拽文件到此处，或点击选择</p>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
              <button className="button button--secondary" onClick={(e) => { e.stopPropagation(); fileInput.current?.click() }}>📄 导入 Markdown</button>
              <button className="button button--secondary" onClick={(e) => { e.stopPropagation(); imageInput.current?.click() }}>🖼️ 导入图片 (AI)</button>
              <button className="button button--secondary" onClick={(e) => { e.stopPropagation(); pdfInput.current?.click() }}>📑 导入 PDF (AI)</button>
            </div>
            
            <input
              ref={fileInput}
              type="file"
              accept=".md,.markdown,.txt"
              hidden
              onChange={(e) => readMarkdownFile(e.target.files?.[0])}
            />
            <input
              ref={imageInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => processImageFile(e.target.files?.[0])}
            />
            <input
              ref={pdfInput}
              type="file"
              accept="application/pdf"
              hidden
              onChange={(e) => processPdfFile(e.target.files?.[0])}
            />
          </div>

          <p className="uploader__or">或粘贴 Markdown 文本：</p>
          <textarea
            className="uploader__textarea"
            value={text}
            onChange={handleTextChange}
            placeholder={'---\ntitle: 我的测验\n---\n\n## 第一题...\n- [x] 正确选项\n- [ ] 错误选项'}
            rows={12}
            disabled={!!aiProgress}
          />
          {text.trim() && (
            <button
              type="button"
              className="button button--secondary"
              onClick={cleanupMarkdownWithAi}
              disabled={!!aiProgress}
              style={{ alignSelf: 'flex-start' }}
            >
              用 AI 整理成测验
            </button>
          )}
        </div>
        
        <div className="uploader__pane uploader__pane--preview">
          <p className="uploader__pane-title">实时预览</p>
          {!text.trim() ? (
            <p className="uploader__hint">在左侧输入内容以查看预览</p>
          ) : previewError ? (
            <div className="uploader__preview-error">
              ❌ 解析失败：<br/>{previewError}
            </div>
          ) : previewQuiz ? (
            <div className="uploader__preview-success">
              <h4>{previewQuiz.title}</h4>
              <p>共 {previewQuiz.questions.length} 道题</p>
              <ul className="uploader__preview-list">
                {previewQuiz.questions.slice(0, 5).map((q, i) => (
                  <li key={i}>{q.prompt.substring(0, 30)}{q.prompt.length > 30 ? '...' : ''}</li>
                ))}
                {previewQuiz.questions.length > 5 && <li>...及更多</li>}
              </ul>
            </div>
          ) : null}
        </div>
      </div>

      {error && <p className="uploader__error">{error}</p>}

      <button
        type="button"
        className="button button--primary"
        onClick={() => tryLoad(text)}
        disabled={!text.trim() || !!aiProgress}
        style={{ marginTop: '16px' }}
      >
        {submitLabel}
      </button>
    </div>
  )
}
