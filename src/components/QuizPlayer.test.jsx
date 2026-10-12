// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

const scoreText = (container) =>
  container.querySelector('.summary__score').textContent.replace(/\s+/g, ' ').trim()
import QuizPlayer from './QuizPlayer.jsx'
import { parseQuiz } from '../quiz/parseQuiz.js'
import { addAttempt, quizKey } from '../quiz/storage.js'

const SINGLE = parseQuiz(`---
title: 组件测试
---
## Q1
- [ ] 错的
- [x] 对的
## Q2
- [x] 正确
- [ ] 不对
`)

const MULTI = parseQuiz(`---
title: 多选测试
---
## 选出正确的
- [x] A对
- [x] B对
- [ ] C错
`)

beforeEach(() => {
  try {
    localStorage.clear()
  } catch {
    /* ignore */
  }
})
afterEach(cleanup)

describe('QuizPlayer (single choice)', () => {
  it('shows "Not quite" for a wrong pick and reveals the correct option', () => {
    render(<QuizPlayer quiz={SINGLE} onExit={() => {}} />)
    fireEvent.click(screen.getByText('错的'))
    expect(screen.getByText('✕ Not quite')).toBeTruthy()
    expect(screen.getByText('✓ Right answer')).toBeTruthy()
  })

  it('scores correct answers across questions', () => {
    const { container } = render(<QuizPlayer quiz={SINGLE} onExit={() => {}} />)
    fireEvent.click(screen.getByText('对的')) // Q1 correct
    fireEvent.click(screen.getByText('Next'))
    fireEvent.click(screen.getByText('正确')) // Q2 correct
    fireEvent.click(screen.getByText('Finish'))
    expect(scoreText(container)).toBe('2 / 2')
  })

  it('supports number/letter shortcuts and Enter navigation', () => {
    const { container } = render(<QuizPlayer quiz={SINGLE} onExit={() => {}} />)

    fireEvent.keyDown(container.querySelector('.question'), { key: '2' })
    expect(screen.getByText('✓ Right answer')).toBeTruthy()

    fireEvent.keyDown(container.querySelector('.question'), { key: 'Enter' })
    expect(screen.getByText('Q2')).toBeTruthy()

    fireEvent.keyDown(container.querySelector('.question'), { key: 'A' })
    fireEvent.keyDown(container.querySelector('.question'), { key: 'Enter' })
    expect(scoreText(container)).toBe('2 / 2')
  })

  it('shows attempt history and trend against the previous score', () => {
    addAttempt(quizKey(SINGLE), { score: 1, total: 2, timeMs: 1200 })

    const { container } = render(<QuizPlayer quiz={SINGLE} onExit={() => {}} />)
    fireEvent.click(screen.getByText('对的'))
    fireEvent.click(screen.getByText('Next'))
    fireEvent.click(screen.getByText('正确'))
    fireEvent.click(screen.getByText('Finish'))

    expect(scoreText(container)).toBe('2 / 2')
    expect(screen.getByText(/上次 1\/2/)).toBeTruthy()
    expect(screen.getByText(/进步/)).toBeTruthy()
    expect(screen.getByText(/最佳 2\/2/)).toBeTruthy()
  })

  it('builds a wrong-only retry quiz from missed questions', () => {
    const onRetry = vi.fn()
    render(<QuizPlayer quiz={SINGLE} onExit={() => {}} onRetry={onRetry} />)

    fireEvent.click(screen.getByText('错的'))
    fireEvent.click(screen.getByText('Next'))
    fireEvent.click(screen.getByText('正确'))
    fireEvent.click(screen.getByText('Finish'))
    fireEvent.click(screen.getByText('重练错题（1）'))

    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onRetry.mock.calls[0][0].title).toContain('错题重练')
    expect(onRetry.mock.calls[0][0].questions).toHaveLength(1)
    expect(onRetry.mock.calls[0][1]).toContain('## Q1')
  })
})

describe('QuizPlayer (multi select)', () => {
  it('requires submit and scores only when the exact set matches', () => {
    const { container } = render(<QuizPlayer quiz={MULTI} onExit={() => {}} />)
    // Submit is present (not Next) and disabled until a pick.
    const submit = screen.getByText('提交')
    expect(submit.disabled).toBe(true)
    fireEvent.click(screen.getByText('A对'))
    fireEvent.click(screen.getByText('B对'))
    fireEvent.click(screen.getByText('提交'))
    // Both correct options reveal as right answers.
    expect(screen.getAllByText('✓ Right answer')).toHaveLength(2)
    fireEvent.click(screen.getByText('Finish'))
    expect(scoreText(container)).toBe('1 / 1')
  })
})
