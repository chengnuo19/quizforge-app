const { spawn } = require('child_process')
const fsp = require('fs/promises')
const path = require('path')

// Persistent Docling service.
//
// The `docling` CLI pays ~35s importing docling.document_converter on EVERY
// invocation — measured at 34-36s across three cold and warm runs, so it is
// real import work, not a cold disk. docling-serve pays that once at boot and
// then reuses a warm converter: measured 53.1s per document via the CLI versus
// 8.1-10.2s over HTTP.
//
// Boot costs ~45-50s, so the server is started lazily on the first Docling
// conversion rather than at app launch — a session that never touches Docling
// never pays for it, and the first conversion is roughly at CLI parity.

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 5001
const READY_TIMEOUT_MS = 5 * 60 * 1000
const READY_POLL_MS = 1000
const CONVERT_TIMEOUT_MS = 30 * 60 * 1000

let serverProcess = null
let serverUrl = null
let startPromise = null

function getDoclingServeCommand(env = process.env) {
  // uv only shims the primary package's entry points, so `docling-serve`
  // installed via `uv tool install docling --with docling-serve` is NOT on
  // PATH — point DOCLING_SERVE_BIN at the tool's Scripts directory instead.
  if (env.DOCLING_SERVE_BIN) return env.DOCLING_SERVE_BIN
  return 'docling-serve'
}

function buildServeArgs({ host = DEFAULT_HOST, port = DEFAULT_PORT, artifactsPath = '' } = {}) {
  const args = ['run', '--host', host, '--port', String(port)]
  // Left unset by default: docling-serve resolves weights through the
  // HuggingFace cache on its own, and a wrong path here breaks a working setup.
  if (artifactsPath) args.push('--artifacts-path', artifactsPath)
  return args
}

function buildServiceUrl({ host = DEFAULT_HOST, port = DEFAULT_PORT } = {}) {
  return `http://${host}:${port}`
}

function formatServeError(error) {
  if (error && error.code === 'ENOENT') {
    return new Error(
      'docling-serve was not found. Install it with pip install docling-serve, or set DOCLING_SERVE_BIN to the executable path.'
    )
  }
  return error instanceof Error ? error : new Error(String(error || 'docling-serve failed.'))
}

// Windows kill() only reaps the direct child; docling-serve runs uvicorn, whose
// workers would survive and keep holding the port. /T takes the whole tree.
function killProcessTree(child, options = {}) {
  const platform = options.platform || process.platform
  const spawnImpl = options.spawnImpl || spawn
  if (!child) return
  if (platform === 'win32' && child.pid) {
    try {
      spawnImpl('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
      return
    } catch {
      // Fall through to the portable signal below.
    }
  }
  try {
    child.kill()
  } catch {
    // Already gone.
  }
}

async function isReady(url, options = {}) {
  const fetchImpl = options.fetchImpl || fetch
  try {
    const response = await fetchImpl(`${url}/health`)
    return !!(response && response.ok)
  } catch {
    return false
  }
}

function delay(ms, timerImpl = setTimeout) {
  return new Promise((resolve) => timerImpl(resolve, ms))
}

async function waitUntilReady(url, options = {}) {
  const timeoutMs = options.readyTimeoutMs || READY_TIMEOUT_MS
  const pollMs = options.readyPollMs || READY_POLL_MS
  const now = options.now || (() => Date.now())
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null

  const deadline = now() + timeoutMs
  let announced = false
  while (now() < deadline) {
    if (await isReady(url, options)) return true
    if (onProgress && !announced) {
      announced = true
      onProgress('正在启动 Docling 服务（首次约需 1 分钟）…')
    }
    await delay(pollMs, options.timerImpl)
  }
  return false
}

async function startDoclingServe(options = {}) {
  const spawnImpl = options.spawnImpl || spawn
  const command = getDoclingServeCommand(options.env || process.env)
  const args = buildServeArgs(options)
  const url = buildServiceUrl(options)

  let child
  try {
    child = spawnImpl(command, args, {
      shell: false,
      windowsHide: true,
      // Same reason as docling.cjs: without this the server's own logs come
      // back in the Windows ANSI codepage and its help/emoji output crashes.
      env: {
        ...(options.env || process.env),
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
      },
    })
  } catch (error) {
    throw formatServeError(error)
  }

  let spawnError = null
  child.once('error', (error) => {
    spawnError = formatServeError(error)
  })
  child.once('exit', () => {
    if (serverProcess === child) {
      serverProcess = null
      serverUrl = null
    }
  })

  const ready = await waitUntilReady(url, options)
  if (spawnError) {
    killProcessTree(child, options)
    throw spawnError
  }
  if (!ready) {
    killProcessTree(child, options)
    throw new Error('docling-serve did not become ready in time.')
  }

  serverProcess = child
  serverUrl = url
  return url
}

// Returns the base URL of a ready server, starting one if needed. Concurrent
// callers share a single boot rather than racing two servers onto one port.
function ensureDoclingServe(options = {}) {
  if (serverProcess && serverUrl) return Promise.resolve(serverUrl)
  if (startPromise) return startPromise
  startPromise = startDoclingServe(options).finally(() => {
    startPromise = null
  })
  return startPromise
}

async function convertWithDoclingServe(filePath, options = {}) {
  const selectedPath = String(filePath || '').trim()
  if (!selectedPath) {
    throw new Error('No document file was selected.')
  }

  const fetchImpl = options.fetchImpl || fetch
  const readFile = options.readFile || fsp.readFile
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null

  const url = options.url || (await ensureDoclingServe(options))
  if (onProgress) onProgress('正在转换…')

  const bytes = await readFile(selectedPath)
  const form = new FormData()
  form.append('files', new Blob([bytes]), path.basename(selectedPath))
  form.append('to_formats', 'md')
  // The service defaults do_ocr to true, unlike the CLI's --no-ocr default.
  form.append('do_ocr', options.ocr ? 'true' : 'false')

  const response = await fetchImpl(`${url}/v1/convert/file`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(options.convertTimeoutMs || CONVERT_TIMEOUT_MS),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(
      `docling-serve returned ${response.status}${detail ? `: ${detail.slice(0, 500)}` : ''}`
    )
  }

  const payload = await response.json()
  if (payload && payload.status && payload.status !== 'success') {
    const errors = Array.isArray(payload.errors) ? payload.errors.join('; ') : ''
    throw new Error(`Docling conversion failed${errors ? `: ${errors}` : `: ${payload.status}`}`)
  }

  const markdown = payload && payload.document && payload.document.md_content
  if (typeof markdown !== 'string' || !markdown.trim()) {
    throw new Error('docling-serve returned no Markdown.')
  }
  return markdown.trim()
}

function stopDoclingServe(options = {}) {
  if (!serverProcess) return
  killProcessTree(serverProcess, options)
  serverProcess = null
  serverUrl = null
}

function isDoclingServeRunning() {
  return !!(serverProcess && serverUrl)
}

// Test seam: drop the module-level singleton between cases.
function resetDoclingServeForTests() {
  serverProcess = null
  serverUrl = null
  startPromise = null
}

module.exports = {
  DEFAULT_HOST,
  DEFAULT_PORT,
  READY_TIMEOUT_MS,
  CONVERT_TIMEOUT_MS,
  getDoclingServeCommand,
  buildServeArgs,
  buildServiceUrl,
  killProcessTree,
  isReady,
  waitUntilReady,
  ensureDoclingServe,
  convertWithDoclingServe,
  stopDoclingServe,
  isDoclingServeRunning,
  resetDoclingServeForTests,
}
