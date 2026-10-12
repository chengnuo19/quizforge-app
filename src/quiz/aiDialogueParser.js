/**
 * aiDialogueParser.js
 * Parses dialogues pasted from ChatGPT, Gemini, Claude, etc.,
 * and extracts questions, choices, answers, explanations, and notes.
 */
import { chatCompletion } from './aiClient.js'
import { parseAiJson } from './aiJson.js'

export function splitDialogueTurns(text = '') {
  const raw = String(text || '').trim()
  if (!raw) return { userPrompt: '', aiResponse: raw }

  // Check for common turn markers:
  // User: / ChatGPT: or 用户: / AI: or Q: / A:
  const turnRegex = /(?:^|\n)(?:#{1,3}\s*)?(?:(?:User|Human|You|用户|问|提问)\s*[：:]|\*{1,2}(?:User|Human|You|用户|问)\*{1,2}\s*[：:])\s*([\s\S]*?)(?=(?:^|\n)(?:#{1,3}\s*)?(?:(?:ChatGPT|Gemini|Claude|Assistant|AI|回答|答)\s*[：:]|\*{1,2}(?:ChatGPT|Gemini|Claude|Assistant|AI|回答)\*{1,2}\s*[：:])|$)/i

  const match = raw.match(turnRegex)
  if (match) {
    const userPrompt = match[1].trim()
    const afterUser = raw.slice(match.index + match[0].length)
    const aiMatch = afterUser.match(/^(?:#{1,3}\s*)?(?:(?:ChatGPT|Gemini|Claude|Assistant|AI|回答|答)\s*[：:]|\*{1,2}(?:ChatGPT|Gemini|Claude|Assistant|AI|回答)\*{1,2}\s*[：:])\s*([\s\S]*)$/i)
    const aiResponse = aiMatch ? aiMatch[1].trim() : afterUser.trim()
    return { userPrompt, aiResponse: aiResponse || raw }
  }

  return { userPrompt: '', aiResponse: raw }
}

export function extractQuizComponents(text = '') {
  const content = String(text || '').trim()
  if (!content) {
    return { isQuiz: false, prompt: '', options: [], answer: '', explanation: '', type: 'single' }
  }

  const lines = content.split(/\r?\n/)
  let answerLineIndex = -1
  let answerKey = ''
  let explanationIndex = -1
  let explanation = ''

  // Look for answer and explanation
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim()

    // Answer matching
    const ansMatch = l.match(/(?:【?正确答案】?|【?参考答案】?|【?答案】?|Answer)\s*[：:]\s*([A-Da-d对错TFtf√×正确错误]+)/i)
    if (ansMatch && !answerKey) {
      answerKey = ansMatch[1].trim().toUpperCase()
      answerLineIndex = i
    }

    // Explanation matching
    const expMatch = l.match(/(?:【?题目解析】?|【?解析】?|Explanation)\s*[：:]\s*(.*)/i)
    if (expMatch && explanationIndex === -1) {
      explanationIndex = i
      explanation = expMatch[1].trim()
    }
  }

  if (explanationIndex !== -1) {
    const expLines = explanation ? [explanation] : []
    for (let i = explanationIndex + 1; i < lines.length; i++) {
      if (lines[i].startsWith('#') || lines[i].startsWith('---')) break
      if (lines[i].trim()) expLines.push(lines[i].trim())
    }
    explanation = expLines.join('\n').trim()
  }

  // Detect true/false questions
  const isTfAnswer = ['对', '错', '正确', '错误', 'T', 'F', 'TRUE', 'FALSE', '√', '×'].includes(answerKey)

  // Options matching A., B., C., D.
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
      // Filter out conversational greetings or question type headers
      if (i === 0 && /(好的|这是一道|请看下面的题目|如下所示|^(单选题|多选题|判断题|选择题)[：:\s]*$)/.test(line) && line.length < 30) {
        continue
      }
      promptLines.push(lines[i])
    }
  }

  let prompt = promptLines.join('\n').replace(/^#+\s*/, '').trim()

  if (isTfAnswer) {
    const isTrue = ['对', '正确', 'T', 'TRUE', '√'].includes(answerKey)
    return {
      isQuiz: true,
      type: 'tf',
      prompt: prompt || content.slice(0, 100),
      options: [
        { key: 'A', text: '正确', correct: isTrue },
        { key: 'B', text: '错误', correct: !isTrue },
      ],
      answer: isTrue ? 'A' : 'B',
      explanation,
    }
  }

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

export function parseAiDialogue(text = '', titleHint = '') {
  const { userPrompt, aiResponse } = splitDialogueTurns(text)
  const effectiveContent = aiResponse || text
  const quizInfo = extractQuizComponents(effectiveContent)

  const defaultTitle = (titleHint || userPrompt || effectiveContent.split('\n')[0] || 'AI 学习笔记')
    .replace(/[#*`_]/g, '')
    .trim()
    .slice(0, 40)

  return {
    userPrompt,
    aiResponse: effectiveContent,
    title: defaultTitle,
    isQuiz: quizInfo.isQuiz,
    quiz: quizInfo,
  }
}

export function buildQuizMarkdown(parsedData, quizTitle) {
  let title = quizTitle || parsedData.title || 'AI 错题集'
  const q = parsedData.quiz

  if (!q || !q.isQuiz) {
    const safeTitle = title === parsedData.title ? `${title} 测验` : title
    return `# ${safeTitle}\n\n## ${parsedData.title}\n\n- [ ] 选项 A\n- [x] 选项 B\n\n> Explanation: ${parsedData.aiResponse}\n`
  }

  // Avoid title collision with question heading in parseQuiz
  const firstPromptLine = q.prompt.split('\n')[0].trim()
  if (title.trim() === firstPromptLine) {
    title = `${title} 测验`
  }

  const optLines = q.options.map((opt) => {
    const prefix = opt.correct ? '- [x] ' : '- [ ] '
    return `${prefix}${opt.text}`
  }).join('\n')

  const explanationBlock = q.explanation ? `\n\n> Explanation: ${q.explanation}` : ''

  return `# ${title}\n\n## ${q.prompt}\n\n${optLines}${explanationBlock}\n`
}

export function buildNoteMarkdown(parsedData, noteTitle) {
  const title = noteTitle || parsedData.title || 'AI 问答笔记'
  const sections = [`# ${title}`, '']

  if (parsedData.userPrompt) {
    sections.push('## 问题背景 / 提问', parsedData.userPrompt, '', '---', '')
  }

  sections.push('## AI 解答与核心笔记', parsedData.aiResponse)
  return sections.join('\n')
}

/**
 * 判断解析结果是否需要 AI 兜底修复
 * 只有在用户想导入成测验（importType === 'quiz'），并且满足以下任一条件时才返回 true：
 * 1. parsed.quiz.isQuiz 为 false；
 * 2. 选项少于 2 个；
 * 3. 没有任何选项的 correct 为 true。
 */
export function needsAiRepair(parsed, importType) {
  if (importType !== 'quiz') return false
  const quiz = parsed?.quiz
  if (!quiz || !quiz.isQuiz) return true
  const options = quiz.options || []
  if (options.length < 2) return true
  const hasCorrect = options.some((opt) => Boolean(opt.correct))
  if (!hasCorrect) return true
  return false
}

const OPTION_KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/**
 * 使用 AI 重新从对话文本中解析测验题
 */
export async function aiParseDialogue(text, { complete = chatCompletion } = {}) {
  const system =
    '从用户粘贴的 AI 对话中提取一道测验题。只输出 JSON，不要任何解释：{"prompt":"题干","type":"single|multiple|tf","options":[{"text":"选项文本","correct":true}],"explanation":"解析，可为空"}。判断题输出两个选项「正确」「错误」。必须至少一个 correct 为 true。'

  const rawResult = await complete({ system, user: String(text || '') })
  const json = parseAiJson(rawResult)

  const prompt = typeof json?.prompt === 'string' ? json.prompt.trim() : ''
  const rawOptions = Array.isArray(json?.options) ? json.options : []
  const hasCorrect = rawOptions.some((o) => Boolean(o?.correct))

  if (!prompt || rawOptions.length < 2 || !hasCorrect) {
    throw new Error('AI 没能提取出完整的题目')
  }

  const options = rawOptions.map((opt, idx) => ({
    key: OPTION_KEYS[idx] || String.fromCharCode(65 + idx),
    text: String(opt.text || '').trim(),
    correct: Boolean(opt.correct),
  }))

  const correctKeys = options.filter((o) => o.correct).map((o) => o.key)
  const answer = correctKeys.join('')
  const type = json.type || (correctKeys.length > 1 ? 'multiple' : 'single')
  const explanation = json.explanation ? String(json.explanation).trim() : ''

  const { userPrompt, aiResponse } = splitDialogueTurns(text)
  const defaultTitle = (userPrompt || prompt.split('\n')[0] || 'AI 测验题')
    .replace(/[#*`_]/g, '')
    .trim()
    .slice(0, 40)

  const quiz = {
    isQuiz: true,
    type,
    prompt,
    options,
    answer,
    explanation,
  }

  return {
    userPrompt,
    aiResponse: aiResponse || text,
    title: defaultTitle,
    isQuiz: true,
    quiz,
  }
}
