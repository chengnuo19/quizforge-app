const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron')
const path = require('path')
const fs = require('fs/promises')
const { existsSync } = require('fs')
const { randomUUID } = require('crypto')
const yaml = require('js-yaml')
const { convertDocumentWithMarkitdown } = require('./markitdown.cjs')
const { convertDocumentWithDocling } = require('./docling.cjs')
const { convertWithDoclingServe, stopDoclingServe } = require('./doclingServe.cjs')
const {
  runScreenshotOrganizer,
  startScreenshotWatcher,
  validateScreenshotAiSettings,
} = require('./screenshotOrganizer.cjs')
const { initReminders } = require('./reminders.cjs')
const {
  DEFAULT_YTDLP_PATH,
  DEFAULT_FFMPEG_PATH,
  checkEnvironment: checkYtdlpEnv,
  fetchVideoInfo: fetchYtdlpInfo,
  cleanSubtitleToMarkdown,
  startDownloadProcess,
  updateYtdlpBinary,
} = require('./ytdlp.cjs')
const { checkWhisperEnvironment, startTranscription } = require('./whisper.cjs')
const {
  VIDEO_EXTENSIONS,
  findSubtitleFfmpeg,
  probeVideo,
  runFfmpeg,
  buildExtractAudioArgs,
  burnSubtitles,
  getProjectPath,
  getOutputBase,
} = require('./videoSubtitle.cjs')
const {
  startClipServer,
  stopClipServer,
  getClipServerStatus,
  setCachedNotebooks,
} = require('./clipServer.cjs')
const { createChatgptClient } = require('./aiChatgpt.cjs')
const { createAntigravityClient } = require('./aiAntigravity.cjs')

// Shared by every "pick a document to convert" dialog below.
const DOCUMENT_FILTERS = [
  {
    name: 'Documents',
    extensions: [
      'pdf',
      'docx',
      'doc',
      'pptx',
      'ppt',
      'xlsx',
      'xls',
      'html',
      'htm',
      'csv',
      'json',
      'xml',
      'txt',
      'md',
      'markdown',
      'epub',
      'zip',
    ],
  },
  { name: 'All Files', extensions: ['*'] },
]

let mainWindow = null
let screenshotWatchProcess = null
let screenshotWatchConfigPath = null
let activeYtdlpController = null
let activeSubtitleController = null
let subtitleFfmpegCache = null

function getSubtitleConfigFile() {
  return path.join(app.getPath('userData'), 'subtitle-config.json')
}

async function loadSubtitleConfig() {
  try {
    const configFile = getSubtitleConfigFile()
    if (existsSync(configFile)) return JSON.parse(await fs.readFile(configFile, 'utf-8'))
  } catch (err) {
    console.error('Failed to load subtitle config:', err)
  }
  return {}
}

async function saveSubtitleConfig(data) {
  const merged = { ...(await loadSubtitleConfig()), ...data }
  await fs.writeFile(getSubtitleConfigFile(), JSON.stringify(merged, null, 2), 'utf-8')
  return merged
}

async function getSubtitleFfmpeg() {
  if (subtitleFfmpegCache && subtitleFfmpegCache.available) return subtitleFfmpegCache
  const config = await loadSubtitleConfig()
  subtitleFfmpegCache = await findSubtitleFfmpeg({ ffmpegPath: config.ffmpegPath })
  if (!subtitleFfmpegCache.available) throw new Error(subtitleFfmpegCache.error)
  return subtitleFfmpegCache
}

function getYtdlpConfigFile() {
  return path.join(app.getPath('userData'), 'ytdlp-config.json')
}

async function loadYtdlpConfig() {
  const configFile = getYtdlpConfigFile()
  const defaults = {
    ytdlpPath: DEFAULT_YTDLP_PATH,
    ffmpegPath: existsSync(DEFAULT_FFMPEG_PATH) ? DEFAULT_FFMPEG_PATH : 'ffmpeg',
    downloadDir: app.getPath('downloads'),
    defaultSubLang: 'zh-Hans,zh,en',
    defaultAudioFormat: 'mp3',
    concurrentFragments: 5,
    proxy: '',
  }

  try {
    if (existsSync(configFile)) {
      const data = JSON.parse(await fs.readFile(configFile, 'utf-8'))
      return { ...defaults, ...data }
    }
  } catch (err) {
    console.error('Failed to load ytdlp config:', err)
  }
  return defaults
}

async function saveYtdlpConfig(data) {
  const configFile = getYtdlpConfigFile()
  try {
    const current = await loadYtdlpConfig()
    const merged = { ...current, ...data }
    await fs.writeFile(configFile, JSON.stringify(merged, null, 2), 'utf-8')
    return merged
  } catch (err) {
    console.error('Failed to save ytdlp config:', err)
    throw err
  }
}

const screenshotOrganizerRoot = process.env.SCREENSHOT_ORGANIZER_DIR || path.join(app.getPath('userData'), 'screenshot-organizer')
const screenshotOrganizerConfigPath = process.env.SCREENSHOT_ORGANIZER_CONFIG || path.join(screenshotOrganizerRoot, 'config.yaml')

// Check if we are running in dev mode (Vite)
const isDev = !app.isPackaged

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'QuizForge',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    }
  })

  // Hide the default menu
  mainWindow.setMenuBarVisibility(false)

  if (isDev) {
    // Load Vite dev server
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    // Load built index.html
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

async function completeWithApiKeyMain(settings, { system, user, image }) {
  if (!settings?.apiKey) {
    throw new Error('未配置 AI API Key，请先在右上角设置中配置。')
  }
  const baseUrl = (settings.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')
  const userContent = image
    ? [
        { type: 'text', text: user },
        {
          type: 'image_url',
          image_url: { url: `data:${image.mimeType};base64,${image.data}` },
        },
      ]
    : user
  const payload = {
    model: settings.model || 'gpt-4o',
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      { role: 'user', content: userContent },
    ],
  }
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
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

async function createScreenshotRuntimeConfig(payload = {}) {
  if (!existsSync(screenshotOrganizerConfigPath)) {
    throw new Error(`Screenshot organizer config was not found: ${screenshotOrganizerConfigPath}`)
  }

  const config = yaml.load(await fs.readFile(screenshotOrganizerConfigPath, 'utf-8'))
  if (!config || typeof config !== 'object') {
    throw new Error('Screenshot organizer config is invalid.')
  }

  const watchDir = String(payload.watchDir || '').trim()
  const outputDir = String(payload.outputDir || '').trim()
  const provider = String(payload.provider || '').trim()
  const modelName = String(payload.modelName || '').trim()
  const aiSettings = payload.aiSettings || {}

  if (watchDir) config.watch_dir = watchDir
  if (outputDir) config.output_dir = outputDir

  if (provider === '__app__') {
    if (!config.providers) config.providers = {}
    let targetModel = 'gpt-4o'
    if (aiSettings.provider === 'chatgpt') {
      targetModel = aiSettings.chatgptModel || 'gpt-5.5'
    } else if (aiSettings.provider === 'antigravity') {
      targetModel = aiSettings.antigravityModel || 'gemini-3.8-flash-high'
    } else if (aiSettings.model) {
      targetModel = aiSettings.model
    }

    config.providers.quizforge = {
      adapter: 'host_pipe',
      base_url: '',
      model: targetModel,
      max_tokens: 300,
    }
    config.provider_order = ['quizforge']
    config.workers = 1
  } else if (provider) {
    if (!config.providers || !config.providers[provider]) {
      throw new Error(`Unknown screenshot provider: ${provider}`)
    }
    config.provider_order = [provider]
    if (modelName) config.providers[provider].model = modelName
  }

  const tempPath = path.join(app.getPath('temp'), `quizforge-screenshot-${randomUUID()}.yaml`)
  await fs.writeFile(tempPath, yaml.dump(config), 'utf-8')
  return tempPath
}

async function removeScreenshotRuntimeConfig(configPath) {
  if (configPath) await fs.rm(configPath, { force: true })
}

app.whenReady().then(() => {
  // AI 订阅：ChatGPT（pi-ai OAuth）与 Antigravity（官方 agy CLI）提前初始化
  const aiClients = {
    chatgpt: createChatgptClient({
      userDataDir: app.getPath('userData'),
      safeStorage,
      openExternal: (url) => shell.openExternal(url),
    }),
    antigravity: createAntigravityClient(),
  }
  ipcMain.handle('screenshot:getConfig', async (event, customPath) => {
    const pathsToTry = []
    if (customPath) {
      pathsToTry.push(customPath)
    }
    pathsToTry.push(screenshotOrganizerConfigPath)
    pathsToTry.push(path.join(__dirname, '../config.yaml'))

    let configContent = null
    let usedPath = null

    for (const p of pathsToTry) {
      try {
        if (existsSync(p)) {
          configContent = await fs.readFile(p, 'utf-8')
          usedPath = p
          break
        }
      } catch (e) {
        // Ignore and try next
      }
    }

    if (!configContent) {
      return {
        success: false,
        source: 'mock',
        config: {
          watchDir: path.join(app.getPath('pictures'), 'Screenshots'),
          outputDir: path.join(app.getPath('documents'), 'QuizForge', 'screenshots'),
          providerOrder: ['mock'],
          providers: {
            mock: {
              label: 'Mock (仿真测试)',
              model: 'mock-vision-model',
              adapter: 'mock',
              apiKeyEnv: '',
              hasApiKey: true,
              pricing: '预计单张截图整理成本：免费 (Mock)'
            }
          }
        }
      }
    }

    try {
      const parsed = yaml.load(configContent)
      const providerOrder = parsed.provider_order || ['mock']
      const providers = {}

      const providerLabels = {
        mock: 'Mock (仿真测试)',
        openai: 'OpenAI',
        claude: 'Anthropic Claude',
        gemini: 'Google Gemini',
        glm: '智谱清言 GLM',
        mimo: 'MiMo',
        qwen: '阿里通义千问',
        kimi: 'Moonshot Kimi',
        doubao: '字节跳动豆包',
        ollama: 'Ollama 本地部署'
      }

      const getPricingTip = (id, pConf) => {
        if (id === 'mock') return '预计单张截图整理成本：免费 (Mock)'
        if (pConf.pricing) {
          const input = pConf.pricing.input_per_million_cny
          const output = pConf.pricing.output_per_million_cny
          if (input !== undefined && output !== undefined) {
            return `预计输入单价: ¥${input}/M tokens, 输出单价: ¥${output}/M tokens`
          }
        }
        const budgetTips = {
          openai: '预计单张截图整理成本约为 ¥0.03 ~ ¥0.08',
          claude: '预计单张截图整理成本约为 ¥0.05 ~ ¥0.12',
          gemini: '预计单张截图整理成本约为 ¥0.01 ~ ¥0.03',
          glm: '预计单张截图整理成本约为 ¥0.01 ~ ¥0.03',
          mimo: '预计单张截图整理成本约为 ¥0.005 ~ ¥0.01',
          qwen: '预计单张截图整理成本约为 ¥0.01 ~ ¥0.02'
        }
        return budgetTips[id] || '请根据服务商接口定价合理配置预算。'
      }

      providers['mock'] = {
        label: 'Mock (仿真测试)',
        model: 'mock-vision-model',
        adapter: 'mock',
        apiKeyEnv: '',
        hasApiKey: true,
        pricing: '预计单张截图整理成本：免费 (Mock)'
      }

      if (parsed.providers) {
        for (const id of providerOrder) {
          const pConf = parsed.providers[id]
          if (pConf) {
            const apiKeyEnv = pConf.api_key_env || ''
            const hasApiKey = apiKeyEnv ? (process.env[apiKeyEnv] !== undefined && process.env[apiKeyEnv] !== '') : (pConf.api_key_required === false)
            
            providers[id] = {
              label: providerLabels[id] || id,
              model: pConf.model || '',
              adapter: pConf.adapter || '',
              apiKeyEnv: apiKeyEnv,
              hasApiKey: !!hasApiKey,
              pricing: getPricingTip(id, pConf)
            }
          }
        }
      }

      const validProviderOrder = providerOrder.filter(id => providers[id])

      return {
        success: true,
        source: usedPath,
        config: {
          watchDir: parsed.watch_dir || '',
          outputDir: parsed.output_dir || '',
          providerOrder: validProviderOrder.length > 0 ? validProviderOrder : ['mock'],
          providers: providers
        }
      }
    } catch (err) {
      return {
        success: false,
        source: usedPath,
        error: `YAML 解析失败: ${err.message}`,
        config: {
          watchDir: path.join(app.getPath('pictures'), 'Screenshots'),
          outputDir: path.join(app.getPath('documents'), 'QuizForge', 'screenshots'),
          providerOrder: ['mock'],
          providers: {
            mock: {
              label: 'Mock (仿真测试)',
              model: 'mock-vision-model',
              adapter: 'mock',
              apiKeyEnv: '',
              hasApiKey: true,
              pricing: '预计单张截图整理成本：免费 (Mock)'
            }
          }
        }
      }
    }
  })

  ipcMain.handle('screenshot:run', async (_event, payload = {}) => {
    const action = String(payload.action || '')
    if (!['preview', 'batch', 'watch', 'undo'].includes(action)) {
      throw new Error('Unsupported screenshot action.')
    }

    if (action === 'watch' && screenshotWatchProcess) {
      return {
        watching: true,
        pid: screenshotWatchProcess.pid,
        output: 'Screenshot watcher is already running.',
      }
    }

    const isAppProvider = payload.provider === '__app__'
    const cliProvider = isAppProvider ? 'quizforge' : String(payload.provider || '').trim()
    const aiSettings = payload.aiSettings || {}

    // 预检：__app__ 模式下，若为 apiKey 且未配置 apiKey，则立即拦截抛错，不启动 Python 进程
    validateScreenshotAiSettings(payload)

    const handleAiRequest = isAppProvider ? async (req) => {
      const providerType = aiSettings.provider || 'apiKey'
      if (providerType === 'chatgpt' || providerType === 'antigravity') {
        const client = aiClients[providerType]
        if (!client) throw new Error(`未知的 AI 订阅：${providerType}`)
        const model = providerType === 'chatgpt'
          ? (aiSettings.chatgptModel || 'gpt-5.5')
          : (aiSettings.antigravityModel || 'gemini-3.8-flash-high')
        return await client.complete({
          system: req.system,
          user: req.user,
          images: req.image ? [req.image] : [],
          model,
        })
      } else {
        return await completeWithApiKeyMain(aiSettings, req)
      }
    } : undefined

    const runtimeConfigPath = await createScreenshotRuntimeConfig(payload)
    if (action === 'watch') {
      try {
        const child = startScreenshotWatcher({
          configPath: runtimeConfigPath,
          provider: cliProvider,
          cwd: screenshotOrganizerRoot,
          handleAiRequest,
        })
        screenshotWatchProcess = child
        screenshotWatchConfigPath = runtimeConfigPath
        const clearWatcher = async () => {
          screenshotWatchProcess = null
          const tempPath = screenshotWatchConfigPath
          screenshotWatchConfigPath = null
          await removeScreenshotRuntimeConfig(tempPath)
        }
        child.once('exit', clearWatcher)
        child.once('error', clearWatcher)
        return { watching: true, pid: child.pid, output: 'Screenshot watcher started.' }
      } catch (error) {
        await removeScreenshotRuntimeConfig(runtimeConfigPath)
        throw error
      }
    }

    try {
      const output = await runScreenshotOrganizer({
        action,
        configPath: runtimeConfigPath,
        provider: cliProvider,
        cwd: screenshotOrganizerRoot,
        handleAiRequest,
      })
      return { watching: false, output }
    } finally {
      await removeScreenshotRuntimeConfig(runtimeConfigPath)
    }
  })

  ipcMain.handle('screenshot:stopWatch', async () => {
    if (!screenshotWatchProcess) {
      return { watching: false, output: 'Screenshot watcher is not running.' }
    }
    screenshotWatchProcess.kill()
    return { watching: false, output: 'Screenshot watcher stop requested.' }
  })

  // Register IPC handlers for File System Access
  ipcMain.handle('dialog:selectVault', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: '选择题库仓库文件夹'
    })
    if (result.canceled) return null
    return result.filePaths[0]
  })

  ipcMain.handle('dialog:selectAndConvertDocument', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      title: '选择要转换的文档',
      filters: DOCUMENT_FILTERS,
    })

    if (result.canceled || !result.filePaths[0]) return null

    const filePath = result.filePaths[0]
    const markdown = await convertDocumentWithMarkitdown(filePath)
    return { path: filePath, markdown }
  })

  ipcMain.handle('markitdown:selectAndConvertFile', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      title: '选择要用 MarkItDown 转换的文件',
      filters: DOCUMENT_FILTERS,
    })

    if (result.canceled || !result.filePaths[0]) return null

    const filePath = result.filePaths[0]
    const markdown = await convertDocumentWithMarkitdown(filePath)
    return { path: filePath, markdown }
  })

  // Engine-aware conversion. MarkItDown returns in a second or two; Docling runs
  // layout models and streams progress back so a long run does not look hung.
  ipcMain.handle('document:selectAndConvert', async (event, payload = {}) => {
    const engine = payload?.engine === 'docling' ? 'docling' : 'markitdown'
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      title: engine === 'docling' ? '选择要用 Docling 转换的文件' : '选择要用 MarkItDown 转换的文件',
      filters: DOCUMENT_FILTERS,
    })

    if (result.canceled || !result.filePaths[0]) return null

    const filePath = result.filePaths[0]
    if (engine === 'docling') {
      const ocr = Boolean(payload?.ocr)
      const emit = (line) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('document-convert-progress', line)
        }
      }

      // Prefer the persistent service (~8s/doc once warm). The one-shot CLI
      // re-imports docling every run (~53s/doc), so it is only the fallback for
      // when docling-serve is missing or will not boot.
      try {
        const markdown = await convertWithDoclingServe(filePath, { ocr, onProgress: emit })
        return { path: filePath, markdown, engine, via: 'serve' }
      } catch (error) {
        emit(`Docling 服务不可用，改用单次转换（较慢）：${error.message}`)
      }

      const markdown = await convertDocumentWithDocling(filePath, { ocr, onProgress: emit })
      return { path: filePath, markdown, engine, via: 'cli' }
    }

    const markdown = await convertDocumentWithMarkitdown(filePath)
    return { path: filePath, markdown, engine, via: 'cli' }
  })

  ipcMain.handle('markitdown:saveMarkdownFile', async (_event, payload) => {
    const markdown = String(payload?.markdown || '')
    const defaultFileName = String(payload?.defaultFileName || 'markitdown-output.md')
    const result = await dialog.showSaveDialog({
      title: '保存 Markdown',
      defaultPath: defaultFileName.endsWith('.md') ? defaultFileName : `${defaultFileName}.md`,
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })

    if (result.canceled || !result.filePath) return null

    await fs.writeFile(result.filePath, markdown, 'utf-8')
    return { path: result.filePath }
  })

  ipcMain.handle('fs:readDir', async (event, dirPath) => {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    return entries.map(e => ({
      name: e.name,
      isDirectory: e.isDirectory(),
      path: path.join(dirPath, e.name)
    }))
  })

  ipcMain.handle('fs:readFile', async (event, filePath) => {
    return await fs.readFile(filePath, 'utf-8')
  })

  // Binary variants for PDF Workbench (readFile is text-only; a PDF must be
  // transferred as raw bytes, base64-encoded across the IPC boundary).
  ipcMain.handle('fs:readFileBuffer', async (event, filePath) => {
    const buf = await fs.readFile(filePath)
    return { base64: buf.toString('base64') }
  })

  ipcMain.handle('fs:writeFileBuffer', async (event, filePath, base64) => {
    await fs.writeFile(filePath, Buffer.from(base64, 'base64'))
    return true
  })

  ipcMain.handle('fs:writeFile', async (event, filePath, content) => {
    await fs.writeFile(filePath, content, 'utf-8')
  })

  ipcMain.handle('fs:mkdir', async (event, dirPath) => {
    await fs.mkdir(dirPath, { recursive: true })
  })

  ipcMain.handle('fs:exists', async (event, targetPath) => {
    return existsSync(targetPath)
  })
  
  ipcMain.handle('fs:copyBuiltin', async (event, destPath) => {
    // In dev mode, builtins are in project root /content
    // In production, we need to package them in extraResources
    const srcPath = isDev 
      ? path.join(__dirname, '../content') 
      : path.join(process.resourcesPath, 'content')
    
    if (existsSync(srcPath)) {
      await fs.cp(srcPath, destPath, { recursive: true, force: true })
      return true
    }
    return false
  })

  ipcMain.handle('path:join', (event, ...paths) => {
    return path.join(...paths)
  })

  // yt-dlp handlers
  ipcMain.handle('ytdlp:getConfig', async () => {
    return await loadYtdlpConfig()
  })

  ipcMain.handle('ytdlp:saveConfig', async (_event, config) => {
    return await saveYtdlpConfig(config)
  })

  ipcMain.handle('ytdlp:checkEnvironment', async (_event, options = {}) => {
    const config = await loadYtdlpConfig()
    return await checkYtdlpEnv({
      ytdlpPath: options.ytdlpPath || config.ytdlpPath,
      ffmpegPath: options.ffmpegPath || config.ffmpegPath,
    })
  })

  ipcMain.handle('ytdlp:fetchVideoInfo', async (_event, url, options = {}) => {
    const config = await loadYtdlpConfig()
    return await fetchYtdlpInfo(url, {
      ytdlpPath: options.ytdlpPath || config.ytdlpPath,
      proxy: options.proxy || config.proxy,
    })
  })

  ipcMain.handle('ytdlp:startDownload', async (event, payload = {}) => {
    const config = await loadYtdlpConfig()
    if (activeYtdlpController) {
      activeYtdlpController.cancel()
      activeYtdlpController = null
    }

    const outputDir = payload.outputDir || config.downloadDir || app.getPath('downloads')
    const emitProgress = (progress) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('ytdlp-progress', progress)
      }
    }
    const emitLog = (line) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('ytdlp-log', line)
      }
    }

    const controller = startDownloadProcess({
      url: payload.url,
      mode: payload.mode || 'video',
      outputDir,
      outputTemplate: payload.outputTemplate,
      format: payload.format,
      audioFormat: payload.audioFormat || config.defaultAudioFormat,
      subLang: payload.subLang || config.defaultSubLang,
      concurrentFragments: payload.concurrentFragments ?? config.concurrentFragments,
      proxy: payload.proxy || config.proxy,
      ytdlpPath: payload.ytdlpPath || config.ytdlpPath,
      ffmpegPath: payload.ffmpegPath || config.ffmpegPath,
      onProgress: emitProgress,
      onLog: emitLog,
    })

    activeYtdlpController = controller

    try {
      const result = await controller.promise
      return { ...result, outputDir }
    } finally {
      if (activeYtdlpController === controller) {
        activeYtdlpController = null
      }
    }
  })

  ipcMain.handle('ytdlp:cancelDownload', async () => {
    if (activeYtdlpController) {
      activeYtdlpController.cancel()
      activeYtdlpController = null
      return true
    }
    return false
  })

  ipcMain.handle('ytdlp:updateBinary', async (_event, options = {}) => {
    const config = await loadYtdlpConfig()
    return await updateYtdlpBinary({
      ytdlpPath: options.ytdlpPath || config.ytdlpPath,
      proxy: options.proxy || config.proxy,
    })
  })

  ipcMain.handle('ytdlp:extractSubtitles', async (event, payload = {}) => {
    const config = await loadYtdlpConfig()
    const tempDir = path.join(app.getPath('temp'), `qf-sub-${randomUUID()}`)
    await fs.mkdir(tempDir, { recursive: true })

    const emitLog = (line) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('ytdlp-log', line)
      }
    }

    try {
      const controller = startDownloadProcess({
        url: payload.url,
        mode: 'subtitles',
        subLang: payload.subLang || config.defaultSubLang,
        outputDir: tempDir,
        outputTemplate: 'subtitle.%(ext)s',
        ytdlpPath: payload.ytdlpPath || config.ytdlpPath,
        ffmpegPath: payload.ffmpegPath || config.ffmpegPath,
        onLog: emitLog,
      })

      const result = await controller.promise
      if (result.cancelled) {
        return { cancelled: true }
      }

      const files = await fs.readdir(tempDir)
      const subFile = files.find(f => f.endsWith('.vtt') || f.endsWith('.srt'))
      if (!subFile) {
        throw new Error('未检测到下载的字幕文件。该视频可能没有提供所选语言的字幕。')
      }

      const filePath = path.join(tempDir, subFile)
      const content = await fs.readFile(filePath, 'utf-8')
      const markdown = cleanSubtitleToMarkdown(content, payload.videoInfo || {})

      return {
        success: true,
        markdown,
        subFileName: subFile,
      }
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
  })

  ipcMain.handle('dialog:selectDirectory', async (_event, title) => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: title || '选择下载保存文件夹',
    })
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  ipcMain.handle('shell:openFolder', async (_event, folderPath) => {
    if (folderPath && existsSync(folderPath)) {
      await shell.openPath(folderPath)
      return true
    }
    return false
  })

  // Video subtitle handlers
  ipcMain.handle('subtitle:checkEnv', async () => {
    const config = await loadSubtitleConfig()
    subtitleFfmpegCache = null
    const [whisper, ffmpeg] = await Promise.all([
      checkWhisperEnvironment({ pythonPath: config.pythonPath }),
      findSubtitleFfmpeg({ ffmpegPath: config.ffmpegPath }),
    ])
    subtitleFfmpegCache = ffmpeg
    // Remember the working interpreter so the next check skips the search.
    if (whisper.available && whisper.python !== config.pythonPath) {
      await saveSubtitleConfig({ pythonPath: whisper.python }).catch(() => {})
    }
    return { whisper, ffmpeg }
  })

  ipcMain.handle('subtitle:selectVideo', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      title: '选择要加字幕的视频',
      filters: [{ name: 'Videos', extensions: VIDEO_EXTENSIONS }, { name: 'All Files', extensions: ['*'] }],
    })
    if (result.canceled || !result.filePaths[0]) return null
    const videoPath = result.filePaths[0]
    const { ffprobe } = await getSubtitleFfmpeg()
    const probe = await probeVideo(ffprobe, videoPath)
    let project = null
    const projectPath = getProjectPath(videoPath)
    if (existsSync(projectPath)) {
      try {
        project = JSON.parse(await fs.readFile(projectPath, 'utf-8'))
      } catch (err) {
        console.error('Failed to read subtitle project:', err)
      }
    }
    return { videoPath, probe, project }
  })

  ipcMain.handle('subtitle:transcribe', async (event, payload = {}) => {
    if (activeSubtitleController) activeSubtitleController.cancel()
    const send = (channel, data) => {
      if (!event.sender.isDestroyed()) event.sender.send(channel, data)
    }
    const config = await loadSubtitleConfig()
    if (!config.pythonPath) throw new Error('还没有找到 faster-whisper，请先点“检查环境”。')
    const { ffmpeg } = await getSubtitleFfmpeg()
    const tempDir = path.join(app.getPath('temp'), `qf-asr-${randomUUID()}`)
    const audioPath = path.join(tempDir, 'audio.wav')
    const duration = Number(payload.duration) || 0
    let current = null
    let cancelled = false
    const controller = {
      cancel: () => {
        cancelled = true
        if (current) current.cancel()
      },
    }
    activeSubtitleController = controller

    try {
      await fs.mkdir(tempDir, { recursive: true })
      send('subtitle-progress', { stage: 'audio', percent: 0 })
      current = runFfmpeg(ffmpeg, buildExtractAudioArgs(payload.videoPath, audioPath), {
        duration,
        onProgress: ({ percent }) => send('subtitle-progress', { stage: 'audio', percent }),
      })
      const extracted = await current.promise
      if (cancelled || extracted.cancelled) return { cancelled: true }

      send('subtitle-progress', { stage: 'transcribe', percent: 0 })
      current = startTranscription({
        python: config.pythonPath,
        audioPath,
        model: config.model,
        device: payload.device,
        onLog: (line) => send('subtitle-log', line),
        onProgress: ({ seconds, segments }) => send('subtitle-progress', {
          stage: 'transcribe',
          percent: duration ? Math.min(100, (seconds / duration) * 100) : 0,
          segments,
        }),
      })
      const result = await current.promise
      if (cancelled || result.cancelled) return { cancelled: true }
      return {
        cancelled: false,
        device: result.device,
        language: result.info?.language || '',
        segments: result.segments,
      }
    } finally {
      if (activeSubtitleController === controller) activeSubtitleController = null
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
  })

  ipcMain.handle('subtitle:saveProject', async (_event, videoPath, project) => {
    const projectPath = getProjectPath(videoPath)
    await fs.writeFile(projectPath, JSON.stringify({ ...project, updatedAt: new Date().toISOString() }, null, 2), 'utf-8')
    return projectPath
  })

  ipcMain.handle('subtitle:exportSrt', async (_event, payload = {}) => {
    const outputPath = `${getOutputBase(payload.videoPath)}.${payload.mode}.srt`
    await fs.writeFile(outputPath, payload.content, 'utf-8')
    return outputPath
  })

  ipcMain.handle('subtitle:burn', async (event, payload = {}) => {
    if (activeSubtitleController) activeSubtitleController.cancel()
    const send = (channel, data) => {
      if (!event.sender.isDestroyed()) event.sender.send(channel, data)
    }
    const { ffmpeg, hasNvenc } = await getSubtitleFfmpeg()
    const outputPath = `${getOutputBase(payload.videoPath)}.${payload.mode}.subtitled.mp4`
    const controller = burnSubtitles({
      ffmpeg,
      hasNvenc,
      input: payload.videoPath,
      output: outputPath,
      assContent: payload.assContent,
      duration: Number(payload.duration) || 0,
      tempRoot: app.getPath('temp'),
      onProgress: ({ percent }) => send('subtitle-progress', { stage: 'burn', percent }),
      onLog: (line) => send('subtitle-log', line),
    })
    activeSubtitleController = controller
    try {
      const result = await controller.promise
      if (result.cancelled) {
        await fs.rm(outputPath, { force: true }).catch(() => {})
        return { cancelled: true }
      }
      return { cancelled: false, outputPath }
    } finally {
      if (activeSubtitleController === controller) activeSubtitleController = null
    }
  })

  ipcMain.handle('subtitle:cancel', async () => {
    if (!activeSubtitleController) return false
    activeSubtitleController.cancel()
    activeSubtitleController = null
    return true
  })

  ipcMain.handle('shell:showItem', async (_event, filePath) => {
    if (filePath && existsSync(filePath)) {
      shell.showItemInFolder(filePath)
      return true
    }
    return false
  })

  // Clipper handlers
  ipcMain.handle('clipper:getStatus', async () => {
    return getClipServerStatus()
  })

  ipcMain.handle('clipper:updateNotebooks', async (_event, notebooks) => {
    setCachedNotebooks(notebooks)
    return true
  })

  ipcMain.handle('clipper:openExtensionDir', async () => {
    const extDir = path.join(__dirname, '../chrome-extension')
    if (existsSync(extDir)) {
      await shell.openPath(extDir)
      return true
    }
    return false
  })

  // Start clip server
  startClipServer({
    onClip: async (payload) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('clipper:import-clip', payload)
        return {
          success: true,
          message: payload.title ? `已将「${payload.title.slice(0, 20)}」保存并推送到 QuizForge！` : '已推送到 QuizForge！',
        }
      }
      return { success: true, message: '已接收剪藏内容。' }
    },
  }).catch((err) => {
    console.error('Failed to start clip server:', err)
  })

  // AI 订阅 IPC 绑定
  const aiClient = (provider) => {
    const client = aiClients[provider]
    if (!client) throw new Error(`未知的 AI 订阅：${provider}`)
    return client
  }
  ipcMain.handle('ai:status', (_event, provider) => aiClient(provider).status())
  ipcMain.handle('ai:login', (_event, provider) => aiClient(provider).login())
  ipcMain.handle('ai:logout', (_event, provider) => aiClient(provider).logout())
  ipcMain.handle('ai:listModels', (_event, provider) => aiClient(provider).listModels())
  ipcMain.handle('ai:complete', (_event, provider, request) => aiClient(provider).complete(request))

  initReminders(ipcMain, () => mainWindow)

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  screenshotWatchProcess?.kill()
  // docling-serve runs uvicorn workers underneath, so this kills the tree.
  stopDoclingServe()
  activeYtdlpController?.cancel()
  stopClipServer()
})
