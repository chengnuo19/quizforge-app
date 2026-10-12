// ChatGPT 订阅接入：用 pi-ai 的 "Sign in with ChatGPT" OAuth 登录，令牌加密存在 userData。
const path = require('path')
const fs = require('fs/promises')
const { randomUUID } = require('crypto')

const PROVIDER_ID = 'openai'
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000

// 一个 JSON 文件存所有凭据；有 safeStorage 时整体加密。写入串行化，满足 pi-ai 对 modify 的要求。
function createFileCredentialStore({ filePath, safeStorage, fsImpl = fs }) {
  let queue = Promise.resolve()
  const canEncrypt = () => !!safeStorage && safeStorage.isEncryptionAvailable()

  async function readAll() {
    let raw
    try {
      raw = await fsImpl.readFile(filePath)
    } catch (err) {
      if (err.code === 'ENOENT') return {}
      throw err
    }
    const text = canEncrypt() ? safeStorage.decryptString(raw) : raw.toString('utf8')
    return JSON.parse(text)
  }

  async function writeAll(data) {
    const text = JSON.stringify(data)
    await fsImpl.mkdir(path.dirname(filePath), { recursive: true })
    await fsImpl.writeFile(filePath, canEncrypt() ? safeStorage.encryptString(text) : text)
  }

  function serial(fn) {
    const run = queue.then(fn, fn)
    queue = run.catch(() => {})
    return run
  }

  return {
    async read(providerId) {
      const all = await readAll()
      return all[providerId]
    },
    async list() {
      const all = await readAll()
      return Object.entries(all).map(([providerId, c]) => ({ providerId, type: c.type }))
    },
    modify(providerId, fn) {
      return serial(async () => {
        const all = await readAll()
        const next = await fn(all[providerId])
        if (next === undefined) delete all[providerId]
        else all[providerId] = next
        await writeAll(all)
        return next
      })
    },
    delete(providerId) {
      return serial(async () => {
        const all = await readAll()
        delete all[providerId]
        await writeAll(all)
      })
    },
  }
}

// OpenAI 要求同一安装始终用同一个设备 ID。
async function loadDeviceId(filePath, fsImpl = fs) {
  try {
    const id = (await fsImpl.readFile(filePath, 'utf8')).trim()
    if (id) return id
  } catch {}
  const id = randomUUID()
  await fsImpl.mkdir(path.dirname(filePath), { recursive: true })
  await fsImpl.writeFile(filePath, id)
  return id
}

// 把渲染端的 { system, user, images:[{data,mimeType}] } 转成 pi-ai 的 Context。
function buildContext({ system, user, images = [] }) {
  const content = images.length
    ? [{ type: 'text', text: user }, ...images.map((img) => ({ type: 'image', data: img.data, mimeType: img.mimeType }))]
    : user
  return {
    systemPrompt: system || undefined,
    messages: [{ role: 'user', content, timestamp: Date.now() }],
  }
}

function extractText(message) {
  if (message.stopReason === 'error' || message.stopReason === 'aborted') {
    throw new Error(`ChatGPT 请求失败：${message.errorMessage || message.stopReason}`)
  }
  return message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('')
}

function createChatgptClient({ userDataDir, safeStorage, openExternal, loadPiAi }) {
  const store = createFileCredentialStore({ filePath: path.join(userDataDir, 'ai-auth.bin'), safeStorage })
  const deviceIdFile = path.join(userDataDir, 'ai-device-id')
  let modelsPromise = null
  let pendingLogin = null

  function getModels() {
    if (!modelsPromise) {
      modelsPromise = (loadPiAi || defaultLoadPiAi)().then(({ createModels, openaiProvider }) => {
        const models = createModels({ credentials: store })
        models.setProvider(openaiProvider())
        return models
      })
      modelsPromise.catch(() => { modelsPromise = null })
    }
    return modelsPromise
  }

  return {
    async status() {
      const credential = await store.read(PROVIDER_ID)
      return { loggedIn: credential?.type === 'oauth' }
    },

    async login() {
      if (pendingLogin) throw new Error('已有一个 ChatGPT 登录正在进行，请先在浏览器里完成')
      const models = await getModels()
      const deviceId = await loadDeviceId(deviceIdFile)
      pendingLogin = models.login(PROVIDER_ID, 'oauth', {
        signal: AbortSignal.timeout(LOGIN_TIMEOUT_MS),
        // 只走本地回调；手动粘贴回调地址的分支保持挂起，登录结束时由 pi-ai 中止。
        prompt: () => new Promise(() => {}),
        notify: (event) => {
          if (event.type === 'auth_url') openExternal(event.url)
        },
      }, { getDeviceId: () => deviceId })
      try {
        await pendingLogin
        return { loggedIn: true }
      } finally {
        pendingLogin = null
      }
    },

    async logout() {
      await store.delete(PROVIDER_ID)
      return { loggedIn: false }
    },

    async listModels() {
      const models = await getModels()
      return models.getModels(PROVIDER_ID)
        .filter((m) => m.input.includes('image'))
        .map((m) => ({ id: m.id, name: m.name }))
    },

    async complete(request) {
      const models = await getModels()
      const model = models.getModel(PROVIDER_ID, request.model)
      if (!model) throw new Error(`未知的 ChatGPT 模型：${request.model}`)
      // 不传 temperature：订阅里的 GPT-5 系列推理模型不接受这个参数。
      const message = await models.completeSimple(model, buildContext(request))
      return extractText(message)
    },
  }
}

async function defaultLoadPiAi() {
  const { createModels } = await import('@earendil-works/pi-ai')
  const { openaiProvider } = await import('@earendil-works/pi-ai/providers/openai')
  return { createModels, openaiProvider }
}

module.exports = { createFileCredentialStore, loadDeviceId, buildContext, extractText, createChatgptClient }
