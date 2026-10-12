import { describe, expect, it } from 'vitest'
const { EventEmitter } = require('events')
const {
  DEFAULT_YTDLP_PATH,
  DEFAULT_FFMPEG_PATH,
  getYtdlpPath,
  getFfmpegPath,
  formatDuration,
  checkEnvironment,
  parseProgressLine,
  buildDownloadArgs,
  extractUsefulFormats,
  extractSubtitleLanguages,
  cleanSubtitleToMarkdown,
  startDownloadProcess,
  updateYtdlpBinary,
} = require('./ytdlp.cjs')

describe('ytdlp module', () => {
  describe('path and environment helpers', () => {
    it('returns default paths when no overrides are given', () => {
      expect(getYtdlpPath(null, {})).toBe(DEFAULT_YTDLP_PATH)
      expect(getFfmpegPath(null, {}, () => false)).toBe('ffmpeg')
      expect(getFfmpegPath(null, {}, () => true)).toBe(DEFAULT_FFMPEG_PATH)
    })

    it('respects custom paths and environment variables', () => {
      expect(getYtdlpPath('D:\\custom\\yt-dlp.exe', {})).toBe('D:\\custom\\yt-dlp.exe')
      expect(getYtdlpPath('', { YTDLP_BIN: 'C:\\bin\\yt-dlp.exe' })).toBe('C:\\bin\\yt-dlp.exe')

      expect(getFfmpegPath('D:\\custom\\ffmpeg.exe', {})).toBe('D:\\custom\\ffmpeg.exe')
      expect(getFfmpegPath('', { FFMPEG_BIN: 'C:\\bin\\ffmpeg.exe' })).toBe('C:\\bin\\ffmpeg.exe')
    })

    it('formats duration correctly', () => {
      expect(formatDuration(0)).toBe('00:00')
      expect(formatDuration(65)).toBe('01:05')
      expect(formatDuration(3665)).toBe('01:01:05')
      expect(formatDuration(null)).toBe('00:00')
    })

    it('checks environment with mocked execFile', async () => {
      const execFileImpl = (cmd, args, opts, cb) => {
        if (cmd.includes('yt-dlp')) {
          cb(null, '2024.05.26\n')
        } else if (cmd.includes('ffmpeg')) {
          cb(null, 'ffmpeg version 6.0 Copyright (c)\n')
        } else {
          cb(new Error('Unknown binary'))
        }
      }

      const res = await checkEnvironment({
        ytdlpPath: 'C:\\test-tools\\yt-dlp.exe',
        ffmpegPath: 'C:\\test-tools\\ffmpeg\\ffmpeg.exe',
        execFileImpl,
        fsExistsImpl: () => true,
      })

      expect(res.ytdlp.available).toBe(true)
      expect(res.ytdlp.version).toBe('2024.05.26')
      expect(res.ffmpeg.available).toBe(true)
      expect(res.ffmpeg.version).toContain('ffmpeg version 6.0')
    })
  })

  describe('parseProgressLine', () => {
    it('parses typical yt-dlp downloading progress line', () => {
      const line = '[download]  45.2% of ~120.34MiB at 4.25MiB/s ETA 00:15'
      const parsed = parseProgressLine(line)
      expect(parsed).toEqual({
        status: 'downloading',
        percent: 45.2,
        totalSize: '120.34MiB',
        speed: '4.25MiB/s',
        eta: '00:15',
        raw: line,
      })
    })

    it('parses finished progress line', () => {
      const line = '[download] 100% of 15.00MiB in 00:02'
      const parsed = parseProgressLine(line)
      expect(parsed).toEqual({
        status: 'finished',
        percent: 100,
        totalSize: '15.00MiB',
        speed: '',
        eta: '00:00',
        raw: line,
      })
    })

    it('detects extracting-audio and merging statuses', () => {
      expect(parseProgressLine('[ExtractAudio] Destination: test.mp3')?.status).toBe('extracting-audio')
      expect(parseProgressLine('[Merger] Merging formats into "test.mp4"')?.status).toBe('merging')
      expect(parseProgressLine('[info] Testing')?.status).toBe('processing')
    })
  })

  describe('buildDownloadArgs', () => {
    it('throws error when URL is missing', () => {
      expect(() => buildDownloadArgs({ url: '' })).toThrow('Video URL is required.')
    })

    it('builds arguments for video download', () => {
      const args = buildDownloadArgs({
        url: 'https://example.com/watch?v=123',
        mode: 'video',
        outputDir: 'D:\\Videos',
        ffmpegPath: 'D:\\ffmpeg.exe',
      })

      expect(args).toContain('-P')
      expect(args).toContain('D:\\Videos')
      expect(args).toContain('--ffmpeg-location')
      expect(args).toContain('D:\\ffmpeg.exe')
      expect(args).toContain('-f')
      expect(args).toContain('bestvideo+bestaudio/best')
      expect(args).toContain('--merge-output-format')
      expect(args).toContain('mp4')
      expect(args[args.length - 1]).toBe('https://example.com/watch?v=123')
    })

    it('builds arguments for audio download', () => {
      const args = buildDownloadArgs({
        url: 'https://example.com/watch?v=123',
        mode: 'audio',
        audioFormat: 'mp3',
      })

      expect(args).toContain('-x')
      expect(args).toContain('--audio-format')
      expect(args).toContain('mp3')
      expect(args).toContain('--audio-quality')
    })

    it('builds arguments for subtitles extraction', () => {
      const args = buildDownloadArgs({
        url: 'https://example.com/watch?v=123',
        mode: 'subtitles',
        subLang: 'zh-Hans,en',
      })

      expect(args).toContain('--write-sub')
      expect(args).toContain('--write-auto-sub')
      expect(args).toContain('--sub-lang')
      expect(args).toContain('zh-Hans,en')
      expect(args).toContain('--skip-download')
    })

    it('supports concurrent-fragments and proxy settings', () => {
      const args = buildDownloadArgs({
        url: 'https://example.com/watch?v=123',
        mode: 'video',
        concurrentFragments: 8,
        proxy: 'http://127.0.0.1:7890',
      })

      expect(args).toContain('--concurrent-fragments')
      expect(args).toContain('8')
      expect(args).toContain('--proxy')
      expect(args).toContain('http://127.0.0.1:7890')
    })

    it('omits concurrent-fragments when set to 1 or below', () => {
      const args = buildDownloadArgs({
        url: 'https://example.com/watch?v=123',
        mode: 'video',
        concurrentFragments: 1,
      })

      expect(args).not.toContain('--concurrent-fragments')
    })
  })

  describe('extractUsefulFormats and extractSubtitleLanguages', () => {
    it('filters useful standard resolutions from raw formats', () => {
      const formats = [
        { height: 1080, format_id: '137' },
        { height: 720, format_id: '22' },
        { height: null, format_id: 'audio' },
      ]
      const useful = extractUsefulFormats(formats)
      const ids = useful.map((f) => f.id)
      expect(ids).toContain('best')
      expect(ids).toContain('1080p')
      expect(ids).toContain('720p')
      expect(ids).not.toContain('360p')
    })

    it('extracts manual and automatic subtitles', () => {
      const manual = { 'zh-Hans': [{ name: '中文（简体）' }] }
      const auto = { en: [{ name: 'English' }] }
      const result = extractSubtitleLanguages(manual, auto)
      expect(result).toHaveLength(2)
      expect(result.find((s) => s.code === 'zh-Hans')?.isAuto).toBe(false)
      expect(result.find((s) => s.code === 'en')?.isAuto).toBe(true)
    })
  })

  describe('cleanSubtitleToMarkdown', () => {
    it('cleans WebVTT cues, deduplicates lines, and outputs Markdown', () => {
      const vtt = `WEBVTT
Kind: captions
Language: zh-Hans

1
00:00:01.000 --> 00:00:04.000
<c>大家好，今天我们来讲解</c>

2
00:00:04.000 --> 00:00:08.000
大家好，今天我们来讲解
计算机科学的核心概念。

3
00:00:08.500 --> 00:00:12.000
计算机科学的核心概念。
`
      const md = cleanSubtitleToMarkdown(vtt, {
        title: '计算机导论第一课',
        uploader: '测试老师',
        durationFormatted: '10:00',
        webpage_url: 'https://example.com/course',
      })

      expect(md).toContain('# 计算机导论第一课')
      expect(md).toContain('测试老师')
      expect(md).toContain('10:00')
      expect(md).toContain('https://example.com/course')
      expect(md).toContain('## 讲座字幕与逐字稿')
      expect(md).not.toContain('WEBVTT')
      expect(md).not.toContain('00:00:01.000')
      expect(md).not.toContain('<c>')
      expect(md).toContain('大家好，今天我们来讲解 计算机科学的核心概念。')
    })
  })

  describe('updateYtdlpBinary', () => {
    it('executes yt-dlp -U and returns updated version', async () => {
      const execCalls = []
      const execFileImpl = (cmd, args, opts, cb) => {
        execCalls.push({ cmd, args })
        if (args.includes('-U')) {
          cb(null, 'Updated yt-dlp to version 2026.08.19\n')
        } else if (args.includes('--version')) {
          cb(null, '2026.08.19\n')
        } else {
          cb(new Error('Unknown command'))
        }
      }

      const res = await updateYtdlpBinary({
        ytdlpPath: 'C:\\test-tools\\yt-dlp.exe',
        proxy: 'http://127.0.0.1:7890',
        execFileImpl,
      })

      expect(res.success).toBe(true)
      expect(res.version).toBe('2026.08.19')
      expect(res.output).toContain('Updated yt-dlp')
      expect(execCalls[0].args).toContain('-U')
      expect(execCalls[0].args).toContain('--proxy')
      expect(execCalls[0].args).toContain('http://127.0.0.1:7890')
    })

    it('rejects on error during update', async () => {
      const execFileImpl = (cmd, args, opts, cb) => {
        cb(new Error('Update network error'), '', 'Network timeout')
      }

      await expect(
        updateYtdlpBinary({
          ytdlpPath: 'C:\\test-tools\\yt-dlp.exe',
          execFileImpl,
        })
      ).rejects.toThrow('Network timeout')
    })
  })

  describe('startDownloadProcess', () => {
    it('streams progress and handles completion', async () => {
      const mockChild = new EventEmitter()
      mockChild.stdout = new EventEmitter()
      mockChild.stderr = new EventEmitter()
      mockChild.killed = false
      mockChild.kill = () => {
        mockChild.killed = true
        mockChild.emit('close', 0)
      }

      const spawnImpl = () => mockChild

      const progressEvents = []
      const logEvents = []

      const { promise } = startDownloadProcess({
        url: 'https://example.com/video',
        outputDir: 'D:\\Downloads',
        spawnImpl,
        onProgress: (p) => progressEvents.push(p),
        onLog: (l) => logEvents.push(l),
      })

      mockChild.stdout.emit(
        'data',
        Buffer.from('[download]  50.0% of ~10.00MiB at 1.00MiB/s ETA 00:05\n')
      )
      mockChild.emit('close', 0)

      const result = await promise
      expect(result.success).toBe(true)
      expect(progressEvents).toHaveLength(1)
      expect(progressEvents[0].percent).toBe(50.0)
      expect(logEvents).toHaveLength(1)
    })

    it('handles cancellation properly', async () => {
      const mockChild = new EventEmitter()
      mockChild.stdout = new EventEmitter()
      mockChild.stderr = new EventEmitter()
      mockChild.killed = false
      mockChild.kill = () => {
        mockChild.killed = true
        mockChild.emit('close', 1)
      }

      const spawnImpl = () => mockChild

      const { promise, cancel } = startDownloadProcess({
        url: 'https://example.com/video',
        spawnImpl,
      })

      cancel()
      const result = await promise
      expect(result.cancelled).toBe(true)
    })
  })
})
