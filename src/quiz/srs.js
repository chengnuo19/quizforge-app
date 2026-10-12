// SM-2 spaced repetition algorithm — per-question review state in localStorage.
//
// Card identity: hash(bookId + '\0' + quizId + '\0' + prompt).
// Using the prompt text (not an index) means card state survives shuffling and
// minor quiz edits as long as the question text itself doesn't change.
//
// A card state: { interval, repetitions, easeFactor, nextReview, lastReview }
//   interval    – days until next review (starts at 1)
//   repetitions – consecutive correct answers; resets to 0 on wrong
//   easeFactor  – multiplier for interval growth (starts at 2.5, min 1.3)
//   nextReview  – Unix ms timestamp of next scheduled review
//   lastReview  – Unix ms timestamp of last review (null = never seen)

import { listBooks } from './books.js'
import { parseQuiz } from './parseQuiz.js'
import { fsWriteSettings } from './fsSync.js'

const SRS_KEY = 'quizforge:srs'

// ---------- Card ID ----------

// djb2-xor hash → base-36 string (compact, URL-safe, no special chars).
function hashStr(s) {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0
  }
  return h.toString(36)
}

export function cardId(bookId, quizId, prompt) {
  return hashStr(`${bookId}\x00${quizId}\x00${prompt}`)
}

// ---------- Storage ----------

function loadAll() {
  try {
    const raw = localStorage.getItem(SRS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveAll(data) {
  try {
    localStorage.setItem(SRS_KEY, JSON.stringify(data))
    fsWriteSettings(SRS_KEY, data)
  } catch {}
}

const DEFAULTS = {
  interval: 1,
  repetitions: 0,
  easeFactor: 2.5,
  nextReview: 0, // epoch 0 → immediately due (never reviewed)
  lastReview: null,
}

export function getCardState(id) {
  const all = loadAll()
  return { ...DEFAULTS, ...(all[id] ?? {}) }
}

// ---------- SM-2 algorithm ----------

// quality: 0 (worst) → 5 (perfect). We use 4 for correct, 1 for wrong.
function sm2(quality, { interval, repetitions, easeFactor }) {
  let newInterval
  if (quality >= 3) {
    if (repetitions === 0) newInterval = 1
    else if (repetitions === 1) newInterval = 6
    else newInterval = Math.round(interval * easeFactor)
  } else {
    newInterval = 1
  }

  const newRepetitions = quality >= 3 ? repetitions + 1 : 0
  const newEaseFactor = Math.max(
    1.3,
    easeFactor + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02),
  )

  return {
    interval: newInterval,
    repetitions: newRepetitions,
    easeFactor: Math.round(newEaseFactor * 1000) / 1000,
    nextReview: Date.now() + newInterval * 24 * 60 * 60 * 1000,
    lastReview: Date.now(),
  }
}

// Update a card's SRS state after answering. Returns the new state.
export function updateCard(id, correct) {
  const quality = correct ? 4 : 1
  const current = getCardState(id)
  const next = sm2(quality, current)
  const all = loadAll()
  all[id] = next
  saveAll(all)
  return next
}

// ---------- Due-card queries ----------

// Collect all questions across all books that are due for review today.
// Returns: Array<{ cardId, question, quizTitle, bookName, bookId, quizId }>
export function getDueCards() {
  const now = Date.now()
  const all = loadAll()
  const due = []

  try {
    const books = listBooks()
    for (const book of books) {
      for (const entry of book.quizzes ?? []) {
        if (!entry.quiz) continue
        for (const q of entry.quiz.questions ?? []) {
          const id = cardId(book.id, entry.id, q.prompt)
          const state = all[id]
          if (!state || state.nextReview <= now) {
            due.push({
              cardId: id,
              question: q,
              quizTitle: entry.title,
              bookName: book.name,
              bookId: book.id,
              quizId: entry.id,
            })
          }
        }
      }
    }
  } catch {
    // listBooks() uses import.meta.glob — in non-Vite test environments it may
    // throw; return empty array gracefully.
  }

  return due
}

export function countDue() {
  return getDueCards().length
}

// ---------- Statistics helpers ----------

// Mastery breakdown for the stats dashboard.
// Buckets:
//   new      – never reviewed
//   learning – seen but interval ≤ 1 day (still shaky)
//   reviewing – 2–20 days interval
//   mastered – interval ≥ 21 days
export function getSrsStats() {
  const all = loadAll()
  let total = 0,
    newCards = 0,
    learning = 0,
    reviewing = 0,
    mastered = 0

  try {
    const books = listBooks()
    for (const book of books) {
      for (const entry of book.quizzes ?? []) {
        if (!entry.quiz) continue
        for (const q of entry.quiz.questions ?? []) {
          total++
          const id = cardId(book.id, entry.id, q.prompt)
          const state = all[id]
          if (!state || state.lastReview === null) {
            newCards++
          } else if (state.interval <= 1) {
            learning++
          } else if (state.interval < 21) {
            reviewing++
          } else {
            mastered++
          }
        }
      }
    }
  } catch {}

  return { total, new: newCards, learning, reviewing, mastered }
}

// All lastReview timestamps (ms) — used to build the study heatmap.
export function getSrsReviewDates() {
  const all = loadAll()
  return Object.values(all)
    .map((s) => s.lastReview)
    .filter(Boolean)
}
