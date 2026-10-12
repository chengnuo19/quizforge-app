import { useState } from 'react'
import Uploader from './Uploader.jsx'

export default function GlobalImportModal({
  userBooks,
  onImport,
  onCancel,
}) {
  const [selectedBookId, setSelectedBookId] = useState('new')
  const [newBookName, setNewBookName] = useState('')

  const handleLoad = (quiz, source) => {
    onImport({
      isNew: selectedBookId === 'new',
      bookId: selectedBookId === 'new' ? null : selectedBookId,
      newBookName: selectedBookId === 'new' ? newBookName || quiz.title : null,
      quiz,
      source
    })
  }

  return (
    <div className="book-editor" style={{ width: '100%', maxWidth: '100%', marginBottom: '32px' }}>
      <h3 className="book-editor__title">导入测验</h3>

      <div className="book-editor__field">
        <span className="book-editor__label">目标笔记本</span>
        <select 
          className="book-editor__input" 
          value={selectedBookId} 
          onChange={e => setSelectedBookId(e.target.value)}
          style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-main)', fontSize: 'inherit' }}
        >
          <option value="new">-- 新建笔记本 --</option>
          {userBooks.map(b => (
            <option key={b.id} value={b.id}>{b.icon} {b.name}</option>
          ))}
        </select>
      </div>

      {selectedBookId === 'new' && (
        <div className="book-editor__field" style={{ marginTop: '16px' }}>
          <span className="book-editor__label">新笔记本名称</span>
          <input
            className="book-editor__input"
            value={newBookName}
            onChange={(e) => setNewBookName(e.target.value)}
            placeholder="如果留空，将使用测验标题作为名称"
            style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-main)' }}
          />
        </div>
      )}

      <div style={{ marginTop: '24px' }}>
        <Uploader
          onLoad={handleLoad}
          submitLabel="确认导入"
        />
      </div>

      <div className="book-editor__actions" style={{ marginTop: '16px' }}>
        <button type="button" className="button button--secondary" onClick={onCancel}>
          取消
        </button>
      </div>
    </div>
  )
}
