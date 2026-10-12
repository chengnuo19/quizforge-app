import { describe, expect, it, vi } from 'vitest'
const { EventEmitter } = require('events')
const { PassThrough } = require('stream')
const {
  buildScreenshotOrganizerArgs,
  runScreenshotOrganizer,
  attachHostPipe,
  validateScreenshotAiSettings,
  PIPE_PREFIX,
} = require('./screenshotOrganizer.cjs')

function createFakeChild() {
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.stdin = new PassThrough()
  child.killed = false
  child.exitCode = null
  child.kill = vi.fn(() => {
    child.killed = true
    child.emit('close', 1)
  })

  child.writtenLines = []
  let buffer = ''
  child.stdin.on('data', (chunk) => {
    buffer += chunk.toString('utf-8')
    const parts = buffer.split('\n')
    buffer = parts.pop()
    for (const p of parts) {
      if (p.trim()) {
        try {
          child.writtenLines.push(JSON.parse(p))
        } catch (_) {
          child.writtenLines.push(p)
        }
      }
    }
  })
  return child
}

describe('screenshot organizer helper', () => {
  const configPath = 'C:\\Temp\\quizforge-screenshot.yaml'

  it('builds a limited dry-run command for previews', () => {
    expect(buildScreenshotOrganizerArgs('preview', configPath, 'gemini')).toEqual([
      '-3.12', '-m', 'screenshot_organizer', 'batch',
      '--config', configPath, '--provider', 'gemini', '--dry-run', '--limit', '5',
    ])
  })

  it('builds a confirmed batch command and an undo command', () => {
    expect(buildScreenshotOrganizerArgs('batch', configPath, 'gemini')).toContain('--yes')
    expect(buildScreenshotOrganizerArgs('undo', configPath)).toEqual([
      '-3.12', '-m', 'screenshot_organizer', 'undo', '--config', configPath, '--last',
    ])
  })

  it('attachHostPipe 识别协议行并调用 handleAiRequest，将回复写回 stdin', async () => {
    const child = createFakeChild()
    const logs = []
    const handleAiRequest = vi.fn().mockResolvedValue('分类结果：代码')

    attachHostPipe(child, handleAiRequest, (l) => logs.push(l))

    // 写入普通日志
    child.stdout.write('准备开始整理截图...\n')

    // 写入协议行（前面带换行，模拟 Python 端的写入）
    const reqJson = JSON.stringify({
      id: 'req-123',
      system: 'sys prompt',
      user: 'user prompt',
      image: { mimeType: 'image/png', data: 'abc' },
    })
    child.stdout.write(`\n${PIPE_PREFIX}${reqJson}\n`)

    // 等待异步处理
    await vi.waitFor(() => {
      expect(handleAiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'req-123' })
      )
      expect(child.writtenLines).toContainEqual({
        id: 'req-123',
        ok: true,
        content: '分类结果：代码',
      })
    })

    expect(logs).toContain('准备开始整理截图...')
  })

  it('attachHostPipe 支持同一行中前缀前有未换行日志的情况，且空行被忽略', async () => {
    const child = createFakeChild()
    const logs = []
    const handleAiRequest = vi.fn().mockResolvedValue('OK')

    attachHostPipe(child, handleAiRequest, (l) => logs.push(l))

    const reqJson = JSON.stringify({ id: 'req-456' })
    // 前缀前包含未换行的日志文本
    child.stdout.write(`[预览] 正在处理 1.png -> 代码/x.png${PIPE_PREFIX}${reqJson}\n`)

    await vi.waitFor(() => {
      expect(child.writtenLines).toContainEqual({
        id: 'req-456',
        ok: true,
        content: 'OK',
      })
    })

    expect(logs).toContain('[预览] 正在处理 1.png -> 代码/x.png')
  })

  it('handleAiRequest 抛出异常时向 stdin 写回 ok: false，不会抛出到未捕获错误', async () => {
    const child = createFakeChild()
    const handleAiRequest = vi.fn().mockRejectedValue(new Error('配额超限'))

    attachHostPipe(child, handleAiRequest)

    const reqJson = JSON.stringify({ id: 'req-err' })
    child.stdout.write(`${PIPE_PREFIX}${reqJson}\n`)

    await vi.waitFor(() => {
      expect(child.writtenLines).toContainEqual({
        id: 'req-err',
        ok: false,
        error: '配额超限',
      })
    })
  })

  it('runScreenshotOrganizer 使用 spawn 启动并在正常退出时返回收集的日志', async () => {
    const child = createFakeChild()
    const spawnImpl = vi.fn().mockReturnValue(child)

    const promise = runScreenshotOrganizer({
      action: 'preview',
      configPath,
      provider: 'quizforge',
      cwd: 'C:\\test-fixtures\\ScreenshotOrganizer',
      spawnImpl,
    })

    child.stdout.write('日志行 1\n日志行 2\n')
    setTimeout(() => {
      child.emit('close', 0)
    }, 10)

    const output = await promise
    expect(output).toContain('日志行 1\n日志行 2')
    expect(spawnImpl).toHaveBeenCalledWith(
      'py',
      expect.arrayContaining(['batch', '--config', configPath]),
      expect.objectContaining({ shell: false })
    )
  })

  it('runScreenshotOrganizer 在非 0 退出时抛出包含 stderr 的错误', async () => {
    const child = createFakeChild()
    const spawnImpl = vi.fn().mockReturnValue(child)

    const promise = runScreenshotOrganizer({
      action: 'preview',
      configPath,
      provider: 'mock',
      cwd: 'C:\\test-fixtures\\ScreenshotOrganizer',
      spawnImpl,
    })

    child.stderr.write('执行发生错误：配置无效')
    setTimeout(() => {
      child.emit('close', 1)
    }, 10)

    await expect(promise).rejects.toThrow('执行发生错误：配置无效')
  })

  it('quizforge 模式下不设总超时（推进超过 10 分钟不被 kill）', async () => {
    vi.useFakeTimers()
    const child = createFakeChild()
    const spawnImpl = vi.fn().mockReturnValue(child)

    const promise = runScreenshotOrganizer({
      action: 'preview',
      configPath,
      provider: 'quizforge',
      cwd: 'C:\\test-fixtures\\ScreenshotOrganizer',
      spawnImpl,
    })

    // 推进 700 秒（超过 10 分钟 / 600 秒）
    vi.advanceTimersByTime(700000)
    expect(child.kill).not.toHaveBeenCalled()

    child.emit('close', 0)
    await expect(promise).resolves.toBe('')
    vi.useRealTimers()
  })

  it('普通 provider 模式下超过 180 秒会触发超时被 kill', async () => {
    vi.useFakeTimers()
    const child = createFakeChild()
    const spawnImpl = vi.fn().mockReturnValue(child)

    const promise = runScreenshotOrganizer({
      action: 'preview',
      configPath,
      provider: 'gemini',
      cwd: 'C:\\test-fixtures\\ScreenshotOrganizer',
      spawnImpl,
    })

    // 推进 185 秒
    vi.advanceTimersByTime(185000)
    expect(child.kill).toHaveBeenCalled()

    await expect(promise).rejects.toThrow('timed out after 180000 ms')
    vi.useRealTimers()
  })

  it('预检抛错时 spawn 未被调用', () => {
    const spawnImpl = vi.fn()
    const invalidPayload = {
      provider: '__app__',
      aiSettings: { provider: 'apiKey', apiKey: '   ' },
    }

    expect(() => {
      validateScreenshotAiSettings(invalidPayload)
      // 若预检未抛错才会走到 spawn
      spawnImpl()
    }).toThrow('未配置 AI：请在右上角设置中填写 API Key 或选择订阅')

    expect(spawnImpl).not.toHaveBeenCalled()
  })
})
