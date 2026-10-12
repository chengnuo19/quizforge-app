import { appendResource, createDocumentResource } from './resources.js'

function getApi() {
  if (typeof window === 'undefined') return null
  return window.ytdlp || null
}

export function canUseYtdlp() {
  const api = getApi()
  return (
    !!api &&
    typeof api.checkEnvironment === 'function' &&
    typeof api.fetchVideoInfo === 'function' &&
    typeof api.startDownload === 'function'
  )
}

export async function checkEnvironment(options = {}) {
  const api = getApi()
  if (!api) {
    return {
      ytdlp: { available: false, path: '', version: '', error: '仅在桌面版可用。' },
      ffmpeg: { available: false, path: '', version: '', error: '仅在桌面版可用。' },
    }
  }
  return await api.checkEnvironment(options)
}

export async function fetchVideoInfo(url, options = {}) {
  const api = getApi()
  if (!api) throw new Error('仅在桌面版可用。')
  return await api.fetchVideoInfo(url, options)
}

export async function startDownload(payload) {
  const api = getApi()
  if (!api) throw new Error('仅在桌面版可用。')
  return await api.startDownload(payload)
}

export async function cancelDownload() {
  const api = getApi()
  if (!api) return false
  return await api.cancelDownload()
}

export async function extractSubtitles(payload) {
  const api = getApi()
  if (!api) throw new Error('仅在桌面版可用。')
  return await api.extractSubtitles(payload)
}

export async function selectDirectory(title) {
  const api = getApi()
  if (!api) return null
  return await api.selectDirectory(title)
}

export async function openFolder(folderPath) {
  const api = getApi()
  if (!api) return false
  return await api.openFolder(folderPath)
}

export async function getYtdlpConfig() {
  const api = getApi()
  if (!api) {
    return {
      ytdlpPath: 'yt-dlp',
      ffmpegPath: 'ffmpeg',
      downloadDir: '',
      defaultSubLang: 'zh-Hans,zh,en',
      defaultAudioFormat: 'mp3',
      concurrentFragments: 5,
      proxy: '',
    }
  }
  return await api.getConfig()
}

export async function saveYtdlpConfig(config) {
  const api = getApi()
  if (!api) return config
  return await api.saveConfig(config)
}

export async function updateYtdlpBinary(options = {}) {
  const api = getApi()
  if (!api || typeof api.updateBinary !== 'function') {
    throw new Error('仅在桌面版可用。')
  }
  return await api.updateBinary(options)
}

export function onDownloadProgress(callback) {
  const api = getApi()
  if (!api || typeof api.onProgress !== 'function') return () => {}
  return api.onProgress(callback)
}

export function onDownloadLog(callback) {
  const api = getApi()
  if (!api || typeof api.onLog !== 'function') return () => {}
  return api.onLog(callback)
}

export function importSubtitleAsResource({
  markdown,
  videoInfo,
  notebookId,
  notebookName,
}) {
  const title = videoInfo?.title || '视频讲座逐字稿'
  const resource = createDocumentResource({
    notebookId,
    notebookName,
    title,
    markdown,
    sourcePath: videoInfo?.webpage_url || '',
    sourceSite: 'yt-dlp 视频提取',
  })
  if (videoInfo?.webpage_url) {
    resource.sourceUrl = videoInfo.webpage_url
  }

  appendResource(resource)
  return resource
}

export async function saveSubtitleMarkdownFile({ defaultFileName, markdown }) {
  if (typeof window !== 'undefined' && window.markitdown?.saveMarkdownFile) {
    return await window.markitdown.saveMarkdownFile({
      defaultFileName: defaultFileName || 'video-transcript.md',
      markdown,
    })
  }

  // Fallback for Web environment: trigger client-side download
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = defaultFileName || 'video-transcript.md'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  return { path: defaultFileName }
}
