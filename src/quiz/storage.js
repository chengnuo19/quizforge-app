// Lightweight localStorage helpers for quiz progress. Each quiz gets a key
// derived from its title + question count so re-opening the same quiz resumes.
import { fsWriteProgress, fsWriteHistory, fsWriteSettings } from './fsSync.js'

const PREFIX = 'quizforge:progress:'

export function quizKey(quiz) {
  return `${PREFIX}${quiz.title}::${quiz.questions.length}`
}

export function loadProgress(key) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function saveProgress(key, state) {
  try {
    localStorage.setItem(key, JSON.stringify(state))
    fsWriteProgress()
  } catch {
    /* storage unavailable / quota — ignore, progress is best-effort */
  }
}

export function clearProgress(key) {
  try {
    localStorage.removeItem(key)
    fsWriteProgress()
  } catch {
    /* ignore */
  }
}

// ---------- Quiz Notes ----------

export function loadQuizNote(quizKeyStr) {
  try {
    return localStorage.getItem(quizKeyStr.replace('progress:', 'notes:')) || ''
  } catch {
    return ''
  }
}

export function saveQuizNote(quizKeyStr, note) {
  try {
    localStorage.setItem(quizKeyStr.replace('progress:', 'notes:'), note)
  } catch {
    /* ignore */
  }
}

// ---------- Attempt history (cross-attempt scores) ----------

const HISTORY_PREFIX = 'quizforge:history:'

// Returns an array of past attempts: [{ date, score, total, timeMs }], oldest first.
export function loadHistory(quizKeyStr) {
  try {
    const raw = localStorage.getItem(HISTORY_PREFIX + quizKeyStr)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// Append one attempt; keeps at most the last 20. Returns the updated list.
export function addAttempt(quizKeyStr, attempt) {
  const list = loadHistory(quizKeyStr)
  list.push({ date: Date.now(), ...attempt })
  const trimmed = list.slice(-20)
  try {
    localStorage.setItem(HISTORY_PREFIX + quizKeyStr, JSON.stringify(trimmed))
    fsWriteHistory()
  } catch {
    /* ignore */
  }
  return trimmed
}

// Scan all history keys and return every study-day (YYYY-MM-DD string) when
// the user finished at least one quiz. Used by the heatmap in StatsView.
export function getAllStudyDates() {
  const days = new Set()
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k?.startsWith(HISTORY_PREFIX)) continue
      const entries = JSON.parse(localStorage.getItem(k) || '[]')
      for (const e of entries) {
        if (e.date) {
          days.add(new Date(e.date).toISOString().slice(0, 10))
        }
      }
    }
  } catch {}
  return [...days].sort()
}

// Scan all history keys and return a Map of YYYY-MM-DD -> total questions answered.
export function getStudyDateCounts() {
  const dayCounts = new Map()
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k?.startsWith(HISTORY_PREFIX)) continue
      const entries = JSON.parse(localStorage.getItem(k) || '[]')
      for (const e of entries) {
        if (e.date && e.total) {
          const iso = new Date(e.date).toISOString().slice(0, 10)
          dayCounts.set(iso, (dayCounts.get(iso) || 0) + e.total)
        }
      }
    }
  } catch {}
  return dayCounts
}

const THEME_KEY = 'quizforge:theme'

export function loadTheme() {
  try {
    return localStorage.getItem(THEME_KEY) || 'light'
  } catch {
    return 'light'
  }
}

export function saveTheme(theme) {
  try {
    localStorage.setItem(THEME_KEY, theme)
    fsWriteSettings(THEME_KEY, theme)
  } catch {
    /* ignore */
  }
}

// ---------- AI Settings ----------

const AI_SETTINGS_KEY = 'quizforge:aiSettings'

export function loadAiSettings() {
  try {
    const raw = localStorage.getItem(AI_SETTINGS_KEY)
    return raw ? JSON.parse(raw) : {
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-4o'
    }
  } catch {
    return {
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-4o'
    }
  }
}

export function saveAiSettings(settings) {
  try {
    localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(settings))
    fsWriteSettings(AI_SETTINGS_KEY, settings)
  } catch {
    /* ignore */
  }
}
