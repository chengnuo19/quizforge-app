// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AiDialogueImportModal from './AiDialogueImportModal.jsx'
import * as aiDialogueParser from '../quiz/aiDialogueParser.js'
import * as aiNotebookSuggest from '../quiz/aiNotebookSuggest.js'

vi.mock('../quiz/aiNotebookSuggest.js', () => ({
  suggestNotebook: vi.fn(),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AiDialogueImportModal', () => {
  const userBooks = [
    { id: 'b1', name: '数据结构', icon: '🌲' },
    { id: 'b2', name: '计算机网络', icon: '🌐' },
  ]

  it('renders modal header and inputs', () => {
    render(<AiDialogueImportModal userBooks={userBooks} onCancel={() => {}} />)

    expect(screen.getByText(/从 ChatGPT \/ Gemini 对话导入/)).toBeTruthy()
    expect(screen.getByPlaceholderText(/在此粘贴来自 ChatGPT/)).toBeTruthy()
  })

  it('parses input and switches mode', () => {
    const { rerender } = render(
      <AiDialogueImportModal userBooks={userBooks} onCancel={() => {}} />
    )

    const textarea = screen.getByPlaceholderText(/在此粘贴来自 ChatGPT/)
    fireEvent.change(textarea, {
      target: {
        value: `下列哪个协议工作在网络层？
A. TCP
B. IP
C. HTTP
D. FTP
答案：B
解析：IP 协议位于网络层。`,
      },
    })

    // Should detect quiz and show options
    expect(screen.getByText(/题干：/)).toBeTruthy()
    expect(screen.getByText(/IP ✓ \(正确答案\)/)).toBeTruthy()

    // Can manually toggle back to document mode
    const docBtn = screen.getByRole('button', { name: '📝 存为资料笔记' })
    fireEvent.click(docBtn)

    expect(screen.getByText(/解析结果预览 \(资料笔记\)/)).toBeTruthy()
  })

  it('submits document import correctly', () => {
    const onImportDocument = vi.fn()
    render(
      <AiDialogueImportModal
        userBooks={userBooks}
        onImportDocument={onImportDocument}
        onCancel={() => {}}
      />
    )

    const textarea = screen.getByPlaceholderText(/在此粘贴来自 ChatGPT/)
    fireEvent.change(textarea, {
      target: {
        value: `用户:
什么是闭包？

ChatGPT:
闭包是指有权访问另一个函数作用域变量的函数。`,
      },
    })

    const submitBtn = screen.getByRole('button', { name: '确认导入' })
    fireEvent.click(submitBtn)

    expect(onImportDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        isNew: false,
        bookId: 'b1',
        document: expect.objectContaining({
          sourceSite: 'ChatGPT / Gemini 剪藏',
        }),
      })
    )
  })

  it('submits quiz import correctly', () => {
    const onImportQuiz = vi.fn()
    render(
      <AiDialogueImportModal
        userBooks={userBooks}
        onImportQuiz={onImportQuiz}
        onCancel={() => {}}
      />
    )

    const textarea = screen.getByPlaceholderText(/在此粘贴来自 ChatGPT/)
    fireEvent.change(textarea, {
      target: {
        value: `单选题：
HTTP 的默认端口是？
A. 21
B. 80
C. 443
D. 8080
答案：B
解析：HTTP 默认使用 80 端口。`,
      },
    })

    const submitBtn = screen.getByRole('button', { name: '确认导入' })
    fireEvent.click(submitBtn)

    expect(onImportQuiz).toHaveBeenCalledWith(
      expect.objectContaining({
        isNew: false,
        bookId: 'b1',
        addToWrong: true,
        quiz: expect.objectContaining({
          questions: expect.any(Array),
        }),
      })
    )
  })

  it('calls onCancel when cancel button clicked', () => {
    const onCancel = vi.fn()
    render(<AiDialogueImportModal userBooks={userBooks} onCancel={onCancel} />)

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('正则识别失败的测验文本显示「用 AI 重新解析」，点击后预览内容更新', async () => {
    const spy = vi.spyOn(aiDialogueParser, 'aiParseDialogue').mockResolvedValue({
      userPrompt: '',
      aiResponse: 'AI修复后的题目',
      title: 'AI提取测验',
      isQuiz: true,
      quiz: {
        isQuiz: true,
        type: 'single',
        prompt: 'AI修复出的题干',
        options: [
          { key: 'A', text: '选项甲', correct: true },
          { key: 'B', text: '选项乙', correct: false },
        ],
        answer: 'A',
        explanation: 'AI修复出的解析',
      },
    })

    render(
      <AiDialogueImportModal
        userBooks={userBooks}
        initialType="quiz"
        onCancel={() => {}}
      />
    )

    const textarea = screen.getByPlaceholderText(/在此粘贴来自 ChatGPT/)
    fireEvent.change(textarea, {
      target: {
        value: '一段格式混乱的题目文本，没有明确标注答案',
      },
    })

    expect(screen.getByText('⚠️ 没能自动识别完整的题目')).toBeTruthy()
    const repairBtn = screen.getByRole('button', { name: '用 AI 重新解析' })
    expect(repairBtn).toBeTruthy()

    fireEvent.click(repairBtn)

    await waitFor(() => {
      expect(screen.getByText(/题干：AI修复出的题干/)).toBeTruthy()
      expect(screen.getByText(/选项甲 ✓ \(正确答案\)/)).toBeTruthy()
      expect(screen.getByText(/AI修复出的解析/)).toBeTruthy()
    })
    expect(spy).toHaveBeenCalled()
  })

  it('点击「AI 推荐」后，选择框切换为推荐的已有笔记本并显示推荐理由，且不触发导入', async () => {
    aiNotebookSuggest.suggestNotebook.mockResolvedValue({
      bookId: 'b2',
      newNotebookName: null,
      reason: '内容涉及计算机网络协议',
    })
    const onImportQuiz = vi.fn()
    const onImportDocument = vi.fn()

    render(
      <AiDialogueImportModal
        userBooks={userBooks}
        onImportQuiz={onImportQuiz}
        onImportDocument={onImportDocument}
        onCancel={() => {}}
      />
    )

    const textarea = screen.getByPlaceholderText(/在此粘贴来自 ChatGPT/)
    fireEvent.change(textarea, {
      target: {
        value: '关于 TCP 三次握手和四次挥手的讨论...',
      },
    })

    const suggestBtn = screen.getByRole('button', { name: 'AI 推荐' })
    fireEvent.click(suggestBtn)

    await waitFor(() => {
      expect(screen.getByText('AI 推荐理由：内容涉及计算机网络协议')).toBeTruthy()
    })

    const select = screen.getByRole('combobox')
    expect(select.value).toBe('b2')
    expect(onImportQuiz).not.toHaveBeenCalled()
    expect(onImportDocument).not.toHaveBeenCalled()
  })

  it('点击「AI 推荐」建议新建笔记本时，切换为 new 且填入建议名称', async () => {
    aiNotebookSuggest.suggestNotebook.mockResolvedValue({
      bookId: null,
      newNotebookName: '操作系统原理',
      reason: '新学科分类',
    })

    render(
      <AiDialogueImportModal
        userBooks={userBooks}
        onCancel={() => {}}
      />
    )

    const textarea = screen.getByPlaceholderText(/在此粘贴来自 ChatGPT/)
    fireEvent.change(textarea, {
      target: {
        value: '页面置换算法 FIFO 与 LRU 比较',
      },
    })

    const suggestBtn = screen.getByRole('button', { name: 'AI 推荐' })
    fireEvent.click(suggestBtn)

    await waitFor(() => {
      expect(screen.getByText('AI 推荐理由：新学科分类')).toBeTruthy()
    })

    const select = screen.getByRole('combobox')
    expect(select.value).toBe('new')
    const newBookInput = screen.getByPlaceholderText('如果留空，将使用标题作为名称')
    expect(newBookInput.value).toBe('操作系统原理')
  })
})
