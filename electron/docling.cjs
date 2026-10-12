const { spawn } = require('child_process')
const fsp = require('fs/promises')
const os = require('os')
const path = require('path')

// Docling runs layout, table and formula models — on CPU a textbook legitimately
// takes minutes, so MarkItDown's 2-minute ceiling is far too tight here. Cap at
// 30 minutes and let the user watch streamed progress instead of guessing.
const DOCLING_TIMEOUT_MS = 30 * 60 * 1000

function getDoclingCommand(env = process.env) {
  if (env.DOCLING_BIN) return env.DOCLING_BIN
  return 'docling'
}

// Unlike MarkItDown, Docling writes into an output DIRECTORY rather than stdout,
// so each conversion gets a throwaway directory we read the .md back out of.
// `convert` is named explicitly: docling 2.129 moved to subcommands and the bare
// `docling <file>` form now only survives as a compatibility shim.
function buildDoclingArgs(filePath, outputDir, { ocr = false } = {}) {
  return [
    'convert',
    filePath,
    '--to',
    'md',
    '--output',
    outputDir,
    ocr ? '--ocr' : '--no-ocr',
  ]
}

function formatDoclingError(error, stderr) {
  if (error && error.code === 'ENOENT') {
    return new Error(
      'Docling was not found. Install it with pip install docling or set DOCLING_BIN to the executable path.'
    )
  }

  const detail = String(stderr || (error && error.message) || '').trim()
  return new Error(detail ? `Docling conversion failed: ${detail}` : 'Docling conversion failed.')
}

// Docling logs its per-stage progress to stderr. Forward the human-readable
// lines and drop the blank ones so the panel can show what stage it is at.
// Split on bare \r too: the weight-loading bar redraws itself that way.
function progressLines(chunk) {
  return String(chunk || '')
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter(Boolean)
}

async function readConvertedMarkdown(outputDir, deps = {}) {
  const readdir = deps.readdir || fsp.readdir
  const readFile = deps.readFile || fsp.readFile

  const entries = await readdir(outputDir)
  const markdownFiles = entries.filter((name) => /\.md$/i.test(name))
  if (markdownFiles.length === 0) {
    throw new Error('Docling produced no Markdown output.')
  }

  const contents = await Promise.all(
    markdownFiles.map((name) => readFile(path.join(outputDir, name), 'utf-8'))
  )
  // One source document yields one .md. If a future Docling version splits its
  // output, the largest file is the document body rather than a side-car.
  return contents
    .map((content) => String(content))
    .sort((a, b) => b.length - a.length)[0]
    .trim()
}

function runDocling(filePath, outputDir, options = {}) {
  const spawnImpl = options.spawnImpl || spawn
  const command = getDoclingCommand(options.env || process.env)
  const args = buildDoclingArgs(filePath, outputDir, { ocr: options.ocr })
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null

  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawnImpl(command, args, {
        shell: false,
        windowsHide: true,
        // Without this Python writes stderr in the Windows ANSI codepage and
        // any non-ASCII filename comes back as mojibake — same reason
        // screenshotOrganizer.cjs forces UTF-8.
        env: {
          ...(options.env || process.env),
          PYTHONUTF8: '1',
          PYTHONIOENCODING: 'utf-8',
        },
      })
    } catch (error) {
      reject(formatDoclingError(error, ''))
      return
    }

    let stderr = ''
    let settled = false

    const finish = (settleFn, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      settleFn(value)
    }

    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        // The process already exited; nothing left to stop.
      }
      finish(
        reject,
        new Error(`Docling timed out after ${Math.round(DOCLING_TIMEOUT_MS / 60000)} minutes.`)
      )
    }, DOCLING_TIMEOUT_MS)

    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk)
        if (onProgress) progressLines(chunk).forEach(onProgress)
      })
    }

    child.on('error', (error) => finish(reject, formatDoclingError(error, stderr)))
    child.on('close', (code) => {
      if (code === 0) {
        finish(resolve, undefined)
        return
      }
      finish(reject, formatDoclingError(null, stderr || `docling exited with code ${code}`))
    })
  })
}

async function convertDocumentWithDocling(filePath, options = {}) {
  const selectedPath = String(filePath || '').trim()
  if (!selectedPath) {
    throw new Error('No document file was selected.')
  }

  const mkdtemp = options.mkdtemp || fsp.mkdtemp
  const rm = options.rm || fsp.rm
  const outputDir = await mkdtemp(path.join(options.tmpDir || os.tmpdir(), 'quizforge-docling-'))

  try {
    await runDocling(selectedPath, outputDir, options)
    return await readConvertedMarkdown(outputDir, options)
  } finally {
    try {
      await rm(outputDir, { recursive: true, force: true })
    } catch {
      // A leftover temp directory is harmless — never mask the real error.
    }
  }
}

module.exports = {
  DOCLING_TIMEOUT_MS,
  getDoclingCommand,
  buildDoclingArgs,
  readConvertedMarkdown,
  convertDocumentWithDocling,
}
