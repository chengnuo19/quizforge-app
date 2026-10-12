import { useEffect, useMemo, useState } from 'react'
import ThemeToggle from './ThemeToggle.jsx'
import BookCard from './BookCard.jsx'
import BookEditor from './BookEditor.jsx'
import GlobalImportModal from './GlobalImportModal.jsx'
import AiDialogueImportModal from './AiDialogueImportModal.jsx'
import SettingsModal from './SettingsModal.jsx'
import { listBooks, createBook, addQuizToBook } from '../quiz/books.js'
import { buildQuizMarkdown, buildNoteMarkdown } from '../quiz/aiDialogueParser.js'
import { goBook, goSrs, goStats, goPlay, goFavorites, goWrongBook, goOrganizeWrong, goMarkitdown, goScreenshotOrganizer, goTodos, goPdfWorkbench, goMediaDownloader, goVideoSubtitles } from '../quiz/router.js'
import { countDue } from '../quiz/srs.js'
import { countFavorites } from '../quiz/favorites.js'
import { countWrongQuestions } from '../quiz/wrongBook.js'
import { exportAllData, importAllData } from '../quiz/dataIO.js'
import { usePwaInstall } from '../hooks/usePwaInstall.js'
import { appendResource, createDocumentResource, getDocumentResourceTitle } from '../quiz/resources.js'
import { formatRecentLearningTime, getRecentLearning } from '../quiz/recentLearning.js'
import { getTodoSummary } from '../quiz/todoSummary.js'

// Landing page: notebook (book) grid.
// Built-in books come from /content folders; user books live in localStorage.

function filterBooks(books, query) {
  if (!query) return books
  const q = query.toLowerCase().trim()
  return books.filter((b) => b.name.toLowerCase().includes(q))
}

function searchQuestions(books, query, limit = 30) {
  if (!query) return []
  const q = query.toLowerCase().trim()
  const hits = []
  for (const book of books) {
    for (const entry of book.quizzes ?? []) {
      if (!entry.quiz) continue
      for (const question of entry.quiz.questions) {
        if (question.prompt.toLowerCase().includes(q)) {
          hits.push({ book, entry, question })
          if (hits.length >= limit) return hits
        }
      }
    }
  }
  return hits
}

function highlightText(text, query) {
  if (!query) return text
  const parts = text.split(new RegExp(`(${query})`, 'gi'))
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase() ? (
      <span key={i} className="search-highlight">{part}</span>
    ) : (
      part
    ),
  )
}

export default function Library({ theme, onToggleTheme, onBooksChange }) {
  const [creating, setCreating] = useState(false)
  const [showGlobalImport, setShowGlobalImport] = useState(false)
  const [showAiDialogueModal, setShowAiDialogueModal] = useState(false)
  const [aiDialogueInitialText, setAiDialogueInitialText] = useState('')
  const [aiDialogueInitialType, setAiDialogueInitialType] = useState('auto')
  const [globalImportMode, setGlobalImportMode] = useState('quiz')
  const [showSettings, setShowSettings] = useState(false)
  const [importSuccess, setImportSuccess] = useState(null)
  // Local version bump so a newly created book shows immediately.
  const [version, setVersion] = useState(0)
  const books = useMemo(() => listBooks(), [version])
  const [dueCount, setDueCount] = useState(0)
  const [favCount, setFavCount] = useState(0)
  const [wrongCount, setWrongCount] = useState(0)
  const [query, setQuery] = useState('')
  const filteredBooks = useMemo(() => filterBooks(books, query), [books, query])
  const questionHits = useMemo(() => searchQuestions(books, query), [books, query])
  const recentLearning = useMemo(() => getRecentLearning(books), [books])
  const todoSummary = useMemo(() => getTodoSummary(), [version])
  const { canInstall, promptInstall } = usePwaInstall()

  useEffect(() => {
    // countDue() scans all books — run asynchronously to avoid blocking paint.
    const id = requestAnimationFrame(() => {
      try {
        setDueCount(countDue())
        setFavCount(countFavorites())
        setWrongCount(countWrongQuestions())
      } catch { /* best-effort */ }
    })
    return () => cancelAnimationFrame(id)
  }, [version])

  // Sync notebooks with desktop clipper server & listen for incoming clips
  useEffect(() => {
    if (typeof window !== 'undefined' && window.clipper) {
      window.clipper.updateNotebooks?.(books.filter((b) => !b.builtin))

      if (typeof window.clipper.onImportClip === 'function') {
        const unsub = window.clipper.onImportClip((payload) => {
          try {
            const shouldOpenModal =
              (!payload.notebookId || payload.notebookId === 'default') &&
              !String(payload.newNotebookName || '').trim()

            if (shouldOpenModal) {
              let clipText = payload.contentMarkdown || ''
              if (!clipText) {
                if (payload.userPrompt || payload.aiResponse) {
                  clipText = `用户:\n${payload.userPrompt || ''}\n\nAI:\n${payload.aiResponse || ''}`.trim()
                } else {
                  clipText = payload.title || ''
                }
              }
              setAiDialogueInitialText(clipText)
              setAiDialogueInitialType(payload.type === 'quiz' ? 'quiz' : 'document')
              setShowAiDialogueModal(true)
              return
            }

            const trimmedNewName = String(payload.newNotebookName || '').trim()
            const targetBook = trimmedNewName
              ? createBook({ name: trimmedNewName, icon: '🤖', color: 'rose' })
              : (books.find((b) => b.id === payload.notebookId) || createBook({ name: payload.provider ? `${payload.provider} 错题与笔记` : 'AI 剪藏', icon: '🤖', color: 'rose' }))

            if (payload.type === 'quiz') {
              const quizMd = payload.contentMarkdown?.includes('## ')
                ? payload.contentMarkdown
                : buildQuizMarkdown(payload, payload.title)
              const entry = addQuizToBook(targetBook.id, quizMd)
              setImportSuccess({ bookId: targetBook.id, quizId: entry.id, title: payload.title || 'AI 错题' })
            } else {
              const noteMd = buildNoteMarkdown(payload, payload.title)
              const resource = createDocumentResource({
                notebookId: targetBook.id,
                notebookName: targetBook.name,
                title: payload.title || 'AI 笔记',
                markdown: noteMd,
                sourcePath: payload.sourceUrl || '',
                sourceSite: payload.provider || 'ChatGPT / Gemini 剪藏',
              })
              appendResource(resource)
              setImportSuccess({ bookId: targetBook.id, title: resource.title, type: 'resource' })
            }

            setVersion((v) => v + 1)
            onBooksChange?.()
          } catch (err) {
            console.error('[Library] Failed to process clip payload:', err)
          }
        })
        return () => unsub()
      }
    }
  }, [books, onBooksChange])

  const handleCreate = ({ name, icon, color }) => {
    const book = createBook({ name, icon, color })
    setCreating(false)
    setVersion((v) => v + 1)
    onBooksChange?.()
    goBook(book.id)
  }

  const handleGlobalImport = ({ isNew, bookId, newBookName, quiz, source }) => {
    let targetBookId = bookId
    if (isNew) {
      const book = createBook({ name: newBookName || quiz.title })
      targetBookId = book.id
    }
    const entry = addQuizToBook(targetBookId, source)

    setShowGlobalImport(false)
    setImportSuccess({ bookId: targetBookId, quizId: entry.id, title: quiz.title })
    setVersion((v) => v + 1)
    onBooksChange?.()
  }

  const handleGlobalDocumentImport = ({ isNew, bookId, notebookName, newBookName, document }) => {
    const resourceTitle = getDocumentResourceTitle(document)
    let targetBookId = bookId
    let targetBookName = notebookName

    if (isNew) {
      const book = createBook({ name: newBookName || resourceTitle })
      targetBookId = book.id
      targetBookName = book.name
    }

    const resource = createDocumentResource({
      notebookId: targetBookId,
      notebookName: targetBookName,
      title: resourceTitle,
      markdown: document.markdown,
      sourcePath: document.path,
    })
    appendResource(resource)

    setShowGlobalImport(false)
    setImportSuccess({ bookId: targetBookId, title: resource.title, type: 'resource' })
    setVersion((v) => v + 1)
    onBooksChange?.()
  }

  const handleExport = () => {
    const dataStr = exportAllData()
    const blob = new Blob([dataStr], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `quizforge-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json'
    input.onchange = async (e) => {
      const file = e.target.files[0]
      if (!file) return
      try {
        const text = await file.text()
        const oldWrongCount = countWrongQuestions()
        if (importAllData(text)) {
          const addedWrongs = countWrongQuestions() - oldWrongCount
          if (addedWrongs > 0) {
            if (window.confirm(`导入成功！发现 ${addedWrongs} 道新错题，是否立即去整理？`)) {
              window.location.hash = '#organizeWrong'
            }
          } else {
            alert('导入成功，即将刷新页面应用更改。')
          }
          window.location.reload()
        } else {
          alert('导入失败：找不到有效的备份数据。')
        }
      } catch (err) {
        alert('读取文件失败。')
      }
    }
    input.click()
  }

  const primaryActions = [
    {
      label: '导入测验',
      icon: '↑',
      onClick: () => {
        setGlobalImportMode('quiz')
        setShowGlobalImport(true)
        setShowAiDialogueModal(false)
        setImportSuccess(null)
      },
    },
    {
      label: 'AI 对话导入',
      icon: '🤖',
      onClick: () => {
        setShowAiDialogueModal(true)
        setShowGlobalImport(false)
        setImportSuccess(null)
      },
    },
    { label: 'MarkItDown', icon: 'M↓', onClick: goMarkitdown },
    { label: '截图整理', icon: '□', onClick: goScreenshotOrganizer },
    { label: 'PDF 工作台', icon: '🛠', onClick: goPdfWorkbench },
    { label: '音视频下载', icon: '🎬', onClick: goMediaDownloader },
    { label: '视频加字幕', icon: '💬', onClick: goVideoSubtitles },
    { label: '导入备份', icon: '⇩', onClick: handleImport },
    { label: '导出备份', icon: '⇧', onClick: handleExport },
    { label: '设置', icon: '⚙', onClick: () => setShowSettings(true) },
  ]

  const secondaryActions = [
    dueCount > 0 && { label: `今日复习 ${dueCount}`, onClick: goSrs },
    { label: `收藏题目 ${favCount}`, onClick: goFavorites, disabled: favCount === 0 },
    { label: `错题本 ${wrongCount}`, onClick: goWrongBook, disabled: wrongCount === 0 },
    { label: '整理错题', onClick: goOrganizeWrong, disabled: wrongCount === 0 },
    { label: '学习报告', onClick: goStats },
    { label: 'To do 任务', onClick: goTodos },
    canInstall && { label: '安装应用', onClick: promptInstall },
  ].filter(Boolean)

  return (
    <div className="home-shell">
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}

      {/* 左侧边栏 */}
      <aside className="home-sidebar">
        <div className="home-sidebar__brand">
          <span className="home-sidebar__brand-mark" aria-hidden="true">✦</span>
          <span className="home-sidebar__brand-name">QuizForge</span>
        </div>

        <nav className="home-sidebar__nav" aria-label="侧边栏导航">
          <button
            type="button"
            className={`home-sidebar__item ${!query ? 'home-sidebar__item--active' : ''}`}
            onClick={() => setQuery('')}
          >
            <span className="home-sidebar__icon" aria-hidden="true">🏠</span>
            <span className="home-sidebar__label">首页</span>
          </button>

          <button
            type="button"
            className="home-sidebar__item"
            onClick={goSrs}
          >
            <span className="home-sidebar__icon" aria-hidden="true">🔁</span>
            <span className="home-sidebar__label">今日复习</span>
            {dueCount > 0 && <span className="home-sidebar__count">{dueCount}</span>}
          </button>

          <button
            type="button"
            className="home-sidebar__item"
            onClick={goFavorites}
            disabled={favCount === 0}
          >
            <span className="home-sidebar__icon" aria-hidden="true">⭐</span>
            <span className="home-sidebar__label">收藏题目</span>
            {favCount > 0 && <span className="home-sidebar__count">{favCount}</span>}
          </button>

          <button
            type="button"
            className="home-sidebar__item"
            onClick={goWrongBook}
            disabled={wrongCount === 0}
          >
            <span className="home-sidebar__icon" aria-hidden="true">📓</span>
            <span className="home-sidebar__label">错题本</span>
            {wrongCount > 0 && <span className="home-sidebar__count">{wrongCount}</span>}
          </button>

          <button
            type="button"
            className="home-sidebar__item"
            onClick={goOrganizeWrong}
            disabled={wrongCount === 0}
          >
            <span className="home-sidebar__icon" aria-hidden="true">🛠️</span>
            <span className="home-sidebar__label">整理错题</span>
          </button>

          <button
            type="button"
            className="home-sidebar__item"
            onClick={goStats}
          >
            <span className="home-sidebar__icon" aria-hidden="true">📊</span>
            <span className="home-sidebar__label">学习报告</span>
          </button>

          <button
            type="button"
            className="home-sidebar__item"
            onClick={goTodos}
          >
            <span className="home-sidebar__icon" aria-hidden="true">📋</span>
            <span className="home-sidebar__label">To do 任务</span>
          </button>

          <button
            type="button"
            className="home-sidebar__item"
            onClick={goPdfWorkbench}
          >
            <span className="home-sidebar__icon" aria-hidden="true">🛠</span>
            <span className="home-sidebar__label">PDF 工作台</span>
          </button>

          <button
            type="button"
            className="home-sidebar__item"
            onClick={() => setShowAiDialogueModal(true)}
          >
            <span className="home-sidebar__icon" aria-hidden="true">🤖</span>
            <span className="home-sidebar__label">AI 对话导入</span>
          </button>

          <button
            type="button"
            className="home-sidebar__item"
            onClick={goMediaDownloader}
          >
            <span className="home-sidebar__icon" aria-hidden="true">🎬</span>
            <span className="home-sidebar__label">音视频工作台</span>
          </button>

          <button
            type="button"
            className="home-sidebar__item"
            onClick={goVideoSubtitles}
          >
            <span className="home-sidebar__icon" aria-hidden="true">💬</span>
            <span className="home-sidebar__label">视频加字幕</span>
          </button>

          {canInstall && (
            <button
              type="button"
              className="home-sidebar__item"
              onClick={promptInstall}
            >
              <span className="home-sidebar__icon" aria-hidden="true">📲</span>
              <span className="home-sidebar__label">安装应用</span>
            </button>
          )}
        </nav>

        <div className="home-sidebar__library">
          <div className="home-sidebar__library-title">我的笔记本</div>
          <div className="home-sidebar__library-list">
            {books.map((book) => (
              <button
                key={book.id}
                type="button"
                className="home-sidebar__library-item"
                onClick={() => goBook(book.id)}
                title={book.name}
              >
                <span
                  className="home-sidebar__library-marker"
                  style={{ backgroundColor: book.color || 'var(--primary)' }}
                >
                  {book.icon || '📘'}
                </span>
                <span className="home-sidebar__library-name">{book.name}</span>
              </button>
            ))}
          </div>
        </div>
      </aside>

      {/* 右侧主工作区 */}
      <div className="home-workspace">
        <header className="home-topbar">
          <div className="home-topbar__search">
            <input
              type="text"
              className="search-bar"
              placeholder="搜索笔记本、题目或内容"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQuery('')
              }}
            />
            {query && (
              <button className="search-clear icon-button" onClick={() => setQuery('')} aria-label="清除搜索">
                ×
              </button>
            )}
          </div>
          <div className="home-topbar__actions">
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          </div>
        </header>

        <div className="home-dashboard">
          {/* 左侧/中间主内容 */}
          <main className="home-main">
            {/* 快速开始面板 */}
            <section className="home-quickstart">
              <div className="home-quickstart__info">
                <h1 className="home-quickstart__title">快速开始</h1>
                <p className="home-quickstart__subtitle">选择一个入口，或继续最近的笔记本。</p>
              </div>

              <div className="home-action-grid" aria-label="主要功能入口">
                {primaryActions.map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    className="home-action-card"
                    onClick={action.onClick}
                  >
                    <span className="home-action-icon" aria-hidden="true">{action.icon}</span>
                    <span className="home-action-label">{action.label}</span>
                  </button>
                ))}
              </div>
            </section>

            {/* 最近学习条带 */}
            {recentLearning ? (
              <div className="home-continue">
                <button
                  type="button"
                  className={`home-continue__card book--${recentLearning.bookColor}`}
                  onClick={() => goPlay(recentLearning.bookId, recentLearning.quizId)}
                >
                  <span className="home-continue__label">最近学习</span>
                  <div className="home-continue__content">
                    <span className="home-continue__title">
                      <span aria-hidden="true">{recentLearning.bookIcon}</span>
                      {recentLearning.bookName}
                    </span>
                    <span className="home-continue__meta">
                      {recentLearning.quizTitle} · {formatRecentLearningTime(recentLearning.date)}
                    </span>
                    <span className="home-continue__progress">
                      上次 {recentLearning.score}/{recentLearning.total} · {recentLearning.questionCount} 题
                    </span>
                  </div>
                  <span className="home-continue__action">继续</span>
                </button>
              </div>
            ) : (
              <div className="home-continue">
                <div className="home-continue__card home-continue__card--empty">
                  <span className="home-continue__label">最近学习</span>
                  <div className="home-continue__content">
                    <span className="home-continue__title">还没有学习记录</span>
                    <span className="home-continue__meta">导入或打开一个测验后，这里会显示继续入口。</span>
                  </div>
                </div>
              </div>
            )}

            {/* 我的笔记本区域 / 搜索结果 */}
            <section className="home-main__section">
              {query ? (
                <div className="search-results">
                  <h2 className="home__heading">匹配的笔记本 ({filteredBooks.length})</h2>
                  {filteredBooks.length > 0 && (
                    <div className="home__grid">
                      {filteredBooks.map((book) => (
                        <BookCard key={book.id} book={book} />
                      ))}
                    </div>
                  )}

                  <h2 className="home__heading" style={{ marginTop: 'var(--space-xl)' }}>匹配的题目 ({questionHits.length})</h2>
                  {questionHits.length > 0 && (
                    <ul className="search-hits">
                      {questionHits.map((hit, i) => (
                        <li key={i} className="search-hit" onClick={() => goPlay(hit.book.id, hit.entry.id)}>
                          <div className="search-hit__source">
                            <span aria-hidden="true">{hit.book.icon}</span> {hit.book.name} / {hit.entry.title}
                          </div>
                          <div className="search-hit__prompt">
                            {highlightText(hit.question.prompt, query)}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}

                  {filteredBooks.length === 0 && questionHits.length === 0 && (
                    <p className="home__empty stats-empty">没有找到匹配的内容。</p>
                  )}
                </div>
              ) : (
                <>
                  <h2 className="home__heading">我的笔记本</h2>
                  {importSuccess && (
                    <div style={{ background: 'var(--bg-card)', padding: '12px 16px', borderRadius: '8px', border: '1px solid var(--primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                      <span>{importSuccess.type === 'resource' ? '成功保存资料：' : '成功导入测验：'}<strong>{importSuccess.title}</strong></span>
                      <button
                        type="button"
                        className="button button--primary"
                        onClick={() => importSuccess.type === 'resource' ? goBook(importSuccess.bookId) : goPlay(importSuccess.bookId, importSuccess.quizId)}
                      >
                        前往查看
                      </button>
                    </div>
                  )}
                  {showAiDialogueModal ? (
                    <AiDialogueImportModal
                      userBooks={books.filter((b) => !b.builtin)}
                      initialText={aiDialogueInitialText}
                      initialType={aiDialogueInitialType}
                      onImportDocument={(doc) => {
                        handleGlobalDocumentImport(doc)
                        setShowAiDialogueModal(false)
                        setAiDialogueInitialText('')
                        setAiDialogueInitialType('auto')
                      }}
                      onImportQuiz={(quiz) => {
                        handleGlobalImport(quiz)
                        setShowAiDialogueModal(false)
                        setAiDialogueInitialText('')
                        setAiDialogueInitialType('auto')
                      }}
                      onCancel={() => {
                        setShowAiDialogueModal(false)
                        setAiDialogueInitialText('')
                        setAiDialogueInitialType('auto')
                      }}
                    />
                  ) : showGlobalImport ? (
                    <GlobalImportModal
                      userBooks={books.filter(b => !b.builtin)}
                      onImport={handleGlobalImport}
                      onImportDocument={handleGlobalDocumentImport}
                      preferredImport={globalImportMode === 'document' ? 'document' : null}
                      onCancel={() => setShowGlobalImport(false)}
                    />
                  ) : creating ? (
                    <BookEditor
                      title="新建笔记本"
                      submitLabel="创建"
                      onSubmit={handleCreate}
                      onCancel={() => setCreating(false)}
                    />
                  ) : (
                    <div className="home__grid">
                      <button
                        type="button"
                        className="book-card book-card--new"
                        onClick={() => setCreating(true)}
                      >
                        <span className="book-card__icon" aria-hidden="true">
                          ＋
                        </span>
                        <span className="book-card__name">新建笔记本</span>
                        <span className="book-card__meta">创建你自己的题库</span>
                      </button>

                      {books.map((book) => (
                        <BookCard key={book.id} book={book} />
                      ))}
                    </div>
                  )}
                </>
              )}
            </section>
          </main>

          {/* 右侧导轨 */}
          <aside className="home-right-rail">
            <div className="home-review-card">
              <h3 className="home-review-card__title">今日复习</h3>
              <div className="home-review-card__body">
                {dueCount > 0 ? (
                  <>
                    <p className="home-review-card__text">
                      你有 <strong className="home-review-card__count">{dueCount}</strong> 道题目需要复习。
                    </p>
                    <button
                      type="button"
                      className="button button--primary home-review-card__button"
                      onClick={goSrs}
                    >
                      开始复习
                    </button>
                  </>
                ) : (
                  <>
                    <p className="home-review-card__text home-review-card__text--empty">
                      太棒了！今天没有待复习的题目。
                    </p>
                    <button
                      type="button"
                      className="button home-review-card__button"
                      disabled
                    >
                      开始复习
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className="home-review-card" style={{ marginTop: 'var(--space-lg)' }}>
              <h3 className="home-review-card__title">To do 任务</h3>
              <div className="home-review-card__body">
                {todoSummary.openCount > 0 ? (
                  <>
                    <p className="home-review-card__text">
                      你有 <strong className="home-review-card__count">{todoSummary.openCount}</strong> 个未完成任务。
                      {todoSummary.overdueCount > 0 && (
                        <span style={{ color: 'var(--rose)', marginLeft: '8px', fontSize: '12px', fontWeight: 'bold' }}>
                          ({todoSummary.overdueCount} 个已逾期)
                        </span>
                      )}
                    </p>
                    <ul className="home-todo-list" style={{ margin: 0, paddingLeft: '20px', fontSize: '14px', color: 'var(--body)', listStyleType: 'disc' }}>
                      {todoSummary.nextTodos.map(t => (
                        <li key={t.id} style={{ marginBottom: '8px' }}>
                          <span className="home-todo-item-title" style={{ fontWeight: '500' }}>{t.title}</span>
                          <span className="home-todo-item-due" style={{ fontSize: '12px', color: 'var(--muted)', display: 'block' }}>
                            截止: {new Date(t.dueAt).toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      className="button button--primary home-review-card__button"
                      onClick={goTodos}
                    >
                      查看任务
                    </button>
                  </>
                ) : (
                  <>
                    <p className="home-review-card__text home-review-card__text--empty">
                      太棒了！今天没有待完成的任务。
                    </p>
                    <button
                      type="button"
                      className="button home-review-card__button"
                      onClick={goTodos}
                    >
                      查看任务
                    </button>
                  </>
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
