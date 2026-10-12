import { describe, it, expect } from 'vitest'
import { shuffleQuiz } from './shuffle.js'
import { parseQuiz } from './parseQuiz.js'

const QUIZ = parseQuiz(`---
title: T
shuffle: true
---
## Q1
- [x] a
- [ ] b
- [ ] c
- [ ] d
## Q2
- [x] a
- [ ] b
## Q3
- [x] a
- [ ] b
`)

describe('shuffleQuiz', () => {
  it('parses shuffle flags from front matter', () => {
    expect(QUIZ.shuffle).toBe(true)
    expect(QUIZ.shuffleOptions).toBe(true) // defaults to shuffle
  })

  it('is deterministic for the same seed', () => {
    const a = shuffleQuiz(QUIZ, 123)
    const b = shuffleQuiz(QUIZ, 123)
    expect(a.questions.map((q) => q.prompt)).toEqual(b.questions.map((q) => q.prompt))
  })

  it('relabels options A/B/C… by new position and keeps exactly one correct per Q1', () => {
    const s = shuffleQuiz(QUIZ, 999)
    const q1 = s.questions.find((q) => q.prompt === 'Q1')
    expect(q1.options.map((o) => o.label)).toEqual(['A', 'B', 'C', 'D'])
    expect(q1.options.filter((o) => o.correct)).toHaveLength(1)
    expect(q1.options.find((o) => o.correct).text).toBe('a')
  })

  it('returns the quiz unchanged when shuffle is off', () => {
    const off = parseQuiz('## Q\n- [x] a\n- [ ] b\n')
    expect(shuffleQuiz(off, 1)).toBe(off)
  })
})
