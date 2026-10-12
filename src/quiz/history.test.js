// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { loadHistory, addAttempt } from './storage.js'

describe('attempt history', () => {
  beforeEach(() => localStorage.clear())

  it('returns an empty array when there is no history', () => {
    expect(loadHistory('k')).toEqual([])
  })

  it('appends attempts oldest-first and stamps a date', () => {
    addAttempt('k', { score: 3, total: 5, timeMs: 1000 })
    addAttempt('k', { score: 4, total: 5, timeMs: 900 })
    const list = loadHistory('k')
    expect(list).toHaveLength(2)
    expect(list[0].score).toBe(3)
    expect(list[1].score).toBe(4)
    expect(typeof list[0].date).toBe('number')
  })

  it('keeps at most the last 20 attempts', () => {
    for (let i = 0; i < 25; i++) addAttempt('k', { score: i, total: 25, timeMs: 0 })
    const list = loadHistory('k')
    expect(list).toHaveLength(20)
    expect(list[0].score).toBe(5) // first 5 dropped
    expect(list[19].score).toBe(24)
  })

  it('keeps separate history per key', () => {
    addAttempt('a', { score: 1, total: 2, timeMs: 0 })
    addAttempt('b', { score: 2, total: 2, timeMs: 0 })
    expect(loadHistory('a')).toHaveLength(1)
    expect(loadHistory('b')[0].score).toBe(2)
  })
})
