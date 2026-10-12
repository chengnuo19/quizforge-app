import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getTodoSummary } from './todoSummary.js'
import { loadTodos } from './todos.js'

// Mock localStorage since environment is node
const localStorageMock = (() => {
  let store = {}
  return {
    getItem: vi.fn((key) => store[key] || null),
    setItem: vi.fn((key, value) => {
      store[key] = String(value)
    }),
    clear: vi.fn(() => {
      store = {}
    }),
    removeItem: vi.fn((key) => {
      delete store[key]
    })
  }
})()

vi.stubGlobal('localStorage', localStorageMock)

// Mock localFsStorage to prevent testing from trying to write to files
vi.mock('./localFsStorage.js', () => ({
  isDesktop: false,
  writeJsonFile: vi.fn(),
  readJsonFile: vi.fn(),
  getVaultPath: vi.fn()
}))

describe('todoSummary helper', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('returns zero counts and empty array when there are no todos', () => {
    const summary = getTodoSummary()
    expect(summary.openCount).toBe(0)
    expect(summary.overdueCount).toBe(0)
    expect(summary.nextTodos).toEqual([])
  })

  it('correctly calculates counts and returns nearest open todos', () => {
    const now = Date.now()
    const raw = {
      schemaVersion: 1,
      todos: [
        { id: '1', title: 'Task 1', status: 'open', dueAt: now + 50000 },
        { id: '2', title: 'Task 2', status: 'done', dueAt: now + 10000 },
        { id: '3', title: 'Task 3', status: 'open', dueAt: now - 10000 }, // Overdue
        { id: '4', title: 'Task 4', status: 'open', dueAt: now + 100000 },
        { id: '5', title: 'Task 5', status: 'open', dueAt: now + 20000 }
      ]
    }
    localStorage.setItem('quizforge:todos', JSON.stringify(raw))

    const summary = getTodoSummary()
    expect(summary.openCount).toBe(4) // Task 1, 3, 4, 5
    expect(summary.overdueCount).toBe(1) // Task 3
    
    // Nearest should be: Task 3 (past), Task 1 (now + 50k), Task 5 (now + 20k) wait:
    // dueAt sorted ascending: Task 3 (now - 10k) < Task 5 (now + 20k) < Task 1 (now + 50k) < Task 4 (now + 100k)
    // So nearest 3 should be: Task 3, Task 5, Task 1
    expect(summary.nextTodos).toHaveLength(3)
    expect(summary.nextTodos[0].id).toBe('3')
    expect(summary.nextTodos[1].id).toBe('5')
    expect(summary.nextTodos[2].id).toBe('1')
  })
})
