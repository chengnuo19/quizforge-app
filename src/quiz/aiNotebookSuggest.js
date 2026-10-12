import { chatCompletion } from './aiClient.js'
import { parseAiJson } from './aiJson.js'

/**
 * 根据内容与已有笔记本列表，由 AI 推荐归属笔记本或建议新建笔记本名
 * @param {object} params
 * @param {string} [params.title]
 * @param {string} [params.content]
 * @param {Array<{id: string, name: string, description?: string, builtin?: boolean}>} [params.books]
 * @param {object} [options]
 * @param {Function} [options.complete]
 * @returns {Promise<{ bookId: string|null, newNotebookName: string|null, reason: string }>}
 */
export async function suggestNotebook(
  { title = '', content = '', books = [] },
  { complete = chatCompletion } = {}
) {
  // 只保留用户自建笔记本（过滤掉 builtin: true）
  const userBooks = (books || [])
    .filter((b) => !b.builtin)
    .map((b) => ({
      id: b.id,
      name: b.name,
      ...(b.description ? { description: b.description } : {}),
    }))

  const truncatedContent = String(content || '').slice(0, 3000)

  const system =
    '根据学习内容，从给定笔记本列表中选择最合适的一个；都不合适时建议一个新笔记本名（≤12 字）。只输出 JSON：{"bookId":"列表中的 id 或 null","newNotebookName":"bookId 为 null 时填写","reason":"一句话理由"}'

  const user = `已有笔记本列表：
${JSON.stringify(userBooks, null, 2)}

标题：${title || '无标题'}
内容：
${truncatedContent}`

  const responseText = await complete({ system, user })
  const json = parseAiJson(responseText)

  let bookId = json?.bookId ?? null
  let newNotebookName = json?.newNotebookName ? String(json.newNotebookName).trim() : null
  const reason = json?.reason ? String(json.reason).trim() : 'AI 推荐'

  // 校验 bookId 是否真实存在于列表中
  const matchedBook = userBooks.find((b) => b.id === bookId)
  if (!matchedBook) {
    bookId = null
  }

  // bookId 为 null 时，newNotebookName 不能为空，否则抛错
  if (bookId === null) {
    if (!newNotebookName) {
      throw new Error('AI 未能推荐有效的目标笔记本')
    }
  } else {
    newNotebookName = null
  }

  return {
    bookId,
    newNotebookName,
    reason,
  }
}
