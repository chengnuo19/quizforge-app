// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import React from 'react'
import QuestionCard from './QuestionCard.jsx'

describe('QuestionCard AI explanation panel integration', () => {
  const singleQuestion = {
    prompt: '地球是球体吗？',
    options: [
      { label: 'A', text: '是的', correct: true },
      { label: 'B', text: '不是', correct: false },
    ],
  }

  const multiQuestion = {
    prompt: '下列属于偶数的是？',
    multi: true,
    options: [
      { label: 'A', text: '2', correct: true },
      { label: 'B', text: '4', correct: true },
      { label: 'C', text: '5', correct: false },
    ],
  }

  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  afterEach(cleanup)

  it('未答题时，不展示 AiExplainPanel', () => {
    const { container } = render(
      <QuestionCard
        question={singleQuestion}
        answer={null}
        cardId="card-1"
        onAnswer={() => {}}
      />
    )
    expect(container.querySelector('.ai-explain-panel')).toBeNull()
  })

  it('答对且传了 cardId 时，不展示 AiExplainPanel', () => {
    const { container } = render(
      <QuestionCard
        question={singleQuestion}
        answer="A"
        cardId="card-1"
        onAnswer={() => {}}
      />
    )
    expect(container.querySelector('.ai-explain-panel')).toBeNull()
  })

  it('答错且传了 cardId 时，渲染 AiExplainPanel', () => {
    const { container } = render(
      <QuestionCard
        question={singleQuestion}
        answer="B"
        cardId="card-1"
        onAnswer={() => {}}
      />
    )
    expect(container.querySelector('.ai-explain-panel')).toBeTruthy()
  })

  it('答错但未传 cardId 时，不渲染 AiExplainPanel', () => {
    const { container } = render(
      <QuestionCard
        question={singleQuestion}
        answer="B"
        onAnswer={() => {}}
      />
    )
    expect(container.querySelector('.ai-explain-panel')).toBeNull()
  })

  it('多选题部分正确（或未全选）时判定为答错并渲染 AiExplainPanel', () => {
    const { container } = render(
      <QuestionCard
        question={multiQuestion}
        answer={['A']}
        cardId="card-2"
        onAnswer={() => {}}
      />
    )
    expect(container.querySelector('.ai-explain-panel')).toBeTruthy()
  })

  it('多选题全部选对时不渲染 AiExplainPanel', () => {
    const { container } = render(
      <QuestionCard
        question={multiQuestion}
        answer={['A', 'B']}
        cardId="card-2"
        onAnswer={() => {}}
      />
    )
    expect(container.querySelector('.ai-explain-panel')).toBeNull()
  })
})
