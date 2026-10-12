import { describe, expect, it, vi } from 'vitest'
import {
  splitDialogueTurns,
  extractQuizComponents,
  parseAiDialogue,
  buildQuizMarkdown,
  buildNoteMarkdown,
  needsAiRepair,
  aiParseDialogue,
} from './aiDialogueParser.js'
import { parseQuiz } from './parseQuiz.js'

describe('aiDialogueParser module', () => {
  describe('splitDialogueTurns', () => {
    it('splits standard User and ChatGPT markers', () => {
      const text = `用户:
请问快速排序的时间复杂度是多少？

ChatGPT:
快速排序的平均时间复杂度为 O(n log n)，最坏情况下为 O(n^2)。`

      const { userPrompt, aiResponse } = splitDialogueTurns(text)
      expect(userPrompt).toBe('请问快速排序的时间复杂度是多少？')
      expect(aiResponse).toContain('平均时间复杂度为 O(n log n)')
    })

    it('handles markdown formatted roles', () => {
      const text = `### Human:
为什么二叉搜索树中序遍历是有序的？

### Assistant:
因为二叉搜索树满足左子树 < 根 < 右子树。`

      const { userPrompt, aiResponse } = splitDialogueTurns(text)
      expect(userPrompt).toContain('为什么二叉搜索树')
      expect(aiResponse).toContain('左子树 < 根 < 右子树')
    })
  })

  describe('extractQuizComponents', () => {
    it('parses multiple choice questions with options and explanation', () => {
      const content = `下列关于二叉树遍历的叙述中，正确的是（ ）。
A. 前序遍历序列与后序遍历序列相同的二叉树只有根结点
B. 若已知前序和后序遍历序列，可以唯一确定一棵二叉树
C. 在二叉树中，前序遍历第一个结点一定是后序遍历的最后一个结点
D. 中序遍历中任意结点的后继必在该结点的右子树中

正确答案：C
解析：
前序遍历首节点为根，后序遍历尾节点为根，故二者一定相同。`

      const quiz = extractQuizComponents(content)
      expect(quiz.isQuiz).toBe(true)
      expect(quiz.type).toBe('single')
      expect(quiz.prompt).toContain('下列关于二叉树遍历的叙述中')
      expect(quiz.options).toHaveLength(4)
      expect(quiz.options.find(o => o.key === 'C')?.correct).toBe(true)
      expect(quiz.options.find(o => o.key === 'A')?.correct).toBe(false)
      expect(quiz.explanation).toContain('前序遍历首节点为根')
    })

    it('detects multiple choice questions with multiple correct options', () => {
      const content = `哪些协议属于传输层协议？
A. TCP
B. UDP
C. IP
D. HTTP
答案：AB
解析：TCP 和 UDP 属于传输层。`

      const quiz = extractQuizComponents(content)
      expect(quiz.isQuiz).toBe(true)
      expect(quiz.type).toBe('multiple')
      expect(quiz.options.find(o => o.key === 'A')?.correct).toBe(true)
      expect(quiz.options.find(o => o.key === 'B')?.correct).toBe(true)
      expect(quiz.options.find(o => o.key === 'C')?.correct).toBe(false)
    })

    it('detects true/false questions', () => {
      const content = `Python 中的列表是不可变对象。
答案：错误
解析：列表是可变序列。`

      const quiz = extractQuizComponents(content)
      expect(quiz.isQuiz).toBe(true)
      expect(quiz.type).toBe('tf')
      expect(quiz.options.find(o => o.text === '错误')?.correct).toBe(true)
      expect(quiz.options.find(o => o.text === '正确')?.correct).toBe(false)
    })
  })

  describe('buildQuizMarkdown and buildNoteMarkdown', () => {
    it('builds standard QuizForge quiz markdown format', () => {
      const parsed = parseAiDialogue(`什么是单例模式？
A. 创建一个实例
B. 创建多个实例
答案：A
解析：单例保证全局唯一。`)

      const md = buildQuizMarkdown(parsed, '设计模式测验')
      expect(md).toContain('# 设计模式测验')
      expect(md).toContain('- [x] 创建一个实例')
      expect(md).toContain('- [ ] 创建多个实例')
      expect(md).toContain('> Explanation: 单例保证全局唯一。')
    })

    it('builds note markdown with prompt and response', () => {
      const parsed = parseAiDialogue(`用户:
TCP 和 UDP 的区别？

ChatGPT:
TCP 面向连接，UDP 无连接。`)

      const md = buildNoteMarkdown(parsed, '网络基础')
      expect(md).toContain('# 网络基础')
      expect(md).toContain('## 问题背景 / 提问')
      expect(md).toContain('TCP 和 UDP 的区别？')
      expect(md).toContain('## AI 解答与核心笔记')
      expect(md).toContain('TCP 面向连接，UDP 无连接。')
    })
  })

  describe('needsAiRepair', () => {
    it('正则能解析出完整题目的样例返回 false', () => {
      const parsed = parseAiDialogue(`单选题：
牛顿第一定律又称？
A. 惯性定律
B. 加速度定律
答案：A`)
      expect(needsAiRepair(parsed, 'quiz')).toBe(false)
    })

    it('缺少答案或选项不全的样例返回 true', () => {
      const parsedNoAns = parseAiDialogue(`牛顿第一定律又称？
A. 惯性定律
B. 加速度定律`)
      expect(needsAiRepair(parsedNoAns, 'quiz')).toBe(true)

      const parsedNoOptions = parseAiDialogue(`这只是一段问答说明，没有任何选项。`)
      expect(needsAiRepair(parsedNoOptions, 'quiz')).toBe(true)
    })

    it('importType 不是 quiz 时返回 false', () => {
      const parsed = parseAiDialogue(`没有任何选项的一段纯文本笔记`)
      expect(needsAiRepair(parsed, 'document')).toBe(false)
    })
  })

  describe('aiParseDialogue', () => {
    it('返回带说明文字包裹的 JSON 时能正确解析', async () => {
      const mockAiOutput = `好的，为您提取出的测验题如下：
\`\`\`json
{
  "prompt": "哪个行星离太阳最近？",
  "type": "single",
  "options": [
    { "text": "水星", "correct": true },
    { "text": "金星", "correct": false }
  ],
  "explanation": "水星是距离太阳最近的行星。"
}
\`\`\`
请确认。`

      const mockComplete = vi.fn().mockResolvedValue(mockAiOutput)
      const parsed = await aiParseDialogue('原始对话文本', { complete: mockComplete })

      expect(parsed.isQuiz).toBe(true)
      expect(parsed.quiz.prompt).toBe('哪个行星离太阳最近？')
      expect(parsed.quiz.options).toHaveLength(2)
      expect(parsed.quiz.options[0]).toEqual({ key: 'A', text: '水星', correct: true })
      expect(parsed.quiz.options[1]).toEqual({ key: 'B', text: '金星', correct: false })
      expect(parsed.quiz.answer).toBe('A')
      expect(parsed.quiz.explanation).toBe('水星是距离太阳最近的行星。')
    })

    it('返回缺少正确选项的 JSON 时抛错', async () => {
      const mockAiOutput = JSON.stringify({
        prompt: '测试题干',
        type: 'single',
        options: [
          { text: 'A选项', correct: false },
          { text: 'B选项', correct: false },
        ],
      })
      const mockComplete = vi.fn().mockResolvedValue(mockAiOutput)

      await expect(aiParseDialogue('文本', { complete: mockComplete })).rejects.toThrow(
        'AI 没能提取出完整的题目'
      )
    })

    it('解析结果传给 buildQuizMarkdown 后能被 parseQuiz 正常解析', async () => {
      const mockAiOutput = JSON.stringify({
        prompt: '光合作用产生的主要气体是？',
        type: 'single',
        options: [
          { text: '氧气', correct: true },
          { text: '二氧化碳', correct: false },
        ],
        explanation: '植物在光照下释放氧气。',
      })
      const mockComplete = vi.fn().mockResolvedValue(mockAiOutput)

      const parsed = await aiParseDialogue('对话文本', { complete: mockComplete })
      const md = buildQuizMarkdown(parsed, '生物测验')
      const parsedQuiz = parseQuiz(md)

      expect(parsedQuiz.questions).toHaveLength(1)
      expect(parsedQuiz.questions[0].prompt).toBe('光合作用产生的主要气体是？')
      expect(parsedQuiz.questions[0].options[0].text).toBe('氧气')
      expect(parsedQuiz.questions[0].options[0].correct).toBe(true)
      expect(parsedQuiz.questions[0].options[1].correct).toBe(false)
      expect(parsedQuiz.questions[0].explain).toContain('植物在光照下释放氧气。')
    })
  })
})
