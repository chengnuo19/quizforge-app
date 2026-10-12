// Book (notebook) model — the single source of truth for grouping quizzes.
//
// Hybrid model:
//   - Built-in books come from /content/<folder>/*.md (read-only, shipped in repo).
//   - User books are created in-browser and persisted in localStorage.
//
// A book:  { id, name, icon, color, builtin, quizzes: [...] }
// A quiz:  { id, title, source, quiz?, error? }   (quiz/error from parseQuiz)

import { parseQuiz } from './parseQuiz.js'
import { isDesktop } from './localFsStorage.js'
import { fsCreateBook, fsWriteQuiz } from './fsSync.js'

// Fixed palettes so books get a stable, pleasant look without a color picker
// dependency. `color` is a key mapped to a CSS class (.book--<color>).
export const BOOK_COLORS = ['sand', 'sage', 'sky', 'rose', 'lilac', 'amber']
export const BOOK_ICONS = ['📘', '📗', '📙', '📕', '📓', '📔', '🧮', '🔬', '🧠', '⚛️', '🌐', '🔢']

// Deterministic default style from a string (folder name) or index.
function defaultStyle(seed) {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return {
    icon: BOOK_ICONS[h % BOOK_ICONS.length],
    color: BOOK_COLORS[h % BOOK_COLORS.length],
  }
}

// ---------- Built-in books (from /content) ----------

// Eagerly import every markdown file under /content (any depth) as raw text.
const modules = import.meta.glob('/content/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
})

// Pure grouping logic, separated so it can be unit-tested without Vite's glob.
// `entries` is a map of { '/content/<folder>/<file>.md': rawSource }.
export function groupBuiltin(entries) {
  const byFolder = new Map()
  for (const [path, source] of Object.entries(entries)) {
    const rel = path.replace(/^\/content\//, '')
    const segments = rel.split('/')
    const folder = segments.length > 1 ? segments[0] : '示例'
    const file = segments[segments.length - 1].replace(/\.md$/, '')
    if (!byFolder.has(folder)) byFolder.set(folder, [])
    let quiz
    let error
    try {
      quiz = parseQuiz(source)
    } catch (err) {
      error = err.message
    }
    byFolder.get(folder).push({
      id: path,
      title: quiz ? quiz.title : file,
      source,
      quiz,
      error,
    })
  }

  return [...byFolder.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([folder, quizzes]) => ({
      id: `builtin:${folder}`,
      name: folder,
      builtin: true,
      ...defaultStyle(folder),
      quizzes: quizzes.sort((a, b) => a.title.localeCompare(b.title)),
    }))
}

export function loadBuiltinBooks() {
  if (isDesktop) return [] // Built-ins are copied to the Vault in Desktop mode
  return groupBuiltin(modules)
}

// ---------- User books (localStorage) ----------

const BOOKS_KEY = 'quizforge:books'

function uid() {
  return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

export function loadUserBooks() {
  try {
    const key = isDesktop ? 'quizforge:desktopBooks' : BOOKS_KEY
    const raw = localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveUserBooks(books) {
  try {
    const key = isDesktop ? 'quizforge:desktopBooks' : BOOKS_KEY
    localStorage.setItem(key, JSON.stringify(books))
  } catch {
    /* storage unavailable / quota — best-effort */
  }
}

// Re-parse a stored user quiz's source so callers get the same shape as built-in
// quizzes ({ quiz } or { error }).
function hydrateUserBook(book) {
  return {
    ...book,
    builtin: false,
    quizzes: (book.quizzes || []).map((q) => {
      try {
        return { ...q, quiz: parseQuiz(q.source), error: undefined }
      } catch (err) {
        return { ...q, quiz: undefined, error: err.message }
      }
    }),
  }
}

export function createBook({ name, icon, color } = {}) {
  const books = loadUserBooks()
  const style = defaultStyle(name || uid())
  const bookName = (name || '未命名笔记本').trim()
  const book = {
    id: isDesktop ? bookName : uid(), // In desktop, use name temporarily until fsCreateBook returns path, or just use name since it matches path suffix.
    name: bookName,
    icon: icon || style.icon,
    color: color || style.color,
    quizzes: [],
  }
  books.push(book)
  saveUserBooks(books)
  
  if (isDesktop) {
    fsCreateBook(bookName).then(path => {
      // Update ID to full path once created
      const b = loadUserBooks().find(x => x.name === bookName)
      if (b) {
        b.id = path
        saveUserBooks(loadUserBooks())
      }
    })
  }

  return hydrateUserBook(book)
}

export function renameBook(id, name) {
  const books = loadUserBooks()
  const b = books.find((x) => x.id === id)
  if (b) {
    b.name = (name || b.name).trim()
    saveUserBooks(books)
  }
}

export function setBookStyle(id, { icon, color }) {
  const books = loadUserBooks()
  const b = books.find((x) => x.id === id)
  if (b) {
    if (icon) b.icon = icon
    if (color) b.color = color
    saveUserBooks(books)
  }
}

export function deleteBook(id) {
  saveUserBooks(loadUserBooks().filter((x) => x.id !== id))
}

// Add a quiz to a user book from raw markdown. Throws if the markdown is invalid
// (so the caller can show a parse error), otherwise stores the source + title.
export function addQuizToBook(bookId, source) {
  const quiz = parseQuiz(source) // throws on invalid markdown
  const books = loadUserBooks()
  const b = books.find((x) => x.id === bookId)
  if (!b) throw new Error('笔记本不存在。')
  const entry = { id: uid(), title: quiz.title, source }
  b.quizzes = b.quizzes || []
  b.quizzes.push(entry)
  saveUserBooks(books)
  
  if (isDesktop) {
    fsWriteQuiz(bookId, quiz.title, source).then(path => {
      const b2 = loadUserBooks().find(x => x.id === bookId)
      const q2 = b2?.quizzes.find(x => x.title === quiz.title)
      if (q2) {
        q2.id = path // Update ID to filepath
        saveUserBooks(loadUserBooks())
      }
    })
  }
  
  return entry
}

export function upsertQuizInBook(book, source) {
  const quiz = parseQuiz(source);
  const books = loadUserBooks();
  let stored = books.find((x) => x.id === book.id);
  if (!stored) {
    stored = {
      id: book.id,
      name: book.name,
      icon: book.icon,
      color: book.color,
      sourceGroup: book.sourceGroup,
      quizzes: [],
    };
    books.push(stored);
  }

  stored.quizzes = stored.quizzes || [];
  const existing = stored.quizzes.find((entry) => entry.title === quiz.title);
  if (existing) {
    existing.source = source;
  } else {
    stored.quizzes.push({ id: uid(), title: quiz.title, source });
  }
  saveUserBooks(books);

  if (isDesktop) {
    fsWriteQuiz(book.id, book.fileName || quiz.title, source).then((path) => {
      const fresh = loadUserBooks();
      const freshBook = fresh.find((x) => x.id === book.id);
      const freshQuiz = freshBook && freshBook.quizzes.find((x) => x.title === quiz.title);
      if (freshQuiz) {
        freshQuiz.id = path;
        saveUserBooks(fresh);
      }
    });
  }

  return stored.quizzes.find((entry) => entry.title === quiz.title);
}

export function updateQuizInBook(bookId, quizId, source) {
  const quiz = parseQuiz(source) // throws on invalid markdown
  const books = loadUserBooks()
  const b = books.find((x) => x.id === bookId)
  if (!b) throw new Error('笔记本不存在。')
  const q = (b.quizzes || []).find((x) => x.id === quizId)
  if (!q) throw new Error('测验不存在。')
  q.title = quiz.title
  q.source = source
  saveUserBooks(books)
  
  if (isDesktop) {
    fsWriteQuiz(bookId, quiz.title, source).then(path => {
      const b2 = loadUserBooks().find(x => x.id === bookId)
      const q2 = b2?.quizzes.find(x => x.id === quizId)
      if (q2) {
        q2.id = path
        saveUserBooks(loadUserBooks())
      }
    })
  }
}

export function removeQuizFromBook(bookId, quizId) {
  const books = loadUserBooks()
  const b = books.find((x) => x.id === bookId)
  if (!b) return
  b.quizzes = (b.quizzes || []).filter((x) => x.id !== quizId)
  saveUserBooks(books)
}

// ---------- Merged access ----------

// All books, built-in first then user books (hydrated).
export function listBooks() {
  return [...loadBuiltinBooks(), ...loadUserBooks().map(hydrateUserBook)]
}

export function getBook(id) {
  return listBooks().find((b) => b.id === id) || null
}
