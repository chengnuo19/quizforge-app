// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { cardId, getCardState, updateCard } from './srs.js'

// Note: getDueCards / countDue / getSrsStats all call listBooks() which uses
// import.meta.glob — not testable in the plain jsdom environment. Those paths
// are covered by the integration smoke test (Library.test.jsx).

beforeEach(() => localStorage.clear())

describe('cardId', () => {
  it('returns the same hash for the same inputs', () => {
    const a = cardId('book1', 'quiz1', 'What is 1+1?')
    const b = cardId('book1', 'quiz1', 'What is 1+1?')
    expect(a).toBe(b)
  })

  it('returns different hashes for different prompts', () => {
    const a = cardId('book1', 'quiz1', 'Question A')
    const b = cardId('book1', 'quiz1', 'Question B')
    expect(a).not.toBe(b)
  })

  it('returns different hashes for different quizIds', () => {
    const a = cardId('book1', 'quiz1', 'Q')
    const b = cardId('book1', 'quiz2', 'Q')
    expect(a).not.toBe(b)
  })

  it('returns different hashes for different bookIds', () => {
    const a = cardId('book1', 'quiz1', 'Q')
    const b = cardId('book2', 'quiz1', 'Q')
    expect(a).not.toBe(b)
  })
})

describe('getCardState', () => {
  it('returns defaults for an unseen card', () => {
    const state = getCardState('unknown-id')
    expect(state.repetitions).toBe(0)
    expect(state.easeFactor).toBe(2.5)
    expect(state.interval).toBe(1)
    expect(state.nextReview).toBe(0)
    expect(state.lastReview).toBeNull()
  })
})

describe('SM-2 algorithm via updateCard', () => {
  const ID = 'test-card'

  it('first correct answer → interval = 1 day, repetitions = 1', () => {
    const result = updateCard(ID, true)
    expect(result.repetitions).toBe(1)
    expect(result.interval).toBe(1)
    expect(result.nextReview).toBeGreaterThan(Date.now())
    expect(result.lastReview).toBeGreaterThan(0)
  })

  it('second correct answer → interval = 6 days, repetitions = 2', () => {
    updateCard(ID, true) // rep 1 → interval 1
    const result = updateCard(ID, true) // rep 2 → interval 6
    expect(result.repetitions).toBe(2)
    expect(result.interval).toBe(6)
  })

  it('third correct answer → interval grows by easeFactor', () => {
    updateCard(ID, true) // rep 1
    updateCard(ID, true) // rep 2, interval 6
    const result = updateCard(ID, true) // rep 3, interval = round(6 * 2.5) = 15
    expect(result.repetitions).toBe(3)
    expect(result.interval).toBe(15)
  })

  it('wrong answer resets repetitions to 0 and interval to 1', () => {
    updateCard(ID, true) // rep 1
    updateCard(ID, true) // rep 2, interval 6
    const result = updateCard(ID, false) // wrong → reset
    expect(result.repetitions).toBe(0)
    expect(result.interval).toBe(1)
  })

  it('wrong answer lowers the easeFactor (harder card)', () => {
    const before = getCardState(ID).easeFactor
    updateCard(ID, false)
    const after = getCardState(ID).easeFactor
    expect(after).toBeLessThan(before)
  })

  it('easeFactor never drops below 1.3', () => {
    // Spam wrong answers to drive easeFactor as low as possible
    for (let i = 0; i < 30; i++) updateCard(ID, false)
    const state = getCardState(ID)
    expect(state.easeFactor).toBeGreaterThanOrEqual(1.3)
  })

  it('nextReview is in the future after a correct answer', () => {
    const now = Date.now()
    updateCard(ID, true)
    expect(getCardState(ID).nextReview).toBeGreaterThan(now)
  })

  it('persists state to localStorage', () => {
    updateCard(ID, true)
    updateCard(ID, true)
    // Simulate a fresh load by re-reading through getCardState
    const state = getCardState(ID)
    expect(state.repetitions).toBe(2)
    expect(state.interval).toBe(6)
  })

  it('keeps separate state per card ID', () => {
    updateCard('card-a', true)
    updateCard('card-a', true) // interval 6
    updateCard('card-b', false) // wrong, different card

    expect(getCardState('card-a').interval).toBe(6)
    expect(getCardState('card-b').repetitions).toBe(0)
  })
})
