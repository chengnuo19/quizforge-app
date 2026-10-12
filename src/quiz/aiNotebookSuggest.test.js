import { describe, it, expect, vi } from 'vitest'
import { suggestNotebook } from './aiNotebookSuggest.js'

describe('aiNotebookSuggest', () => {
  const books = [
    { id: 'builtin-1', name: '系统预置', builtin: true },
    { id: 'book-phys', name: '大学物理' },
    { id: 'book-cs', name: '计算机网络' },
  ]

  it('返回存在的 id 时原样返回，且过滤内置笔记本', async () => {
    const mockComplete = vi.fn().mockResolvedValue(
      JSON.stringify({
        bookId: 'book-phys',
        newNotebookName: null,
        reason: '内容涉及经典力学',
      })
    )

    const result = await suggestNotebook(
      { title: '牛顿运动定律', content: '加速度与力的关系...', books },
      { complete: mockComplete }
    )

    expect(result).toEqual({
      bookId: 'book-phys',
      newNotebookName: null,
      reason: '内容涉及经典力学',
    })

    // 检查传给 AI 的 prompt：只包含非 builtin 的笔记本
    const callArgs = mockComplete.mock.calls[0][0]
    expect(callArgs.user).toContain('大学物理')
    expect(callArgs.user).toContain('计算机网络')
    expect(callArgs.user).not.toContain('系统预置')
  })

  it('返回不存在的 id 时降级为建议新建', async () => {
    const mockComplete = vi.fn().mockResolvedValue(
      JSON.stringify({
        bookId: 'non-existent-id',
        newNotebookName: '有机化学',
        reason: '属于全新学科',
      })
    )

    const result = await suggestNotebook(
      { title: '苯环结构', content: '芳香烃特性...', books },
      { complete: mockComplete }
    )

    expect(result).toEqual({
      bookId: null,
      newNotebookName: '有机化学',
      reason: '属于全新学科',
    })
  })

  it('bookId 为 null 且缺少 newNotebookName 时抛错', async () => {
    const mockComplete = vi.fn().mockResolvedValue(
      JSON.stringify({
        bookId: null,
        newNotebookName: '',
        reason: '都不合适',
      })
    )

    await expect(
      suggestNotebook(
        { title: '未知内容', content: '...', books },
        { complete: mockComplete }
      )
    ).rejects.toThrow('AI 未能推荐有效的目标笔记本')
  })

  it('输入超长内容时被截断到 3000 字', async () => {
    const mockComplete = vi.fn().mockResolvedValue(
      JSON.stringify({
        bookId: 'book-cs',
        newNotebookName: null,
        reason: '网络协议',
      })
    )

    const superLongContent = 'A'.repeat(5000)
    await suggestNotebook(
      { title: '超长长文', content: superLongContent, books },
      { complete: mockComplete }
    )

    const callArgs = mockComplete.mock.calls[0][0]
    expect(callArgs.user).toContain('A'.repeat(3000))
    expect(callArgs.user).not.toContain('A'.repeat(3001))
  })
})
