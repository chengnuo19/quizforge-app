import { useState, useEffect } from 'react'
import ThemeToggle from './ThemeToggle.jsx'
import SettingsModal from './SettingsModal.jsx'
import { loadAiSettings } from '../quiz/storage.js'
import { AI_PROVIDERS, getProvider } from '../quiz/aiClient.js'

export default function ScreenshotOrganizerPanel({ onExit, theme, onToggleTheme }) {
  const [screenshotDir, setScreenshotDir] = useState('')
  const [outputDir, setOutputDir] = useState('')
  const [mode, setMode] = useState('preview')
  const [provider, setProvider] = useState('__app__')
  const [modelName, setModelName] = useState('')
  const [aiSettings, setAiSettings] = useState(() => loadAiSettings())
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [commandOutput, setCommandOutput] = useState('')
  const [actionError, setActionError] = useState('')
  const [watching, setWatching] = useState(false)

  const [configSource, setConfigSource] = useState('loading') // 'loading', 'mock', 'real', 'error'
  const [sourcePath, setSourcePath] = useState('')
  const [yamlError, setYamlError] = useState('')
  const [providerOrder, setProviderOrder] = useState(['mock'])
  const [providers, setProviders] = useState({
    mock: {
      label: 'Mock (仿真测试)',
      model: 'mock-vision-model',
      adapter: 'mock',
      apiKeyEnv: '',
      hasApiKey: true,
      pricing: '预计单张截图整理成本：免费 (Mock)'
    }
  })

  // Load configuration from Electron main process
  useEffect(() => {
    if (window.electronAPI && window.electronAPI.getScreenshotConfig) {
      window.electronAPI.getScreenshotConfig()
        .then((res) => {
          if (res.success) {
            setConfigSource(res.source.includes('mock') ? 'mock' : 'real')
            setSourcePath(res.source)
            setProviders(res.config.providers)
            setProviderOrder(res.config.providerOrder)
            
            if (res.config.watchDir) setScreenshotDir(res.config.watchDir)
            if (res.config.outputDir) setOutputDir(res.config.outputDir)
          } else {
            setConfigSource('error')
            setSourcePath(res.source || '')
            setYamlError(res.error || '未知的 YAML 解析错误')
            // Fallback to mock
            setProviders(res.config.providers)
            setProviderOrder(res.config.providerOrder)
          }
        })
        .catch((err) => {
          setConfigSource('error')
          setYamlError(err.message || '加载配置失败')
        })
    } else {
      setConfigSource('mock')
    }
  }, [])

  // Auto-change model name when provider changes
  useEffect(() => {
    if (providers[provider]) {
      setModelName(providers[provider].model || '')
    }
  }, [provider, providers])

  const handlePreview = () => {
    runAction('preview')
  }

  const runAction = async (action) => {
    if (!window.electronAPI?.runScreenshotOrganizer) {
      setActionError('截图整理只能在桌面应用中运行。')
      return
    }

    setLoading(true)
    setActionError('')
    setCommandOutput('')
    setResults([])
    try {
      const currentAiSettings = loadAiSettings()
      const response = await window.electronAPI.runScreenshotOrganizer({
        action,
        watchDir: screenshotDir,
        outputDir,
        provider,
        modelName: provider === '__app__' ? '' : modelName,
        aiSettings: currentAiSettings,
      })
      setWatching(Boolean(response?.watching))
      setCommandOutput(response?.output || '命令已完成。')
    } catch (error) {
      setActionError(error?.message || '截图整理执行失败。')
    } finally {
      setLoading(false)
    }
  }

  const handleActionClick = async () => {
    if (mode === 'watch' && watching) {
      if (!window.electronAPI?.stopScreenshotWatcher) {
        setActionError('截图监听只能在桌面应用中停止。')
        return
      }
      setLoading(true)
      setActionError('')
      try {
        const response = await window.electronAPI.stopScreenshotWatcher()
        setWatching(Boolean(response?.watching))
        setCommandOutput(response?.output || '监听已停止。')
      } catch (error) {
        setActionError(error?.message || '停止截图监听失败。')
      } finally {
        setLoading(false)
      }
      return
    }

    if (mode === 'watch') {
      await runAction('watch')
      return
    }

    if (window.confirm('将按当前配置移动和重命名截图，确定继续吗？')) {
      await runAction('batch')
    }
  }

  const handleUndo = () => {
    runAction('undo')
  }

  return (
    <div className="home">
      <div className="home__topbar">
        <button type="button" className="button button--secondary" onClick={onExit}>
          ← 返回首页
        </button>
        {onToggleTheme && <ThemeToggle theme={theme} onToggle={onToggleTheme} />}
      </div>

      <section className="screenshot-organizer-panel">
        <h1 className="home__heading">截图自动整理</h1>

        {/* Configuration Status Banner */}
        {configSource === 'real' && (
          <div className="screenshot-organizer-panel__warning" style={{ borderLeftColor: '#4caf50', backgroundColor: 'rgba(76, 175, 80, 0.1)' }}>
            <span className="screenshot-organizer-panel__warning-icon">✅</span>
            <div className="screenshot-organizer-panel__warning-content">
              <strong>已加载真实配置驱动</strong>
              <p>成功从 <code>{sourcePath}</code> 读取模型配置。预览不会移动文件；开始整理前会要求确认。</p>
            </div>
          </div>
        )}

        {configSource === 'mock' && (
          <div className="screenshot-organizer-panel__warning">
            <span className="screenshot-organizer-panel__warning-icon">⚠️</span>
            <div className="screenshot-organizer-panel__warning-content">
              <strong>Mock 演示模式</strong>
              <p>未检测到真实配置文件，当前运行在 Mock 仿真模式下。</p>
            </div>
          </div>
        )}

        {configSource === 'error' && (
          <div className="screenshot-organizer-panel__warning" style={{ borderLeftColor: '#f44336', backgroundColor: 'rgba(244, 67, 54, 0.1)' }}>
            <span className="screenshot-organizer-panel__warning-icon">❌</span>
            <div className="screenshot-organizer-panel__warning-content">
              <strong>配置解析错误 (已降级为 Mock)</strong>
              <p>{yamlError || `配置文件 ${sourcePath} 解析失败，已自动降级为 Mock Fallback。`}</p>
            </div>
          </div>
        )}

        {/* Configurations Grid */}
        <div className="screenshot-organizer-panel__grid">
          {/* Section 1: Paths & Mode */}
          <div className="screenshot-organizer-panel__section">
            <h2 className="screenshot-organizer-panel__title">📁 路径与模式设置</h2>
            
            <div className="book-editor__field">
              <label className="book-editor__label" htmlFor="screenshotDirInput">截图源目录</label>
              <input
                id="screenshotDirInput"
                type="text"
                className="book-editor__input"
                value={screenshotDir}
                onChange={(e) => setScreenshotDir(e.target.value)}
                placeholder="请输入截图目录绝对路径"
              />
            </div>

            <div className="book-editor__field" style={{ marginTop: '12px' }}>
              <label className="book-editor__label" htmlFor="outputDirInput">整理输出目录</label>
              <input
                id="outputDirInput"
                type="text"
                className="book-editor__input"
                value={outputDir}
                onChange={(e) => setOutputDir(e.target.value)}
                placeholder="请输入输出目录绝对路径"
              />
            </div>

            <div className="book-editor__field" style={{ marginTop: '12px' }}>
              <label className="book-editor__label" htmlFor="modeSelect">处理模式</label>
              <select
                id="modeSelect"
                data-testid="screenshot-mode"
                className="book-editor__input"
                value={mode}
                onChange={(e) => setMode(e.target.value)}
              >
                <option value="preview">仅预览（不移动文件）</option>
                <option value="batch">批量整理（重命名并分类）</option>
                <option value="watch">监听新增（自动实时整理）</option>
              </select>
            </div>
          </div>

          {/* Section 2: AI Model Config */}
          <div className="screenshot-organizer-panel__section">
            <h2 className="screenshot-organizer-panel__title">🤖 AI 模型配置</h2>

            <div className="book-editor__field">
              <label className="book-editor__label" htmlFor="providerSelect">服务商 (Provider)</label>
              <select
                id="providerSelect"
                className="book-editor__input"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
              >
                <option value="__app__">
                  🌟 使用应用全局 AI（推荐：跟随应用订阅与设置）
                </option>
                {providerOrder.map((id) => (
                  <option key={id} value={id}>
                    {providers[id]?.label || id}
                  </option>
                ))}
              </select>
            </div>

            {provider === '__app__' ? (
              <div>
                {(() => {
                  const activeProviderKey = getProvider(aiSettings)
                  const activeProviderInfo = AI_PROVIDERS[activeProviderKey]
                  const activeModel =
                    activeProviderKey === 'chatgpt'
                      ? (aiSettings.chatgptModel || 'gpt-5.5')
                      : activeProviderKey === 'antigravity'
                      ? (aiSettings.antigravityModel || 'gemini-3.8-flash-high')
                      : (aiSettings.model || 'gpt-4o')
                  const isKeyMissing = activeProviderKey === 'apiKey' && !String(aiSettings.apiKey || '').trim()

                  return (
                    <>
                      <div
                        style={{
                          marginTop: '12px',
                          padding: '12px',
                          borderRadius: 'var(--radius-sm, 6px)',
                          background: 'var(--surface-soft, rgba(255, 255, 255, 0.04))',
                          border: '1px solid var(--hairline)',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                          <span style={{ fontSize: '12px', color: 'var(--muted)' }}>当前应用 AI 来源</span>
                          <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--ink)' }}>
                            {activeProviderInfo?.label || activeProviderKey}
                          </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '12px', color: 'var(--muted)' }}>生效模型</span>
                          <code style={{ fontSize: '12px', color: 'var(--accent, #646cff)' }}>{activeModel}</code>
                        </div>
                      </div>

                      {isKeyMissing ? (
                        <div
                          style={{
                            marginTop: '10px',
                            padding: '10px 12px',
                            borderRadius: 'var(--radius-sm, 6px)',
                            backgroundColor: 'rgba(255, 152, 0, 0.12)',
                            border: '1px solid #ff9800',
                            color: '#ff9800',
                          }}
                        >
                          <strong style={{ display: 'block', fontSize: '13px' }}>⚠️ 未配置全局 API Key</strong>
                          <span style={{ fontSize: '12px' }}>
                            当前使用 OpenAI 兼容接口，但尚未填写 API Key。请点击下方按钮进行配置。
                          </span>
                        </div>
                      ) : activeProviderKey === 'antigravity' ? (
                        <p className="uploader__hint" style={{ marginTop: '10px', fontSize: '0.85em', color: 'var(--muted)' }}>
                          💡 使用本机 agy CLI 账号额度。Antigravity 分析较深，每张约需 20~30 秒。
                        </p>
                      ) : activeProviderKey === 'chatgpt' ? (
                        <p className="uploader__hint" style={{ marginTop: '10px', fontSize: '0.85em', color: 'var(--muted)' }}>
                          💡 使用当前登录的 ChatGPT Plus/Pro 订阅账号处理截图。
                        </p>
                      ) : (
                        <p className="uploader__hint" style={{ marginTop: '10px', fontSize: '0.85em', color: 'var(--muted)' }}>
                          💡 默认使用 QuizForge 设定的全局 API Key，无需在系统配置环境变量。
                        </p>
                      )}

                      <button
                        type="button"
                        className="button button--secondary"
                        style={{ marginTop: '12px', width: '100%', fontSize: '13px', padding: '7px 12px' }}
                        onClick={() => setShowSettingsModal(true)}
                      >
                        ⚙️ 配置应用 AI / 更换模型
                      </button>
                    </>
                  )
                })()}
              </div>
            ) : (
              <>
                <div className="book-editor__field" style={{ marginTop: '12px' }}>
                  <label className="book-editor__label" htmlFor="modelNameInput">模型名称</label>
                  <input
                    id="modelNameInput"
                    type="text"
                    className="book-editor__input"
                    value={modelName}
                    onChange={(e) => setModelName(e.target.value)}
                    placeholder="请输入模型具体名称"
                  />
                </div>

                <p className="uploader__hint" style={{ marginTop: '12px', fontSize: '0.85em', color: 'var(--muted)' }}>
                  💡 {providers[provider]?.pricing || '请根据服务商接口定价合理配置预算。'}
                </p>

                {providers[provider] && !providers[provider].hasApiKey && (
                  <div
                    style={{
                      marginTop: '10px',
                      padding: '10px 12px',
                      borderRadius: 'var(--radius-sm, 6px)',
                      backgroundColor: 'rgba(255, 152, 0, 0.12)',
                      border: '1px solid #ff9800',
                      color: '#ff9800',
                    }}
                  >
                    <p style={{ margin: 0, fontSize: '12px', fontWeight: '500' }}>
                      ⚠️ 缺少环境变量 <code>{providers[provider].apiKeyEnv}</code>，该服务商可能无法正常调用。
                    </p>
                    <button
                      type="button"
                      className="button button--secondary"
                      style={{ marginTop: '8px', fontSize: '12px', padding: '4px 10px' }}
                      onClick={() => setProvider('__app__')}
                    >
                      🌟 切回应用全局 AI
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="screenshot-organizer-panel__actions" style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
          <button
            type="button"
            data-testid="screenshot-preview"
            className="button button--primary"
            onClick={handlePreview}
            disabled={loading}
          >
            {loading ? '正在扫描预览...' : '预览整理结果'}
          </button>
          <button
            type="button"
            data-testid="screenshot-start"
            className="button button--secondary"
            onClick={handleActionClick}
            disabled={loading}
          >
            {mode === 'watch' && watching ? '停止监听' : '开始整理'}
          </button>
          <button
            type="button"
            data-testid="screenshot-undo"
            className="button button--secondary"
            onClick={handleUndo}
            disabled={loading}
          >
            撤销上次操作
          </button>
        </div>

        {/* Preview Results Table */}
        <div className="screenshot-organizer-panel__section" style={{ marginTop: '24px' }}>
          <h2 className="screenshot-organizer-panel__title">📋 整理效果预览</h2>
          {actionError && (
            <p role="alert" style={{ color: '#f44336', whiteSpace: 'pre-wrap' }}>
              {actionError}
            </p>
          )}
          {commandOutput && (
            <pre data-testid="screenshot-command-output" style={{ whiteSpace: 'pre-wrap', overflowX: 'auto' }}>
              {commandOutput}
            </pre>
          )}
          
          {loading ? (
            <div className="home__empty" style={{ padding: '24px 0', textAlign: 'center' }}>
              正在模拟分析源目录中的截图文件...
            </div>
          ) : results.length > 0 ? (
            <div style={{ overflowX: 'auto' }}>
              <table className="screenshot-organizer-panel__table">
                <thead>
                  <tr>
                    <th>原文件名</th>
                    <th>建议分类</th>
                    <th>建议新文件名</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((item, idx) => (
                    <tr key={idx}>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9em' }}>{item.originalName}</td>
                      <td>
                        <span className="screenshot-organizer-panel__badge screenshot-organizer-panel__badge--category">
                          {item.category}
                        </span>
                      </td>
                      <td style={{ fontWeight: '500' }}>{item.newName}</td>
                      <td>
                        <span className={`screenshot-organizer-panel__badge screenshot-organizer-panel__badge--${item.status}`}>
                          {item.statusText}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="home__empty" style={{ padding: '16px 0' }}>
              暂无预览数据，请在上方配置完成后点击“预览整理结果”按钮。
            </p>
          )}
        </div>
        {/* Settings Modal */}
        {showSettingsModal && (
          <SettingsModal
            onClose={() => {
              setShowSettingsModal(false)
              setAiSettings(loadAiSettings())
            }}
          />
        )}
      </section>
    </div>
  )
}
