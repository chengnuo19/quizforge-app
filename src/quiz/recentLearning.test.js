// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addAttempt, quizKey } from './storage.js'
import { formatRecentLearningTime, getRecentLearning } from './recentLearning.js'

const QUIZ_OLD = {
  title: '旧测验',
  questions: [{ prompt: 'old' }],
}

const QUIZ_NEW = {
  title: '新测验',
  questions: [{ prompt: 'new 1' }, { prompt: 'new 2' }],
}

function booksFixture() {
  return [
    {
      id: 'book-a',
      name: '数据结构与算法',
      icon: '📘',
      color: 'sky',
      quizzes: [
        { id: 'quiz-old', title: '旧测验', quiz: QUIZ_OLD },
      ],
    },
    {
      id: 'book-b',
      name: '计算机网络',
      icon: '📗',
      color: 'sage',
      quizzes: [
        { id: 'quiz-new', title: '新测验', quiz: QUIZ_NEW },
      ],
    },
  ]
}

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-07-07T08:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
})

describe('getRecentLearning', () => {
  it('returns null when no quiz has attempt history', () => {
    expect(getRecentLearning(booksFixture())).toBeNull()
  })

  it('returns the quiz with the latest attempt date', () => {
    vi.setSystemTime(new Date('2026-07-06T08:00:00Z'))
    addAttempt(quizKey(QUIZ_OLD), { score: 1, total: 1, timeMs: 1000 })

    vi.setSystemTime(new Date('2026-07-07T07:50:00Z'))
    addAttempt(quizKey(QUIZ_NEW), { score: 2, total: 2, timeMs: 2000 })

    expect(getRecentLearning(booksFixture())).toEqual({
      bookId: 'book-b',
      bookName: '计算机网络',
      bookIcon: '📗',
      bookColor: 'sage',
      quizId: 'quiz-new',
      quizTitle: '新测验',
      questionCount: 2,
      date: new Date('2026-07-07T07:50:00Z').getTime(),
      score: 2,
      total: 2,
    })
  })

  it('skips entries without parsed quiz data', () => {
    const books = [{
      id: 'book-a',
      name: '空笔记本',
      icon: '📘',
      color: 'sky',
      quizzes: [{ id: 'broken', title: 'Broken', quiz: undefined }],
    }]

    expect(getRecentLearning(books)).toBeNull()
  })
})

describe('formatRecentLearningTime', () => {
  it('formats recent timestamps without adding a date library', () => {
    const now = new Date('2026-07-07T08:00:00Z').getTime()

    expect(formatRecentLearningTime(now - 30 * 1000, now)).toBe('刚刚')
    expect(formatRecentLearningTime(now - 12 * 60 * 1000, now)).toBe('12 分钟前')
    expect(formatRecentLearningTime(now - 3 * 60 * 60 * 1000, now)).toBe('3 小时前')
    expect(formatRecentLearningTime(now - 2 * 24 * 60 * 60 * 1000, now)).toBe('2 天前')
  })
})
