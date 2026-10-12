import { chatCompletion } from './aiClient.js'

/**
 * 将超长单段按换行或句末标点切分为不超过 maxChars 的小段
 * @param {string} text
 * @param {number} maxChars
 * @returns {string[]}
 */
function splitOverlongParagraph(text, maxChars) {
  if (text.length <= maxChars) return [text]

  const pieces = []
  // 匹配句子（包含末尾标点或换行）
  const sentenceRegex = /([^。！？.!?\n]+[。！？.!?\n]*)/g
  let match
  let current = ''

  while ((match = sentenceRegex.exec(text)) !== null) {
    const part = match[0]
    if (part.length > maxChars) {
      if (current) {
        pieces.push(current)
        current = ''
      }
      for (let i = 0; i < part.length; i += maxChars) {
        pieces.push(part.slice(i, i + maxChars))
      }
    } else if (current.length + part.length <= maxChars) {
      current += part
    } else {
      if (current) pieces.push(current)
      current = part
    }
  }

  if (current) pieces.push(current)

  if (pieces.length === 0 && text.length > 0) {
    for (let i = 0; i < text.length; i += maxChars) {
      pieces.push(text.slice(i, i + maxChars))
    }
  }

  return pieces
}

/**
 * 将字幕逐字稿分块：
 * 按空行分段，再把相邻段落合并成多块，每块不超过 maxChars。
 * 单个段落本身就超长时，按句号或换行硬切。
 * @param {string} markdown
 * @param {number} [maxChars=8000]
 * @returns {string[]}
 */
export function splitTranscript(markdown, maxChars = 8000) {
  const raw = String(markdown || '').trim()
  if (!raw) return []

  // 按连续空行切分段落
  const rawParagraphs = raw.split(/\r?\n\r?\n/)
  const normalizedParts = []

  for (const p of rawParagraphs) {
    const trimmed = p.trim()
    if (!trimmed) continue
    if (trimmed.length > maxChars) {
      const slices = splitOverlongParagraph(trimmed, maxChars)
      normalizedParts.push(...slices)
    } else {
      normalizedParts.push(trimmed)
    }
  }

  const chunks = []
  let currentChunk = ''

  for (const part of normalizedParts) {
    if (!currentChunk) {
      currentChunk = part
    } else {
      const candidate = currentChunk + '\n\n' + part
      if (candidate.length <= maxChars) {
        currentChunk = candidate
      } else {
        chunks.push(currentChunk)
        currentChunk = part
      }
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk)
  }

  return chunks
}

/**
 * 将讲座文稿逐块调用 AI 整理成结构化讲义
 * @param {string} markdown
 * @param {object} [options]
 * @param {Function} [options.complete=chatCompletion]
 * @param {Function} [options.onProgress] ({ done, total }) => void
 * @param {Function} [options.shouldStop] () => boolean
 * @returns {Promise<string>}
 */
export async function organizeLecture(
  markdown,
  { complete = chatCompletion, onProgress, shouldStop } = {}
) {
  const chunks = splitTranscript(markdown)
  if (chunks.length === 0) return ''

  const total = chunks.length
  const results = []

  for (let i = 0; i < total; i++) {
    if (shouldStop?.()) {
      throw new Error('已取消')
    }

    onProgress?.({ done: i, total })

    const system = `把讲座逐字稿片段整理成学习讲义：用 ## / ### 小标题分节，提炼要点列表，删除口语词和重复，保留所有专业术语、数字、公式和例子，不要编造原文没有的内容。只输出 Markdown。这是第 ${i + 1}/${total} 段，不要写开场白或总结。`
    const user = chunks[i]

    const chunkResult = await complete({ system, user })

    if (shouldStop?.()) {
      throw new Error('已取消')
    }

    results.push(chunkResult)
  }

  onProgress?.({ done: total, total })
  return results.join('\n\n')
}
