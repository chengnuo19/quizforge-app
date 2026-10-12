const { execFile, spawn } = require('child_process')
const path = require('path')
const os = require('os')
const fsp = require('fs/promises')

const VIDEO_EXTENSIONS = ['mp4', 'mov', 'mkv', 'webm', 'avi', 'flv', 'm4v', 'ts']

function execFilePromise(execFileImpl, file, args, options = {}) {
  return new Promise((resolve) => {
    execFileImpl(
      file,
      args,
      { timeout: options.timeout || 20000, windowsHide: true, maxBuffer: 20 * 1024 * 1024 },
      (error, stdout, stderr) => resolve({ error, stdout: String(stdout || ''), stderr: String(stderr || '') }),
    )
  })
}

function siblingFfprobe(ffmpegPath) {
  if (!ffmpegPath.includes('/') && !ffmpegPath.includes('\\')) return 'ffprobe'
  const ext = path.extname(ffmpegPath)
  return path.join(path.dirname(ffmpegPath), `ffprobe${ext}`)
}

// The ffmpeg yt-dlp uses here is a stripped build without libass, so it cannot
// burn subtitles. Only accept a binary whose filter list includes `subtitles`.
async function findSubtitleFfmpeg(options = {}) {
  const env = options.env || process.env
  const execFileImpl = options.execFileImpl || execFile
  const candidates = []
  if (options.ffmpegPath && String(options.ffmpegPath).trim()) candidates.push(String(options.ffmpegPath).trim())
  if (env.FFMPEG_BIN && String(env.FFMPEG_BIN).trim()) candidates.push(String(env.FFMPEG_BIN).trim())
  candidates.push('ffmpeg')

  for (const ffmpeg of [...new Set(candidates)]) {
    const filters = await execFilePromise(execFileImpl, ffmpeg, ['-hide_banner', '-filters'])
    if (filters.error || !/^\s*\S+\s+subtitles\s/m.test(filters.stdout)) continue
    const encoders = await execFilePromise(execFileImpl, ffmpeg, ['-hide_banner', '-encoders'])
    return {
      available: true,
      ffmpeg,
      ffprobe: siblingFfprobe(ffmpeg),
      hasNvenc: /\bh264_nvenc\b/.test(encoders.stdout),
      error: '',
    }
  }

  return {
    available: false,
    ffmpeg: '',
    ffprobe: '',
    hasNvenc: false,
    error: '没有找到支持字幕烧录（libass）的 ffmpeg。请安装完整版：winget install Gyan.FFmpeg',
  }
}

function parseProbeJson(stdout) {
  const data = JSON.parse(stdout)
  const video = (data.streams || []).find((s) => s.codec_type === 'video')
  if (!video) throw new Error('文件里没有视频流。')
  let width = Number(video.width) || 0
  let height = Number(video.height) || 0
  const sideRotation = (video.side_data_list || []).find((d) => d.rotation !== undefined)
  const rotation = Number(sideRotation ? sideRotation.rotation : video.tags?.rotate) || 0
  if (Math.abs(rotation) % 180 === 90) [width, height] = [height, width]
  const duration = Number(data.format?.duration) || Number(video.duration) || 0
  const hasAudio = (data.streams || []).some((s) => s.codec_type === 'audio')
  return { width, height, duration, hasAudio }
}

async function probeVideo(ffprobe, filePath, options = {}) {
  const execFileImpl = options.execFileImpl || execFile
  const { error, stdout, stderr } = await execFilePromise(
    execFileImpl,
    ffprobe,
    ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', filePath],
    { timeout: 30000 },
  )
  if (error) throw new Error(`读取视频信息失败: ${stderr.trim() || error.message}`)
  return parseProbeJson(stdout)
}

function parseFfmpegTime(line) {
  const match = String(line || '').match(/time=(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/)
  if (!match) return null
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
}

function runFfmpeg(ffmpeg, args, options = {}) {
  const spawnImpl = options.spawnImpl || spawn
  const onProgress = options.onProgress || (() => {})
  const state = { child: null, cancelled: false }

  const promise = new Promise((resolve, reject) => {
    try {
      state.child = spawnImpl(ffmpeg, args, { windowsHide: true, shell: false, cwd: options.cwd })
    } catch (err) {
      return reject(new Error(`启动 ffmpeg 失败: ${err.message}`))
    }
    let stderr = ''
    state.child.stderr?.on('data', (chunk) => {
      const text = chunk.toString('utf-8')
      stderr = (stderr + text).slice(-8000)
      for (const line of text.split(/\r|\n/)) {
        const seconds = parseFfmpegTime(line)
        if (seconds !== null) {
          const percent = options.duration ? Math.min(100, (seconds / options.duration) * 100) : 0
          onProgress({ seconds, percent })
        }
      }
    })
    state.child.on('error', (err) => {
      if (!state.cancelled) reject(new Error(`ffmpeg 发生错误: ${err.message}`))
    })
    state.child.on('close', (code) => {
      if (state.cancelled) return resolve({ cancelled: true })
      if (code === 0) return resolve({ cancelled: false })
      const tail = stderr.trim().split(/\r?\n/).slice(-4).join('\n')
      reject(new Error(`ffmpeg 退出码 ${code}: ${tail}`))
    })
  })

  return {
    promise,
    cancel: () => {
      state.cancelled = true
      if (state.child && !state.child.killed) state.child.kill()
    },
  }
}

function buildExtractAudioArgs(input, output) {
  return ['-y', '-hide_banner', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-f', 'wav', output]
}

function buildBurnArgs({ input, assName, output, encoder }) {
  const video = encoder === 'nvenc'
    ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', '21', '-b:v', '0']
    : ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20']
  return [
    '-y',
    '-hide_banner',
    '-i',
    input,
    '-map',
    '0:v:0',
    '-map',
    '0:a?',
    '-vf',
    `subtitles=${assName}`,
    ...video,
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    output,
  ]
}

// libass's filter argument chokes on drive-letter colons and some non-ASCII
// paths, so the .ass is written into a temp dir and referenced by bare name
// with that dir as ffmpeg's cwd.
function burnSubtitles(options = {}) {
  const onLog = options.onLog || (() => {})
  const state = { current: null, cancelled: false }
  const tempDir = path.join(options.tempRoot || os.tmpdir(), `qf-burn-${Date.now()}`)
  const assName = 'subs.ass'

  const runWith = (encoder) => {
    const ctrl = runFfmpeg(
      options.ffmpeg,
      buildBurnArgs({ input: options.input, assName, output: options.output, encoder }),
      { cwd: tempDir, duration: options.duration, onProgress: options.onProgress, spawnImpl: options.spawnImpl },
    )
    state.current = ctrl
    return ctrl.promise
  }

  const promise = (async () => {
    await fsp.mkdir(tempDir, { recursive: true })
    await fsp.writeFile(path.join(tempDir, assName), options.assContent, 'utf-8')
    try {
      if (options.hasNvenc) {
        try {
          return await runWith('nvenc')
        } catch (err) {
          if (state.cancelled) return { cancelled: true }
          onLog(`显卡编码失败，改用 CPU 编码（libx264）。原因：${err.message}`)
        }
      }
      return await runWith('x264')
    } finally {
      await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
  })()

  return {
    promise,
    cancel: () => {
      state.cancelled = true
      if (state.current) state.current.cancel()
    },
  }
}

function getProjectPath(videoPath) {
  const parsed = path.parse(videoPath)
  return path.join(parsed.dir, `${parsed.name}.subtitles.json`)
}

function getOutputBase(videoPath) {
  const parsed = path.parse(videoPath)
  return path.join(parsed.dir, parsed.name)
}

module.exports = {
  VIDEO_EXTENSIONS,
  findSubtitleFfmpeg,
  parseProbeJson,
  probeVideo,
  parseFfmpegTime,
  runFfmpeg,
  buildExtractAudioArgs,
  buildBurnArgs,
  burnSubtitles,
  getProjectPath,
  getOutputBase,
}
