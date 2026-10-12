// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react'
import Library from './Library.jsx'
import BookDetail from './BookDetail.jsx'
import { createBook, addQuizToBook, loadUserBooks } from '../quiz/books.js'

const QUIZ_MD = `---
title: 冒泡排序
---
## Q
- [x] 对
- [ ] 错
`

beforeEach(() => {
  localStorage.clear()
  window.location.hash = ''
})
afterEach(cleanup)

describe('Library', () => {
  it('shows a top-level document import entry for MarkItDown', () => {
    render(<Library theme="light" onToggleTheme={() => {}} />)

    expect(screen.getByText('MarkItDown')).toBeTruthy()
  })

  it('navigates to the standalone MarkItDown page from the top bar', () => {
    render(<Library theme="light" onToggleTheme={() => {}} />)

    fireEvent.click(screen.getByText('MarkItDown'))

    expect(window.location.hash).toBe('#markitdown')
  })

  it('creates a user notebook from the editor and navigates to it', () => {
    render(<Library theme="light" onToggleTheme={() => {}} />)
    fireEvent.click(screen.getByText('新建笔记本'))
    fireEvent.change(screen.getByPlaceholderText(/例如/), { target: { value: '我的题库' } })
    fireEvent.click(screen.getByText('创建'))

    const books = loadUserBooks()
    expect(books).toHaveLength(1)
    expect(books[0].name).toBe('我的题库')
    expect(window.location.hash).toContain('book=')
  })

  it('renders the quick-start launchpad and primary action entries', () => {
    render(<Library theme="light" onToggleTheme={() => {}} />)

    expect(screen.getByText('快速开始')).toBeTruthy()
    expect(screen.getByText('选择一个入口，或继续最近的笔记本。')).toBeTruthy()
    expect(screen.getByRole('button', { name: /导入测验/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /MarkItDown/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /截图整理/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /导入备份/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /导出备份/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /设置/ })).toBeTruthy()
  })

  it('keeps secondary learning destinations reachable without making them primary cards', () => {
    render(<Library theme="light" onToggleTheme={() => {}} />)

    expect(screen.getByRole('button', { name: /学习报告/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /To do 任务/ })).toBeTruthy()
  })

  it('renders the sidebar brand and item texts', () => {
    render(<Library theme="light" onToggleTheme={() => {}} />)

    expect(screen.getByText('QuizForge')).toBeTruthy()
    expect(screen.getByText('首页')).toBeTruthy()
    expect(screen.getAllByText('今日复习').length).toBeGreaterThan(0)
    expect(screen.getByText('收藏题目')).toBeTruthy()
    expect(screen.getByText('错题本')).toBeTruthy()
    expect(screen.getByText('整理错题')).toBeTruthy()
    expect(screen.getByText('学习报告')).toBeTruthy()
  })

  it('renders the topbar search input with the correct placeholder', () => {
    render(<Library theme="light" onToggleTheme={() => {}} />)

    expect(screen.getByPlaceholderText('搜索笔记本、题目或内容')).toBeTruthy()
  })

  it('剪藏时 notebookId 为 default 且没有 newNotebookName 时，打开弹窗且不调用 createBook', async () => {
    const countBefore = loadUserBooks().length
    let clipHandler = null
    window.clipper = {
      updateNotebooks: vi.fn(),
      onImportClip: vi.fn((fn) => {
        clipHandler = fn
        return () => {}
      }),
    }

    render(<Library theme="light" onToggleTheme={() => {}} />)

    expect(clipHandler).toBeTruthy()
    act(() => {
      clipHandler({
        notebookId: 'default',
        newNotebookName: '',
        type: 'quiz',
        contentMarkdown: '## 测试题目\n- [x] 正确\n- [ ] 错误',
        title: '剪藏题目',
      })
    })

    await waitFor(() => {
      expect(screen.getByText(/从 ChatGPT \/ Gemini 对话导入/)).toBeTruthy()
    })
    expect(loadUserBooks().length).toBe(countBefore)
  })

  it('剪藏时 notebookId 为空但 newNotebookName 为“数据结构”时，不打开弹窗并以“数据结构”静默新建', async () => {
    let clipHandler = null
    window.clipper = {
      updateNotebooks: vi.fn(),
      onImportClip: vi.fn((fn) => {
        clipHandler = fn
        return () => {}
      }),
    }

    render(<Library theme="light" onToggleTheme={() => {}} />)

    act(() => {
      clipHandler({
        notebookId: '',
        newNotebookName: '数据结构',
        type: 'quiz',
        contentMarkdown: '## 测试题目\n- [x] 正确\n- [ ] 错误',
        title: '树与二叉树',
      })
    })

    await waitFor(() => {
      expect(screen.queryByText(/从 ChatGPT \/ Gemini 对话导入/)).toBeNull()
      expect(screen.getByText(/成功导入测验：/)).toBeTruthy()
    })
    expect(loadUserBooks().some((b) => b.name === '数据结构')).toBe(true)
  })

  it('剪藏时指定了已有 notebookId，保持静默导入到该笔记本', async () => {
    const book = createBook({ name: '已存在的物理本' })
    let clipHandler = null
    window.clipper = {
      updateNotebooks: vi.fn(),
      onImportClip: vi.fn((fn) => {
        clipHandler = fn
        return () => {}
      }),
    }

    render(<Library theme="light" onToggleTheme={() => {}} />)

    act(() => {
      clipHandler({
        notebookId: book.id,
        type: 'quiz',
        contentMarkdown: '## 测试题目\n- [x] 正确\n- [ ] 错误',
        title: '指定笔记本的剪藏',
      })
    })

    await waitFor(() => {
      expect(screen.queryByText(/从 ChatGPT \/ Gemini 对话导入/)).toBeNull()
      expect(screen.getByText(/成功导入测验：/)).toBeTruthy()
    })
  })
})

describe('BookDetail', () => {
  it('lists quizzes in a user book and opens one on click', () => {
    const book = createBook({ name: '题库' })
    addQuizToBook(book.id, QUIZ_MD)

    render(<BookDetail bookId={book.id} theme="light" onToggleTheme={() => {}} />)
    const card = screen.getByText('冒泡排序')
    expect(card).toBeTruthy()
    fireEvent.click(card)
    expect(window.location.hash).toContain('play=')
  })

  it('shows a read-only message for an empty built-in-like state', () => {
    const book = createBook({ name: '空本' })
    render(<BookDetail bookId={book.id} theme="light" onToggleTheme={() => {}} />)
    expect(screen.getByText(/还没有测验/)).toBeTruthy()
  })

  it('keeps the add quiz action in the tab toolbar', () => {
    const book = createBook({ name: '题库' })
    render(<BookDetail bookId={book.id} theme="light" onToggleTheme={() => {}} />)

    expect(screen.getByRole('button', { name: /添加测验/ }).closest('.book-detail__tabs')).toBeTruthy()
  })
})
