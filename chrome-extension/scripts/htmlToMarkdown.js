/**
 * htmlToMarkdown.js
 * A lightweight HTML to Markdown converter designed specifically for ChatGPT and Gemini outputs.
 * Preserves KaTeX LaTeX formulas, code block languages, and Markdown formatting.
 */

function convertHtmlToMarkdown(elementOrHtml) {
  let root
  if (typeof elementOrHtml === 'string') {
    const parser = new DOMParser()
    const doc = parser.parseFromString(elementOrHtml, 'text/html')
    root = doc.body
  } else if (elementOrHtml instanceof HTMLElement) {
    root = elementOrHtml.cloneNode(true)
  } else {
    return ''
  }

  // Pre-process KaTeX elements: replace KaTeX HTML with raw LaTeX string
  const katexElements = root.querySelectorAll('.katex, .katex-display, math')
  katexElements.forEach((katex) => {
    const isDisplay = katex.classList.contains('katex-display') || katex.tagName.toLowerCase() === 'math'
    const annotation = katex.querySelector('annotation[encoding="application/x-tex"]')
    if (annotation && annotation.textContent) {
      const tex = annotation.textContent.trim()
      const replacement = document.createTextNode(isDisplay ? `\n\n$$${tex}$$\n\n` : `$${tex}$`)
      katex.parentNode?.replaceChild(replacement, katex)
    }
  })

  function walk(node) {
    if (!node) return ''

    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent || ''
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return ''
    }

    const tag = node.tagName.toLowerCase()

    // Handle code blocks
    if (tag === 'pre') {
      const codeElem = node.querySelector('code')
      const langClass = codeElem ? Array.from(codeElem.classList).find(c => c.startsWith('language-')) : ''
      const lang = langClass ? langClass.replace('language-', '') : ''
      const codeText = codeElem ? codeElem.textContent : node.textContent
      return `\n\n\`\`\`${lang}\n${(codeText || '').trim()}\n\`\`\`\n\n`
    }

    if (tag === 'code' && node.parentNode?.tagName.toLowerCase() !== 'pre') {
      return `\`${node.textContent || ''}\``
    }

    // Children recursion
    let inner = ''
    for (const child of node.childNodes) {
      inner += walk(child)
    }

    switch (tag) {
      case 'h1':
        return `\n\n# ${inner.trim()}\n\n`
      case 'h2':
        return `\n\n## ${inner.trim()}\n\n`
      case 'h3':
        return `\n\n### ${inner.trim()}\n\n`
      case 'h4':
        return `\n\n#### ${inner.trim()}\n\n`
      case 'p':
        return `\n\n${inner.trim()}\n\n`
      case 'strong':
      case 'b':
        return `**${inner.trim()}**`
      case 'em':
      case 'i':
        return `*${inner.trim()}*`
      case 'blockquote':
        return `\n\n> ${inner.trim().replace(/\n/g, '\n> ')}\n\n`
      case 'ul': {
        const items = Array.from(node.children)
          .filter(c => c.tagName.toLowerCase() === 'li')
          .map(li => `- ${walk(li).trim()}`)
          .join('\n')
        return `\n\n${items}\n\n`
      }
      case 'ol': {
        const items = Array.from(node.children)
          .filter(c => c.tagName.toLowerCase() === 'li')
          .map((li, idx) => `${idx + 1}. ${walk(li).trim()}`)
          .join('\n')
        return `\n\n${items}\n\n`
      }
      case 'li':
        return inner.trim()
      case 'hr':
        return '\n\n---\n\n'
      case 'br':
        return '\n'
      case 'table': {
        // Simple markdown table conversion
        const rows = Array.from(node.querySelectorAll('tr'))
        if (!rows.length) return inner
        const mdRows = rows.map((tr) => {
          const cells = Array.from(tr.querySelectorAll('th, td')).map(c => walk(c).replace(/\|/g, '\\|').trim())
          return `| ${cells.join(' | ')} |`
        })
        if (mdRows.length > 0) {
          const colCount = (mdRows[0].match(/\|/g) || []).length - 1
          const separator = `| ${Array(colCount).fill('---').join(' | ')} |`
          return `\n\n${mdRows[0]}\n${separator}\n${mdRows.slice(1).join('\n')}\n\n`
        }
        return inner
      }
      default:
        return inner
    }
  }

  const rawMd = walk(root)
  // Clean up excessive blank lines
  return rawMd
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Parses markdown to see if it represents a quiz (multiple choice / true false).
 * Returns { isQuiz, prompt, options, answer, explanation, type }
 */
function extractQuizFromMarkdown(markdown = '') {
  const text = String(markdown || '').trim()
  if (!text) return { isQuiz: false }

  const lines = text.split(/\r?\n/)
  let answerLineIndex = -1
  let answerKey = ''
  let explanation = ''
  let explanationIndex = -1

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim()
    // Match answer: 答案：B or 正确答案：AC or Answer: B
    const ansMatch = l.match(/(?:正确)?答案\s*[：:]\s*([A-Da-d对错TFtf√×]+)/i) || l.match(/^Answer\s*[：:]\s*([A-Da-d]+)/i)
    if (ansMatch && !answerKey) {
      answerKey = ansMatch[1].trim().toUpperCase()
      answerLineIndex = i
    }

    // Match explanation: 解析：... or Explanation: ...
    const expMatch = l.match(/(?:题目)?解析\s*[：:]\s*(.+)/i) || l.match(/^Explanation\s*[：:]\s*(.+)/i)
    if (expMatch && explanationIndex === -1) {
      explanationIndex = i
      explanation = expMatch[1].trim()
    }
  }

  // Gather explanation trailing lines
  if (explanationIndex !== -1) {
    const expLines = [explanation]
    for (let i = explanationIndex + 1; i < lines.length; i++) {
      if (lines[i].startsWith('#') || lines[i].startsWith('---')) break
      expLines.push(lines[i])
    }
    explanation = expLines.join('\n').trim()
  }

  // Find options A., B., C., D.
  const optionRegex = /^([A-D])[\.、\)\s]\s*(.+)$/i
  const options = []
  const promptLines = []

  const maxScanLine = answerLineIndex !== -1 ? answerLineIndex : (explanationIndex !== -1 ? explanationIndex : lines.length)

  for (let i = 0; i < maxScanLine; i++) {
    const line = lines[i].trim()
    const optMatch = line.match(optionRegex)
    if (optMatch) {
      const key = optMatch[1].toUpperCase()
      const optText = optMatch[2].trim()
      const isCorrect = answerKey.includes(key)
      options.push({ key, text: optText, correct: isCorrect })
    } else if (options.length === 0) {
      promptLines.push(lines[i])
    }
  }

  const prompt = promptLines.join('\n').replace(/^#+\s*/, '').trim()

  const isMultiple = answerKey.length > 1
  const isQuiz = options.length >= 2 && Boolean(prompt)

  return {
    isQuiz,
    type: isMultiple ? 'multiple' : 'single',
    prompt,
    options,
    answer: answerKey,
    explanation,
  }
}

// Export for extension content/popup script
if (typeof window !== 'undefined') {
  window.convertHtmlToMarkdown = convertHtmlToMarkdown
  window.extractQuizFromMarkdown = extractQuizFromMarkdown
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    convertHtmlToMarkdown,
    extractQuizFromMarkdown,
  }
}
