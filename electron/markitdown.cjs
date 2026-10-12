const { execFile } = require('child_process')

const MARKITDOWN_MAX_BUFFER = 50 * 1024 * 1024
const MARKITDOWN_TIMEOUT_MS = 120000

function getMarkitdownCommand(env = process.env) {
  if (env.MARKITDOWN_BIN) return env.MARKITDOWN_BIN
  return 'markitdown'
}

function normalizeExecResult(stdoutOrResult, stderrArg) {
  if (typeof stdoutOrResult === 'object' && stdoutOrResult !== null) {
    return {
      stdout: stdoutOrResult.stdout || '',
      stderr: stdoutOrResult.stderr || '',
    }
  }
  return {
    stdout: stdoutOrResult || '',
    stderr: stderrArg || '',
  }
}

function formatMarkitdownError(error, stderr) {
  if (error?.code === 'ENOENT') {
    return new Error(
      'MarkItDown was not found. Install it with pip install "markitdown[all]" or set MARKITDOWN_BIN to the executable path.'
    )
  }

  const detail = String(stderr || error?.message || '').trim()
  return new Error(detail ? `MarkItDown conversion failed: ${detail}` : 'MarkItDown conversion failed.')
}

function convertDocumentWithMarkitdown(filePath, options = {}) {
  const selectedPath = String(filePath || '').trim()
  if (!selectedPath) {
    return Promise.reject(new Error('No document file was selected.'))
  }

  const execFileImpl = options.execFileImpl || execFile
  const command = getMarkitdownCommand(options.env || process.env)

  return new Promise((resolve, reject) => {
    execFileImpl(
      command,
      [selectedPath],
      {
        shell: false,
        windowsHide: true,
        maxBuffer: MARKITDOWN_MAX_BUFFER,
        timeout: MARKITDOWN_TIMEOUT_MS,
      },
      (error, stdoutOrResult, stderrArg) => {
        const { stdout, stderr } = normalizeExecResult(stdoutOrResult, stderrArg)
        if (error) {
          reject(formatMarkitdownError(error, stderr))
          return
        }
        resolve(String(stdout || '').trim())
      }
    )
  })
}

module.exports = {
  MARKITDOWN_MAX_BUFFER,
  MARKITDOWN_TIMEOUT_MS,
  getMarkitdownCommand,
  convertDocumentWithMarkitdown,
}
