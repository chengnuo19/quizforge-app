/**
 * 解析 AI 返回的 JSON：去掉 ```json 包裹，截取第一个 { 到最后一个 } 之间的内容，再 JSON.parse。
 * 失败时抛出 Error('AI 返回的不是有效 JSON')。
 *
 * @param {string} text
 * @returns {any}
 */
export function parseAiJson(text) {
  if (typeof text !== 'string') {
    throw new Error('AI 返回的不是有效 JSON');
  }
  let cleaned = text.trim();
  // 去除 markdown 代码块包裹标记
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('AI 返回的不是有效 JSON');
  }

  const jsonSlice = cleaned.slice(start, end + 1);
  try {
    return JSON.parse(jsonSlice);
  } catch {
    throw new Error('AI 返回的不是有效 JSON');
  }
}
