const { execFile, spawn } = require('child_process')
const path = require('path')

const DEFAULT_WHISPER_MODEL = 'large-v3-turbo'
const CHECK_TIMEOUT_MS = 60000

// Packaged builds keep the script in app.asar.unpacked (see build.asarUnpack),
// because Python cannot read files from inside an asar archive.
function getTranscribeScriptPath(dirname = __dirname) {
  return path.join(dirname, 'scripts', 'transcribe.py').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep)
}

function parseJsonLine(line) {
  const text = String(line || '').trim()
  if (!text.startsWith('{')) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function buildTranscribeArgs(scriptPath, audioPath, options = {}) {
  return [
    scriptPath,
    audioPath,
    '--model',
    options.model || DEFAULT_WHISPER_MODEL,
    '--device',
    options.device === 'cpu' ? 'cpu' : 'cuda',
    '--language',
    options.language || 'auto',
  ]
}

const PYTHON_ENV = { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }

function execFilePromise(execFileImpl, file, args, timeout) {
  return new Promise((resolve) => {
    execFileImpl(
      file,
      args,
      { timeout, windowsHide: true, env: { ...process.env, ...PYTHON_ENV } },
      (error, stdout) => resolve({ error, stdout: String(stdout || '') }),
    )
  })
}

// `py -0p` lists every interpreter the Windows launcher knows about, e.g.
//  -V:3.12          C:\...\Python312\python.exe
function parsePyLauncherList(stdout) {
  return String(stdout || '')
    .split(/\r?\n/)
    .map((line) => line.match(/([A-Za-z]:\\.+?python(?:w)?\.exe)\s*$/i))
    .filter(Boolean)
    .map((match) => match[1])
}

async function listPythonCandidates(options = {}) {
  const env = options.env || process.env
  const execFileImpl = options.execFileImpl || execFile
  const candidates = []
  if (options.pythonPath && String(options.pythonPath).trim()) candidates.push(String(options.pythonPath).trim())
  if (env.WHISPER_PYTHON && String(env.WHISPER_PYTHON).trim()) candidates.push(String(env.WHISPER_PYTHON).trim())
  if (process.platform === 'win32' || options.forcePyLauncher) {
    const { stdout } = await execFilePromise(execFileImpl, 'py', ['-0p'], 8000)
    candidates.push(...parsePyLauncherList(stdout))
  }
  candidates.push('python', 'python3')
  return [...new Set(candidates)]
}

// Walk the candidates and keep the first interpreter where faster-whisper imports.
async function checkWhisperEnvironment(options = {}) {
  const execFileImpl = options.execFileImpl || execFile
  const scriptPath = options.scriptPath || getTranscribeScriptPath()
  const candidates = await listPythonCandidates(options)
  const tried = []

  for (const python of candidates) {
    const { stdout } = await execFilePromise(execFileImpl, python, [scriptPath, '--check'], CHECK_TIMEOUT_MS)
    const result = stdout.split(/\r?\n/).map(parseJsonLine).find((item) => item && item.type === 'check')
    if (result && result.ok) {
      return {
        available: true,
        python,
        version: result.version || '',
        cudaDevices: Number(result.cudaDevices) || 0,
        error: '',
      }
    }
    tried.push(python)
  }

  return {
    available: false,
    python: '',
    version: '',
    cudaDevices: 0,
    error: `没有找到装了 faster-whisper 的 Python（已尝试：${tried.join('、') || '无'}）。`,
  }
}

function runTranscribeOnce(options, device, state) {
  const spawnImpl = options.spawnImpl || spawn
  const args = buildTranscribeArgs(options.scriptPath || getTranscribeScriptPath(), options.audioPath, {
    ...options,
    device,
  })
  const onLog = options.onLog || (() => {})
  const onProgress = options.onProgress || (() => {})

  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawnImpl(options.python, args, {
        windowsHide: true,
        shell: false,
        env: { ...process.env, ...PYTHON_ENV },
      })
    } catch (err) {
      return reject(new Error(`启动识别进程失败: ${err.message}`))
    }
    state.child = child

    const segments = []
    let info = null
    let errorMessage = ''
    let stderr = ''
    let buffer = ''

    const handleLine = (line) => {
      const msg = parseJsonLine(line)
      if (!msg) {
        if (line.trim()) onLog(line)
        return
      }
      if (msg.type === 'info') {
        info = msg
        onLog(`识别设备：${msg.device === "cuda" ? "GPU" : "CPU"}，开始逐句识别`)
      } else if (msg.type === 'segment') {
        segments.push({ start: msg.start, end: msg.end, lang: msg.lang, text: msg.text, words: msg.words || [] })
      } else if (msg.type === 'progress') {
        onProgress({ seconds: msg.t, duration: info ? info.duration : 0, segments: segments.length })
      } else if (msg.type === 'warn') {
        onLog(msg.message)
      } else if (msg.type === 'error') {
        errorMessage = msg.message
      }
    }

    child.stdout?.on('data', (chunk) => {
      buffer += chunk.toString('utf-8')
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop()
      lines.forEach(handleLine)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString('utf-8')
    })
    child.on('error', (err) => {
      if (state.cancelled) return
      reject(new Error(`识别进程发生错误: ${err.message}`))
    })
    child.on('close', (code) => {
      if (buffer) handleLine(buffer)
      if (state.cancelled) return resolve({ cancelled: true })
      if (code === 0 && !errorMessage) {
        return resolve({ cancelled: false, device, info, segments })
      }
      const detail = errorMessage || stderr.trim().split(/\r?\n/).slice(-3).join('\n') || `退出码 ${code}`
      const error = new Error(`语音识别失败: ${detail}`)
      error.segmentCount = segments.length
      reject(error)
    })
  })
}

// Runs on CUDA first; if the GPU path dies before producing anything (missing
// cuDNN, unsupported card), retries once on CPU instead of failing the job.
function startTranscription(options = {}) {
  const state = { child: null, cancelled: false }
  const device = options.device === 'cpu' ? 'cpu' : 'cuda'
  const onLog = options.onLog || (() => {})

  const promise = runTranscribeOnce(options, device, state).catch((error) => {
    if (state.cancelled) return { cancelled: true }
    if (device === 'cuda' && !error.segmentCount) {
      onLog(`GPU 识别失败，改用 CPU 重试（会慢很多）。原因：${error.message}`)
      return runTranscribeOnce(options, 'cpu', state)
    }
    throw error
  })

  return {
    promise,
    cancel: () => {
      state.cancelled = true
      if (state.child && !state.child.killed) state.child.kill()
    },
  }
}

module.exports = {
  DEFAULT_WHISPER_MODEL,
  getTranscribeScriptPath,
  parseJsonLine,
  buildTranscribeArgs,
  parsePyLauncherList,
  listPythonCandidates,
  checkWhisperEnvironment,
  startTranscription,
}
