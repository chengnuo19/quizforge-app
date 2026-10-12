import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { convertMarkdownToQuizMarkdown } from './ai.js'

const originalFetch = globalThis.fetch
const originalLocalStorage = globalThis.localStorage

function installLocalStorage(settings) {
  globalThis.localStorage = {
    getItem: vi.fn((key) => key === 'quizforge:aiSettings' ? JSON.stringify(settings) : null),
    setItem: vi.fn(),
  }
}

beforeEach(() => {
  installLocalStorage({
    apiKey: 'test-key',
    baseUrl: 'https://api.example.com/v1',
    model: 'gpt-test',
  })
})

afterEach(() => {
  globalThis.fetch = originalFetch
  globalThis.localStorage = originalLocalStorage
})

describe('convertMarkdownToQuizMarkdown', () => {
  it('sends converted Markdown to the chat completions endpoint', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '```markdown\n## Q\n- [x] A\n- [ ] B\n```' } }],
      }),
    })

    const result = await convertMarkdownToQuizMarkdown('# Notes')

    expect(result).toBe('## Q\n- [x] A\n- [ ] B')
    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
        }),
      })
    )
  })

  it('requires configured AI settings', async () => {
    installLocalStorage({ apiKey: '' })

    await expect(convertMarkdownToQuizMarkdown('# Notes')).rejects.toThrow(
      '未配置 AI API Key'
    )
  })

  it('rejects empty Markdown input', async () => {
    await expect(convertMarkdownToQuizMarkdown('   ')).rejects.toThrow(
      '没有可整理的 Markdown 内容'
    )
  })
})


