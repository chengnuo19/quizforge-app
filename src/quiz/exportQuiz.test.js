import { describe, it, expect } from 'vitest'
import {
  buildQuizMarkdown,
  buildAnkiCsv,
  buildQuizletTsv,
} from './exportQuiz.js'
import { parseQuiz } from './parseQuiz.js'

// Round-trip helper: build markdown from questions, then re-parse.
function roundTrip(title, questions) {
  const md = buildQuizMarkdown(title, questions)
  return { md, reparsed: parseQuiz(md) }
}

describe('buildQuizMarkdown', () => {
  it('produces valid QuizForge markdown that re-parses correctly', () => {
    const questions = [
      {
        prompt: '哪个排序不稳定？',
        explain: '堆排序跨距离交换。',
        multi: false,
        options: [
          { label: 'A', text: '归并排序', correct: false, explanation: '归并稳定。' },
          { label: 'B', text: '堆排序',   correct: true,  explanation: '堆不稳定。' },
          { label: 'C', text: '冒泡排序', correct: false, explanation: undefined },
        ],
      },
    ]
    const { reparsed } = roundTrip('错题复习', questions)
    expect(reparsed.title).toBe('错题复习')
    expect(reparsed.questions).toHaveLength(1)
    const q = reparsed.questions[0]
    expect(q.prompt).toBe('哪个排序不稳定？')
    expect(q.explain).toBe('堆排序跨距离交换。')
    expect(q.options).toHaveLength(3)
    expect(q.options[1].correct).toBe(true)
    expect(q.options[0].explanation).toContain('归并稳定')
    expect(q.options[2].explanation).toBeUndefined()
  })

  it('handles multi-select questions correctly on round-trip', () => {
    const questions = [
      {
        prompt: '哪些是稳定排序？',
        multi: true,
        options: [
          { label: 'A', text: '归并排序', correct: true,  explanation: undefined },
          { label: 'B', text: '冒泡排序', correct: true,  explanation: undefined },
          { label: 'C', text: '快速排序', correct: false, explanation: undefined },
        ],
      },
    ]
    const { reparsed } = roundTrip('多选复习', questions)
    const q = reparsed.questions[0]
    expect(q.multi).toBe(true)
    expect(q.options.filter((o) => o.correct)).toHaveLength(2)
  })

  it('handles multi-line explain on round-trip', () => {
    const questions = [
      {
        prompt: '简单题',
        explain: '第一行讲解。\n第二行补充。',
        multi: false,
        options: [
          { label: 'A', text: '对', correct: true,  explanation: undefined },
          { label: 'B', text: '错', correct: false, explanation: undefined },
        ],
      },
    ]
    const { reparsed } = roundTrip('测试', questions)
    expect(reparsed.questions[0].explain).toContain('第一行讲解')
    expect(reparsed.questions[0].explain).toContain('第二行补充')
  })

  it('emits correct front-matter title', () => {
    const questions = [
      {
        prompt: 'Q',
        options: [{ label: 'A', text: 'yes', correct: true, explanation: undefined }],
      },
    ]
    const md = buildQuizMarkdown('我的错题集', questions)
    expect(md).toMatch(/^title: 我的错题集$/m)
  })

  it('labels are re-assigned A/B/C/D regardless of original labels', () => {
    // Questions with unusual original labels (e.g. from a shuffled quiz) still get
    // clean A/B/C on re-parse because we export only the text.
    const questions = [
      {
        prompt: 'Q',
        options: [
          { label: 'C', text: 'first',  correct: false, explanation: undefined },
          { label: 'A', text: 'second', correct: true,  explanation: undefined },
        ],
      },
    ]
    const { reparsed } = roundTrip('test', questions)
    const labels = reparsed.questions[0].options.map((o) => o.label)
    expect(labels).toEqual(['A', 'B'])
    expect(reparsed.questions[0].options[1].correct).toBe(true)
  })
})

const Q_WITH_PICK = {
  prompt: '2 + 2 = ?',
  explain: '基础加法。',
  options: [
    { label: 'A', text: '3', correct: false, explanation: undefined },
    { label: 'B', text: '4', correct: true, explanation: '正确。' },
    { label: 'C', text: '5', correct: false, explanation: undefined },
  ],
  _picked: ['A'],
}

describe('export annotations (user pick)', () => {
  it('appends the user pick + correct answer to the markdown explanation', () => {
    const md = buildQuizMarkdown('错题', [Q_WITH_PICK])
    expect(md).toContain('你选择了 A，正确答案为 B')
    // Re-parses cleanly (annotation lives in the Explain blockquote).
    const reparsed = parseQuiz(md)
    expect(reparsed.questions[0].explain).toContain('你选择了 A')
  })

  it('notes unanswered questions', () => {
    const md = buildQuizMarkdown('错题', [{ ...Q_WITH_PICK, _picked: [] }])
    expect(md).toContain('本题未作答，正确答案为 B')
  })
})

describe('buildAnkiCsv', () => {
  it('emits one quoted front,back row per question', () => {
    const csv = buildAnkiCsv([Q_WITH_PICK])
    const lines = csv.split('\n')
    expect(lines).toHaveLength(1)
    expect(lines[0].startsWith('"')).toBe(true)
    expect(csv).toContain('2 + 2 = ?')
    expect(csv).toContain('A. 3<br>')
    expect(csv).toContain('正确答案：B. 4')
    expect(csv).toContain('你选择了 A，正确答案为 B')
  })

  it('escapes embedded double quotes', () => {
    const q = {
      prompt: '他说"你好"',
      options: [{ label: 'A', text: 'x', correct: true, explanation: undefined }],
    }
    const csv = buildAnkiCsv([q])
    expect(csv).toContain('他说""你好""')
  })
})

describe('buildQuizletTsv', () => {
  it('emits term<TAB>definition with no stray tabs/newlines in fields', () => {
    const tsv = buildQuizletTsv([Q_WITH_PICK])
    const lines = tsv.split('\n')
    expect(lines).toHaveLength(1)
    const [term, def, extra] = lines[0].split('\t')
    expect(extra).toBeUndefined() // exactly one tab
    expect(term).toContain('2 + 2 = ?')
    expect(term).toContain('A. 3 / B. 4 / C. 5')
    expect(def).toContain('正确答案：B. 4')
  })
})
