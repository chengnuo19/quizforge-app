// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'
import React from 'react'
import TodoPanel from './TodoPanel.jsx'

// Mock localFsStorage
vi.mock('../quiz/localFsStorage.js', () => ({
  isDesktop: false,
  writeJsonFile: vi.fn(),
  readJsonFile: vi.fn(),
  getVaultPath: vi.fn()
}))

// Mock todos data module
vi.mock('../quiz/todos.js', () => ({
  loadTodos: vi.fn(() => ({
    schemaVersion: 1,
    todos: [
      {
        id: 'todo-1',
        title: 'Task Alpha',
        notes: 'Alpha Notes',
        status: 'open',
        dueAt: Date.now() + 100000,
        estimateMinutes: 30,
        remindBeforeHours: 1,
        reminderChannel: 'gmail',
        reminderStatus: 'none'
      },
      {
        id: 'todo-2',
        title: 'Task Beta',
        notes: 'Beta Notes',
        status: 'done',
        dueAt: Date.now() + 200000,
        estimateMinutes: 60,
        remindBeforeHours: 2,
        reminderChannel: 'gmail',
        reminderStatus: 'none'
      }
    ]
  })),
  createTodo: vi.fn(),
  updateTodo: vi.fn(),
  deleteTodo: vi.fn(),
  toggleTodoStatus: vi.fn()
}))

const todosModule = await import('../quiz/todos.js')

// Mock localStorage for safety
const localStorageMock = (() => {
  let store = {}
  return {
    getItem: (key) => store[key] || null,
    setItem: (key, value) => { store[key] = String(value) },
    clear: () => { store = {} },
    removeItem: (key) => { delete store[key] }
  }
})()
vi.stubGlobal('localStorage', localStorageMock)

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('TodoPanel Component', () => {
  it('renders correctly showing list of open todos by default', () => {
    render(<TodoPanel onExit={() => {}} />)
    
    expect(screen.getByText('To do 任务管理')).toBeTruthy()
    expect(screen.getByText('Task Alpha')).toBeTruthy()
    expect(screen.getByText('Alpha Notes')).toBeTruthy()
    
    // By default filter is 'open', so 'Task Beta' (which is done) should not be visible
    expect(screen.queryByText('Task Beta')).toBeNull()
  })

  it('allows switching filter to show completed todos', async () => {
    render(<TodoPanel onExit={() => {}} />)

    // Find the completed tab and click it
    const completedTab = screen.getByText(/已完成/)
    fireEvent.click(completedTab)

    await waitFor(() => {
      expect(screen.getByText('Task Beta')).toBeTruthy()
      expect(screen.queryByText('Task Alpha')).toBeNull()
    })
  })

  it('opens a dialog modal when clicking "新建任务" and allows submitting', async () => {
    render(<TodoPanel onExit={() => {}} onTodosChange={() => {}} />)

    const createBtn = screen.getByText('＋ 新建任务')
    fireEvent.click(createBtn)

    // Form modal should be visible now
    expect(screen.getByText('任务标题 *')).toBeTruthy()

    // Fill in title
    const titleInput = screen.getByPlaceholderText('要完成的事情...')
    fireEvent.change(titleInput, { target: { value: 'Task Gamma' } })

    // Submit form
    const saveBtn = screen.getByRole('button', { name: '保存' })
    fireEvent.click(saveBtn)

    await waitFor(() => {
      expect(todosModule.createTodo).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Task Gamma'
      }))
    })
  })

  it('toggles a todo status when clicking the complete check circle', async () => {
    render(<TodoPanel onExit={() => {}} />)

    // Find check button for Task Alpha
    const checkBtn = screen.getByTitle('标记为已完成')
    fireEvent.click(checkBtn)

    await waitFor(() => {
      expect(todosModule.toggleTodoStatus).toHaveBeenCalledWith('todo-1')
    })
  })
})
