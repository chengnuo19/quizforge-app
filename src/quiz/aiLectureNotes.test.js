import { describe, it, expect, vi } from 'vitest'
import { splitTranscript, organizeLecture } from './aiLectureNotes.js'

describe('aiLectureNotes', () => {
  describe('splitTranscript', () => {
    it('空文本返回空数组', () => {
      expect(splitTranscript('')).toEqual([])
      expect(splitTranscript('   \n\n  ')).toEqual([])
    })

    it('多段合并且每块不超过 maxChars，拼回去后内容不丢失（去掉空白后和原文一致）', () => {
      const p1 = '第一段：人工智能的发展历程。深度学习的突破带来了大模型的爆发。'
      const p2 = '第二段：强化学习通过试错优化策略。AlphaGo 是其经典范例。'
      const p3 = '第三段：未来展望。通用人工智能还有很长的路要走。'
      const raw = `${p1}\n\n${p2}\n\n${p3}`

      // 设置较小的 maxChars 强制分块
      const maxChars = 50
      const chunks = splitTranscript(raw, maxChars)

      expect(chunks.length).toBeGreaterThan(1)
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(maxChars)
      }

      // 验证拼回去去掉空白后和原文一致
      const rawNoWs = raw.replace(/\s+/g, '')
      const chunksNoWs = chunks.join('').replace(/\s+/g, '')
      expect(chunksNoWs).toBe(rawNoWs)
    })

    it('单段超长时按句末标点或硬切，且各块不超过 maxChars，内容不丢失', () => {
      const sentence1 = '这是一句很长的话，解释了量子力学的基本假设。'
      const sentence2 = '波粒二象性是微观粒子的核心属性之一。'
      const sentence3 = '海森堡不确定性原理说明了动量与位置的测量极限。'
      const longPara = `${sentence1}${sentence2}${sentence3}`

      const maxChars = 25
      const chunks = splitTranscript(longPara, maxChars)

      expect(chunks.length).toBeGreaterThan(1)
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(maxChars)
      }

      const rawNoWs = longPara.replace(/\s+/g, '')
      const chunksNoWs = chunks.join('').replace(/\s+/g, '')
      expect(chunksNoWs).toBe(rawNoWs)
    })
  })

  describe('organizeLecture', () => {
    it('调用次数等于分块数，进度回调正确，最后合并返回', async () => {
      const p1 = '段落一：计算机系统结构基础。'
      const p2 = '段落二：存储器层次结构分析。'
      const raw = `${p1}\n\n${p2}`

      const mockComplete = vi
        .fn()
        .mockResolvedValueOnce('## 第一部分讲义\n- 要点1')
        .mockResolvedValueOnce('## 第二部分讲义\n- 要点2')

      const progressHistory = []
      const onProgress = (p) => progressHistory.push({ ...p })

      // 将 maxChars 设得较小以生成 2 块
      // 检查每块的长度，p1 为 14，p2 为 14，p1+2+p2 为 30
      // 设 maxChars = 20 可确保分为 2 块
      // 但 organizeLecture 默认调用 splitTranscript(markdown, 8000)，这里如果测试多块，造一个超过 8000 的文本或者多段
      const longP1 = 'A'.repeat(5000)
      const longP2 = 'B'.repeat(5000)
      const testMarkdown = `${longP1}\n\n${longP2}`

      const result = await organizeLecture(testMarkdown, {
        complete: mockComplete,
        onProgress,
      })

      expect(mockComplete).toHaveBeenCalledTimes(2)
      // 检查 system 提示词中的序号
      expect(mockComplete.mock.calls[0][0].system).toContain('这是第 1/2 段')
      expect(mockComplete.mock.calls[1][0].system).toContain('这是第 2/2 段')

      expect(result).toBe('## 第一部分讲义\n- 要点1\n\n## 第二部分讲义\n- 要点2')

      // 验证进度回调
      expect(progressHistory).toEqual([
        { done: 0, total: 2 },
        { done: 1, total: 2 },
        { done: 2, total: 2 },
      ])
    })

    it('shouldStop 返回 true 时停止后续调用并抛出“已取消”错误', async () => {
      const p1 = 'A'.repeat(5000)
      const p2 = 'B'.repeat(5000)
      const p3 = 'C'.repeat(5000)
      const testMarkdown = `${p1}\n\n${p2}\n\n${p3}`

      let stopFlag = false
      const mockComplete = vi.fn().mockImplementation(async () => {
        stopFlag = true // 第一块完成后立即将 stopFlag 设为 true
        return '部分讲义'
      })

      await expect(
        organizeLecture(testMarkdown, {
          complete: mockComplete,
          shouldStop: () => stopFlag,
        })
      ).rejects.toThrow('已取消')

      // 只有第一块被调用，第二块和第三块未被调用
      expect(mockComplete).toHaveBeenCalledTimes(1)
    })
  })
})
