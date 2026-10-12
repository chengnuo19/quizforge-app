// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  groupBuiltin,
  loadUserBooks,
  createBook,
  renameBook,
  setBookStyle,
  deleteBook,
  addQuizToBook,
  updateQuizInBook,
  removeQuizFromBook,
  getBook,
  upsertQuizInBook,
} from './books.js'

const QUIZ_MD = `---
title: 样例
---

## 题目
- [x] 对
- [ ] 错
`

describe('groupBuiltin', () => {
  it('groups markdown files by their first folder under /content', () => {
    const entries = {
      '/content/算法/排序.md': '---\ntitle: 排序\n---\n## Q\n- [x] a\n- [ ] b\n',
      '/content/算法/复杂度.md': '---\ntitle: 复杂度\n---\n## Q\n- [x] a\n- [ ] b\n',
      '/content/网络/基础.md': '---\ntitle: 基础\n---\n## Q\n- [x] a\n- [ ] b\n',
    }
    const books = groupBuiltin(entries)
    expect(books).toHaveLength(2)
    const algo = books.find((b) => b.name === '算法')
    expect(algo.builtin).toBe(true)
    expect(algo.id).toBe('builtin:算法')
    expect(algo.quizzes).toHaveLength(2)
    expect(algo.quizzes.map((q) => q.title).sort()).toEqual(['复杂度', '排序'])
  })

  it('puts root-level files into a 示例 book and records parse errors', () => {
    const entries = {
      '/content/loose.md': '## Q\n- [ ] a\n- [ ] b\n', // no correct answer → error
    }
    const books = groupBuiltin(entries)
    expect(books[0].name).toBe('示例')
    expect(books[0].quizzes[0].error).toMatch(/正确答案/)
    expect(books[0].quizzes[0].quiz).toBeUndefined()
  })
})

describe('user books (localStorage CRUD)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('creates, renames, restyles and deletes a book', () => {
    const book = createBook({ name: '我的本', icon: '📗', color: 'sage' })
    expect(book.id).toMatch(/^u/)
    expect(loadUserBooks()).toHaveLength(1)

    renameBook(book.id, '改名了')
    setBookStyle(book.id, { icon: '🔬', color: 'sky' })
    const stored = loadUserBooks()[0]
    expect(stored.name).toBe('改名了')
    expect(stored.icon).toBe('🔬')
    expect(stored.color).toBe('sky')

    deleteBook(book.id)
    expect(loadUserBooks()).toHaveLength(0)
  })

  it('adds, updates and removes quizzes by source', () => {
    const book = createBook({ name: '题库' })
    const entry = addQuizToBook(book.id, QUIZ_MD)
    expect(entry.title).toBe('样例')

    // getBook hydrates: parsed quiz available
    let hydrated = getBook(book.id)
    expect(hydrated.quizzes[0].quiz.questions).toHaveLength(1)

    updateQuizInBook(book.id, entry.id, QUIZ_MD.replace('title: 样例', 'title: 改后'))
    hydrated = getBook(book.id)
    expect(hydrated.quizzes[0].title).toBe('改后')

    removeQuizFromBook(book.id, entry.id)
    expect(getBook(book.id).quizzes).toHaveLength(0)
  })

  it('upserts a quiz into an explicit imported book', () => {
    const entry = upsertQuizInBook({
      id: 'Imported/Physics',
      name: 'Physics',
      icon: '📘',
      color: 'sky',
      sourceGroup: 'imported',
    }, QUIZ_MD);

    expect(entry.title).toBe('样例');
    const stored = loadUserBooks()[0];
    expect(stored.sourceGroup).toBe('imported');
    expect(stored.quizzes).toHaveLength(1);
  })

  it('throws when adding invalid markdown', () => {
    const book = createBook({ name: 'x' })
    expect(() => addQuizToBook(book.id, '## Q\n- [ ] a\n- [ ] b\n')).toThrow(/正确答案/)
  })

  it('surfaces a parse error on getBook when stored source is invalid', () => {
    // Simulate a stored book whose quiz source later fails to parse.
    const book = createBook({ name: 'x' })
    addQuizToBook(book.id, QUIZ_MD)
    // Tamper storage directly with a broken source.
    const raw = JSON.parse(localStorage.getItem('quizforge:books'))
    raw[0].quizzes[0].source = '## Q\n- [ ] a\n'
    localStorage.setItem('quizforge:books', JSON.stringify(raw))
    const hydrated = getBook(book.id)
    expect(hydrated.quizzes[0].error).toBeTruthy()
  })
})
