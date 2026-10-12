import { goBook } from '../quiz/router.js'

// A single notebook tile in the Library grid.
export default function BookCard({ book }) {
  const count = book.quizzes.length
  return (
    <button
      type="button"
      className={`book-card book--${book.color}`}
      onClick={() => goBook(book.id)}
    >
      <span className="book-card__icon" aria-hidden="true">
        {book.icon}
      </span>
      <span className="book-card__name">{book.name}</span>
      <span className="book-card__meta">
        {count} 个测验{book.builtin ? ' · 内置' : ''}
      </span>
    </button>
  )
}
