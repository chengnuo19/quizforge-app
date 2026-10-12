import { loadHistory, quizKey } from './storage.js'

export function getRecentLearning(books) {
  let recent = null

  for (const book of books) {
    for (const entry of book.quizzes || []) {
      if (!entry.quiz) continue

      const history = loadHistory(quizKey(entry.quiz))
      const last = history[history.length - 1]
      if (!last?.date) continue

      if (!recent || last.date > recent.date) {
        recent = {
          bookId: book.id,
          bookName: book.name,
          bookIcon: book.icon,
          bookColor: book.color,
          quizId: entry.id,
          quizTitle: entry.title || entry.quiz.title,
          questionCount: entry.quiz.questions.length,
          date: last.date,
          score: last.score,
          total: last.total,
        }
      }
    }
  }

  return recent
}

export function formatRecentLearningTime(date, now = Date.now()) {
  const elapsed = Math.max(0, now - date)
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  if (elapsed < minute) return '刚刚'
  if (elapsed < hour) return `${Math.floor(elapsed / minute)} 分钟前`
  if (elapsed < day) return `${Math.floor(elapsed / hour)} 小时前`
  return `${Math.floor(elapsed / day)} 天前`
}
