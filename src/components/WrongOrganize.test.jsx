// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import React from 'react'
import WrongOrganize from './WrongOrganize.jsx'
import * as wrongBook from '../quiz/wrongBook.js'

vi.mock('../quiz/wrongBook.js', () => ({
  getWrongQuestions: vi.fn(),
  batchRemoveWrongQuestions: vi.fn(),
}))

vi.mock('../quiz/favorites.js', () => ({
  isFavorite: vi.fn(() => false),
  toggleFavorite: vi.fn(),
}))

vi.mock('../quiz/books.js', () => ({
  createBook: vi.fn(),
  addQuizToBook: vi.fn(),
}))

vi.mock('../quiz/router.js', () => ({
  goBook: vi.fn(),
}))

describe('WrongOrganize AI explain integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    wrongBook.getWrongQuestions.mockReturnValue([
      {
        cardId: 'card-wrong-1',
        bookName: '物理本',
        quizTitle: '力学练习',
        addedAt: Date.now(),
        question: {
          prompt: '牛顿第一定律又称为什么？',
          options: [
            { label: 'A', text: '惯性定律', correct: true },
            { label: 'B', text: '加速度定律', correct: false },
          ],
        },
      },
    ])
  })

  afterEach(cleanup)

  it('错题列表中渲染可展开的 AI 讲解区域', () => {
    const { container } = render(<WrongOrganize onExit={() => {}} theme="light" onToggleTheme={() => {}} />)

    expect(screen.getByText('牛顿第一定律又称为什么？')).toBeTruthy()
    const summary = container.querySelector('summary')
    expect(summary).toBeTruthy()
    expect(summary.textContent).toContain('AI 讲解')

    const explainPanel = container.querySelector('.ai-explain-panel')
    expect(explainPanel).toBeTruthy()
  })
})
