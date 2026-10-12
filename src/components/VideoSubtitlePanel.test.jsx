// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import VideoSubtitlePanel from './VideoSubtitlePanel.jsx'

vi.mock('../quiz/videoSubtitle.js', () => ({
  canUseVideoSubtitle: vi.fn(),
  checkSubtitleEnv: vi.fn(),
  selectVideo: vi.fn(),
  transcribeVideo: vi.fn(),
  saveSubtitleProject: vi.fn(),
  exportSrtFile: vi.fn(),
  burnVideo: vi.fn(),
  cancelSubtitleJob: vi.fn(),
  showInFolder: vi.fn(),
  onSubtitleProgress: vi.fn(() => () => {}),
  onSubtitleLog: vi.fn(() => () => {}),
}))

vi.mock('../quiz/subtitles.js', async (importOriginal) => ({
  ...(await importOriginal()),
  translateSegments: vi.fn(),
}))

const api = await import('../quiz/videoSubtitle.js')
const subtitles = await import('../quiz/subtitles.js')

const ENV_OK = {
  whisper: { available: true, python: 'C:\\Py312\\python.exe', version: '1.2.1', cudaDevices: 1, error: '' },
  ffmpeg: { available: true, ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', hasNvenc: true, error: '' },
}
const PROBE = { width: 1080, height: 1920, duration: 65, hasAudio: true }

beforeEach(() => {
  api.canUseVideoSubtitle.mockReturnValue(true)
  api.checkSubtitleEnv.mockResolvedValue(ENV_OK)
  api.saveSubtitleProject.mockResolvedValue('E:\\v\\talk.subtitles.json')
  api.onSubtitleProgress.mockImplementation(() => () => {})
  api.onSubtitleLog.mockImplementation(() => () => {})
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('VideoSubtitlePanel', () => {
  it('explains that the feature needs the desktop app', () => {
    api.canUseVideoSubtitle.mockReturnValue(false)
    render(<VideoSubtitlePanel onExit={() => {}} />)
    expect(screen.getByText(/需要在桌面版/)).toBeTruthy()
  })

  it('shows install commands when the environment is missing', async () => {
    api.checkSubtitleEnv.mockResolvedValue({
      whisper: { available: false, error: '没有找到装了 faster-whisper 的 Python' },
      ffmpeg: { available: false, error: '没有找到支持字幕烧录（libass）的 ffmpeg' },
    })
    render(<VideoSubtitlePanel onExit={() => {}} />)
    expect(await screen.findByText(/pip install faster-whisper/)).toBeTruthy()
    expect(screen.getByText('winget install Gyan.FFmpeg')).toBeTruthy()
    expect(screen.getByRole('button', { name: '选择视频' }).disabled).toBe(true)
  })

  it('selects a video, transcribes it into editable cues and autosaves', async () => {
    api.selectVideo.mockResolvedValue({ videoPath: 'E:\\v\\talk.mp4', probe: PROBE, project: null })
    api.transcribeVideo.mockResolvedValue({
      cancelled: false,
      device: 'cuda',
      segments: [
        { start: 0, end: 2, text: 'Hello everyone.', words: [] },
        { start: 2, end: 4, text: '大家好', words: [] },
      ],
    })
    render(<VideoSubtitlePanel onExit={() => {}} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '选择视频' }).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: '选择视频' }))
    expect(await screen.findByText(/talk\.mp4 · 01:05 · 1080×1920/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '开始识别' }))
    expect(await screen.findByText('识别完成（GPU）：共 2 句。')).toBeTruthy()
    expect(api.transcribeVideo).toHaveBeenCalledWith({ videoPath: 'E:\\v\\talk.mp4', duration: 65 })
    expect(screen.getByLabelText('第 1 句原文').value).toBe('Hello everyone.')
    expect(screen.getByText('当前按竖屏排版')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('第 2 句译文'), { target: { value: 'Hi all' } })
    await waitFor(() => expect(api.saveSubtitleProject).toHaveBeenCalled(), { timeout: 2000 })
    const [, project] = api.saveSubtitleProject.mock.calls.at(-1)
    expect(project.segments[1].translation).toBe('Hi all')
  })

  it('restores a saved project, translates, exports SRT and burns the video', async () => {
    const saved = [
      { id: 1, start: 0, end: 2, lang: 'en', text: 'Hello', translation: '' },
      { id: 2, start: 2, end: 4, lang: 'zh', text: '谢谢', translation: '' },
    ]
    api.selectVideo.mockResolvedValue({ videoPath: 'E:\\v\\talk.mp4', probe: PROBE, project: { segments: saved, mode: 'bilingual' } })
    subtitles.translateSegments.mockImplementation(async (segs) => segs.map((s) => ({ ...s, translation: s.lang === 'en' ? '你好' : 'Thanks' })))
    api.exportSrtFile.mockResolvedValue('E:\\v\\talk.bilingual.srt')
    api.burnVideo.mockResolvedValue({ cancelled: false, outputPath: 'E:\\v\\talk.bilingual.subtitled.mp4' })

    render(<VideoSubtitlePanel onExit={() => {}} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '选择视频' }).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: '选择视频' }))
    expect(await screen.findByText('已恢复上次的进度：2 句字幕。')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'AI 翻译（2 句待翻译）' }))
    expect(await screen.findByText('翻译完成，可以逐句检查修改。')).toBeTruthy()
    expect(screen.getByRole('button', { name: '翻译已完成' }).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: '导出 SRT' }))
    expect(await screen.findByText('已导出字幕：talk.bilingual.srt')).toBeTruthy()
    expect(api.exportSrtFile.mock.calls[0][0].content).toContain('你好\nHello')

    fireEvent.click(screen.getByRole('button', { name: '烧录字幕成片' }))
    expect(await screen.findByText('成片已生成：talk.bilingual.subtitled.mp4')).toBeTruthy()
    const burnPayload = api.burnVideo.mock.calls[0][0]
    expect(burnPayload).toMatchObject({ videoPath: 'E:\\v\\talk.mp4', mode: 'bilingual', duration: 65 })
    expect(burnPayload.assContent).toContain('PlayResY: 1920')
    expect(burnPayload.assContent).toContain('你好\\N{\\rSub}Hello')

    fireEvent.click(screen.getByRole('button', { name: '打开所在文件夹' }))
    expect(api.showInFolder).toHaveBeenCalledWith('E:\\v\\talk.bilingual.subtitled.mp4')
  })

  it('toggling a cue language clears its translation', async () => {
    api.selectVideo.mockResolvedValue({
      videoPath: 'E:\\v\\talk.mp4',
      probe: PROBE,
      project: { segments: [{ id: 1, start: 0, end: 2, lang: 'en', text: 'OK', translation: '好' }] },
    })
    render(<VideoSubtitlePanel onExit={() => {}} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '选择视频' }).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: '选择视频' }))
    fireEvent.click(await screen.findByRole('button', { name: 'EN' }))
    expect(screen.getByRole('button', { name: '中' })).toBeTruthy()
    expect(screen.getByLabelText('第 1 句译文').value).toBe('')
  })
})
