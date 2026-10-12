import { useEffect, useState } from 'react'
import {
  parseAiDialogue,
  buildQuizMarkdown,
  buildNoteMarkdown,
  needsAiRepair,
  aiParseDialogue,
} from '../quiz/aiDialogueParser.js'
import { suggestNotebook } from '../quiz/aiNotebookSuggest.js'
import { parseQuiz } from '../quiz/parseQuiz.js'

export default function AiDialogueImportModal({
  userBooks = [],
  onImportDocument,
  onImportQuiz,
  onCancel,
  initialText = '',
  initialType = 'auto', // 'auto' | 'document' | 'quiz'
}) {
  const [text, setText] = useState(initialText)
  const [selectedBookId, setSelectedBookId] = useState(userBooks[0]?.id || 'new')
  const [newBookName, setNewBookName] = useState('')
  const [importType, setImportType] = useState('document') // 'document' | 'quiz'
  const [title, setTitle] = useState('')
  const [autoAddedToWrong, setAutoAddedToWrong] = useState(true)
  const [parsed, setParsed] = useState(null)
  const [error, setError] = useState('')
  const [repairing, setRepairing] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [suggestReason, setSuggestReason] = useState('')

  // Parse text whenever text changes
  useEffect(() => {
    if (!text.trim()) {
      setParsed(null)
      setTitle('')
      return
    }

    try {
      const res = parseAiDialogue(text)
      setParsed(res)
      if (!title) {
        setTitle(res.title)
      }
      if (initialType === 'auto') {
        setImportType(res.isQuiz ? 'quiz' : 'document')
      } else {
        setImportType(initialType)
      }
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }, [text, initialType])

  const handleConfirm = () => {
    if (!text.trim() || !parsed) {
      setError('请输入对话内容')
      return
    }

    const isNew = selectedBookId === 'new'
    const finalTitle = title.trim() || parsed.title || 'AI 对话'
    const targetBook = isNew
      ? { id: null, name: newBookName || finalTitle }
      : userBooks.find((b) => b.id === selectedBookId)

    if (importType === 'document') {
      const noteMarkdown = buildNoteMarkdown(parsed, finalTitle)
      onImportDocument?.({
        isNew,
        bookId: isNew ? null : selectedBookId,
        notebookName: targetBook?.name || finalTitle,
        newBookName: isNew ? newBookName || finalTitle : null,
        document: {
          title: finalTitle,
          markdown: noteMarkdown,
          sourceSite: 'ChatGPT / Gemini 剪藏',
        },
      })
    } else {
      // Quiz mode
      const quizMarkdown = buildQuizMarkdown(parsed, finalTitle)
      const parsedQuiz = parseQuiz(quizMarkdown)

      onImportQuiz?.({
        isNew,
        bookId: isNew ? null : selectedBookId,
        newBookName: isNew ? newBookName || finalTitle : null,
        quiz: parsedQuiz,
        source: quizMarkdown,
        addToWrong: autoAddedToWrong,
      })
    }
  }

  return (
    <div className="book-editor" style={{ width: '100%', maxWidth: '100%', marginBottom: '32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h3 className="book-editor__title" style={{ margin: 0 }}>
          🤖 从 ChatGPT / Gemini 对话导入
        </h3>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            className={`button ${importType === 'document' ? 'button--primary' : 'button--secondary'}`}
            style={{ fontSize: '12px', padding: '4px 10px' }}
            onClick={() => setImportType('document')}
          >
            📝 存为资料笔记
          </button>
          <button
            type="button"
            className={`button ${importType === 'quiz' ? 'button--primary' : 'button--secondary'}`}
            style={{ fontSize: '12px', padding: '4px 10px' }}
            onClick={() => setImportType('quiz')}
          >
            ❌ 存为测验错题
          </button>
        </div>
      </div>

      {error && (
        <div className="banner banner--error" style={{ marginBottom: '16px' }}>
          {error}
        </div>
      )}

      {/* Target notebook */}
      <div className="book-editor__field">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
          <span className="book-editor__label" style={{ margin: 0 }}>目标笔记本</span>
          <button
            type="button"
            className="button button--secondary"
            disabled={suggesting || !text.trim()}
            onClick={async () => {
              if (!text.trim() || suggesting) return
              setSuggesting(true)
              setError('')
              try {
                const res = await suggestNotebook({
                  title: title.trim() || parsed?.title || '',
                  content: text,
                  books: userBooks,
                })
                if (res.bookId) {
                  setSelectedBookId(res.bookId)
                } else {
                  setSelectedBookId('new')
                  if (res.newNotebookName) {
                    setNewBookName(res.newNotebookName)
                  }
                }
                if (res.reason) {
                  setSuggestReason(res.reason)
                }
              } catch (err) {
                setError(err?.message || 'AI 推荐笔记本失败')
              } finally {
                setSuggesting(false)
              }
            }}
            style={{ fontSize: '12px', padding: '2px 8px' }}
          >
            {suggesting ? 'AI 推荐中…' : 'AI 推荐'}
          </button>
        </div>
        <select
          className="book-editor__input"
          value={selectedBookId}
          onChange={(e) => setSelectedBookId(e.target.value)}
          style={{
            width: '100%',
            padding: '8px 12px',
            borderRadius: '8px',
            border: '1px solid var(--border)',
            background: 'var(--bg-input)',
            color: 'var(--text-main)',
            fontSize: 'inherit',
          }}
        >
          <option value="new">-- 新建笔记本 --</option>
          {userBooks.map((b) => (
            <option key={b.id} value={b.id}>
              {b.icon} {b.name}
            </option>
          ))}
        </select>
        {suggestReason && (
          <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--muted, #6c6a64)' }}>
            AI 推荐理由：{suggestReason}
          </div>
        )}
      </div>

      {selectedBookId === 'new' && (
        <div className="book-editor__field" style={{ marginTop: '14px' }}>
          <span className="book-editor__label">新笔记本名称</span>
          <input
            className="book-editor__input"
            value={newBookName}
            onChange={(e) => setNewBookName(e.target.value)}
            placeholder="如果留空，将使用标题作为名称"
            style={{
              width: '100%',
              padding: '8px 12px',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              background: 'var(--bg-input)',
              color: 'var(--text-main)',
            }}
          />
        </div>
      )}

      {/* Title */}
      <div className="book-editor__field" style={{ marginTop: '14px' }}>
        <span className="book-editor__label">标题</span>
        <input
          className="book-editor__input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="笔记或错题标题"
          style={{
            width: '100%',
            padding: '8px 12px',
            borderRadius: '8px',
            border: '1px solid var(--border)',
            background: 'var(--bg-input)',
            color: 'var(--text-main)',
          }}
        />
      </div>

      {/* Input area */}
      <div className="book-editor__field" style={{ marginTop: '14px' }}>
        <span className="book-editor__label">粘贴 AI 对话内容</span>
        <textarea
          className="book-editor__input"
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="在此粘贴来自 ChatGPT、Gemini 或 Claude 的对话、问答或题目解析..."
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: '8px',
            border: '1px solid var(--border)',
            background: 'var(--bg-input)',
            color: 'var(--text-main)',
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: '13px',
            lineHeight: 1.5,
          }}
        />
      </div>

      {/* Quiz specific options */}
      {importType === 'quiz' && (
        <div style={{ marginTop: '14px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={autoAddedToWrong}
              onChange={(e) => setAutoAddedToWrong(e.target.checked)}
            />
            <span>自动收录进全局错题本（方便进行集中突击与 SRS 间隔复习）</span>
          </label>
        </div>
      )}

      {/* Preview Card */}
      {parsed && (
        <div
          style={{
            marginTop: '16px',
            padding: '14px 16px',
            borderRadius: '8px',
            background: 'var(--canvas, #faf9f5)',
            border: '1px solid var(--hairline, #e6dfd8)',
            fontSize: '13px',
          }}
        >
          <div style={{ fontWeight: '600', marginBottom: '8px', color: 'var(--primary, #cc785c)' }}>
            ✨ 解析结果预览 ({importType === 'quiz' ? '测验错题' : '资料笔记'})：
          </div>

          {importType === 'quiz' ? (
            <div>
              {needsAiRepair(parsed, importType) ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ color: 'var(--muted, #6c6a64)' }}>
                    ⚠️ 没能自动识别完整的题目
                  </div>
                  <div>
                    <button
                      type="button"
                      className="button button--secondary"
                      disabled={repairing}
                      onClick={async () => {
                        if (!text.trim() || repairing) return
                        setRepairing(true)
                        setError('')
                        try {
                          const repaired = await aiParseDialogue(text)
                          setParsed(repaired)
                          if (!title) {
                            setTitle(repaired.title)
                          }
                        } catch (err) {
                          setError(err?.message || 'AI 解析失败')
                        } finally {
                          setRepairing(false)
                        }
                      }}
                      style={{ fontSize: '12px', padding: '4px 10px' }}
                    >
                      {repairing ? 'AI 解析中…' : '用 AI 重新解析'}
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ fontWeight: '500', marginBottom: '6px' }}>题干：{parsed.quiz.prompt}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '8px' }}>
                    {parsed.quiz.options.map((opt) => (
                      <div
                        key={opt.key}
                        style={{
                          padding: '4px 8px',
                          borderRadius: '4px',
                          background: opt.correct ? 'rgba(16, 185, 129, 0.12)' : 'transparent',
                          color: opt.correct ? '#10b981' : 'inherit',
                          fontWeight: opt.correct ? '600' : 'normal',
                        }}
                      >
                        {opt.key}. {opt.text} {opt.correct && '✓ (正确答案)'}
                      </div>
                    ))}
                  </div>
                  {parsed.quiz.explanation && (
                    <div style={{ color: 'var(--muted, #6c6a64)', fontSize: '12px', borderTop: '1px dashed var(--hairline)', paddingTop: '6px' }}>
                      <strong>解析：</strong>{parsed.quiz.explanation}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div>
              <div style={{ color: 'var(--body)', whiteSpace: 'pre-wrap', maxHeight: '120px', overflowY: 'auto' }}>
                {parsed.aiResponse.slice(0, 300)}...
              </div>
            </div>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="book-editor__actions" style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
        <button type="button" className="button button--secondary" onClick={onCancel}>
          取消
        </button>
        <button
          type="button"
          className="button button--primary"
          onClick={handleConfirm}
          disabled={!text.trim()}
        >
          确认导入
        </button>
      </div>
    </div>
  )
}
