// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'
import React from 'react'
import AiExplainPanel from './AiExplainPanel.jsx'
import * as aiClient from '../quiz/aiClient.js'
import * as aiExplanations from '../quiz/aiExplanations.js'

vi.mock('../quiz/aiClient.js', () => ({
  isAiConfigured: vi.fn(),
}))

vi.mock('../quiz/aiExplanations.js', () => ({
  getCachedExplanation: vi.fn(),
  explainQuestion: vi.fn(),
}))

describe('AiExplainPanel', () => {
  const sampleQuestion = {
    prompt: '牛顿第二定律公式是？',
    options: [
      { label: 'A', text: 'F=ma', correct: true },
      { label: 'B', text: 'E=mc^2', correct: false },
    ],
  }

  beforeEach(() => {
    vi.restoreAllMocks()
    aiClient.isAiConfigured.mockReturnValue(true)
    aiExplanations.getCachedExplanation.mockReturnValue(null)
  })

  afterEach(() => {
    cleanup()
  })

  it('初始命中缓存时直接展示讲解内容', () => {
    aiExplanations.getCachedExplanation.mockReturnValue('这是预先缓存的牛顿第二定律解析')
    render(<AiExplainPanel cardId="card-1" question={sampleQuestion} answer="B" />)

    expect(screen.getByText('💡 AI 错题讲解')).toBeTruthy()
    expect(screen.getByText('这是预先缓存的牛顿第二定律解析')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'AI 讲解' })).toBeNull()
  })

  it('未命中缓存时点击按钮调用 explainQuestion 并展示结果', async () => {
    aiExplanations.explainQuestion.mockResolvedValue('AI 生成的解析：F=ma 才是牛顿第二定律。')

    render(<AiExplainPanel cardId="card-1" question={sampleQuestion} answer="B" />)

    const btn = screen.getByRole('button', { name: 'AI 讲解' })
    expect(btn).toBeTruthy()

    fireEvent.click(btn)

    // 点击后显示加载中
    expect(screen.getByRole('button', { name: 'AI 讲解中…' })).toBeTruthy()

    await waitFor(() => {
      expect(screen.getByText('💡 AI 错题讲解')).toBeTruthy()
      expect(screen.getByText('AI 生成的解析：F=ma 才是牛顿第二定律。')).toBeTruthy()
    })
    expect(aiExplanations.explainQuestion).toHaveBeenCalledWith({
      cardId: 'card-1',
      question: sampleQuestion,
      answer: 'B',
    })
  })

  it('调用失败时展示错误信息和重试按钮', async () => {
    aiExplanations.explainQuestion.mockRejectedValue(new Error('网络请求超时'))

    render(<AiExplainPanel cardId="card-1" question={sampleQuestion} answer="B" />)

    const btn = screen.getByRole('button', { name: 'AI 讲解' })
    fireEvent.click(btn)

    await waitFor(() => {
      expect(screen.getByText('网络请求超时')).toBeTruthy()
      expect(screen.getByRole('button', { name: '重试' })).toBeTruthy()
    })

    // 重试
    aiExplanations.explainQuestion.mockResolvedValue('重试成功后的解析')
    fireEvent.click(screen.getByRole('button', { name: '重试' }))

    await waitFor(() => {
      expect(screen.getByText('重试成功后的解析')).toBeTruthy()
    })
  })

  it('未配置 AI 时显示提示且按钮不可用不触发 AI 调用', () => {
    aiClient.isAiConfigured.mockReturnValue(false)

    render(<AiExplainPanel cardId="card-1" question={sampleQuestion} answer="B" />)

    expect(screen.getByText('请先在右上角设置中配置 AI')).toBeTruthy()
    const btn = screen.getByRole('button', { name: 'AI 讲解' })
    expect(btn.disabled).toBe(true)

    fireEvent.click(btn)
    expect(aiExplanations.explainQuestion).not.toHaveBeenCalled()
  })
})
