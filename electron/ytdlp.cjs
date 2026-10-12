const { execFile, spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const fsPromises = require('fs/promises')

const DEFAULT_YTDLP_PATH = 'yt-dlp'
const DEFAULT_FFMPEG_PATH = 'ffmpeg'

const YTDLP_INFO_TIMEOUT_MS = 60000
const YTDLP_INFO_MAX_BUFFER = 20 * 1024 * 1024

function getYtdlpPath(customPath, env = process.env) {
  if (customPath && String(customPath).trim()) {
    return String(customPath).trim()
  }
  if (env.YTDLP_BIN && String(env.YTDLP_BIN).trim()) {
    return String(env.YTDLP_BIN).trim()
  }
  return DEFAULT_YTDLP_PATH
}

function getFfmpegPath(customPath, env = process.env, existsSyncImpl = fs.existsSync) {
  if (customPath && String(customPath).trim()) {
    return String(customPath).trim()
  }
  if (env.FFMPEG_BIN && String(env.FFMPEG_BIN).trim()) {
    return String(env.FFMPEG_BIN).trim()
  }
  if (existsSyncImpl(DEFAULT_FFMPEG_PATH)) {
    return DEFAULT_FFMPEG_PATH
  }
  return 'ffmpeg'
}

function formatDuration(seconds) {
  if (!seconds || isNaN(seconds) || seconds < 0) return '00:00'
  const sec = Math.floor(seconds)
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) {
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

function checkEnvironment(options = {}) {
  const ytdlpPath = getYtdlpPath(options.ytdlpPath, options.env)
  const ffmpegPath = getFfmpegPath(options.ffmpegPath, options.env, options.fsExistsImpl)
  const execFileImpl = options.execFileImpl || execFile
  const existsSyncImpl = options.fsExistsImpl || fs.existsSync

  return new Promise((resolve) => {
    const result = {
      ytdlp: { available: false, path: ytdlpPath, version: '', error: '' },
      ffmpeg: { available: false, path: ffmpegPath, version: '', error: '' },
    }

    const checkYtdlp = new Promise((resYt) => {
      const isCustomOrRelative = ytdlpPath.includes(path.sep) || ytdlpPath.includes('/')
      if (isCustomOrRelative && !existsSyncImpl(ytdlpPath)) {
        result.ytdlp.error = `yt-dlp 文件未找到: ${ytdlpPath}`
        return resYt()
      }

      execFileImpl(
        ytdlpPath,
        ['--version'],
        { timeout: 8000, windowsHide: true },
        (error, stdout) => {
          if (error) {
            result.ytdlp.error = error.message
          } else {
            result.ytdlp.available = true
            result.ytdlp.version = String(stdout || '').trim()
          }
          resYt()
        }
      )
    })

    const checkFfmpeg = new Promise((resFfmpeg) => {
      const isCustomOrRelative = ffmpegPath.includes(path.sep) || ffmpegPath.includes('/')
      if (isCustomOrRelative && !existsSyncImpl(ffmpegPath)) {
        result.ffmpeg.error = `ffmpeg 文件未找到: ${ffmpegPath}`
        return resFfmpeg()
      }

      execFileImpl(
        ffmpegPath,
        ['-version'],
        { timeout: 8000, windowsHide: true },
        (error, stdout) => {
          if (error) {
            result.ffmpeg.error = error.message
          } else {
            result.ffmpeg.available = true
            const firstLine = String(stdout || '').split(/\r?\n/)[0] || ''
            result.ffmpeg.version = firstLine.trim()
          }
          resFfmpeg()
        }
      )
    })

    Promise.all([checkYtdlp, checkFfmpeg]).then(() => resolve(result))
  })
}

function parseProgressLine(rawLine) {
  const line = String(rawLine || '').trim()
  if (!line) return null

  // 100% completed
  // Example: [download] 100% of 15.00MiB in 00:02
  const finishedMatch = line.match(
    /\[download\]\s+100(?:\.0+)?%\s+of\s+~?([0-9.]+[A-Za-z]+)(?:\s+in\s+(\d{2}:\d{2}))?/
  )
  if (finishedMatch) {
    return {
      status: 'finished',
      percent: 100,
      totalSize: finishedMatch[1] || '',
      speed: '',
      eta: '00:00',
      raw: line,
    }
  }

  // Example: [download]  45.2% of ~120.34MiB at 4.25MiB/s ETA 00:15
  // Example: [download]  10.0% of 50.00MiB at 1.20MiB/s ETA 01:20
  const match = line.match(
    /\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+~?([0-9.]+[A-Za-z]+)(?:\s+at\s+([0-9.]+[A-Za-z/]+))?(?:\s+ETA\s+(\d{2}:\d{2}(?::\d{2})?))?/
  )
  if (match) {
    const percent = parseFloat(match[1])
    return {
      status: percent >= 100 ? 'finished' : 'downloading',
      percent,
      totalSize: match[2] || '',
      speed: match[3] || '',
      eta: match[4] || (percent >= 100 ? '00:00' : ''),
      raw: line,
    }
  }

  if (line.startsWith('[ExtractAudio]')) {
    return { status: 'extracting-audio', percent: 100, raw: line }
  }
  if (line.startsWith('[Merger]')) {
    return { status: 'merging', percent: 99, raw: line }
  }
  if (line.startsWith('[info]') || line.startsWith('[download] Destination:')) {
    return { status: 'processing', raw: line }
  }

  return { status: 'log', raw: line }
}

function buildDownloadArgs(options = {}) {
  const {
    url,
    mode = 'video',
    outputDir,
    outputTemplate,
    format,
    audioFormat = 'mp3',
    subLang = 'zh-Hans,zh,en',
    ffmpegPath,
    concurrentFragments = 5,
    proxy,
  } = options

  if (!url || !String(url).trim()) {
    throw new Error('Video URL is required.')
  }

  const args = ['--newline', '--no-colors', '--no-playlist', '--encoding', 'utf-8']

  if (ffmpegPath && String(ffmpegPath).trim()) {
    args.push('--ffmpeg-location', String(ffmpegPath).trim())
  }

  if (outputDir && String(outputDir).trim()) {
    args.push('-P', String(outputDir).trim())
  }

  const fragments = Number(concurrentFragments)
  if (fragments && fragments > 1) {
    args.push('--concurrent-fragments', String(fragments))
  }

  if (proxy && String(proxy).trim()) {
    args.push('--proxy', String(proxy).trim())
  }

  const template = outputTemplate || '%(title)s [%(id)s].%(ext)s'
  args.push('-o', template)

  if (mode === 'audio') {
    args.push('-x', '--audio-format', audioFormat || 'mp3', '--audio-quality', '0')
  } else if (mode === 'subtitles') {
    args.push(
      '--write-sub',
      '--write-auto-sub',
      '--sub-lang',
      subLang || 'zh-Hans,zh,en',
      '--sub-format',
      'vtt/srt/best',
      '--skip-download'
    )
  } else {
    // video mode
    if (format && format !== 'best') {
      args.push('-f', format)
    } else {
      args.push('-f', 'bestvideo+bestaudio/best')
    }
    args.push('--merge-output-format', 'mp4')
  }

  args.push(String(url).trim())
  return args
}

function extractSubtitleLanguages(subtitles = {}, autoCaptions = {}) {
  const map = new Map()

  if (subtitles && typeof subtitles === 'object') {
    for (const [code, items] of Object.entries(subtitles)) {
      const name = items?.[0]?.name || code
      map.set(code, { code, name, isAuto: false })
    }
  }

  if (autoCaptions && typeof autoCaptions === 'object') {
    for (const [code, items] of Object.entries(autoCaptions)) {
      if (!map.has(code)) {
        const name = (items?.[0]?.name || code) + ' (自动生成)'
        map.set(code, { code, name, isAuto: true })
      }
    }
  }

  return Array.from(map.values())
}

function extractUsefulFormats(rawFormats = []) {
  if (!Array.isArray(rawFormats)) return []

  const standardChoices = [
    { id: 'best', label: '最佳画质与音质 (推荐)', height: 9999 },
    { id: '1080p', label: '1080p 全高清', height: 1080 },
    { id: '720p', label: '720p 高清', height: 720 },
    { id: '480p', label: '480p 标清', height: 480 },
    { id: '360p', label: '360p 流畅', height: 360 },
  ]

  const availableHeights = new Set()
  for (const f of rawFormats) {
    if (f.height && typeof f.height === 'number') {
      availableHeights.add(f.height)
    }
  }

  return standardChoices.filter(choice => {
    if (choice.id === 'best') return true
    return Array.from(availableHeights).some(h => Math.abs(h - choice.height) < 40)
  })
}

function fetchVideoInfo(url, options = {}) {
  const selectedUrl = String(url || '').trim()
  if (!selectedUrl) {
    return Promise.reject(new Error('Video URL cannot be empty.'))
  }

  const ytdlpPath = getYtdlpPath(options.ytdlpPath, options.env)
  const execFileImpl = options.execFileImpl || execFile

  const args = [
    '--dump-single-json',
    '--skip-download',
    '--no-warnings',
    '--no-playlist',
  ]

  if (options.proxy && String(options.proxy).trim()) {
    args.push('--proxy', String(options.proxy).trim())
  }

  args.push(selectedUrl)

  return new Promise((resolve, reject) => {
    execFileImpl(
      ytdlpPath,
      args,
      {
        timeout: options.timeout || YTDLP_INFO_TIMEOUT_MS,
        maxBuffer: options.maxBuffer || YTDLP_INFO_MAX_BUFFER,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr || error.message || '').trim()
          reject(new Error(detail ? `解析视频失败: ${detail}` : '解析视频信息失败。'))
          return
        }

        try {
          const data = JSON.parse(stdout)
          const info = {
            id: data.id || '',
            title: data.title || '未命名视频',
            duration: data.duration || 0,
            durationFormatted: formatDuration(data.duration || 0),
            uploader: data.uploader || data.channel || data.creator || '未知作者',
            thumbnail: data.thumbnail || '',
            webpage_url: data.webpage_url || selectedUrl,
            description: String(data.description || '').slice(0, 500),
            formats: extractUsefulFormats(data.formats),
            subtitles: extractSubtitleLanguages(data.subtitles, data.automatic_captions),
          }
          resolve(info)
        } catch (parseErr) {
          reject(new Error(`解析视频返回数据失败: ${parseErr.message}`))
        }
      }
    )
  })
}

function cleanSubtitleToMarkdown(subtitleContent, videoInfo = {}) {
  const raw = String(subtitleContent || '')
  if (!raw.trim()) {
    return '# 无字幕内容\n\n该视频未检测到字幕文本。'
  }

  const lines = raw.split(/\r?\n/)
  const cleanedLines = []
  let lastLine = ''

  for (let line of lines) {
    line = line.trim()
    if (!line) continue

    // WebVTT headers
    if (line.startsWith('WEBVTT') || line.startsWith('Kind:') || line.startsWith('Language:') || line.startsWith('Style:')) {
      continue
    }

    // Numbered line / cue index (SRT)
    if (/^\d+$/.test(line)) {
      continue
    }

    // Timestamps line: e.g. 00:00:01.000 --> 00:00:04.000 or 00:01,000 --> 00:04,000
    if (/\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3}\s*-->\s*\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3}/.test(line)) {
      continue
    }

    // Strip HTML tags and cue tags
    let cleaned = line.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()
    if (!cleaned) continue

    // Avoid duplicate adjacent lines (common in rolling auto-subtitles)
    if (cleaned === lastLine) continue

    cleanedLines.push(cleaned)
    lastLine = cleaned
  }

  // Group sentences into readable paragraphs (approx every 3-5 sentences or 120 chars)
  const paragraphs = []
  let currentPara = []
  let currentLength = 0

  for (const sentence of cleanedLines) {
    currentPara.push(sentence)
    currentLength += sentence.length

    const isEndingPunctuation = /[。！？!?…]$/.test(sentence)
    if ((isEndingPunctuation && currentLength >= 60) || currentLength >= 150) {
      paragraphs.push(currentPara.join(' '))
      currentPara = []
      currentLength = 0
    }
  }

  if (currentPara.length > 0) {
    paragraphs.push(currentPara.join(' '))
  }

  const title = videoInfo.title || '视频讲座文稿'
  const url = videoInfo.webpage_url || ''
  const uploader = videoInfo.uploader || ''
  const duration = videoInfo.durationFormatted || ''

  const headerLines = [
    `# ${title}`,
    '',
    uploader ? `- **讲师/作者**：${uploader}` : null,
    duration ? `- **视频时长**：${duration}` : null,
    url ? `- **原始链接**：${url}` : null,
    '',
    '---',
    '',
    '## 讲座字幕与逐字稿',
    '',
  ].filter(line => line !== null)

  return `${headerLines.join('\n')}\n${paragraphs.join('\n\n')}\n`
}

function startDownloadProcess(options = {}) {
  const ytdlpPath = getYtdlpPath(options.ytdlpPath, options.env)
  const ffmpegPath = getFfmpegPath(options.ffmpegPath, options.env, options.fsExistsImpl)
  const spawnImpl = options.spawnImpl || spawn

  const args = buildDownloadArgs({
    ...options,
    ffmpegPath: options.ffmpegAvailable !== false ? ffmpegPath : undefined,
  })

  let childProcess = null
  let isCancelled = false

  const promise = new Promise((resolve, reject) => {
    try {
      childProcess = spawnImpl(ytdlpPath, args, {
        windowsHide: true,
        shell: false,
      })
    } catch (err) {
      return reject(new Error(`启动下载进程失败: ${err.message}`))
    }

    const onProgress = options.onProgress || (() => {})
    const onLog = options.onLog || (() => {})

    let lastProgress = null
    let errorOutput = ''

    const handleData = (chunk) => {
      const text = chunk.toString('utf-8')
      const lines = text.split(/\r?\n/)
      for (const line of lines) {
        if (!line.trim()) continue
        onLog(line)
        const parsed = parseProgressLine(line)
        if (parsed) {
          if (parsed.status === 'downloading' || parsed.status === 'finished') {
            lastProgress = parsed
          }
          onProgress(parsed)
        }
      }
    }

    childProcess.stdout?.on('data', handleData)
    childProcess.stderr?.on('data', (chunk) => {
      const text = chunk.toString('utf-8')
      errorOutput += text
      handleData(chunk)
    })

    childProcess.on('error', (err) => {
      if (isCancelled) return
      reject(new Error(`下载进程发生错误: ${err.message}`))
    })

    childProcess.on('close', (code) => {
      if (isCancelled) {
        return resolve({ cancelled: true, message: '用户已取消下载。' })
      }
      if (code === 0) {
        resolve({
          success: true,
          cancelled: false,
          progress: lastProgress || { percent: 100, status: 'finished' },
        })
      } else {
        const msg = errorOutput.trim() || `进程异常退出，退出码: ${code}`
        reject(new Error(`下载失败: ${msg}`))
      }
    })
  })

  return {
    promise,
    cancel: () => {
      isCancelled = true
      if (childProcess && !childProcess.killed) {
        childProcess.kill()
      }
    },
  }
}

function updateYtdlpBinary(options = {}) {
  const ytdlpPath = getYtdlpPath(options.ytdlpPath, options.env)
  const execFileImpl = options.execFileImpl || execFile

  const args = ['-U']
  if (options.proxy && String(options.proxy).trim()) {
    args.push('--proxy', String(options.proxy).trim())
  }

  return new Promise((resolve, reject) => {
    execFileImpl(
      ytdlpPath,
      args,
      { timeout: 60000, windowsHide: true },
      (error, stdout, stderr) => {
        const fullOutput = `${stdout || ''}\n${stderr || ''}`.trim()
        if (error) {
          return reject(new Error(fullOutput || error.message || '更新 yt-dlp 失败'))
        }

        execFileImpl(
          ytdlpPath,
          ['--version'],
          { timeout: 8000, windowsHide: true },
          (_vErr, vOut) => {
            const version = String(vOut || '').trim()
            resolve({
              success: true,
              output: fullOutput,
              version,
            })
          }
        )
      }
    )
  })
}

module.exports = {
  DEFAULT_YTDLP_PATH,
  DEFAULT_FFMPEG_PATH,
  getYtdlpPath,
  getFfmpegPath,
  formatDuration,
  checkEnvironment,
  parseProgressLine,
  buildDownloadArgs,
  extractSubtitleLanguages,
  extractUsefulFormats,
  fetchVideoInfo,
  cleanSubtitleToMarkdown,
  startDownloadProcess,
  updateYtdlpBinary,
}
