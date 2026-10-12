// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MediaDownloaderPanel from './MediaDownloaderPanel.jsx'

vi.mock('../quiz/ytdlp.js', () => ({
  canUseYtdlp: vi.fn(),
  checkEnvironment: vi.fn(),
  fetchVideoInfo: vi.fn(),
  startDownload: vi.fn(),
  cancelDownload: vi.fn(),
  extractSubtitles: vi.fn(),
  selectDirectory: vi.fn(),
  openFolder: vi.fn(),
  getYtdlpConfig: vi.fn(),
  saveYtdlpConfig: vi.fn(),
  onDownloadProgress: vi.fn(() => () => {}),
  onDownloadLog: vi.fn(() => () => {}),
  importSubtitleAsResource: vi.fn(),
  saveSubtitleMarkdownFile: vi.fn(),
  updateYtdlpBinary: vi.fn(),
}))

vi.mock('../quiz/books.js', () => ({
  createBook: vi.fn(({ name }) => ({ id: `book:${name}`, name })),
  listBooks: vi.fn(() => [{ id: 'book-1', name: '公开课笔记', builtin: false }]),
}))

vi.mock('../quiz/aiLectureNotes.js', () => ({
  organizeLecture: vi.fn(),
}))

const ytdlp = await import('../quiz/ytdlp.js')
const aiLectureNotes = await import('../quiz/aiLectureNotes.js')

beforeEach(() => {
  ytdlp.canUseYtdlp.mockReturnValue(true)
  ytdlp.checkEnvironment.mockResolvedValue({
    ytdlp: { available: true, path: 'C:\\test-tools\\yt-dlp.exe', version: '2024.05.26' },
    ffmpeg: { available: true, path: 'C:\\test-tools\\ffmpeg\\ffmpeg.exe', version: '6.0' },
  })
  ytdlp.getYtdlpConfig.mockResolvedValue({
    ytdlpPath: 'C:\\test-tools\\yt-dlp.exe',
    ffmpegPath: 'C:\\test-tools\\ffmpeg\\ffmpeg.exe',
    downloadDir: 'C:\\Users\\User\\Downloads',
    defaultSubLang: 'zh-Hans,zh,en',
    defaultAudioFormat: 'mp3',
    concurrentFragments: 5,
    proxy: '',
  })
  ytdlp.updateYtdlpBinary.mockResolvedValue({
    success: true,
    version: '2026.08.19',
    output: 'Updated yt-dlp to version 2026.08.19',
  })
  ytdlp.onDownloadProgress.mockImplementation(() => () => {})
  ytdlp.onDownloadLog.mockImplementation(() => () => {})
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('MediaDownloaderPanel', () => {
  it('displays desktop-only warning when canUseYtdlp returns false', () => {
    ytdlp.canUseYtdlp.mockReturnValue(false)

    render(<MediaDownloaderPanel onExit={() => {}} />)

    expect(screen.getByText('仅桌面版可用')).toBeTruthy()
  })

  it('renders input and parses video url successfully', async () => {
    ytdlp.fetchVideoInfo.mockResolvedValue({
      id: 'abc12345',
      title: '算法设计与分析公开课',
      duration: 3600,
      durationFormatted: '01:00:00',
      uploader: '算法研讨社',
      thumbnail: 'https://example.com/thumb.jpg',
      webpage_url: 'https://example.com/watch?v=abc12345',
      description: '讲解动态规划与贪心算法',
      formats: [{ id: 'best', label: '最佳画质与音质 (推荐)' }],
      subtitles: [{ code: 'zh-Hans', name: '中文（简体）', isAuto: false }],
    })

    render(<MediaDownloaderPanel onExit={() => {}} />)

    const input = screen.getByPlaceholderText(/输入或粘贴视频网址/)
    fireEvent.change(input, { target: { value: 'https://example.com/watch?v=abc12345' } })

    const submitBtn = screen.getByRole('button', { name: '解析链接' })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(screen.getByText('算法设计与分析公开课')).toBeTruthy()
      expect(screen.getByText('算法研讨社')).toBeTruthy()
      expect(screen.getAllByText('01:00:00').length).toBeGreaterThan(0)
    })
  })

  it('extracts subtitles and imports to notebook', async () => {
    ytdlp.fetchVideoInfo.mockResolvedValue({
      id: 'abc12345',
      title: '测试视频课程',
      durationFormatted: '10:00',
      uploader: '讲师',
      subtitles: [{ code: 'zh-Hans', name: '中文（简体）', isAuto: false }],
    })

    ytdlp.extractSubtitles.mockResolvedValue({
      markdown: '# 测试视频课程\n\n这是提取并清洗好的视频字幕文稿。',
    })

    render(<MediaDownloaderPanel onExit={() => {}} />)

    const input = screen.getByPlaceholderText(/输入或粘贴视频网址/)
    fireEvent.change(input, { target: { value: 'https://example.com/watch?v=abc12345' } })
    fireEvent.click(screen.getByRole('button', { name: '解析链接' }))

    await waitFor(() => {
      expect(screen.getByText('测试视频课程')).toBeTruthy()
    })

    // Click extract subtitles
    const extractBtn = screen.getByRole('button', { name: '提取字幕为文稿' })
    fireEvent.click(extractBtn)

    await waitFor(() => {
      expect(screen.getByDisplayValue(/这是提取并清洗好的视频字幕文稿/)).toBeTruthy()
    })

    // Click import to notebook
    const importBtn = screen.getByRole('button', { name: /导入到笔记本资料库/ })
    fireEvent.click(importBtn)

    expect(ytdlp.importSubtitleAsResource).toHaveBeenCalled()
    await waitFor(() => {
      expect(screen.getByText(/已将讲座文稿成功导入笔记本/)).toBeTruthy()
    })
  })

  it('triggers audio and video downloads with correct parameters', async () => {
    ytdlp.fetchVideoInfo.mockResolvedValue({
      id: 'video999',
      title: '演讲视频',
      durationFormatted: '20:00',
      uploader: '演说家',
      formats: [{ id: 'best', label: '最佳质量' }],
    })
    ytdlp.startDownload.mockResolvedValue({
      success: true,
      outputDir: 'C:\\Users\\User\\Downloads',
    })

    render(<MediaDownloaderPanel onExit={() => {}} />)

    const input = screen.getByPlaceholderText(/输入或粘贴视频网址/)
    fireEvent.change(input, { target: { value: 'https://example.com/watch?v=video999' } })
    fireEvent.click(screen.getByRole('button', { name: '解析链接' }))

    await waitFor(() => {
      expect(screen.getByText('演讲视频')).toBeTruthy()
    })

    // Switch to Audio tab
    fireEvent.click(screen.getByRole('button', { name: /下载音频/ }))
    fireEvent.click(screen.getByRole('button', { name: '开始下载音频' }))

    await waitFor(() => {
      expect(ytdlp.startDownload).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'audio',
          audioFormat: 'mp3',
        })
      )
    })

    // Wait until downloading finishes
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '开始下载音频' })).toBeTruthy()
    })

    // Switch to Video tab
    fireEvent.click(screen.getByRole('button', { name: /下载完整视频/ }))
    fireEvent.click(screen.getByRole('button', { name: '开始下载视频' }))

    await waitFor(() => {
      expect(ytdlp.startDownload).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'video',
        })
      )
    })
  })

  it('can open and close settings modal and trigger yt-dlp update', async () => {
    render(<MediaDownloaderPanel onExit={() => {}} />)

    const settingsBtn = screen.getByRole('button', { name: '⚙ 设置' })
    fireEvent.click(settingsBtn)

    expect(screen.getByText('yt-dlp 工具设置')).toBeTruthy()
    expect(screen.getByText('并发分片下载数（-N / 提速）：')).toBeTruthy()
    expect(screen.getByText('网络代理（Proxy，可选）：')).toBeTruthy()

    // Trigger update yt-dlp
    const updateBtn = screen.getByRole('button', { name: '检查并一键更新 yt-dlp' })
    fireEvent.click(updateBtn)

    await waitFor(() => {
      expect(ytdlp.updateYtdlpBinary).toHaveBeenCalled()
      expect(screen.getByText(/更新成功！当前版本: 2026.08.19/)).toBeTruthy()
    })

    const closeBtn = screen.getByText('×')
    fireEvent.click(closeBtn)

    await waitFor(() => {
      expect(screen.queryByText('yt-dlp 工具设置')).toBeNull()
    })
  })

  it('AI 整理成讲义后切换到讲义，再点导入时向资料库导入讲义文本', async () => {
    ytdlp.fetchVideoInfo.mockResolvedValue({
      id: 'abc12345',
      title: '分布式系统核心理论',
      durationFormatted: '45:00',
      uploader: '教授',
      subtitles: [{ code: 'zh-Hans', name: '中文（简体）', isAuto: false }],
    })

    ytdlp.extractSubtitles.mockResolvedValue({
      markdown: '原始字幕：今天我们讨论 CAP 定理和一致性协议。',
    })

    aiLectureNotes.organizeLecture.mockResolvedValue('## CAP 定理讲义\n- 一致性 (C)\n- 可用性 (A)\n- 分区容错性 (P)')

    render(<MediaDownloaderPanel onExit={() => {}} />)

    const input = screen.getByPlaceholderText(/输入或粘贴视频网址/)
    fireEvent.change(input, { target: { value: 'https://example.com/watch?v=abc12345' } })
    fireEvent.click(screen.getByRole('button', { name: '解析链接' }))

    await waitFor(() => {
      expect(screen.getByText('分布式系统核心理论')).toBeTruthy()
    })

    // 提取字幕
    fireEvent.click(screen.getByRole('button', { name: '提取字幕为文稿' }))
    await waitFor(() => {
      expect(screen.getByDisplayValue(/原始字幕：今天我们讨论 CAP 定理/)).toBeTruthy()
    })

    // 点击 AI 整理成讲义
    const organizeBtn = screen.getByRole('button', { name: 'AI 整理成讲义' })
    expect(organizeBtn).toBeTruthy()
    fireEvent.click(organizeBtn)

    await waitFor(() => {
      expect(aiLectureNotes.organizeLecture).toHaveBeenCalledWith(
        '原始字幕：今天我们讨论 CAP 定理和一致性协议。',
        expect.objectContaining({
          onProgress: expect.any(Function),
          shouldStop: expect.any(Function),
        })
      )
      // 成功后自动切到讲义视图
      expect(screen.getByDisplayValue(/## CAP 定理讲义/)).toBeTruthy()
      expect(screen.getByRole('button', { name: '整理后讲义' })).toBeTruthy()
    })

    // 导入到资料库
    const importBtn = screen.getByRole('button', { name: /导入到笔记本资料库/ })
    fireEvent.click(importBtn)

    expect(ytdlp.importSubtitleAsResource).toHaveBeenCalledWith(
      expect.objectContaining({
        markdown: '## CAP 定理讲义\n- 一致性 (C)\n- 可用性 (A)\n- 分区容错性 (P)',
      })
    )

    // 切回原始文稿后再导入，则导入原始文稿
    fireEvent.click(screen.getByRole('button', { name: '原始文稿' }))
    expect(screen.getByDisplayValue(/原始字幕：今天我们讨论 CAP 定理/)).toBeTruthy()

    fireEvent.click(importBtn)
    expect(ytdlp.importSubtitleAsResource).toHaveBeenLastCalledWith(
      expect.objectContaining({
        markdown: '原始字幕：今天我们讨论 CAP 定理和一致性协议。',
      })
    )
  })

  it('整理出讲义后，提取新字幕会清空讲义并切回原始文稿，导入时使用新文稿', async () => {
    ytdlp.fetchVideoInfo.mockResolvedValue({
      id: 'videoA',
      title: '视频A',
      durationFormatted: '10:00',
      uploader: '讲师',
      subtitles: [{ code: 'zh-Hans', name: '中文（简体）', isAuto: false }],
    })

    ytdlp.extractSubtitles.mockResolvedValueOnce({
      markdown: '视频A文稿内容',
    })

    aiLectureNotes.organizeLecture.mockResolvedValueOnce('## 视频A整理后的讲义')

    render(<MediaDownloaderPanel onExit={() => {}} />)

    const input = screen.getByPlaceholderText(/输入或粘贴视频网址/)
    fireEvent.change(input, { target: { value: 'https://example.com/watch?v=videoA' } })
    fireEvent.click(screen.getByRole('button', { name: '解析链接' }))

    await waitFor(() => {
      expect(screen.getByText('视频A')).toBeTruthy()
    })

    // 提取字幕A并整理成讲义
    fireEvent.click(screen.getByRole('button', { name: '提取字幕为文稿' }))
    await waitFor(() => expect(screen.getByDisplayValue('视频A文稿内容')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'AI 整理成讲义' }))
    await waitFor(() => expect(screen.getByDisplayValue(/## 视频A整理后的讲义/)).toBeTruthy())

    // 现在模拟提取新字幕B
    ytdlp.extractSubtitles.mockResolvedValueOnce({
      markdown: '视频B全新文稿',
    })
    fireEvent.click(screen.getByRole('button', { name: '提取字幕为文稿' }))

    // 提取完成后应清空讲义，切回原始文稿
    await waitFor(() => {
      expect(screen.getByDisplayValue('视频B全新文稿')).toBeTruthy()
      expect(screen.queryByRole('button', { name: '整理后讲义' })).toBeNull()
    })

    // 此时点击导入，收到的应是视频B全新文稿，而不是旧讲义A
    const importBtn = screen.getByRole('button', { name: /导入到笔记本资料库/ })
    fireEvent.click(importBtn)

    expect(ytdlp.importSubtitleAsResource).toHaveBeenLastCalledWith(
      expect.objectContaining({
        markdown: '视频B全新文稿',
      })
    )
  })

  it('整理进行中提取新字幕，旧整理结果返回后不会写入 lectureNotes', async () => {
    ytdlp.fetchVideoInfo.mockResolvedValue({
      id: 'videoC',
      title: '视频C',
      durationFormatted: '10:00',
      uploader: '讲师',
      subtitles: [{ code: 'zh-Hans', name: '中文（简体）', isAuto: false }],
    })

    ytdlp.extractSubtitles.mockResolvedValueOnce({
      markdown: '视频C原始文稿',
    })

    let resolveOldOrganize
    const oldOrganizePromise = new Promise((resolve) => {
      resolveOldOrganize = resolve
    })
    aiLectureNotes.organizeLecture.mockReturnValueOnce(oldOrganizePromise)

    render(<MediaDownloaderPanel onExit={() => {}} />)

    const input = screen.getByPlaceholderText(/输入或粘贴视频网址/)
    fireEvent.change(input, { target: { value: 'https://example.com/watch?v=videoC' } })
    fireEvent.click(screen.getByRole('button', { name: '解析链接' }))

    await waitFor(() => expect(screen.getByText('视频C')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: '提取字幕为文稿' }))
    await waitFor(() => expect(screen.getByDisplayValue('视频C原始文稿')).toBeTruthy())

    // 点击 AI 整理（处于挂起中）
    fireEvent.click(screen.getByRole('button', { name: 'AI 整理成讲义' }))
    expect(screen.getByRole('button', { name: /AI 整理中/ })).toBeTruthy()

    // 此时提取新字幕
    ytdlp.extractSubtitles.mockResolvedValueOnce({
      markdown: '视频D最新字幕',
    })
    fireEvent.click(screen.getByRole('button', { name: '提取字幕为文稿' }))

    await waitFor(() => {
      expect(screen.getByDisplayValue('视频D最新字幕')).toBeTruthy()
    })

    // 旧的整理异步返回
    await act(async () => {
      resolveOldOrganize('## 滞后返回的旧讲义C')
    })

    // 页面依然是视频D最新字幕，且不包含旧讲义C
    expect(screen.getByDisplayValue('视频D最新字幕')).toBeTruthy()
    expect(screen.queryByDisplayValue(/## 滞后返回的旧讲义C/)).toBeNull()
    expect(screen.queryByRole('button', { name: '整理后讲义' })).toBeNull()
  })

  it('点击取消后，按钮文字显示“正在取消…”并被禁用', async () => {
    ytdlp.fetchVideoInfo.mockResolvedValue({
      id: 'videoE',
      title: '视频E',
      durationFormatted: '10:00',
      uploader: '讲师',
      subtitles: [{ code: 'zh-Hans', name: '中文（简体）', isAuto: false }],
    })

    ytdlp.extractSubtitles.mockResolvedValueOnce({
      markdown: '视频E文稿',
    })

    let rejectOrganize
    const pendingPromise = new Promise((_, reject) => {
      rejectOrganize = reject
    })
    aiLectureNotes.organizeLecture.mockReturnValueOnce(pendingPromise)

    render(<MediaDownloaderPanel onExit={() => {}} />)

    const input = screen.getByPlaceholderText(/输入或粘贴视频网址/)
    fireEvent.change(input, { target: { value: 'https://example.com/watch?v=videoE' } })
    fireEvent.click(screen.getByRole('button', { name: '解析链接' }))

    await waitFor(() => expect(screen.getByText('视频E')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: '提取字幕为文稿' }))
    await waitFor(() => expect(screen.getByDisplayValue('视频E文稿')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'AI 整理成讲义' }))
    const cancelBtn = screen.getByRole('button', { name: '取消' })
    expect(cancelBtn).toBeTruthy()

    fireEvent.click(cancelBtn)
    expect(screen.getByRole('button', { name: '正在取消…' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '正在取消…' }).disabled).toBe(true)

    // 释放 promise
    await act(async () => {
      rejectOrganize(new Error('已取消'))
    })

    await waitFor(() => {
      expect(screen.getByText('已取消 AI 整理')).toBeTruthy()
    })
  })
})
