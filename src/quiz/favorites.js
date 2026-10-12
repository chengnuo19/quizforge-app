import { listBooks } from './books.js'
import { fsWriteSettings } from './fsSync.js'

const FAV_KEY = 'quizforge:favorites'

export function loadFavorites() {
  try {
    const raw = localStorage.getItem(FAV_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

export function saveFavorites(data) {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(data))
    fsWriteSettings(FAV_KEY, data)
  } catch {}
}

export function isFavorite(cardId) {
  const all = loadFavorites()
  return !!all[cardId]
}

export function toggleFavorite(cardId, meta) {
  const all = loadFavorites()
  if (all[cardId]) {
    delete all[cardId]
  } else {
    all[cardId] = { ...meta, addedAt: Date.now() }
  }
  saveFavorites(all)
  return !!all[cardId]
}

export function removeFavorite(cardId) {
  const all = loadFavorites()
  if (all[cardId]) {
    delete all[cardId]
    saveFavorites(all)
  }
}

export function getFavoriteQuestions() {
  const all = loadFavorites()
  const favs = []

  try {
    const books = listBooks()
    for (const book of books) {
      for (const entry of book.quizzes ?? []) {
        if (!entry.quiz) continue
        for (const q of entry.quiz.questions ?? []) {
          const id = hashStr(`${book.id}\x00${entry.id}\x00${q.prompt}`)
          if (all[id]) {
            favs.push({
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

  return favs.sort((a, b) => b.addedAt - a.addedAt)
}

export function countFavorites() {
  const all = loadFavorites()
  return Object.keys(all).length
}

export function clearAllFavorites() {
  try {
    localStorage.removeItem(FAV_KEY)
  } catch {}
}

function hashStr(s) {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0
  }
  return h.toString(36)
}
