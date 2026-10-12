// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  questionHash,
  getCachedExplanation,
  saveExplanation,
  explainQuestion,
  loadExplanations,
} from './aiExplanations.js'

describe('aiExplanations', () => {
  const sampleQuestion = {
    prompt: '下列关于光电效应的说法正确的是？',
    explain: '爱因斯坦因光电效应获得诺贝尔奖。',
    options: [
      { label: 'A', text: '光强越大，光电子的最大初动能越大', correct: false },
      { label: 'B', text: '入射光频率大于极限频率时才会发生光电效应', correct: true },
    ],
  }

  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('写入后能正确读回缓存', () => {
    saveExplanation('card-1', sampleQuestion, '这是测试讲解内容')
    const cached = getCachedExplanation('card-1', sampleQuestion)
    expect(cached).toBe('这是测试讲解内容')

    const stored = loadExplanations()
    expect(stored['card-1'].hash).toBe(questionHash(sampleQuestion))
    expect(stored['card-1'].text).toBe('这是测试讲解内容')
  })

  it('题目修改后哈希改变，缓存失效', () => {
    saveExplanation('card-1', sampleQuestion, '旧题目的讲解')

    const modifiedQuestion = {
      ...sampleQuestion,
      prompt: '下列关于光电效应的说法错误的是？',
    }
    expect(questionHash(modifiedQuestion)).not.toBe(questionHash(sampleQuestion))
    expect(getCachedExplanation('card-1', modifiedQuestion)).toBeNull()

    const modifiedOptionQuestion = {
      ...sampleQuestion,
      options: [
        { label: 'A', text: '选项改动了', correct: false },
        { label: 'B', text: sampleQuestion.options[1].text, correct: true },
      ],
    }
    expect(questionHash(modifiedOptionQuestion)).not.toBe(questionHash(sampleQuestion))
    expect(getCachedExplanation('card-1', modifiedOptionQuestion)).toBeNull()
  })

  it('缓存命中时不调用 complete', async () => {
    saveExplanation('card-1', sampleQuestion, '已存在的缓存讲解')
    const mockComplete = vi.fn()

    const result = await explainQuestion(
      { cardId: 'card-1', question: sampleQuestion, answer: 'A' },
      { complete: mockComplete }
    )

    expect(result).toBe('已存在的缓存讲解')
    expect(mockComplete).not.toHaveBeenCalled()
  })

  it('未命中缓存时调用 complete 并写入缓存，提示词符合通用讲解规范且不含学生选择', async () => {
    const mockComplete = vi.fn().mockResolvedValue('AI 生成的新讲解')

    const result = await explainQuestion(
      { cardId: 'card-2', question: sampleQuestion, answer: 'A' },
      { complete: mockComplete }
    )

    expect(result).toBe('AI 生成的新讲解')
    expect(mockComplete).toHaveBeenCalledTimes(1)
    const callArgs = mockComplete.mock.calls[0][0]
    expect(callArgs.system).toContain('你是耐心的学习辅导老师')
    expect(callArgs.system).toContain('350 字以内')
    expect(callArgs.system).toContain('逐个说明每个错误选项错在哪里')
    expect(callArgs.user).toContain(sampleQuestion.prompt)
    expect(callArgs.user).toContain('B. 入射光频率大于极限频率时才会发生光电效应（正确）')
    expect(callArgs.user).not.toContain('学生选择')
    expect(callArgs.user).toContain('已有解析：爱因斯坦因光电效应获得诺贝尔奖。')

    // 再次读取时能命中缓存
    expect(getCachedExplanation('card-2', sampleQuestion)).toBe('AI 生成的新讲解')
  })

  it('用不同的 answer 调用两次 explainQuestion，complete 只被调用 1 次，且 user 提示词中不包含「学生选择」', async () => {
    const mockComplete = vi.fn().mockResolvedValue('通用讲解内容')

    // 第一次调用：answer 为 'A'
    const res1 = await explainQuestion(
      { cardId: 'card-diff-ans', question: sampleQuestion, answer: 'A' },
      { complete: mockComplete }
    )

    // 第二次调用：answer 改为 null 或 'B'
    const res2 = await explainQuestion(
      { cardId: 'card-diff-ans', question: sampleQuestion, answer: null },
      { complete: mockComplete }
    )

    expect(res1).toBe('通用讲解内容')
    expect(res2).toBe('通用讲解内容')
    expect(mockComplete).toHaveBeenCalledTimes(1)

    const callArgs = mockComplete.mock.calls[0][0]
    expect(callArgs.user).not.toContain('学生选择')
  })
})
