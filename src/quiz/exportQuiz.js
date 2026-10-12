// Serialize quiz questions to several export formats:
//   - QuizForge markdown (re-importable)
//   - Anki CSV (front,back)
//   - Quizlet TSV (term<TAB>definition)
// Used to export wrong answers (optionally annotated with the user's pick) as a
// study deck.

// ---------- shared helpers ----------

function correctOptions(q) {
  return q.options.filter((o) => o.correct)
}

// "A. 文本；B. 文本"
function joinOptions(opts, sep = '；') {
  return opts.map((o) => `${o.label}. ${o.text}`).join(sep)
}

// Collapse newlines/tabs to spaces for single-cell formats (CSV/TSV).
function flat(s) {
  return String(s).replace(/[\t\r\n]+/g, ' ').trim()
}

// Annotation line for an exported question, when the user's pick is attached as
// `q._picked` (array of chosen labels; empty = unanswered).
function pickAnnotation(q) {
  if (!Array.isArray(q._picked)) return null
  const correct = correctOptions(q).map((o) => o.label).join('、')
  if (q._picked.length === 0) return `本题未作答，正确答案为 ${correct}。`
  return `你选择了 ${q._picked.join('、')}，正确答案为 ${correct}。`
}

// ---------- QuizForge markdown ----------

/**
 * Build a QuizForge markdown string from question objects (re-importable).
 * If a question carries `_picked` (the user's chosen labels), an annotation line
 * is appended to its explanation.
 *
 * @param {string} title      Front-matter title.
 * @param {Array}  questions  Question objects (parseQuiz shape, optionally + _picked).
 * @returns {string} markdown
 */
export function buildQuizMarkdown(title, questions) {
  const out = ['---', `title: ${title}`, '---', '']

  for (const q of questions) {
    const promptLines = q.prompt.split('\n')
    out.push(`## ${promptLines[0]}`)
    if (promptLines.length > 1) {
      out.push('')
      out.push(...promptLines.slice(1))
    }
    out.push('')

    for (const opt of q.options) {
      out.push(`- [${opt.correct ? 'x' : ' '}] ${opt.text}`)
      if (opt.explanation) {
        for (const line of opt.explanation.split('\n')) out.push(`  ${line}`)
      }
    }

    // Whole-question explanation, plus optional pick annotation.
    const explainParts = []
    if (q.explain) explainParts.push(...q.explain.split('\n'))
    const annotation = pickAnnotation(q)
    if (annotation) explainParts.push(annotation)
    if (explainParts.length) {
      out.push('')
      out.push(`> Explain: ${explainParts[0]}`)
      for (const line of explainParts.slice(1)) out.push(`> ${line}`)
    }

    out.push('')
  }

  return out.join('\n')
}

// ---------- Anki CSV ----------

function csvCell(s) {
  return `"${String(s).replace(/"/g, '""')}"`
}

/**
 * Anki-importable CSV: two columns (front, back). HTML <br> is used for line
 * breaks since Anki renders HTML in fields.
 */
export function buildAnkiCsv(questions) {
  const rows = questions.map((q) => {
    const front = [q.prompt, joinOptions(q.options, '<br>')]
      .map((s) => flat(s))
      .join('<br>')
    const backParts = [`正确答案：${joinOptions(correctOptions(q))}`]
    if (q.explain) backParts.push(flat(q.explain))
    for (const o of correctOptions(q)) {
      if (o.explanation) backParts.push(`${o.label}. ${flat(o.explanation)}`)
    }
    const ann = pickAnnotation(q)
    if (ann) backParts.push(ann)
    return `${csvCell(front)},${csvCell(backParts.join('<br>'))}`
  })
  return rows.join('\n')
}

// ---------- Quizlet TSV ----------

/**
 * Quizlet-importable text: term<TAB>definition, one card per line. Use the
 * default Quizlet import settings (Tab between term/definition, newline between cards).
 */
export function buildQuizletTsv(questions) {
  const rows = questions.map((q) => {
    const term = `${flat(q.prompt)} — ${joinOptions(q.options, ' / ')}`
    const defParts = [`正确答案：${joinOptions(correctOptions(q))}`]
    if (q.explain) defParts.push(flat(q.explain))
    const ann = pickAnnotation(q)
    if (ann) defParts.push(ann)
    return `${term}\t${defParts.join(' | ')}`
  })
  return rows.join('\n')
}

// ---------- download ----------

const MIME = {
  md: 'text/markdown;charset=utf-8',
  csv: 'text/csv;charset=utf-8',
  tsv: 'text/tab-separated-values;charset=utf-8',
}

/**
 * Trigger a browser download for a text string.
 * @param {string} filename
 * @param {string} content
 * @param {'md'|'csv'|'tsv'} [kind]
 */
export function downloadTextFile(filename, content, kind = 'md') {
  const blob = new Blob([content], { type: MIME[kind] || MIME.md })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
