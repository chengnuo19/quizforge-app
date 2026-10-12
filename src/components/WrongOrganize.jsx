import { useMemo, useState, useEffect } from 'react'
import ThemeToggle from './ThemeToggle.jsx'
import AiExplainPanel from './AiExplainPanel.jsx'
import { getWrongQuestions, batchRemoveWrongQuestions } from '../quiz/wrongBook.js'
import { isFavorite, toggleFavorite } from '../quiz/favorites.js'
import { buildQuizMarkdown, downloadTextFile } from '../quiz/exportQuiz.js'
import { createBook, addQuizToBook } from '../quiz/books.js'
import { goBook } from '../quiz/router.js'

export default function WrongOrganize({ onExit, theme, onToggleTheme }) {
  const [wrongs, setWrongs] = useState([])
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [filterBook, setFilterBook] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  const reload = () => {
    setWrongs(getWrongQuestions())
    setSelectedIds(new Set())
  }

  useEffect(() => {
    reload()
  }, [])

  const books = useMemo(() => {
    const set = new Set(wrongs.map(w => w.bookName))
    return Array.from(set).sort()
  }, [wrongs])

  const filteredWrongs = useMemo(() => {
    let res = wrongs
    if (filterBook) {
      res = res.filter(w => w.bookName === filterBook)
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase().trim()
      res = res.filter(w => 
        w.question.prompt.toLowerCase().includes(q) || 
        w.quizTitle.toLowerCase().includes(q)
      )
    }
    return res
  }, [wrongs, filterBook, searchQuery])

  const allSelected = filteredWrongs.length > 0 && filteredWrongs.every(w => selectedIds.has(w.cardId))
  const selectedCount = selectedIds.size

  const toggleSelectAll = (checked) => {
    if (checked) {
      const newSet = new Set(selectedIds)
      filteredWrongs.forEach(w => newSet.add(w.cardId))
      setSelectedIds(newSet)
    } else {
      const newSet = new Set(selectedIds)
      filteredWrongs.forEach(w => newSet.delete(w.cardId))
      setSelectedIds(newSet)
    }
  }

  const toggleSelect = (id) => {
    const newSet = new Set(selectedIds)
    if (newSet.has(id)) newSet.delete(id)
    else newSet.add(id)
    setSelectedIds(newSet)
  }

  const getSelectedItems = () => wrongs.filter(w => selectedIds.has(w.cardId))

  const handleDelete = () => {
    if (selectedCount === 0) return
    if (window.confirm(`确定要移除选中的 ${selectedCount} 道错题记录吗？（不会影响原题库）`)) {
      batchRemoveWrongQuestions(Array.from(selectedIds))
      reload()
    }
  }

  const handleFavorite = () => {
    if (selectedCount === 0) return
    const items = getSelectedItems()
    let count = 0
    for (const w of items) {
      if (!isFavorite(w.cardId)) {
        toggleFavorite(w.cardId, { bookId: w.bookId, quizId: w.quizId })
        count++
      }
    }
    if (count > 0) {
      alert(`已将 ${count} 道题加入收藏！`)
    } else {
      alert(`选中的题目已经在收藏中了！`)
    }
    setSelectedIds(new Set())
  }

  const buildExportQuestions = () => {
    return getSelectedItems().map(w => {
      const q = { ...w.question }
      const sourceInfo = `> 来源：${w.bookName} / ${w.quizTitle}`
      q.explain = q.explain ? `${q.explain}\n\n${sourceInfo}` : sourceInfo
      return q
    })
  }

  const handleExport = () => {
    if (selectedCount === 0) return
    const questions = buildExportQuestions()
    const dateStr = new Date().toISOString().slice(0, 10)
    const title = `错题整理 ${dateStr}`
    const md = buildQuizMarkdown(title, questions)
    downloadTextFile(`${title}.md`, md, 'md')
  }

  const handleCreateBook = () => {
    if (selectedCount === 0) return
    const dateStr = new Date().toISOString().slice(0, 10)
    const title = `错题整理 ${dateStr}`
    
    if (window.confirm(`将把选中的 ${selectedCount} 道题生成为一个名为“${title}”的新笔记本，是否继续？`)) {
      const book = createBook({ name: title })
      const questions = buildExportQuestions()
      const md = buildQuizMarkdown('整理错题', questions)
      addQuizToBook(book.id, md)
      goBook(book.id)
    }
  }

  return (
    <div className="home" style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <div className="home__topbar" style={{ flexShrink: 0, padding: '1rem', borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button type="button" className="icon-button" onClick={onExit} aria-label="返回">
            ←
          </button>
          <h2 style={{ margin: 0, fontSize: '1.25rem' }}>错题整理</h2>
        </div>
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '1rem', gap: '1rem', maxWidth: '800px', margin: '0 auto', width: '100%' }}>
        
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <select 
            value={filterBook} 
            onChange={e => setFilterBook(e.target.value)}
            style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
          >
            <option value="">所有来源笔记本</option>
            {books.map(b => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>

          <input
            type="text"
            placeholder="搜索错题..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border)', flex: 1, minWidth: '200px', background: 'var(--surface)', color: 'var(--text)' }}
          />
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', background: 'var(--surface)', padding: '0.75rem', borderRadius: '8px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginRight: 'auto' }}>
            <input 
              type="checkbox" 
              checked={allSelected} 
              onChange={e => toggleSelectAll(e.target.checked)}
              disabled={filteredWrongs.length === 0}
            />
            全选当前结果
          </label>
          <span style={{ fontSize: '0.9rem', color: 'var(--text-light)', marginRight: '8px' }}>
            已选 {selectedCount} 项
          </span>

          <button className="button button--secondary" style={{ padding: '4px 12px', fontSize: '0.9rem' }} disabled={selectedCount === 0} onClick={handleDelete}>
            删除记录
          </button>
          <button className="button button--secondary" style={{ padding: '4px 12px', fontSize: '0.9rem' }} disabled={selectedCount === 0} onClick={handleFavorite}>
            加入收藏
          </button>
          <button className="button button--secondary" style={{ padding: '4px 12px', fontSize: '0.9rem' }} disabled={selectedCount === 0} onClick={handleExport}>
            导出 Markdown
          </button>
          <button className="button button--primary" style={{ padding: '4px 12px', fontSize: '0.9rem' }} disabled={selectedCount === 0} onClick={handleCreateBook}>
            生成新笔记本
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filteredWrongs.length === 0 ? (
            <div className="stats-empty" style={{ marginTop: '2rem' }}>没有找到符合条件的错题。</div>
          ) : (
            filteredWrongs.map(w => {
              const date = new Date(w.addedAt).toLocaleString()
              return (
                <div 
                  key={w.cardId} 
                  style={{ 
                    display: 'flex', 
                    gap: '12px', 
                    padding: '12px', 
                    background: 'var(--surface)', 
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                    alignItems: 'flex-start'
                  }}
                >
                  <input 
                    type="checkbox" 
                    checked={selectedIds.has(w.cardId)}
                    onChange={() => toggleSelect(w.cardId)}
                    style={{ marginTop: '4px', cursor: 'pointer' }}
                    aria-label={`选择错题 ${w.question.prompt}`}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div 
                      style={{ fontWeight: 'bold', marginBottom: '4px', cursor: 'pointer' }}
                      onClick={() => toggleSelect(w.cardId)}
                    >
                      {w.question.prompt}
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-light)', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                      <span>来源: {w.bookName} / {w.quizTitle}</span>
                      <span>时间: {date}</span>
                    </div>
                    <details style={{ marginTop: '8px' }}>
                      <summary style={{ cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text-light)', userSelect: 'none' }}>
                        AI 讲解
                      </summary>
                      <div style={{ marginTop: '6px' }}>
                        <AiExplainPanel cardId={w.cardId} question={w.question} answer={null} />
                      </div>
                    </details>
                  </div>
                </div>
              )
            })
          )}
        </div>

      </div>
    </div>
  )
}
