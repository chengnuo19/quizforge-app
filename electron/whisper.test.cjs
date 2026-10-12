import { describe, it, expect, vi } from 'vitest'
const { EventEmitter } = require('events')
const path = require('path')
const {
  getTranscribeScriptPath,
  parseJsonLine,
  buildTranscribeArgs,
  parsePyLauncherList,
  checkWhisperEnvironment,
  startTranscription,
} = require('./whisper.cjs')

function fakeChild() {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn()
  return child
}

function emitLines(child, objects) {
  child.stdout.emit('data', Buffer.from(objects.map((o) => JSON.stringify(o)).join('\n') + '\n'))
}

describe('whisper helpers', () => {
  it('points packaged builds at the unpacked script', () => {
    const packed = path.join('C:', 'App', 'resources', 'app.asar', 'electron')
    expect(getTranscribeScriptPath(packed)).toBe(
      path.join('C:', 'App', 'resources', 'app.asar.unpacked', 'electron', 'scripts', 'transcribe.py'),
    )
  })

  it('parses JSON lines and ignores noise', () => {
    expect(parseJsonLine('{"type":"done"}')).toEqual({ type: 'done' })
    expect(parseJsonLine('Downloading model...')).toBeNull()
    expect(parseJsonLine('{broken')).toBeNull()
  })

  it('builds transcribe args with defaults', () => {
    expect(buildTranscribeArgs('t.py', 'a.wav')).toEqual(['t.py', 'a.wav', '--model', 'large-v3-turbo', '--device', 'cuda', '--language', 'auto'])
    expect(buildTranscribeArgs('t.py', 'a.wav', { device: 'cpu', model: 'small' })).toContain('cpu')
  })

  it('parses the py launcher list', () => {
    const out = ' -V:3.14 *        C:\\Py\\pythoncore-3.14-64\\python.exe\r\n -V:3.12          C:\\Programs\\Python312\\python.exe\r\n'
    expect(parsePyLauncherList(out)).toEqual(['C:\\Py\\pythoncore-3.14-64\\python.exe', 'C:\\Programs\\Python312\\python.exe'])
  })
})

describe('checkWhisperEnvironment', () => {
  it('returns the first interpreter that can import faster-whisper', async () => {
    const execFileImpl = vi.fn((file, _args, _opts, cb) => {
      if (file === 'py') return cb(null, ' -V:3.12  C:\\Py312\\python.exe\n')
      if (file === 'C:\\Py312\\python.exe') return cb(null, '{"type":"check","ok":true,"version":"1.2.1","cudaDevices":1}\n')
      return cb(null, '{"type":"check","ok":false,"error":"No module"}\n')
    })
    const result = await checkWhisperEnvironment({ execFileImpl, env: {}, scriptPath: 't.py', forcePyLauncher: true, pythonPath: 'C:\\bad\\python.exe' })
    expect(result).toEqual({ available: true, python: 'C:\\Py312\\python.exe', version: '1.2.1', cudaDevices: 1, error: '' })
  })

  it('reports every interpreter tried when none works', async () => {
    const execFileImpl = vi.fn((_file, _args, _opts, cb) => cb(new Error('nope'), ''))
    const result = await checkWhisperEnvironment({ execFileImpl, env: {}, scriptPath: 't.py' })
    expect(result.available).toBe(false)
    expect(result.error).toContain('python')
  })
})

describe('startTranscription', () => {
  it('collects segments and reports progress', async () => {
    const child = fakeChild()
    const onProgress = vi.fn()
    const ctrl = startTranscription({ python: 'py.exe', scriptPath: 't.py', audioPath: 'a.wav', spawnImpl: () => child, onProgress })
    emitLines(child, [
      { type: 'info', device: 'cuda', language: 'en', duration: 10 },
      { type: 'segment', start: 0, end: 2, text: 'Hi', words: [] },
      { type: 'progress', t: 2 },
      { type: 'done', count: 1 },
    ])
    child.emit('close', 0)
    const result = await ctrl.promise
    expect(result.device).toBe('cuda')
    expect(result.segments).toEqual([{ start: 0, end: 2, text: 'Hi', words: [] }])
    expect(onProgress).toHaveBeenCalledWith({ seconds: 2, duration: 10, segments: 1 })
  })

  it('falls back to CPU when CUDA fails before any segment', async () => {
    const children = [fakeChild(), fakeChild()]
    const spawnImpl = vi.fn(() => children[spawnImpl.mock.calls.length - 1])
    const onLog = vi.fn()
    const ctrl = startTranscription({ python: 'py.exe', scriptPath: 't.py', audioPath: 'a.wav', spawnImpl, onLog })
    children[0].stderr.emit('data', Buffer.from('Could not load library cudnn_ops64_9.dll'))
    children[0].emit('close', 3221226505)
    await new Promise((r) => setTimeout(r, 0))
    emitLines(children[1], [{ type: 'segment', start: 0, end: 1, text: 'ok', words: [] }, { type: 'done', count: 1 }])
    children[1].emit('close', 0)
    const result = await ctrl.promise
    expect(result.device).toBe('cpu')
    expect(spawnImpl.mock.calls[1][1]).toContain('cpu')
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('改用 CPU'))
  })

  it('does not retry after segments were produced, and cancels cleanly', async () => {
    const child = fakeChild()
    const ctrl = startTranscription({ python: 'py.exe', scriptPath: 't.py', audioPath: 'a.wav', spawnImpl: () => child })
    emitLines(child, [{ type: 'segment', start: 0, end: 1, text: 'x', words: [] }, { type: 'error', message: 'RuntimeError: boom' }])
    child.emit('close', 1)
    await expect(ctrl.promise).rejects.toThrow('boom')

    const child2 = fakeChild()
    const ctrl2 = startTranscription({ python: 'py.exe', scriptPath: 't.py', audioPath: 'a.wav', spawnImpl: () => child2 })
    ctrl2.cancel()
    expect(child2.kill).toHaveBeenCalled()
    child2.emit('close', null)
    await expect(ctrl2.promise).resolves.toEqual({ cancelled: true })
  })
})
