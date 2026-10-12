import { loadAiSettings } from './storage.js'

// apiKey：OpenAI 兼容接口（Web 与桌面都可用）；chatgpt / antigravity：订阅登录，仅桌面版。
export const AI_PROVIDERS = {
  apiKey: { label: 'API Key（OpenAI 兼容接口）', desktopOnly: false },
  chatgpt: { label: 'ChatGPT 订阅', desktopOnly: true, modelKey: 'chatgptModel', defaultModel: 'gpt-5.5' },
  antigravity: { label: 'Antigravity 订阅', desktopOnly: true, modelKey: 'antigravityModel', defaultModel: 'gemini-3.8-flash-high' },
}

function getBridge() {
  return typeof window !== 'undefined' ? window.aiBridge : undefined
}

export function getProvider(settings) {
  return AI_PROVIDERS[settings?.provider] ? settings.provider : 'apiKey'
}

export function isAiConfigured(settings = loadAiSettings(), bridge = getBridge()) {
  const provider = getProvider(settings)
  return provider === 'apiKey' ? !!settings.apiKey : !!bridge
}

// 支持 data URL 或裸 base64（按 jpeg 处理，与原先行为一致）。
function toImagePart(image) {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(image)
  return match ? { mimeType: match[1], data: match[2] } : { mimeType: 'image/jpeg', data: image }
}

// Electron 会给 IPC 错误加上 "Error invoking remote method ..." 前缀，去掉以便直接展示。
export function cleanIpcError(err) {
  const message = String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
  return new Error(message)
}

async function completeWithApiKey(settings, { system, user, images, temperature }, fetchImpl) {
  if (!settings.apiKey) {
    throw new Error('未配置 AI API Key，请先在右上角设置中配置。')
  }
  const baseUrl = (settings.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')
  const userContent = images.length
    ? [
        { type: 'text', text: user },
        ...images.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.data}` } })),
      ]
    : user
  const payload = {
    model: settings.model || 'gpt-4o',
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      { role: 'user', content: userContent },
    ],
  }
  if (temperature !== undefined) payload.temperature = temperature

  const response = await fetchImpl(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    let errText = ''
    try {
      const errJson = await response.json()
      errText = errJson.error?.message || JSON.stringify(errJson)
    } catch {
      errText = await response.text()
    }
    throw new Error(`AI 请求失败 (HTTP ${response.status}): ${errText}`)
  }

  const data = await response.json()
  return data.choices?.[0]?.message?.content || ''
}

/**
 * 统一的 AI 调用入口，按设置里的 provider 分发，返回模型回复的纯文本。
 * request: { system?, user, images?: (dataUrl|base64)[], temperature? }
 */
export async function chatCompletion(request, options = {}) {
  const settings = options.settings || loadAiSettings()
  const provider = getProvider(settings)
  const normalized = { ...request, images: (request.images || []).map(toImagePart) }

  if (provider === 'apiKey') {
    return completeWithApiKey(settings, normalized, options.fetchImpl || globalThis.fetch)
  }

  const bridge = options.bridge || getBridge()
  if (!bridge) {
    throw new Error(`${AI_PROVIDERS[provider].label}只能在桌面版使用，请在设置里改用 API Key。`)
  }
  const { modelKey, defaultModel } = AI_PROVIDERS[provider]
  try {
    return await bridge.complete(provider, {
      system: normalized.system,
      user: normalized.user,
      images: normalized.images,
      model: settings[modelKey] || defaultModel,
    })
  } catch (err) {
    throw cleanIpcError(err)
  }
}
