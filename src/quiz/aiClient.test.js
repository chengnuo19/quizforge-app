import { describe, expect, it, vi } from 'vitest'
import { chatCompletion, cleanIpcError, getProvider, isAiConfigured } from './aiClient.js'

function okFetch(content = 'reply') {
  return vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) })
}

describe('aiClient', () => {
  it('defaults unknown providers to apiKey', () => {
    expect(getProvider({})).toBe('apiKey')
    expect(getProvider({ provider: 'nope' })).toBe('apiKey')
    expect(getProvider({ provider: 'chatgpt' })).toBe('chatgpt')
  })

  it('treats apiKey as configured only with a key, subscriptions only with the desktop bridge', () => {
    expect(isAiConfigured({ apiKey: '' }, undefined)).toBe(false)
    expect(isAiConfigured({ apiKey: 'k' }, undefined)).toBe(true)
    expect(isAiConfigured({ provider: 'chatgpt' }, undefined)).toBe(false)
    expect(isAiConfigured({ provider: 'antigravity' }, {})).toBe(true)
  })

  it('sends system, text and images to an OpenAI-compatible endpoint', async () => {
    const fetchImpl = okFetch('done')
    const reply = await chatCompletion(
      { system: 'sys', user: 'hi', images: ['data:image/png;base64,AAA', 'BBB'], temperature: 0.3 },
      { settings: { baseUrl: 'https://x.test/v1/', apiKey: 'k', model: 'm' }, fetchImpl },
    )
    expect(reply).toBe('done')
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://x.test/v1/chat/completions')
    expect(init.headers.Authorization).toBe('Bearer k')
    const body = JSON.parse(init.body)
    expect(body.model).toBe('m')
    expect(body.temperature).toBe(0.3)
    expect(body.messages[0]).toEqual({ role: 'system', content: 'sys' })
    expect(body.messages[1].content).toEqual([
      { type: 'text', text: 'hi' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,BBB' } },
    ])
  })

  it('keeps the old missing-key and HTTP error messages', async () => {
    await expect(chatCompletion({ user: 'hi' }, { settings: { apiKey: '' }, fetchImpl: okFetch() }))
      .rejects.toThrow('未配置 AI API Key')
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: { message: 'bad key' } }) })
    await expect(chatCompletion({ user: 'hi' }, { settings: { apiKey: 'k' }, fetchImpl }))
      .rejects.toThrow('AI 请求失败 (HTTP 401): bad key')
  })

  it('routes subscriptions through the desktop bridge with the chosen model', async () => {
    const bridge = { complete: vi.fn().mockResolvedValue('ok') }
    const reply = await chatCompletion(
      { system: 's', user: 'u', images: ['data:image/webp;base64,CCC'], temperature: 0.3 },
      { settings: { provider: 'antigravity', antigravityModel: 'gemini-x' }, bridge },
    )
    expect(reply).toBe('ok')
    expect(bridge.complete).toHaveBeenCalledWith('antigravity', {
      system: 's',
      user: 'u',
      images: [{ mimeType: 'image/webp', data: 'CCC' }],
      model: 'gemini-x',
    })
  })

  it('falls back to the default subscription model and strips IPC error prefixes', async () => {
    const bridge = { complete: vi.fn().mockRejectedValue(new Error("Error invoking remote method 'ai:complete': Error: 额度用完")) }
    await expect(chatCompletion({ user: 'u' }, { settings: { provider: 'chatgpt' }, bridge })).rejects.toThrow(/^额度用完$/)
    expect(bridge.complete.mock.calls[0][1].model).toBe('gpt-5.5')
    expect(cleanIpcError(new Error('plain')).message).toBe('plain')
  })

  it('explains that subscriptions need the desktop app', async () => {
    await expect(chatCompletion({ user: 'u' }, { settings: { provider: 'chatgpt' }, bridge: null }))
      .rejects.toThrow('只能在桌面版使用')
  })
})
