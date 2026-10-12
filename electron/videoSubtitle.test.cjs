import { describe, it, expect, vi } from 'vitest'
const { EventEmitter } = require('events')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  findSubtitleFfmpeg,
  parseProbeJson,
  parseFfmpegTime,
  buildExtractAudioArgs,
  buildBurnArgs,
  burnSubtitles,
  getProjectPath,
  getOutputBase,
} = require('./videoSubtitle.cjs')

function fakeChild() {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn()
  return child
}

const FULL_FILTERS = ' .. scale             V->V       Scale the input video size.\n .. subtitles         V->V       Render text subtitles onto input video using the libass library.\n'
const STRIPPED_FILTERS = ' .. scale             V->V       Scale the input video size.\n'

describe('findSubtitleFfmpeg', () => {
  it('skips an ffmpeg without libass and picks the one on PATH', async () => {
    const execFileImpl = vi.fn((file, args, _opts, cb) => {
      if (args.includes('-filters')) return cb(null, file === 'D:\\stripped\\ffmpeg.exe' ? STRIPPED_FILTERS : FULL_FILTERS)
      return cb(null, ' V....D h264_nvenc           NVIDIA NVENC H.264 encoder\n')
    })
    const result = await findSubtitleFfmpeg({ ffmpegPath: 'D:\\stripped\\ffmpeg.exe', env: {}, execFileImpl })
    expect(result).toEqual({ available: true, ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', hasNvenc: true, error: '' })
  })

  it('derives ffprobe next to a configured ffmpeg and reports missing libass', async () => {
    const ok = await findSubtitleFfmpeg({
      ffmpegPath: 'C:\\ff\\bin\\ffmpeg.exe',
      env: {},
      execFileImpl: (_f, args, _o, cb) => cb(null, args.includes('-filters') ? FULL_FILTERS : ''),
    })
    expect(ok.ffprobe).toBe(path.join('C:\\ff\\bin', 'ffprobe.exe'))
    expect(ok.hasNvenc).toBe(false)

    const missing = await findSubtitleFfmpeg({ env: {}, execFileImpl: (_f, _a, _o, cb) => cb(null, STRIPPED_FILTERS) })
    expect(missing.available).toBe(false)
    expect(missing.error).toContain('libass')
  })
})

describe('parseProbeJson', () => {
  it('reads size, duration and audio presence', () => {
    const json = JSON.stringify({
      streams: [{ codec_type: 'video', width: 1920, height: 1080 }, { codec_type: 'audio' }],
      format: { duration: '3600.5' },
    })
    expect(parseProbeJson(json)).toEqual({ width: 1920, height: 1080, duration: 3600.5, hasAudio: true })
  })

  it('swaps width and height for rotated phone videos', () => {
    const json = JSON.stringify({
      streams: [{ codec_type: 'video', width: 1920, height: 1080, side_data_list: [{ rotation: -90 }] }],
      format: { duration: '10' },
    })
    expect(parseProbeJson(json)).toMatchObject({ width: 1080, height: 1920, hasAudio: false })
  })

  it('rejects files without video', () => {
    expect(() => parseProbeJson(JSON.stringify({ streams: [{ codec_type: 'audio' }] }))).toThrow('没有视频流')
  })
})

describe('ffmpeg args', () => {
  it('parses progress time', () => {
    expect(parseFfmpegTime('frame=  10 fps=0.0 q=0.0 size= 0kB time=01:02:03.50 bitrate=')).toBe(3723.5)
    expect(parseFfmpegTime('nothing here')).toBeNull()
  })

  it('extracts 16 kHz mono wav', () => {
    expect(buildExtractAudioArgs('in.mp4', 'out.wav')).toEqual(['-y', '-hide_banner', '-i', 'in.mp4', '-vn', '-ac', '1', '-ar', '16000', '-f', 'wav', 'out.wav'])
  })

  it('burns with nvenc or x264', () => {
    const nv = buildBurnArgs({ input: 'in.mp4', assName: 'subs.ass', output: 'out.mp4', encoder: 'nvenc' })
    expect(nv).toEqual(expect.arrayContaining(['subtitles=subs.ass', 'h264_nvenc', '+faststart', 'yuv420p']))
    expect(buildBurnArgs({ input: 'in.mp4', assName: 'subs.ass', output: 'out.mp4', encoder: 'x264' })).toContain('libx264')
  })

  it('names project and output files next to the video', () => {
    expect(getProjectPath(path.join('E:', 'v', '讲座.mp4'))).toBe(path.join('E:', 'v', '讲座.subtitles.json'))
    expect(getOutputBase(path.join('E:', 'v', 'a.b.mov'))).toBe(path.join('E:', 'v', 'a.b'))
  })
})

describe('burnSubtitles', () => {
  it('writes the .ass into a temp cwd, falls back to x264 and cleans up', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qf-burn-test-'))
    const children = []
    const seen = []
    const spawnImpl = vi.fn((_ffmpeg, args, opts) => {
      seen.push({ args, cwd: opts.cwd, ass: fs.readFileSync(path.join(opts.cwd, 'subs.ass'), 'utf-8') })
      const child = fakeChild()
      children.push(child)
      setTimeout(() => {
        if (args.includes('h264_nvenc')) {
          child.stderr.emit('data', Buffer.from('No capable devices found'))
          child.emit('close', 1)
        } else {
          child.stderr.emit('data', Buffer.from('time=00:00:05.00 bitrate'))
          child.emit('close', 0)
        }
      }, 0)
      return child
    })
    const onProgress = vi.fn()
    const onLog = vi.fn()
    const ctrl = burnSubtitles({
      ffmpeg: 'ffmpeg', input: 'in.mp4', output: 'out.mp4', assContent: '[Script Info]', duration: 10,
      hasNvenc: true, tempRoot, spawnImpl, onProgress, onLog,
    })
    await expect(ctrl.promise).resolves.toEqual({ cancelled: false })
    expect(seen).toHaveLength(2)
    expect(seen[0].ass).toBe('[Script Info]')
    expect(seen[1].args).toContain('libx264')
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('CPU 编码'))
    expect(onProgress).toHaveBeenCalledWith({ seconds: 5, percent: 50 })
    expect(fs.existsSync(seen[0].cwd)).toBe(false)
    fs.rmSync(tempRoot, { recursive: true, force: true })
  })
})
