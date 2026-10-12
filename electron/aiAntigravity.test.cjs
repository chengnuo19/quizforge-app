import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
const { EventEmitter } = require('events')
const { PassThrough } = require('stream')
const path = require('path')
const os = require('os')
const fs = require('fs/promises')
const {
  AGENT_NAME,
  parseModelList,
  buildArgs,
  buildPrompt,
  childEnv,
  createAntigravityClient,
} = require('./aiAntigravity.cjs')

function fakeChild(lines, code = 0) {
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.kill = vi.fn()
  let input = ''
  child.stdin = new PassThrough()
  child.stdin.on('data', (chunk) => { input += chunk })
  child.stdin.on('finish', () => {
    child.input = input
    child.stdout.end(lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n')
    setTimeout(() => child.emit('close', code), 5)
  })
  return child
}

describe('aiAntigravity helpers', () => {
  it('parses `agy models` output and skips the banner', () => {
    expect(parseModelList('Fetching available models...\r\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)\nclaude-sonnet-4-6\tClaude Sonnet 4.6\n'))
      .toEqual([
        { id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' },
        { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
      ])
  })

  it('runs the dedicated agent in headless stream-json mode', () => {
    const args = buildArgs('gemini-x')
    expect(args.slice(0, 4)).toEqual(['--model', 'gemini-x', '--agent', AGENT_NAME])
    expect(args).toContain('--disable-slash-commands')
    expect(args.join(' ')).toContain('--input-format stream-json --output-format stream-json')
  })

  it('puts system, user and image paths into one prompt', () => {
    expect(buildPrompt({ system: 'S', user: 'U' }, [])).toBe('S\n\nU')
    expect(buildPrompt({ user: 'U' }, ['C:/a.png'])).toContain('view_file')
    expect(buildPrompt({ user: 'U' }, ['C:/a.png'])).toContain('C:/a.png')
  })

  it('never passes API keys to agy', () => {
    const env = childEnv({ PATH: 'p', GEMINI_API_KEY: 'x', GOOGLE_API_KEY: 'y', GOOGLE_GENAI_USE_VERTEXAI: '1' })
    expect(env).toEqual({ PATH: 'p' })
  })
})

describe('createAntigravityClient.complete', () => {
  let home

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-agy-home-'))
  })

  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true })
  })

  it('writes images to a temp dir, returns the result text and cleans up', async () => {
    let spawned
    const spawnImpl = vi.fn((cmd, args, opts) => {
      spawned = { cmd, args, opts, child: fakeChild([
        'not json',
        { event: 'progress' },
        { event: 'result', result: { status: 'SUCCESS', response: '  ## 题目  ' } },
      ]) }
      return spawned.child
    })
    const client = createAntigravityClient({ spawnImpl, home, env: { LOCALAPPDATA: path.join(home, 'none'), GEMINI_API_KEY: 'x' } })

    const text = await client.complete({ user: 'U', model: 'gemini-x', images: [{ mimeType: 'image/png', data: Buffer.from('png').toString('base64') }] })

    expect(text).toBe('## 题目')
    expect(spawned.cmd).toBe('agy')
    expect(spawned.opts.env.GEMINI_API_KEY).toBeUndefined()
    const sent = JSON.parse(spawned.child.input)
    expect(sent.event).toBe('user')
    const imagePath = path.join(spawned.opts.cwd, 'image-1.png')
    expect(sent.message.content).toContain(imagePath)
    await expect(fs.access(spawned.opts.cwd)).rejects.toThrow()
    const agentFile = await fs.readFile(path.join(home, '.gemini', 'config', 'agents', `${AGENT_NAME}.md`), 'utf8')
    expect(agentFile).toContain('- view_file')
    expect(agentFile).toContain('commandExecutionPolicy: off')
  })

  it('does not overwrite an existing agent file', async () => {
    const file = path.join(home, '.gemini', 'config', 'agents', `${AGENT_NAME}.md`)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, 'custom')
    const spawnImpl = () => fakeChild([{ event: 'result', result: { status: 'SUCCESS', response: 'ok' } }])
    await createAntigravityClient({ spawnImpl, home, env: {} }).complete({ user: 'U', model: 'm' })
    expect(await fs.readFile(file, 'utf8')).toBe('custom')
  })

  it('reports agy errors', async () => {
    const spawnImpl = () => fakeChild([{ event: 'result', result: { status: 'ERROR', error: 'quota exhausted' } }], 1)
    await expect(createAntigravityClient({ spawnImpl, home, env: {} }).complete({ user: 'U', model: 'm' }))
      .rejects.toThrow('Antigravity 调用失败：quota exhausted')
  })

  it('refuses to run when agy is configured for an API key provider', async () => {
    const dir = path.join(home, '.gemini', 'antigravity-cli')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, 'settings.json'), JSON.stringify({ modelProvider: 'gemini-api' }))
    const spawnImpl = vi.fn()
    const client = createAntigravityClient({ spawnImpl, home, env: {} })
    await expect(client.complete({ user: 'U', model: 'm' })).rejects.toThrow('modelProvider')
    expect(spawnImpl).not.toHaveBeenCalled()
    expect((await client.status()).accountMode).toBe(false)
  })
})
