import { describe, it, expect, beforeEach } from 'vitest'
const { EventEmitter } = require('events')
const {
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
} = require('./doclingServe.cjs')

function fakeChild() {
  const child = new EventEmitter()
  child.pid = 4242
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.killed = false
  child.kill = () => {
    child.killed = true
  }
  return child
}

const okResponse = { ok: true, status: 200 }

// A clock that jumps instantly so readiness polling never really sleeps.
function fakeClock() {
  let current = 0
  return {
    now: () => current,
    timerImpl: (fn, ms) => {
      current += ms
      fn()
      return 0
    },
  }
}

beforeEach(() => {
  resetDoclingServeForTests()
})

describe('docling-serve helper', () => {
  it('uses DOCLING_SERVE_BIN when configured', () => {
    expect(getDoclingServeCommand({ DOCLING_SERVE_BIN: 'C:\\uv\\docling-serve.exe' }))
      .toBe('C:\\uv\\docling-serve.exe')
  })

  it('falls back to the docling-serve command on PATH', () => {
    expect(getDoclingServeCommand({})).toBe('docling-serve')
  })

  it('binds the server to loopback on the default port', () => {
    expect(buildServeArgs()).toEqual(['run', '--host', '127.0.0.1', '--port', '5001'])
    expect(buildServiceUrl()).toBe('http://127.0.0.1:5001')
  })

  it('passes an artifacts path only when one is configured', () => {
    expect(buildServeArgs({ artifactsPath: 'C:\\models' })).toContain('--artifacts-path')
    expect(buildServeArgs()).not.toContain('--artifacts-path')
  })

  it('reports readiness from the health endpoint', async () => {
    await expect(isReady('http://x', { fetchImpl: async () => okResponse })).resolves.toBe(true)
    await expect(isReady('http://x', { fetchImpl: async () => ({ ok: false }) })).resolves.toBe(false)
    await expect(isReady('http://x', {
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED')
      },
    })).resolves.toBe(false)
  })

  it('polls until the server answers, announcing the slow first boot once', async () => {
    const clock = fakeClock()
    const progress = []
    let calls = 0
    const fetchImpl = async () => {
      calls += 1
      if (calls < 4) throw new Error('ECONNREFUSED')
      return okResponse
    }

    await expect(waitUntilReady('http://x', {
      ...clock,
      fetchImpl,
      onProgress: (line) => progress.push(line),
    })).resolves.toBe(true)
    expect(progress).toHaveLength(1)
    expect(progress[0]).toContain('Docling')
  })

  it('gives up once the readiness deadline passes', async () => {
    const clock = fakeClock()
    await expect(waitUntilReady('http://x', {
      ...clock,
      readyTimeoutMs: 3000,
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED')
      },
    })).resolves.toBe(false)
  })

  it('kills the whole process tree on Windows so uvicorn workers release the port', () => {
    const calls = []
    const child = fakeChild()
    killProcessTree(child, {
      platform: 'win32',
      spawnImpl: (command, args) => calls.push({ command, args }),
    })

    expect(calls[0].command).toBe('taskkill')
    expect(calls[0].args).toEqual(['/PID', '4242', '/T', '/F'])
    expect(child.killed).toBe(false)
  })

  it('falls back to a plain kill off Windows', () => {
    const child = fakeChild()
    killProcessTree(child, { platform: 'linux', spawnImpl: () => {} })
    expect(child.killed).toBe(true)
  })

  it('turns a missing executable into setup guidance', async () => {
    const clock = fakeClock()
    const spawnImpl = () => {
      const error = new Error('spawn docling-serve ENOENT')
      error.code = 'ENOENT'
      throw error
    }

    await expect(ensureDoclingServe({ ...clock, spawnImpl, env: {} }))
      .rejects.toThrow('docling-serve was not found')
  })

  it('starts the server once and reuses it for later conversions', async () => {
    const clock = fakeClock()
    const spawns = []
    const spawnImpl = (command, args, options) => {
      spawns.push({ command, args, options })
      return fakeChild()
    }
    const deps = { ...clock, spawnImpl, env: {}, fetchImpl: async () => okResponse }

    const first = await ensureDoclingServe(deps)
    const second = await ensureDoclingServe(deps)

    expect(first).toBe('http://127.0.0.1:5001')
    expect(second).toBe(first)
    expect(spawns).toHaveLength(1)
    expect(spawns[0].options.env.PYTHONUTF8).toBe('1')
    expect(isDoclingServeRunning()).toBe(true)

    stopDoclingServe({ platform: 'linux', spawnImpl: () => {} })
    expect(isDoclingServeRunning()).toBe(false)
  })

  it('does not race two servers onto one port', async () => {
    const clock = fakeClock()
    const spawns = []
    const deps = {
      ...clock,
      env: {},
      spawnImpl: () => {
        spawns.push(1)
        return fakeChild()
      },
      fetchImpl: async () => okResponse,
    }

    const [a, b] = await Promise.all([ensureDoclingServe(deps), ensureDoclingServe(deps)])
    expect(a).toBe(b)
    expect(spawns).toHaveLength(1)
  })

  it('posts the file and reads Markdown out of document.md_content', async () => {
    const requests = []
    const markdown = await convertWithDoclingServe('C:\\notes\\exam.pdf', {
      url: 'http://127.0.0.1:5001',
      ocr: true,
      readFile: async () => Buffer.from('%PDF-1.4'),
      fetchImpl: async (target, init) => {
        requests.push({ target, init })
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status: 'success',
            document: { md_content: '# Exam\n\n## 1. 题干\n' },
          }),
        }
      },
    })

    expect(markdown).toBe('# Exam\n\n## 1. 题干')
    expect(requests[0].target).toBe('http://127.0.0.1:5001/v1/convert/file')
    expect(requests[0].init.method).toBe('POST')
    expect(requests[0].init.body.get('to_formats')).toBe('md')
    expect(requests[0].init.body.get('do_ocr')).toBe('true')
  })

  it('sends do_ocr=false explicitly, since the service defaults it to true', async () => {
    let form
    await convertWithDoclingServe('C:\\notes\\exam.pdf', {
      url: 'http://x',
      readFile: async () => Buffer.from('%PDF'),
      fetchImpl: async (_target, init) => {
        form = init.body
        return {
          ok: true,
          status: 200,
          json: async () => ({ status: 'success', document: { md_content: '# ok' } }),
        }
      },
    })

    expect(form.get('do_ocr')).toBe('false')
  })

  it('rejects when the selected file path is empty', async () => {
    await expect(convertWithDoclingServe('')).rejects.toThrow('No document file was selected.')
  })

  it('surfaces an HTTP failure body', async () => {
    await expect(convertWithDoclingServe('C:\\notes\\exam.pdf', {
      url: 'http://x',
      readFile: async () => Buffer.from('%PDF'),
      fetchImpl: async () => ({
        ok: false,
        status: 422,
        text: async () => 'Unsupported file type',
      }),
    })).rejects.toThrow('Unsupported file type')
  })

  it('surfaces a non-success conversion status', async () => {
    await expect(convertWithDoclingServe('C:\\notes\\exam.pdf', {
      url: 'http://x',
      readFile: async () => Buffer.from('%PDF'),
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ status: 'failure', errors: ['page 3 is corrupt'] }),
      }),
    })).rejects.toThrow('page 3 is corrupt')
  })

  it('fails clearly when the service returns empty Markdown', async () => {
    await expect(convertWithDoclingServe('C:\\notes\\exam.pdf', {
      url: 'http://x',
      readFile: async () => Buffer.from('%PDF'),
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ status: 'success', document: { md_content: '   ' } }),
      }),
    })).rejects.toThrow('no Markdown')
  })
})
