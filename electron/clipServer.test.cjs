import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const {
  createClipServer,
  setCachedNotebooks,
  getCachedNotebooks,
} = require('./clipServer.cjs')

describe('clipServer module', () => {
  let server
  let port
  let onClipMock

  beforeEach(async () => {
    onClipMock = vi.fn().mockResolvedValue({
      success: true,
      notebookName: '测试笔记本',
    })

    server = createClipServer({
      onClip: onClipMock,
      getVaultPath: () => 'C:\\test-fixtures\\QuizForge\\Vault',
    })

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        port = server.address().port
        resolve()
      })
    })
  })

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve))
  })

  it('responds with CORS headers on OPTIONS', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/status`, {
      method: 'OPTIONS',
    })

    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-allow-methods')).toContain('POST')
  })

  it('returns status info on GET /api/status', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/status`)
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.online).toBe(true)
    expect(data.vaultPath).toBe('C:\\test-fixtures\\QuizForge\\Vault')
  })

  it('manages and returns cached notebooks on GET /api/notebooks', async () => {
    setCachedNotebooks([
      { id: 'b1', name: '数据结构与算法', icon: '🌲', color: 'emerald' },
      { id: 'b2', name: '考研政治', icon: '📕', color: 'rose' },
    ])

    expect(getCachedNotebooks()).toHaveLength(2)

    const res = await fetch(`http://127.0.0.1:${port}/api/notebooks`)
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.notebooks).toHaveLength(2)
    expect(data.notebooks[0].name).toBe('数据结构与算法')
  })

  it('accepts valid clip payload on POST /api/clip', async () => {
    const payload = {
      type: 'document',
      title: '二叉树遍历原理',
      contentMarkdown: '# 二叉树遍历\n\n前序遍历是根左右。',
      sourceUrl: 'https://chatgpt.com/c/12345',
      provider: 'ChatGPT',
    }

    const res = await fetch(`http://127.0.0.1:${port}/api/clip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(onClipMock).toHaveBeenCalledWith(expect.objectContaining({
      title: '二叉树遍历原理',
      provider: 'ChatGPT',
    }))
  })

  it('rejects empty payload on POST /api/clip with 400', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/clip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '空笔记' }),
    })

    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.success).toBe(false)
  })
})
