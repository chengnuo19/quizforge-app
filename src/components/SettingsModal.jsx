import { useEffect, useState } from 'react'
import { loadAiSettings, saveAiSettings } from '../quiz/storage.js'
import { AI_PROVIDERS, chatCompletion, cleanIpcError, getProvider } from '../quiz/aiClient.js'

const labelStyle = {
  display: 'block',
  fontSize: '13px',
  fontWeight: '600',
  color: 'var(--ink)',
  marginBottom: '6px',
}

const inputStyle = {
  width: '100%',
  padding: '9px 12px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--hairline)',
  background: 'var(--canvas)',
  color: 'var(--ink)',
  fontSize: '13px',
  boxSizing: 'border-box',
}

const hintStyle = { color: 'var(--muted)', fontSize: '12px', margin: '6px 0 0 0', lineHeight: 1.4 }
const errorStyle = { color: 'var(--danger, #d93025)', fontSize: '12px', margin: '6px 0 0 0', lineHeight: 1.4 }

const SUBSCRIPTION_HINTS = {
  chatgpt: '会打开浏览器，用你的 ChatGPT Plus/Pro 账号授权；令牌加密保存在本机。',
  antigravity: '使用本机已登录的 Antigravity CLI（agy）账号，额度与 agy 共用。',
}

// 订阅登录状态与模型选择；按 provider 加 key 渲染，切换时状态自动重置。
function SubscriptionSettings({ provider, settings, setSettings, bridge }) {
  const { modelKey, defaultModel } = AI_PROVIDERS[provider]
  const [status, setStatus] = useState(null)
  const [models, setModels] = useState(null)
  const [modelsError, setModelsError] = useState('')
  const [loggingIn, setLoggingIn] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    bridge.status(provider)
      .then((next) => { if (!cancelled) setStatus(next) })
      .catch((err) => { if (!cancelled) setError(cleanIpcError(err).message) })
    bridge.listModels(provider)
      .then((list) => { if (!cancelled) setModels(list) })
      .catch((err) => { if (!cancelled) setModelsError(cleanIpcError(err).message) })
    return () => { cancelled = true }
  }, [provider, bridge])

  const run = async (action) => {
    setError('')
    try {
      setStatus(await action())
    } catch (err) {
      setError(cleanIpcError(err).message)
    }
  }

  const handleLogin = async () => {
    setLoggingIn(true)
    await run(() => bridge.login(provider))
    setLoggingIn(false)
  }

  const model = settings[modelKey] || defaultModel
  const setModel = (value) => setSettings({ ...settings, [modelKey]: value })
  const options = models && !models.some((m) => m.id === model) ? [{ id: model, name: model }, ...models] : models

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div>
        {provider === 'chatgpt' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', color: 'var(--ink)' }}>
              {status === null ? '正在读取登录状态…' : status.loggedIn ? '已登录 ChatGPT' : '未登录'}
            </span>
            {status && !status.loggedIn && (
              <button type="button" className="button button--primary" onClick={handleLogin} disabled={loggingIn}>
                {loggingIn ? '请在浏览器中完成登录…' : '登录 ChatGPT'}
              </button>
            )}
            {status?.loggedIn && (
              <button type="button" className="button button--secondary" onClick={() => run(() => bridge.logout(provider))}>
                退出登录
              </button>
            )}
          </div>
        )}
        {provider === 'antigravity' && status?.accountMode === false && (
          <p style={errorStyle}>Antigravity CLI 当前是 API key 模式，请先在 agy 里切回账号登录。</p>
        )}
        <p style={hintStyle}>{SUBSCRIPTION_HINTS[provider]}</p>
        {error && <p style={errorStyle}>{error}</p>}
      </div>

      <div>
        <label style={labelStyle} htmlFor="ai-subscription-model">模型</label>
        {modelsError ? (
          <>
            <input
              id="ai-subscription-model"
              className="book-editor__input"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              style={inputStyle}
            />
            <p style={errorStyle}>读取模型列表失败：{modelsError}</p>
          </>
        ) : options ? (
          <select
            id="ai-subscription-model"
            className="book-editor__input"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            style={inputStyle}
          >
            {options.map((m) => (
              <option key={m.id} value={m.id}>{m.name === m.id ? m.id : `${m.name}（${m.id}）`}</option>
            ))}
          </select>
        ) : (
          <p style={hintStyle}>正在读取模型列表…</p>
        )}
      </div>
    </div>
  )
}

function ConnectionTest({ settings }) {
  const [result, setResult] = useState(null)

  const handleTest = async () => {
    setResult({ testing: true })
    try {
      const reply = await chatCompletion({ user: '只回复 OK 两个字母。' }, { settings })
      setResult({ ok: true, text: `连接成功：${reply.trim().slice(0, 40)}` })
    } catch (err) {
      setResult({ ok: false, text: `连接失败：${err.message}` })
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
      <button type="button" className="button button--secondary" onClick={handleTest} disabled={result?.testing}>
        {result?.testing ? '测试中…' : '测试连接'}
      </button>
      {result && !result.testing && (
        <span style={{ ...(result.ok ? hintStyle : errorStyle), margin: 0 }}>{result.text}</span>
      )}
    </div>
  )
}

export default function SettingsModal({ onClose }) {
  const [settings, setSettings] = useState(() => loadAiSettings())
  const [bridge] = useState(() => (typeof window !== 'undefined' ? window.aiBridge : undefined))
  const provider = getProvider(settings)
  const [clipperStatus, setClipperStatus] = useState(null)

  useEffect(() => {
    if (typeof window !== 'undefined' && window.clipper?.getStatus) {
      window.clipper.getStatus().then(setClipperStatus).catch(() => {})
    }
  }, [])

  const handleSave = () => {
    saveAiSettings(settings)
    onClose()
  }

  const handleOpenExtensionDir = () => {
    if (typeof window !== 'undefined' && window.clipper?.openExtensionDir) {
      window.clipper.openExtensionDir()
    }
  }

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.45)',
        backdropFilter: 'blur(5px)',
        WebkitBackdropFilter: 'blur(5px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '500px',
          maxWidth: '92%',
          maxHeight: '88vh',
          overflowY: 'auto',
          padding: '24px 28px',
          backgroundColor: 'var(--surface-card)',
          color: 'var(--ink)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--hairline)',
          boxShadow: '0 20px 48px rgba(0, 0, 0, 0.28)',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <h3 style={{ margin: 0, fontSize: '20px', fontFamily: 'var(--font-display)', color: 'var(--ink)' }}>
            应用设置
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            style={{
              background: 'none',
              border: 'none',
              fontSize: '22px',
              lineHeight: 1,
              cursor: 'pointer',
              color: 'var(--muted)',
              padding: '4px',
            }}
          >
            ×
          </button>
        </div>

        {/* 浏览器剪藏扩展区块 */}
        <div
          style={{
            marginBottom: '22px',
            padding: '14px 16px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--surface-soft)',
            border: '1px solid var(--hairline)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontWeight: '600', fontSize: '14px', color: 'var(--ink)' }}>
              🌐 浏览器剪藏扩展 (Chrome / Edge)
            </span>
            {clipperStatus?.running ? (
              <span style={{ fontSize: '11px', color: 'var(--success)', fontWeight: '600' }}>
                ● 服务运行中 (端口: {clipperStatus.port})
              </span>
            ) : (
              <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
                ○ 仅桌面版可用
              </span>
            )}
          </div>
          <p style={{ color: 'var(--body)', fontSize: '12px', margin: '0 0 10px 0', lineHeight: 1.5 }}>
            一键将 ChatGPT 与 Gemini 网页端的问答与错题保存到本地笔记本。
          </p>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              type="button"
              className="button button--secondary"
              style={{ fontSize: '12px', padding: '5px 12px' }}
              onClick={handleOpenExtensionDir}
              disabled={!window.clipper}
            >
              📂 打开扩展程序目录
            </button>
          </div>

          <div
            style={{
              marginTop: '10px',
              fontSize: '11px',
              color: 'var(--muted)',
              background: 'var(--canvas)',
              border: '1px solid var(--hairline)',
              padding: '8px 12px',
              borderRadius: 'var(--radius-sm)',
              lineHeight: 1.5,
            }}
          >
            <strong style={{ color: 'var(--ink)' }}>安装指引：</strong>在浏览器打开 <code>chrome://extensions</code>，开启右上角「开发者模式」，点击「加载已解压的扩展程序」，选择上述目录即可！
          </div>
        </div>

        {/* AI 接口设置 */}
        <div>
          <h4 style={{ margin: '0 0 6px 0', fontSize: '15px', fontWeight: '600', color: 'var(--ink)' }}>
            AI 接口设置
          </h4>
          <p style={{ color: 'var(--muted)', fontSize: '12px', margin: '0 0 16px 0', lineHeight: 1.4 }}>
            选择 AI 来源：自填 API Key，或在桌面版直接用 ChatGPT / Antigravity 订阅登录。用于识别图片和 PDF 出题、整理 Markdown、翻译字幕。
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div role="radiogroup" aria-label="AI 来源" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {Object.entries(AI_PROVIDERS).map(([key, info]) => {
                const disabled = info.desktopOnly && !bridge
                return (
                  <label
                    key={key}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '13px',
                      color: disabled ? 'var(--muted)' : 'var(--ink)',
                      cursor: disabled ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <input
                      type="radio"
                      name="ai-provider"
                      value={key}
                      checked={provider === key}
                      disabled={disabled}
                      onChange={() => setSettings({ ...settings, provider: key })}
                    />
                    {info.label}{disabled ? '（仅桌面版）' : ''}
                  </label>
                )
              })}
            </div>

            {provider === 'apiKey' ? (
              <>
                <div>
                  <label style={labelStyle}>API Base URL</label>
                  <input
                    className="book-editor__input"
                    value={settings.baseUrl}
                    onChange={(e) => setSettings({ ...settings, baseUrl: e.target.value })}
                    placeholder="https://api.openai.com/v1"
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label style={labelStyle}>API Key</label>
                  <input
                    className="book-editor__input"
                    type="password"
                    value={settings.apiKey}
                    onChange={(e) => setSettings({ ...settings, apiKey: e.target.value })}
                    placeholder="sk-..."
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label style={labelStyle}>模型名称 (Model)</label>
                  <input
                    className="book-editor__input"
                    value={settings.model}
                    onChange={(e) => setSettings({ ...settings, model: e.target.value })}
                    placeholder="gpt-4o"
                    style={inputStyle}
                  />
                </div>
              </>
            ) : bridge ? (
              <SubscriptionSettings
                key={provider}
                provider={provider}
                settings={settings}
                setSettings={setSettings}
                bridge={bridge}
              />
            ) : (
              <p style={errorStyle}>订阅登录只能在桌面版使用，请改用 API Key。</p>
            )}

            <ConnectionTest settings={settings} />
          </div>
        </div>

        <div style={{ marginTop: '24px', display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button type="button" className="button button--secondary" onClick={onClose}>
            取消
          </button>
          <button type="button" className="button button--primary" onClick={handleSave}>
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
