import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  normalizeTodos,
  loadTodos,
  saveTodos,
  createTodo,
  updateTodo,
  deleteTodo,
  toggleTodoStatus
} from './todos.js'

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

describe('todos data layer', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('normalizes invalid or missing data structure', () => {
    const empty = normalizeTodos(null)
    expect(empty.schemaVersion).toBe(1)
    expect(empty.todos).toEqual([])

    const invalid = normalizeTodos({ schemaVersion: 2, todos: 'not-an-array' })
    expect(invalid.schemaVersion).toBe(2)
    expect(invalid.todos).toEqual([])
  })

  it('normalizes and populates defaults for partial todos', () => {
    const raw = {
      schemaVersion: 1,
      todos: [
        { title: 'Test Task', status: 'open' }
      ]
    }
    const normalized = normalizeTodos(raw)
    expect(normalized.todos).toHaveLength(1)
    
    const todo = normalized.todos[0]
    expect(todo.id).toBeDefined()
    expect(todo.title).toBe('Test Task')
    expect(todo.notes).toBe('')
    expect(todo.status).toBe('open')
    expect(typeof todo.dueAt).toBe('number')
    expect(todo.estimateMinutes).toBe(0)
    expect(todo.remindBeforeHours).toBe(0)
    expect(todo.reminderChannel).toBe('gmail')
    expect(todo.reminderStatus).toBe('none')
    expect(typeof todo.createdAt).toBe('number')
    expect(typeof todo.updatedAt).toBe('number')
  })

  it('loads empty todos initially', () => {
    const data = loadTodos()
    expect(data.schemaVersion).toBe(1)
    expect(data.todos).toEqual([])
  })

  it('creates a new todo', async () => {
    const data = await createTodo({
      title: 'New Todo',
      notes: 'Some notes',
      dueAt: 12345678,
      estimateMinutes: 30,
      remindBeforeHours: 1
    })

    expect(data.todos).toHaveLength(1)
    const todo = data.todos[0]
    expect(todo.title).toBe('New Todo')
    expect(todo.notes).toBe('Some notes')
    expect(todo.dueAt).toBe(12345678)
    expect(todo.estimateMinutes).toBe(30)
    expect(todo.remindBeforeHours).toBe(1)
    expect(todo.status).toBe('open')
    expect(todo.reminderStatus).toBe('none')
  })

  it('updates an existing todo and resets reminderStatus if time/reminder values change', async () => {
    let data = await createTodo({
      title: 'Task to update',
      dueAt: 1000,
      estimateMinutes: 10,
      remindBeforeHours: 2
    })
    
    const id = data.todos[0].id

    // Manually mark as scheduled in mock state
    data.todos[0].reminderStatus = 'scheduled'
    localStorage.setItem('quizforge:todos', JSON.stringify(data))

    // Update irrelevant fields
    data = await updateTodo(id, { notes: 'Updated notes' })
    expect(data.todos[0].notes).toBe('Updated notes')
    expect(data.todos[0].reminderStatus).toBe('scheduled')

    // Update timing field - should reset reminderStatus
    data = await updateTodo(id, { dueAt: 2000 })
    expect(data.todos[0].dueAt).toBe(2000)
    expect(data.todos[0].reminderStatus).toBe('none')
  })

  it('deletes a todo', async () => {
    let data = await createTodo({ title: 'Task 1' })
    data = await createTodo({ title: 'Task 2' })
    expect(data.todos).toHaveLength(2)

    const idToDelete = data.todos[0].id
    data = await deleteTodo(idToDelete)
    expect(data.todos).toHaveLength(1)
    expect(data.todos[0].title).toBe('Task 2')
  })

  it('toggles todo status and resets reminderStatus on reopen', async () => {
    let data = await createTodo({ title: 'Toggle Task' })
    const id = data.todos[0].id

    data = await toggleTodoStatus(id)
    expect(data.todos[0].status).toBe('done')

    // Mock set reminderStatus to sent
    data.todos[0].reminderStatus = 'sent'
    localStorage.setItem('quizforge:todos', JSON.stringify(data))

    // Toggle back to open
    data = await toggleTodoStatus(id)
    expect(data.todos[0].status).toBe('open')
    expect(data.todos[0].reminderStatus).toBe('none')
  })
})
