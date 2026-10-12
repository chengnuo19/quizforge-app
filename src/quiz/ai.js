import { chatCompletion } from './aiClient.js'

const DEFAULT_PROMPT = `你是一个出色的测验题目转换助手。
请从用户提供的图片或 PDF 页面中提取所有的题目（包括选择题、判断题等）。
将提取出的题目按照严格的 Markdown 格式输出。
格式规范如下：
1. 整个文件可以有一个 \`title: 测验名称\` 的 YAML frontmatter（可选）。如果不知道测验名称，可以根据题目内容起一个。
2. 每道题目的题干使用 \`##\` 标题或粗体。建议用 \`## 第X题：...\`。
3. 选项使用列表标记，并且用 \`[ ]\` 表示错误选项，\`[x]\` 表示正确选项。如果是判断题，提供对/错两个选项。如果没有标明标准答案，请根据你的知识给出正确答案。
4. 请勿输出除测验 Markdown 内容之外的任何解释说明，仅输出最终的 Markdown 文本即可。如果使用了 \`\`\`markdown 标记包裹，请去掉它们，直接输出纯文本。

示例格式：
---
title: 生物测验
---

## 1. 以下哪个是光合作用的产物？
- [ ] 二氧化碳
- [x] 氧气
- [ ] 氮气
- [ ] 氢气
`

export async function convertImagesToMarkdown(base64Images, onProgress) {
  if (onProgress) onProgress('正在调用 AI 接口进行识别，由于图片处理较慢，请耐心等待...')

  let result = await chatCompletion({ user: DEFAULT_PROMPT, images: base64Images })

  // 移除可能存在的 markdown 代码块包裹
  result = result.replace(/^```markdown\s*/i, '').replace(/```\s*$/, '')

  return result.trim()
}
const MARKDOWN_CLEANUP_PROMPT = `你是 QuizForge 题目整理助手。用户会提供由文档转换得到的 Markdown 笔记。
请把其中适合做测验的内容整理成 QuizForge 兼容的 Markdown。

要求：
1. 只输出最终 Markdown，不要输出解释。
2. 可以包含 YAML frontmatter，例如 title。
3. 每道题用 ## 开头。
4. 选项使用 - [ ] 和 - [x]，至少一个正确答案。
5. 判断题也要输出两个选项。
6. 不确定答案时，根据上下文谨慎推断；无法形成题目的内容不要硬编。`

export async function convertMarkdownToQuizMarkdown(markdown, onProgress) {
  const source = String(markdown || '').trim()
  if (!source) {
    throw new Error('没有可整理的 Markdown 内容')
  }

  if (onProgress) onProgress('正在整理 Markdown 为测验格式...')

  let result = await chatCompletion({ system: MARKDOWN_CLEANUP_PROMPT, user: source })
  result = result.replace(/^```markdown\s*/i, '').replace(/```\s*$/, '')

  return result.trim()
}
