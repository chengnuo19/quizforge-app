const { spawn } = require('child_process')
const readline = require('readline')

const SCREENSHOT_TIMEOUT_MS = 180000
const PIPE_PREFIX = '@@QUIZFORGE-AI@@ '

function buildScreenshotOrganizerArgs(action, configPath, provider) {
  const base = ['-3.12', '-m', 'screenshot_organizer']
  const configArgs = ['--config', configPath]
  const providerArgs = provider ? ['--provider', provider] : []

  if (action === 'preview') {
    return [...base, 'batch', ...configArgs, ...providerArgs, '--dry-run', '--limit', '5']
  }
  if (action === 'batch') {
    return [...base, 'batch', ...configArgs, ...providerArgs, '--yes']
  }
  if (action === 'watch') {
    return [...base, 'watch', ...configArgs, ...providerArgs]
  }
  if (action === 'undo') {
    return [...base, 'undo', ...configArgs, '--last']
  }
  throw new Error(`Unsupported screenshot action: ${action}`)
}

/**
 * 监听子进程的 stdout 协议管道与标准日志
 * @param {import('child_process').ChildProcess} child
 * @param {Function} handleAiRequest (req) => Promise<string>
 * @param {Function} [onLog] (line: string) => void
 */
function attachHostPipe(child, handleAiRequest, onLog) {
  if (!child || !child.stdout) return

  // 监听 stdin error，避免进程意外关闭后写入触发未捕获的 EPIPE 导致宿主崩溃
  if (child.stdin && typeof child.stdin.on === 'function') {
    child.stdin.on('error', (err) => {
      console.warn('[screenshotOrganizer] child.stdin error:', err?.message)
    })
  }

  const safeWriteStdin = (payload) => {
    if (
      !child ||
      child.killed ||
      child.exitCode !== null ||
      !child.stdin ||
      child.stdin.destroyed ||
      !child.stdin.writable
    ) {
      return
    }
    try {
      child.stdin.write(JSON.stringify(payload) + '\n')
    } catch (err) {
      console.warn('[screenshotOrganizer] safeWriteStdin error:', err?.message)
    }
  }

  const rl = readline.createInterface({
    input: child.stdout,
    crlfDelay: Infinity,
  })

  rl.on('line', (line) => {
    // 忽略纯空行（Python 会在协议行前多写一个换行）
    if (!line || !line.trim()) {
      return
    }

    const idx = line.indexOf(PIPE_PREFIX)
    if (idx !== -1) {
      // 前缀前的非空文字作为普通日志处理
      const prefixPart = line.slice(0, idx).trim()
      if (prefixPart && onLog) {
        onLog(prefixPart)
      }

      const jsonStr = line.slice(idx + PIPE_PREFIX.length).trim()
      if (!jsonStr) return

      let req
      try {
        req = JSON.parse(jsonStr)
      } catch (parseErr) {
        console.error('[screenshotOrganizer] 解析协议行 JSON 失败:', parseErr?.message)
        return
      }

      const id = req?.id
      if (!id) return

      // 异步处理 AI 请求，任何异常均转为 {"ok": false} 写回，绝不抛到外部
      Promise.resolve()
        .then(async () => {
          if (typeof handleAiRequest !== 'function') {
            throw new Error('宿主未提供 handleAiRequest 处理器')
          }
          const content = await handleAiRequest(req)
          safeWriteStdin({ id, ok: true, content: String(content ?? '') })
        })
        .catch((err) => {
          const errorMsg = String(err?.message || err || '宿主 AI 请求处理失败')
          safeWriteStdin({ id, ok: false, error: errorMsg })
        })
    } else {
      if (onLog) {
        onLog(line)
      }
    }
  })
}

function runScreenshotOrganizer({
  action,
  configPath,
  provider,
  cwd,
  env = process.env,
  spawnImpl = spawn,
  handleAiRequest,
  timeoutMs,
}) {
  const args = buildScreenshotOrganizerArgs(action, configPath, provider)
  // 使用应用 AI 设置（provider === 'quizforge' 或传了 handleAiRequest）时不设总超时（effectiveTimeout = 0）：
  // 每个单张请求已由 Python 端 HostPipeAdapter 的 360 秒超时兜底，批量整理多张截图耗时随数量增长，不设总超时避免大批量任务中途中断。
  // 其他直接调用第三方 API 的 provider 保持原有的 SCREENSHOT_TIMEOUT_MS (180000ms)。
  const isAppAi = provider === 'quizforge' || Boolean(handleAiRequest)
  const effectiveTimeout = timeoutMs !== undefined
    ? timeoutMs
    : (isAppAi ? 0 : SCREENSHOT_TIMEOUT_MS)

  return new Promise((resolve, reject) => {
    const logs = []
    let stderr = ''
    let timeoutTimer = null
    let timedOut = false

    const child = spawnImpl('py', args, {
      cwd,
      env: { ...env, PYTHONUTF8: '1' },
      shell: false,
      windowsHide: true,
    })

    if (effectiveTimeout > 0) {
      timeoutTimer = setTimeout(() => {
        timedOut = true
        try {
          child.kill()
        } catch (_) {}
        reject(new Error(`Screenshot organizer timed out after ${effectiveTimeout} ms.`))
      }, effectiveTimeout)
    }

    if (child.stderr) {
      child.stderr.on('data', (data) => {
        stderr += data.toString('utf-8')
      })
    }

    attachHostPipe(child, handleAiRequest, (line) => {
      logs.push(line)
    })

    child.on('error', (err) => {
      if (timeoutTimer) clearTimeout(timeoutTimer)
      if (timedOut) return
      reject(err)
    })

    child.on('close', (code) => {
      if (timeoutTimer) clearTimeout(timeoutTimer)
      if (timedOut) return
      if (code === 0) {
        resolve(logs.join('\n').trim())
      } else {
        const errorMsg = String(stderr || logs.join('\n') || `Screenshot organizer exited with code ${code}`).trim()
        reject(new Error(errorMsg))
      }
    })
  })
}

function startScreenshotWatcher({
  configPath,
  provider,
  cwd,
  env = process.env,
  spawnImpl = spawn,
  handleAiRequest,
  onLog,
}) {
  const child = spawnImpl('py', buildScreenshotOrganizerArgs('watch', configPath, provider), {
    cwd,
    env: { ...env, PYTHONUTF8: '1' },
    shell: false,
    windowsHide: true,
  })

  if (handleAiRequest) {
    attachHostPipe(child, handleAiRequest, onLog)
  }

  return child
}

function validateScreenshotAiSettings(payload) {
  const isAppProvider = payload?.provider === '__app__'
  if (!isAppProvider) return
  const aiSettings = payload?.aiSettings || {}
  const providerType = aiSettings.provider || 'apiKey'
  if (providerType === 'apiKey' && !String(aiSettings.apiKey || '').trim()) {
    throw new Error('未配置 AI：请在右上角设置中填写 API Key 或选择订阅')
  }
}

module.exports = {
  buildScreenshotOrganizerArgs,
  runScreenshotOrganizer,
  startScreenshotWatcher,
  attachHostPipe,
  validateScreenshotAiSettings,
  PIPE_PREFIX,
}
