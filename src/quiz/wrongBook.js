import { listBooks } from './books.js'
import { cardId as srsCardId } from './srs.js'

import { fsWriteSettings } from './fsSync.js'

const WRONG_KEY = 'quizforge:wrong'

export function loadWrongBook() {
  try {
    const raw = localStorage.getItem(WRONG_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

export function saveWrongBook(data) {
  try {
    localStorage.setItem(WRONG_KEY, JSON.stringify(data))
    fsWriteSettings('quizforge:wrongBook', data)
  } catch {}
}

export function logWrongQuestion(bookId, quizId, question) {
  const all = loadWrongBook()
  const id = srsCardId(bookId, quizId, question.prompt)
  all[id] = { bookId, quizId, addedAt: Date.now() }
  saveWrongBook(all)
}

export function removeWrongQuestion(bookId, quizId, question) {
  const all = loadWrongBook()
  const id = srsCardId(bookId, quizId, question.prompt)
  if (all[id]) {
    delete all[id]
    saveWrongBook(all)
  }
}

export function getWrongQuestions() {
  const all = loadWrongBook()
  const wrongs = []

  try {
    const books = listBooks()
    for (const book of books) {
      for (const entry of book.quizzes ?? []) {
        if (!entry.quiz) continue
        for (const q of entry.quiz.questions ?? []) {
          const id = srsCardId(book.id, entry.id, q.prompt)
          if (all[id]) {
            wrongs.push({
              cardId: id,
              question: q,
              quizTitle: entry.title,
              bookName: book.name,
              bookId: book.id,
              quizId: entry.id,
              addedAt: all[id].addedAt,
            })
          }
        }
      }
    }
  } catch {}

  return wrongs.sort((a, b) => b.addedAt - a.addedAt)
}

export function countWrongQuestions() {
  const all = loadWrongBook()
  return Object.keys(all).length
}

export function clearWrongBook() {
  try {
    localStorage.removeItem(WRONG_KEY)
  } catch {}
}

export function batchRemoveWrongQuestions(cardIds) {
  const all = loadWrongBook()
  let changed = false
  for (const id of cardIds) {
    if (all[id]) {
      delete all[id]
      changed = true
    }
  }
  if (changed) {
    saveWrongBook(all)
  }
}
