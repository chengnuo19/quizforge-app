// Parse a QuizForge markdown string into a structured quiz model.
//
// Format (see README.md):
//   ---
//   title: ...
//   sources: 5        (optional)
//   ---
//   ## question prompt (may contain $latex$)
//   - [ ] option text
//     indented explanation for that option
//   - [x] correct option text
//     indented explanation
//   > Explain: optional whole-question explanation
//
// Returns: { title, sources, questions: [
//   { prompt, explain, options: [ { label, text, explanation, correct } ] }
// ] }
//
// Throws Error with a human-readable message on malformed input.

const OPTION_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

// Strip a leading "A." / "A、" / "A)" / "A）" the author may have typed by hand,
// since labels are assigned automatically by order.
const MANUAL_LABEL_RE = /^(\*\*|__|[*_])?([A-Za-z][.、)）])(\*\*|__|[*_])?\s+/

function parseFrontMatter(text) {
  const meta = {}
  let match = text.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (match && /(?:^|\n)##/.test(match[1])) {
    match = null
  }
  if (!match) return { meta, body: text.replace(/^﻿/, '') }
  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    let value = line.slice(idx + 1).trim()
    // Drop inline "# comment" and surrounding quotes.
    value = value.replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim()
    meta[key] = value
  }
  return { meta, body: text.slice(match[0].length) }
}

// Extract answer letters from strings like "A", "AB", "A、B", "A,B", "ABD"
function extractAnswerLetters(str) {
  // Remove markdown bold/italic markers
  const clean = str.replace(/\*+/g, '').replace(/_+/g, '').trim()
  // Match all uppercase letters that could be option labels
  return [...clean.matchAll(/[A-Z]/g)].map((m) => m[0])
}

function getJudgmentValue(str) {
  const clean = str.replace(/[*_()（）【\]\[\s：:]/g, '').trim().toLowerCase()
  if (['对', '正确', 't', 'true', 'yes', 'v', '√'].includes(clean) || clean.startsWith('对') || clean.startsWith('正确')) {
    return true
  }
  if (['错', '错误', 'f', 'false', 'no', 'x', 'ｘ'].includes(clean) || clean.startsWith('错') || clean.startsWith('错误')) {
    return false
  }
  return null
}

function finalizeQuestion(q, index) {
  // If we collected "正确答案" hints, apply them now.
  if (q._correctLabels && q._correctLabels.length > 0) {
    for (const o of q.options) {
      o.correct = q._correctLabels.includes(o.label)
    }
  } else if (q._correctJudgment !== undefined) {
    const val = getJudgmentValue(q._correctJudgment)
    if (val !== null) {
      if (q.options.length > 0) {
        for (const o of q.options) {
          const oVal = getJudgmentValue(o.text)
          if (oVal !== null) {
            o.correct = (oVal === val)
          }
        }
      } else {
        const useCorrectIncorrect = q._correctJudgment.includes('正确') || q._correctJudgment.includes('错误')
        const trueText = useCorrectIncorrect ? '正确' : '对'
        const falseText = useCorrectIncorrect ? '错误' : '错'
        q.options = [
          { label: 'A', text: trueText, explanation: '', correct: val === true },
          { label: 'B', text: falseText, explanation: '', correct: val === false }
        ]
      }
    }
  }
  delete q._correctLabels
  delete q._correctJudgment
  delete q._inExplain

  const correctCount = q.options.filter((o) => o.correct).length
  if (correctCount === 0) {
    throw new Error(`第 ${index} 题没有标记正确答案（请用 "- [x]" 标记选项）。`)
  }
  // More than one [x] makes this a multiple-answer question.
  q.multi = correctCount > 1
  q.prompt = q.prompt.trim()
  q.explain = q.explain.trim() || undefined
  for (const o of q.options) {
    o.text = o.text.trim()
    o.explanation = o.explanation.trim() || undefined
  }
  return q
}

export function parseQuiz(source) {
  if (typeof source !== 'string' || source.trim() === '') {
    throw new Error('内容为空，请提供 Markdown 测验文本。')
  }

  const { meta, body } = parseFrontMatter(source)

  // Extract first H1 heading as title if meta.title is not specified
  let title = meta.title
  if (!title) {
    const titleMatch = body.match(/^(?:>?\s*)?#\s+(.+)$/m)
    if (titleMatch) {
      title = titleMatch[1].trim()
    }
  }

  const lines = body.split(/\r?\n/)

  const questions = []
  let current = null // current question
  let lastOption = null // current option (for explanation continuation)
  let inFence = false // inside a ``` / ~~~ fenced code block

  const pushQuestion = () => {
    if (current && (current.options.length > 0 || current._correctJudgment !== undefined)) {
      questions.push(finalizeQuestion(current, questions.length + 1))
    }
  }

  // QUESTION_START_RE: matches either markdown H1-H6 headings OR lines starting with "第 X 题" or list numbers
  const QUESTION_START_RE = /^(?:#{1,6}\s*(.*)|(?:\*\*|__|[*_])?(?:第\s*(\d+|[一二三四五六七八九十百]+)\s*题|(\d+|[一二三四五六七八九十百]+))[.、:：\s]\s*(?:\*\*|__|[*_])?\s*(.*))$/

  // ANSWER_LINE_RE: matches correct answer declarations
  const ANSWER_LINE_RE = /^(?:>\s*)?(?:[-*+－—]\s*)?(?:(?:【|\[)\s*\**(?:正确答案|参考答案|答案|Answer|Ans)\**\s*(?:】|\])|(?:[-*+－—]\s*)?\**(?:正确答案|参考答案|答案|Answer|Ans)\**[：:\s]+)(.*)$/i

  // EXPLAIN_LINE_RE: matches explanation declarations
  const EXPLAIN_LINE_RE = /^(?:>\s*)?(?:[-*+－—]\s*)?(?:(?:【|\[)\s*\**(?:答案解析|详细解析|解析|详解|Explain|Explanation)\**\s*(?:】|\])|(?:[-*+－—]\s*)?\**(?:答案解析|详细解析|解析|详解|Explain|Explanation)\**[：:\s]+)(.*)$/i

  // altOptionRegex: matches flexible option formats with decorator and separator validation
  const altOptionRegex = /^(?:(?:[-*+－—]\s*|\d+[.、)）]\s*))?(\*\*|__|[*_])?([([【（])?([A-Z])([)\]】）])?(\*\*|__|[*_])?([.、:：])?(\*\*|__|[*_])?\s*(.*)$/

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '')
    const trimmed = line.trim()

    // Inside a fenced code block, take lines verbatim — never treat "##" or
    // "- [ ]" inside code as quiz structure. Strip up to 2 leading spaces (the
    // explanation indent) while keeping deeper code indentation.
    const isFence = /^(```|~~~)/.test(trimmed)
    if (current && (inFence || isFence)) {
      const content = rawLine.replace(/^ {0,2}/, '')
      if (lastOption) {
        lastOption.explanation += (lastOption.explanation ? '\n' : '') + content
      } else {
        current.prompt += '\n' + content
      }
      if (isFence) inFence = !inFence
      continue
    }

    // Option: "- [ ] text" or "- [x] text", tolerating different bullets, numbers, whitespace, and checkmarks
    // We restrict the contents of [] to checkmark-like characters or space so we don't accidentally match Markdown links.
    const option = trimmed.match(/^(?:[-*+－—]|\d+[.、)）])?\s*\[([xXvV√ｘｖ\s]*?)\]\s*(.*)$/)
    if (current && option) {
      current._inExplain = false
      const label = OPTION_LABELS[current.options.length] ?? '?'
      const mark = option[1].trim().toLowerCase()
      // Treat as correct if it contains x, v, or √
      const correct = ['x', 'v', '√', 'ｘ', 'ｖ'].includes(mark)
      const text = option[2].replace(MANUAL_LABEL_RE, (match, p1, p2, p3) => {
        if (p1 && p3) return ''
        return p1 || ''
      })
      lastOption = {
        label,
        text,
        explanation: '',
        correct,
      }
      current.options.push(lastOption)
      continue
    }

    // Alternative option format: e.g., "A. text" / "A) text" / "【A】text"
    const altOption = trimmed.match(altOptionRegex)
    if (current && altOption && current.options.length === OPTION_LABELS.indexOf(altOption[3])) {
      // Validate that it actually has a decorator or separator (avoid matching random words starting with A)
      const hasDecorator = !!(altOption[1] || altOption[2] || altOption[4] || altOption[5] || altOption[6] || altOption[7])
      if (hasDecorator) {
        current._inExplain = false
        const p1 = altOption[1]
        const p3 = altOption[5] || altOption[6]
        const prefix = (p1 && !p3) ? p1 : ''
        lastOption = {
          label: altOption[3],
          text: prefix + altOption[8],
          explanation: '',
          correct: false, // will be set by _correctLabels/_correctJudgment in finalizeQuestion
        }
        current.options.push(lastOption)
        continue
      }
    }

    // New question detection (use line instead of trimmed to require column 0 alignment for numbers)
    const heading = line.match(QUESTION_START_RE)
    if (heading) {
      const promptText = (heading[1] || heading[4] || '').trim()
      // Skip H1 title if it matches the extracted title
      if (!current && promptText === title) {
        continue
      }
      pushQuestion()
      current = { prompt: promptText, explain: '', options: [] }
      lastOption = null
      continue
    }

    if (!current) continue // skip anything before the first question

    // Correct answer line
    const answerMatch = trimmed.match(ANSWER_LINE_RE)
    if (answerMatch && (answerMatch[1].includes('对') || answerMatch[1].includes('错') || answerMatch[1].includes('正确') || answerMatch[1].includes('错误') || extractAnswerLetters(answerMatch[1]).length > 0)) {
      const answerVal = answerMatch[1].trim()
      const letters = extractAnswerLetters(answerVal)
      if (letters.length > 0) {
        current._correctLabels = letters
      } else {
        current._correctJudgment = answerVal
      }
      lastOption = null
      continue
    }

    // Explanation line
    const explainMatch = trimmed.match(EXPLAIN_LINE_RE)
    if (explainMatch) {
      const cleanContent = explainMatch[1].replace(/^[*_\s：:]+/, '').trim()
      if (cleanContent) {
        current.explain += (current.explain ? '\n' : '') + cleanContent
      }
      current._inExplain = true
      lastOption = null
      continue
    }

    // Whole-question explanation: "> Explain: ..." or following "> ..." lines (fallback for general quotes)
    const quote = trimmed.match(/^>\s?(.*)$/)
    if (quote) {
      const content = quote[1]
      const cleanContent = content
        .replace(/^\*+|\*+$/g, '')           // leading/trailing bold markers
        .trim()
      if (cleanContent) current.explain += (current.explain ? '\n' : '') + cleanContent
      lastOption = null // explanation block ends option continuation
      continue
    }

    if (trimmed === '') continue

    // Indented/continuation lines
    const indented = /^\s+/.test(rawLine)
    if (current._inExplain) {
      current.explain += (current.explain ? '\n' : '') + trimmed
    } else if (indented && lastOption) {
      lastOption.explanation += (lastOption.explanation ? '\n' : '') + trimmed
    } else if (!indented && current.options.length === 0) {
      current.prompt += '\n' + trimmed
    } else if (lastOption) {
      lastOption.explanation += (lastOption.explanation ? '\n' : '') + trimmed
    }
  }
  pushQuestion()

  if (questions.length === 0) {
    throw new Error('没有找到任何题目（题目以 "## "、"第 X 题" 或 "数字." 开头）。')
  }

  const sources = meta.sources != null && meta.sources !== '' ? Number(meta.sources) : undefined
  const truthy = (v) => ['true', '1', 'yes', 'on'].includes(String(v).toLowerCase())
  const shuffle = truthy(meta.shuffle)
  // Options shuffle defaults to the question-shuffle setting; can be turned off explicitly.
  const shuffleOptions = meta.shuffleOptions != null ? truthy(meta.shuffleOptions) : shuffle

  return {
    title: title || '未命名测验',
    sources: Number.isFinite(sources) ? sources : undefined,
    shuffle,
    shuffleOptions,
    questions,
  }
}

export default parseQuiz
