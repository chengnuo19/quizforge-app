import { useState } from 'react'
import { BOOK_COLORS, BOOK_ICONS } from '../quiz/books.js'

// Inline panel to create or edit a book's name / icon / color. Used by Library
// (create) and BookDetail (edit). Calls onSubmit({ name, icon, color }).
export default function BookEditor({
  initial = {},
  title = '新建笔记本',
  submitLabel = '创建',
  onSubmit,
  onCancel,
}) {
  const [name, setName] = useState(initial.name || '')
  const [icon, setIcon] = useState(initial.icon || BOOK_ICONS[0])
  const [color, setColor] = useState(initial.color || BOOK_COLORS[0])

  const submit = (e) => {
    e?.preventDefault()
    if (!name.trim()) return
    onSubmit({ name: name.trim(), icon, color })
  }

  return (
    <form className={`book-editor book--${color}`} onSubmit={submit}>
      <h3 className="book-editor__title">{title}</h3>

      <label className="book-editor__field">
        <span className="book-editor__label">名称</span>
        <input
          className="book-editor__input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如：数据结构、高数、英语词汇"
          autoFocus
        />
      </label>

      <div className="book-editor__field">
        <span className="book-editor__label">图标</span>
        <div className="book-editor__icons">
          {BOOK_ICONS.map((ic) => (
            <button
              type="button"
              key={ic}
              className={`book-editor__icon${ic === icon ? ' is-selected' : ''}`}
              onClick={() => setIcon(ic)}
              aria-pressed={ic === icon}
            >
              {ic}
            </button>
          ))}
        </div>
      </div>

      <div className="book-editor__field">
        <span className="book-editor__label">颜色</span>
        <div className="book-editor__colors">
          {BOOK_COLORS.map((c) => (
            <button
              type="button"
              key={c}
              className={`book-editor__swatch book--${c}${c === color ? ' is-selected' : ''}`}
              onClick={() => setColor(c)}
              aria-label={c}
              aria-pressed={c === color}
            />
          ))}
        </div>
      </div>

      <div className="book-editor__actions">
        <button type="button" className="button button--secondary" onClick={onCancel}>
          取消
        </button>
        <button type="submit" className="button button--primary" disabled={!name.trim()}>
          {submitLabel}
        </button>
      </div>
    </form>
  )
}
