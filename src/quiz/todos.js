import { isDesktop, writeJsonFile } from './localFsStorage.js'

const LOCAL_KEY = 'quizforge:todos'

export function normalizeTodos(data) {
  const normalized = {
    schemaVersion: 1,
    todos: []
  }

  if (data && typeof data === 'object') {
    if (typeof data.schemaVersion === 'number') {
      normalized.schemaVersion = data.schemaVersion
    }
    if (Array.isArray(data.todos)) {
      normalized.todos = data.todos.map(todo => {
        return {
          id: todo.id ? String(todo.id) : String(Date.now() + Math.random()),
          title: String(todo.title || '未命名任务').trim(),
          notes: String(todo.notes || '').trim(),
          status: todo.status === 'done' ? 'done' : 'open',
          dueAt: typeof todo.dueAt === 'number' ? todo.dueAt : Date.now(),
          estimateMinutes: typeof todo.estimateMinutes === 'number' ? todo.estimateMinutes : 0,
          remindBeforeHours: typeof todo.remindBeforeHours === 'number' ? todo.remindBeforeHours : 0,
          reminderChannel: 'gmail',
          reminderStatus: ['none', 'scheduled', 'sent', 'failed'].includes(todo.reminderStatus) 
            ? todo.reminderStatus 
            : 'none',
          createdAt: typeof todo.createdAt === 'number' ? todo.createdAt : Date.now(),
          updatedAt: typeof todo.updatedAt === 'number' ? todo.updatedAt : Date.now()
        }
      })
    }
  }

  return normalized
}

export function loadTodos() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    if (!raw) return { schemaVersion: 1, todos: [] }
    return normalizeTodos(JSON.parse(raw))
  } catch (err) {
    console.error('Failed to load todos from localStorage:', err)
    return { schemaVersion: 1, todos: [] }
  }
}

export async function saveTodos(todosData) {
  const normalized = normalizeTodos(todosData)
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(normalized))
  } catch (err) {
    console.error('Failed to save todos to localStorage:', err)
  }

  if (isDesktop) {
    try {
      await writeJsonFile('todos.json', normalized)
      if (window.electronAPI && typeof window.electronAPI.todosChanged === 'function') {
        await window.electronAPI.todosChanged(normalized.todos)
      }
    } catch (err) {
      console.error('Failed to sync todos to desktop:', err)
    }
  }
  return normalized
}

export async function createTodo({ title, notes = '', dueAt, estimateMinutes = 0, remindBeforeHours = 0 }) {
  const data = loadTodos()
  const newTodo = {
    id: String(Date.now() + Math.floor(Math.random() * 1000)),
    title: title || '未命名任务',
    notes,
    status: 'open',
    dueAt: dueAt || Date.now(),
    estimateMinutes,
    remindBeforeHours,
    reminderChannel: 'gmail',
    reminderStatus: 'none',
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
  data.todos.push(newTodo)
  return await saveTodos(data)
}

export async function updateTodo(id, updates) {
  const data = loadTodos()
  const index = data.todos.findIndex(t => t.id === String(id))
  if (index === -1) return data

  const oldTodo = data.todos[index]
  
  // If dueAt, estimateMinutes, or remindBeforeHours changed, reset reminderStatus so it can be re-scheduled
  let reminderStatus = oldTodo.reminderStatus
  if (
    (updates.dueAt !== undefined && updates.dueAt !== oldTodo.dueAt) ||
    (updates.estimateMinutes !== undefined && updates.estimateMinutes !== oldTodo.estimateMinutes) ||
    (updates.remindBeforeHours !== undefined && updates.remindBeforeHours !== oldTodo.remindBeforeHours)
  ) {
    reminderStatus = 'none'
  }

  data.todos[index] = {
    ...oldTodo,
    ...updates,
    reminderStatus,
    updatedAt: Date.now()
  }
  return await saveTodos(data)
}

export async function deleteTodo(id) {
  const data = loadTodos()
  data.todos = data.todos.filter(t => t.id !== String(id))
  return await saveTodos(data)
}

export async function toggleTodoStatus(id) {
  const data = loadTodos()
  const index = data.todos.findIndex(t => t.id === String(id))
  if (index === -1) return data

  const todo = data.todos[index]
  const nextStatus = todo.status === 'open' ? 'done' : 'open'
  
  data.todos[index] = {
    ...todo,
    status: nextStatus,
    // Reset reminderStatus if marked open again so it can reschedule if still in the future
    reminderStatus: nextStatus === 'open' ? 'none' : todo.reminderStatus,
    updatedAt: Date.now()
  }
  return await saveTodos(data)
}
