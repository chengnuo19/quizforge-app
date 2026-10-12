import { describe, it, expect } from 'vitest'
import {
  parsePageRanges,
  mergeRanges,
  splitEveryN,
  expandRanges,
} from './pageRanges.js'

describe('parsePageRanges', () => {
  it('keeps adjacent ranges separate (split semantics)', () => {
    expect(parsePageRanges('1-5, 6-10, 15', 20)).toEqual([
      { start: 1, end: 5 },
      { start: 6, end: 10 },
      { start: 15, end: 15 },
    ])
  })

  it('parses "1,3,5-12" (extract style)', () => {
    expect(parsePageRanges('1,3,5-12', 20)).toEqual([
      { start: 1, end: 1 },
      { start: 3, end: 3 },
      { start: 5, end: 12 },
    ])
  })

  it('accepts full-width comma and whitespace', () => {
    expect(parsePageRanges('1，3 , 5- 7', 20)).toEqual([
      { start: 1, end: 1 },
      { start: 3, end: 3 },
      { start: 5, end: 7 },
    ])
  })

  it('merges only overlapping ranges, keeping adjacent ranges separate', () => {
    expect(parsePageRanges('1-3, 2-5, 8-9, 10-11', 20)).toEqual([
      { start: 1, end: 5 },
      { start: 8, end: 9 },
      { start: 10, end: 11 },
    ])
  })

  it('throws on empty input', () => {
    expect(() => parsePageRanges('', 10)).toThrow(/请输入要处理的页码/)
    expect(() => parsePageRanges('   ,  ', 10)).toThrow(/请输入要处理的页码/)
  })

  it('throws on an unparseable token with the offending text', () => {
    expect(() => parsePageRanges('1-5, abc', 20)).toThrow(/abc/)
  })

  it('throws when a range exceeds the document length', () => {
    expect(() => parsePageRanges('1-99', 10)).toThrow(/99 超出范围（文档共 10 页）/)
  })

  it('throws on a zero or negative start', () => {
    expect(() => parsePageRanges('0-3', 10)).toThrow(/必须从 1 开始/)
  })

  it('throws when start is greater than end', () => {
    expect(() => parsePageRanges('5-2', 10)).toThrow(/区间无效/)
  })
})

describe('mergeRanges', () => {
  it('sorts and merges out-of-order input', () => {
    expect(mergeRanges([{ start: 5, end: 6 }, { start: 1, end: 2 }])).toEqual([
      { start: 1, end: 2 },
      { start: 5, end: 6 },
    ])
  })
})

describe('splitEveryN', () => {
  it('splits 10 pages into chunks of 4', () => {
    expect(splitEveryN(10, 4)).toEqual([
      { start: 1, end: 4 },
      { start: 5, end: 8 },
      { start: 9, end: 10 },
    ])
  })

  it('handles an exact division', () => {
    expect(splitEveryN(6, 3)).toEqual([
      { start: 1, end: 3 },
      { start: 4, end: 6 },
    ])
  })

  it('throws on a non-positive chunk size', () => {
    expect(() => splitEveryN(10, 0)).toThrow(/大于 0/)
    expect(() => splitEveryN(10, 2.5)).toThrow(/大于 0/)
  })
})

describe('expandRanges', () => {
  it('flattens ranges to 1-based page numbers', () => {
    expect(expandRanges([{ start: 1, end: 3 }, { start: 5, end: 5 }])).toEqual([
      1, 2, 3, 5,
    ])
  })
})
