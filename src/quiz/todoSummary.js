import { loadTodos } from './todos.js'

export function getTodoSummary() {
  const { todos = [] } = loadTodos() || {}
  const now = Date.now()

  const openTodos = todos.filter(t => t.status === 'open')
  const openCount = openTodos.length

  const overdueCount = openTodos.filter(t => t.dueAt < now).length

  const sortedOpen = [...openTodos].sort((a, b) => a.dueAt - b.dueAt)
  const nextTodos = sortedOpen.slice(0, 3).map(t => ({
    id: t.id,
    title: t.title,
    dueAt: t.dueAt
  }))

  return {
    openCount,
    nextTodos,
    overdueCount
  }
}
