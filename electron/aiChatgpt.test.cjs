import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
const path = require('path')
const os = require('os')
const fs = require('fs/promises')
const {
  createFileCredentialStore,
  loadDeviceId,
  buildContext,
  extractText,
  createChatgptClient,
} = require('./aiChatgpt.cjs')

const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from(`enc:${text}`),
  decryptString: (buf) => buf.toString().replace(/^enc:/, ''),
}

describe('aiChatgpt', () => {
  let dir

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-chatgpt-'))
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('stores credentials encrypted and serializes modify', async () => {
    const filePath = path.join(dir, 'auth.bin')
    const store = createFileCredentialStore({ filePath, safeStorage: fakeSafeStorage })
    expect(await store.read('openai')).toBeUndefined()

    await Promise.all([
      store.modify('openai', async () => ({ type: 'oauth', access: 'a1' })),
      store.modify('other', async () => ({ type: 'api_key', key: 'k' })),
    ])
    expect((await fs.readFile(filePath)).toString().startsWith('enc:')).toBe(true)
    expect(await store.read('openai')).toEqual({ type: 'oauth', access: 'a1' })
    expect(await store.list()).toEqual([
      { providerId: 'openai', type: 'oauth' },
      { providerId: 'other', type: 'api_key' },
    ])

    await store.modify('openai', async (current) => ({ ...current, access: 'a2' }))
    expect((await store.read('openai')).access).toBe('a2')
    await store.delete('openai')
    expect(await store.read('openai')).toBeUndefined()
  })

  it('keeps one device id per installation', async () => {
    const file = path.join(dir, 'device-id')
    const first = await loadDeviceId(file)
    expect(first).toMatch(/^[0-9a-f-]{36}$/)
    expect(await loadDeviceId(file)).toBe(first)
  })

  it('builds a pi-ai context with optional images', () => {
    expect(buildContext({ user: 'u' }).messages[0].content).toBe('u')
    const ctx = buildContext({ system: 's', user: 'u', images: [{ data: 'AAA', mimeType: 'image/png' }] })
    expect(ctx.systemPrompt).toBe('s')
    expect(ctx.messages[0].content).toEqual([
      { type: 'text', text: 'u' },
      { type: 'image', data: 'AAA', mimeType: 'image/png' },
    ])
  })

  it('extracts text and surfaces provider errors', () => {
    expect(extractText({ stopReason: 'stop', content: [{ type: 'thinking', thinking: 'x' }, { type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }))
      .toBe('ab')
    expect(() => extractText({ stopReason: 'error', errorMessage: '429', content: [] })).toThrow('ChatGPT 请求失败：429')
  })

  it('logs in by opening the browser and completes with the chosen model', async () => {
    const fakeModels = {
      setProvider: vi.fn(),
      login: vi.fn(async (_id, _type, interaction, options) => {
        interaction.notify({ type: 'auth_url', url: 'https://auth.openai.com/x' })
        return { type: 'oauth', deviceId: options.getDeviceId() }
      }),
      getModels: vi.fn(() => [
        { id: 'gpt-5.5', name: 'GPT-5.5', input: ['text', 'image'] },
        { id: 'gpt-4', name: 'GPT-4', input: ['text'] },
      ]),
      getModel: vi.fn((_p, id) => (id === 'gpt-5.5' ? { id } : undefined)),
      completeSimple: vi.fn(async () => ({ stopReason: 'stop', content: [{ type: 'text', text: 'OK' }] })),
    }
    const openExternal = vi.fn()
    const client = createChatgptClient({
      userDataDir: dir,
      safeStorage: fakeSafeStorage,
      openExternal,
      loadPiAi: async () => ({ createModels: () => fakeModels, openaiProvider: () => 'provider' }),
    })

    expect(await client.status()).toEqual({ loggedIn: false })
    expect(await client.login()).toEqual({ loggedIn: true })
    expect(openExternal).toHaveBeenCalledWith('https://auth.openai.com/x')
    expect(fakeModels.login.mock.calls[0].slice(0, 2)).toEqual(['openai', 'oauth'])

    expect(await client.listModels()).toEqual([{ id: 'gpt-5.5', name: 'GPT-5.5' }])
    expect(await client.complete({ user: 'hi', model: 'gpt-5.5', temperature: 0.3 })).toBe('OK')
    expect(fakeModels.completeSimple.mock.calls[0][2]).toBeUndefined()
    await expect(client.complete({ user: 'hi', model: 'nope' })).rejects.toThrow('未知的 ChatGPT 模型')
  })
})
