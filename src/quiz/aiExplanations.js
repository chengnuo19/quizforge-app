import { chatCompletion } from './aiClient.js'
import { fsWriteSettings } from './fsSync.js'

export const AI_EXPLANATIONS_KEY = 'quizforge:aiExplanations'

export function loadExplanations() {
  try {
    const raw = localStorage.getItem(AI_EXPLANATIONS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

export function saveExplanations(data) {
  try {
    localStorage.setItem(AI_EXPLANATIONS_KEY, JSON.stringify(data))
    fsWriteSettings(AI_EXPLANATIONS_KEY, data)
  } catch {}
}

/**
 * 对题干、各选项文本和 correct 状态做一个稳定的 djb2 哈希
 * @param {object} question
 * @returns {string}
 */
export function questionHash(question) {
  if (!question) return ''
  const prompt = question.prompt || ''
  const optionsStr = (question.options || [])
    .map((o) => `${o?.text ?? ''}|${o?.correct ?? false}`)
    .join(';')
  const raw = `${prompt}:::${optionsStr}`

  let hash = 5381
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) + hash) + raw.charCodeAt(i)
    hash = hash & hash
  }
  return (hash >>> 0).toString(16)
}

/**
 * 读取已缓存的讲解。若题目被修改（哈希不一致）或未缓存则返回 null。
 * @param {string} cardId
 * @param {object} question
 * @returns {string|null}
 */
export function getCachedExplanation(cardId, question) {
  if (!cardId || !question) return null
  const all = loadExplanations()
  const entry = all[cardId]
  if (!entry || !entry.text) return null
  const currentHash = questionHash(question)
  if (entry.hash !== currentHash) return null
  return entry.text
}

/**
 * 缓存讲解结果
 * @param {string} cardId
 * @param {object} question
 * @param {string} text
 */
export function saveExplanation(cardId, question, text) {
  if (!cardId) return
  const all = loadExplanations()
  all[cardId] = {
    hash: questionHash(question),
    text,
    createdAt: Date.now(),
  }
  saveExplanations(all)
}

function buildExplainUserPrompt(question) {
  const parts = []
  parts.push(question.prompt || '')

  const optionsText = (question.options || [])
    .map((o, idx) => {
      const label = o.label || String.fromCharCode(65 + idx)
      const correctTag = o.correct ? '（正确）' : ''
      return `${label}. ${o.text}${correctTag}`
    })
    .join('\n')
  if (optionsText) {
    parts.push(optionsText)
  }

  if (question.explain && question.explain.trim()) {
    parts.push(`已有解析：${question.explain.trim()}`)
  }

  return parts.join('\n\n')
}

/**
 * 请求或获取题目的 AI 讲解
 * @param {object} params
 * @param {string} params.cardId
 * @param {object} params.question
 * @param {string|string[]|null} [params.answer]
 * @param {object} [options]
 * @param {Function} [options.complete]
 * @returns {Promise<string>}
 */
export async function explainQuestion(
  { cardId, question, answer },
  { complete = chatCompletion } = {}
) {
  const cached = getCachedExplanation(cardId, question)
  if (cached) {
    return cached
  }

  const system =
    '你是耐心的学习辅导老师。用中文、Markdown，350 字以内讲解：①正确答案为什么对 ②逐个说明每个错误选项错在哪里（每项一两句）③一个帮助记忆的要点。可以使用 $...$ LaTeX。不要重复抄题目。'
  const user = buildExplainUserPrompt(question)

  const text = await complete({ system, user })
  saveExplanation(cardId, question, text)
  return text
}
