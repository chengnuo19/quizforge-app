import { useEffect, useMemo, useState, useRef } from 'react'
import ThemeToggle from './ThemeToggle.jsx'
import { listBooks, createBook } from '../quiz/books.js'
import {
  canUseYtdlp,
  checkEnvironment,
  fetchVideoInfo,
  startDownload,
  cancelDownload,
  extractSubtitles,
  selectDirectory,
  openFolder,
  getYtdlpConfig,
  saveYtdlpConfig,
  onDownloadProgress,
  onDownloadLog,
  importSubtitleAsResource,
  saveSubtitleMarkdownFile,
  updateYtdlpBinary,
} from '../quiz/ytdlp.js'
import { organizeLecture } from '../quiz/aiLectureNotes.js'

function formatFileName(title, ext = 'md') {
  const safe = String(title || 'video-transcript')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()
  return `${safe || 'video-transcript'}.${ext}`
}

export default function MediaDownloaderPanel({ onExit, theme, onToggleTheme, onResourcesChange }) {
  const available = canUseYtdlp()
  const books = useMemo(() => listBooks().filter((b) => !b.builtin), [])
  const [selectedBookId, setSelectedBookId] = useState(books[0]?.id || 'new')
  const [newBookName, setNewBookName] = useState('')

  const [url, setUrl] = useState('')
  const [parsing, setParsing] = useState(false)
  const [videoInfo, setVideoInfo] = useState(null)
  const [activeTab, setActiveTab] = useState('subtitles') // 'subtitles' | 'audio' | 'video'

  // Options
  const [subLang, setSubLang] = useState('zh-Hans,zh,en')
  const [audioFormat, setAudioFormat] = useState('mp3')
  const [videoFormat, setVideoFormat] = useState('best')
  const [downloadDir, setDownloadDir] = useState('')

  // Subtitle Markdown
  const [markdown, setMarkdown] = useState('')
  const [extractingSub, setExtractingSub] = useState(false)
  const [lectureNotes, setLectureNotes] = useState('')
  const [organizing, setOrganizing] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [organizeProgress, setOrganizeProgress] = useState({ done: 0, total: 0 })
  const [contentView, setContentView] = useState('transcript') // 'transcript' | 'notes'
  const shouldStopRef = useRef(false)
  const runIdRef = useRef(0)

  // Download & Progress state
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState(null)
  const [logs, setLogs] = useState([])
  const [lastSavedDir, setLastSavedDir] = useState('')

  // Messages & Feedback
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  // Environment & Settings Modal
  const [envStatus, setEnvStatus] = useState(null)
  const [showSettings, setShowSettings] = useState(false)
  const [updatingYtdlp, setUpdatingYtdlp] = useState(false)
  const [updateMessage, setUpdateMessage] = useState('')
  const [config, setConfig] = useState({
    ytdlpPath: '',
    ffmpegPath: '',
    downloadDir: '',
    defaultSubLang: 'zh-Hans,zh,en',
    defaultAudioFormat: 'mp3',
    concurrentFragments: 5,
    proxy: '',
  })

  // Load config & check environment
  useEffect(() => {
    if (!available) return

    getYtdlpConfig().then((cfg) => {
      setConfig(cfg)
      setDownloadDir(cfg.downloadDir || '')
      setAudioFormat(cfg.defaultAudioFormat || 'mp3')
      setSubLang(cfg.defaultSubLang || 'zh-Hans,zh,en')
      checkEnvironment({ ytdlpPath: cfg.ytdlpPath, ffmpegPath: cfg.ffmpegPath }).then(setEnvStatus)
    })

    const unsubProgress = onDownloadProgress((p) => {
      setProgress(p)
      if (p.status === 'finished') {
        setDownloading(false)
      }
    })

    const unsubLog = onDownloadLog((line) => {
      setLogs((prev) => [...prev.slice(-49), line])
    })

    return () => {
      unsubProgress()
      unsubLog()
    }
  }, [available])

  const handleParseUrl = async (e) => {
    e?.preventDefault()
    if (!url.trim()) return

    setParsing(true)
    setError('')
    setMessage('')
    setVideoInfo(null)
    setMarkdown('')
    setLectureNotes('')
    setContentView('transcript')
    shouldStopRef.current = true
    runIdRef.current += 1
    setOrganizing(false)
    setCancelling(false)
    setProgress(null)
    setLogs([])

    try {
      const info = await fetchVideoInfo(url.trim(), {
        ytdlpPath: config.ytdlpPath,
        proxy: config.proxy,
      })
      setVideoInfo(info)
      if (info.formats && info.formats.length > 0) {
        setVideoFormat(info.formats[0].id)
      }
      if (info.subtitles && info.subtitles.length > 0) {
        const hasZh = info.subtitles.find((s) => s.code.startsWith('zh'))
        setSubLang(hasZh ? hasZh.code : info.subtitles[0].code)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setParsing(false)
    }
  }

  const handleExtractSubtitles = async () => {
    if (!videoInfo) return
    setExtractingSub(true)
    setError('')
    setMessage('')
    setLogs([])

    try {
      const res = await extractSubtitles({
        url: videoInfo.webpage_url || url,
        subLang,
        videoInfo,
        ytdlpPath: config.ytdlpPath,
        ffmpegPath: config.ffmpegPath,
        proxy: config.proxy,
      })

      if (res.cancelled) {
        setMessage('已取消提取字幕。')
      } else if (res.markdown) {
        setMarkdown(res.markdown)
        setLectureNotes('')
        setContentView('transcript')
        shouldStopRef.current = true
        runIdRef.current += 1
        setOrganizing(false)
        setCancelling(false)
        setMessage('字幕提取并清洗成功！可直接在下方查看、编辑或导入笔记本。')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setExtractingSub(false)
    }
  }

  const handleImportToNotebook = () => {
    const contentToImport = (contentView === 'notes' && lectureNotes) ? lectureNotes : markdown
    if (!contentToImport) return
    try {
      const targetBook =
        selectedBookId === 'new'
          ? createBook({ name: newBookName || videoInfo?.title || '新视频课程' })
          : books.find((b) => b.id === selectedBookId)

      const resource = importSubtitleAsResource({
        markdown: contentToImport,
        videoInfo,
        notebookId: targetBook.id,
        notebookName: targetBook.name,
      })

      onResourcesChange?.()
      const typeLabel = contentView === 'notes' ? '整理后讲义' : '讲座文稿'
      setMessage(`已将${typeLabel}成功导入笔记本《${targetBook.name}》的资料库！`)
    } catch (err) {
      setError(err.message)
    }
  }

  const handleOrganizeLecture = async () => {
    if (!markdown || organizing) return
    const currentRunId = ++runIdRef.current
    setOrganizing(true)
    setCancelling(false)
    setError('')
    setMessage('')
    shouldStopRef.current = false
    setOrganizeProgress({ done: 0, total: 0 })

    try {
      const notes = await organizeLecture(markdown, {
        onProgress: (p) => {
          if (runIdRef.current === currentRunId && !shouldStopRef.current) {
            setOrganizeProgress(p)
          }
        },
        shouldStop: () => shouldStopRef.current || runIdRef.current !== currentRunId,
      })
      if (runIdRef.current === currentRunId && !shouldStopRef.current) {
        setLectureNotes(notes)
        setContentView('notes')
        setMessage('讲座文稿已成功整理为讲义！')
      }
    } catch (err) {
      if (err?.message === '已取消' || shouldStopRef.current || runIdRef.current !== currentRunId) {
        if (runIdRef.current === currentRunId) {
          setMessage('已取消 AI 整理')
        }
      } else {
        if (runIdRef.current === currentRunId) {
          setError(err?.message || '整理讲义失败')
        }
      }
    } finally {
      if (runIdRef.current === currentRunId) {
        setOrganizing(false)
        setCancelling(false)
      }
    }
  }

  const handleCancelOrganize = () => {
    shouldStopRef.current = true
    setCancelling(true)
  }

  const handleSaveMarkdown = async () => {
    const curText = (contentView === 'notes' && lectureNotes) ? lectureNotes : markdown
    if (!curText) return
    try {
      const baseName = videoInfo?.title || '讲座'
      const suffix = contentView === 'notes' ? '-讲义' : ''
      const fileName = formatFileName(`${baseName}${suffix}`, 'md')
      const res = await saveSubtitleMarkdownFile({ defaultFileName: fileName, markdown: curText })
      if (res) setMessage(`已保存 Markdown 文档：${res.path || fileName}`)
    } catch (err) {
      setError(err.message)
    }
  }

  const handleChooseDirectory = async () => {
    const chosen = await selectDirectory('选择下载保存文件夹')
    if (chosen) {
      setDownloadDir(chosen)
    }
  }

  const handleStartDownload = async (mode) => {
    if (!videoInfo) return
    setDownloading(true)
    setError('')
    setMessage('')
    setProgress({ percent: 0, status: 'downloading', speed: '', eta: '' })
    setLogs([])

    try {
      const targetDir = downloadDir || config.downloadDir
      const res = await startDownload({
        url: videoInfo.webpage_url || url,
        mode,
        outputDir: targetDir,
        format: videoFormat,
        audioFormat,
        concurrentFragments: config.concurrentFragments,
        proxy: config.proxy,
        ytdlpPath: config.ytdlpPath,
        ffmpegPath: config.ffmpegPath,
      })

      if (res.cancelled) {
        setMessage('用户已取消下载。')
      } else {
        const out = res.outputDir || targetDir
        setLastSavedDir(out)
        setMessage(`下载完成！文件已保存在：${out}`)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setDownloading(false)
    }
  }

  const handleCancelDownload = async () => {
    await cancelDownload()
    setDownloading(false)
    setMessage('已发送取消下载请求。')
  }

  const handleUpdateYtdlp = async () => {
    setUpdatingYtdlp(true)
    setUpdateMessage('正在检查并更新 yt-dlp，请稍候...')
    try {
      const res = await updateYtdlpBinary({
        ytdlpPath: config.ytdlpPath,
        proxy: config.proxy,
      })
      setUpdateMessage(`更新成功！当前版本: ${res.version || '最新'}`)
      const env = await checkEnvironment({
        ytdlpPath: config.ytdlpPath,
        ffmpegPath: config.ffmpegPath,
      })
      setEnvStatus(env)
    } catch (err) {
      setUpdateMessage(`更新失败: ${err.message}`)
    } finally {
      setUpdatingYtdlp(false)
    }
  }

  const handleSaveConfig = async (e) => {
    e.preventDefault()
    try {
      const saved = await saveYtdlpConfig(config)
      setConfig(saved)
      setShowSettings(false)
      setMessage('设置已保存。')
      // re-check environment
      const env = await checkEnvironment({
        ytdlpPath: saved.ytdlpPath,
        ffmpegPath: saved.ffmpegPath,
      })
      setEnvStatus(env)
    } catch (err) {
      setError(`保存设置失败: ${err.message}`)
    }
  }

  return (
    <div className="home">
      <div className="home__topbar">
        <button type="button" className="button button--secondary" onClick={onExit}>
          ← 返回首页
        </button>
        <h1 className="home__title">🎬 音视频工作台</h1>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {available && (
            <button
              type="button"
              className="button button--secondary"
              onClick={() => setShowSettings(true)}
              title="配置 yt-dlp 和下载设置"
            >
              ⚙ 设置
            </button>
          )}
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        </div>
      </div>

      <div className="home__content media-downloader-panel" style={{ maxWidth: '980px', margin: '0 auto', padding: '0 var(--space-md) var(--space-xl)' }}>
        {!available && (
          <div className="screenshot-organizer-panel__warning" style={{ marginBottom: '20px' }}>
            <div className="screenshot-organizer-panel__warning-icon">💻</div>
            <div className="screenshot-organizer-panel__warning-content">
              <strong>仅桌面版可用</strong>
              <p>音视频下载与字幕提取需要运行本地二进制程序（yt-dlp 与 ffmpeg）。请下载或启动 QuizForge Electron 桌面版使用此功能。</p>
            </div>
          </div>
        )}

        {/* Environment status banner */}
        {available && envStatus && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              padding: '10px 16px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--surface-card)',
              border: '1px solid var(--hairline)',
              fontSize: '13px',
              marginBottom: '16px',
            }}
          >
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
              <div>
                <span style={{ color: 'var(--muted)' }}>yt-dlp：</span>
                {envStatus.ytdlp?.available ? (
                  <span style={{ color: 'var(--success)', fontWeight: '600' }}>
                    已就绪 ({envStatus.ytdlp.version || '可运行'})
                  </span>
                ) : (
                  <span style={{ color: 'var(--rose)', fontWeight: '600' }}>
                    未就绪 ({envStatus.ytdlp?.error || '未找到可执行文件'})
                  </span>
                )}
              </div>
              <div>
                <span style={{ color: 'var(--muted)' }}>ffmpeg：</span>
                {envStatus.ffmpeg?.available ? (
                  <span style={{ color: 'var(--success)', fontWeight: '600' }}>
                    已就绪 (支持高画质音视频合并与转码)
                  </span>
                ) : (
                  <span style={{ color: 'var(--warning, #d4a017)' }}>
                    未检测到 (部分合并/转码受限)
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              className="button button--secondary"
              style={{ fontSize: '12px', padding: '4px 10px' }}
              onClick={() => setShowSettings(true)}
            >
              路径设置
            </button>
          </div>
        )}

        {message && (
          <div className="banner banner--success" style={{ marginBottom: '16px' }}>
            {message}
          </div>
        )}
        {error && (
          <div className="banner banner--error" style={{ marginBottom: '16px' }}>
            {error}
          </div>
        )}

        {/* URL Input Form */}
        <div
          style={{
            background: 'var(--surface-card)',
            border: '1px solid var(--hairline)',
            borderRadius: 'var(--radius-lg)',
            padding: '20px',
            marginBottom: '20px',
          }}
        >
          <form onSubmit={handleParseUrl} style={{ display: 'flex', gap: '12px' }}>
            <input
              type="text"
              className="input"
              style={{ flex: 1, fontSize: '15px' }}
              placeholder="输入或粘贴视频网址 (支持 Bilibili、YouTube 等视频/课程链接)..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={parsing || downloading || !available}
            />
            <button
              type="submit"
              className="button button--primary"
              disabled={parsing || downloading || !available || !url.trim()}
              style={{ minWidth: '110px' }}
            >
              {parsing ? '正在解析...' : '解析链接'}
            </button>
          </form>
          <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--muted)' }}>
            💡 支持 Bilibili、YouTube、MOOC 等国内外 1000+ 平台课程与讲座链接。
          </div>
        </div>

        {/* Video Info & Operations Card */}
        {videoInfo && (
          <div
            style={{
              background: 'var(--surface-card)',
              border: '1px solid var(--hairline)',
              borderRadius: 'var(--radius-lg)',
              padding: '20px',
              marginBottom: '20px',
            }}
          >
            {/* Header: Title, Thumbnail & Meta */}
            <div style={{ display: 'flex', gap: '20px', marginBottom: '20px', flexWrap: 'wrap' }}>
              {videoInfo.thumbnail && (
                <div style={{ position: 'relative', width: '220px', borderRadius: 'var(--radius-md)', overflow: 'hidden', background: '#000', flexShrink: 0 }}>
                  <img
                    src={videoInfo.thumbnail}
                    alt={videoInfo.title}
                    style={{ width: '100%', height: '124px', objectFit: 'cover', display: 'block' }}
                  />
                  {videoInfo.durationFormatted && (
                    <span
                      style={{
                        position: 'absolute',
                        bottom: '6px',
                        right: '6px',
                        background: 'rgba(0,0,0,0.75)',
                        color: '#fff',
                        fontSize: '11px',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        fontWeight: '600',
                      }}
                    >
                      {videoInfo.durationFormatted}
                    </span>
                  )}
                </div>
              )}
              <div style={{ flex: 1, minWidth: '240px' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', lineHeight: 1.35 }}>
                  {videoInfo.title}
                </h3>
                <div style={{ fontSize: '13px', color: 'var(--muted)', display: 'flex', flexWrap: 'wrap', gap: '16px', marginBottom: '8px' }}>
                  <span>作者/频道：<strong style={{ color: 'var(--body)' }}>{videoInfo.uploader}</strong></span>
                  {videoInfo.durationFormatted && (
                    <span>时长：<strong style={{ color: 'var(--body)' }}>{videoInfo.durationFormatted}</strong></span>
                  )}
                </div>
                {videoInfo.description && (
                  <p style={{ margin: 0, fontSize: '12px', color: 'var(--muted)', maxHeight: '42px', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                    {videoInfo.description}
                  </p>
                )}
              </div>
            </div>

            {/* Navigation Tabs */}
            <div
              style={{
                display: 'flex',
                borderBottom: '1px solid var(--hairline)',
                marginBottom: '20px',
                gap: '8px',
              }}
            >
              <button
                type="button"
                className={`button ${activeTab === 'subtitles' ? 'button--primary' : 'button--secondary'}`}
                style={{ borderRadius: '6px 6px 0 0', borderBottom: 'none' }}
                onClick={() => setActiveTab('subtitles')}
              >
                📝 提取文稿与字幕
              </button>
              <button
                type="button"
                className={`button ${activeTab === 'audio' ? 'button--primary' : 'button--secondary'}`}
                style={{ borderRadius: '6px 6px 0 0', borderBottom: 'none' }}
                onClick={() => setActiveTab('audio')}
              >
                🎵 下载音频 (MP3)
              </button>
              <button
                type="button"
                className={`button ${activeTab === 'video' ? 'button--primary' : 'button--secondary'}`}
                style={{ borderRadius: '6px 6px 0 0', borderBottom: 'none' }}
                onClick={() => setActiveTab('video')}
              >
                🎬 下载完整视频
              </button>
            </div>

            {/* Tab 1: Subtitle Extraction */}
            {activeTab === 'subtitles' && (
              <div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'center', marginBottom: '16px' }}>
                  <label style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span>字幕语言：</span>
                    <select
                      className="input"
                      style={{ padding: '6px 12px' }}
                      value={subLang}
                      onChange={(e) => setSubLang(e.target.value)}
                    >
                      {videoInfo.subtitles && videoInfo.subtitles.length > 0 ? (
                        videoInfo.subtitles.map((sub) => (
                          <option key={sub.code} value={sub.code}>
                            {sub.name} ({sub.code})
                          </option>
                        ))
                      ) : (
                        <>
                          <option value="zh-Hans,zh,en">中文简体 / 英文（自动匹配）</option>
                          <option value="zh-Hans">中文（简体）</option>
                          <option value="zh-Hant">中文（繁体）</option>
                          <option value="en">English (英文)</option>
                        </>
                      )}
                    </select>
                  </label>

                  <button
                    type="button"
                    className="button button--primary"
                    onClick={handleExtractSubtitles}
                    disabled={extractingSub || downloading}
                  >
                    {extractingSub ? '正在提取字幕...' : '提取字幕为文稿'}
                  </button>
                </div>

                {markdown && (
                  <div style={{ marginTop: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '13px', fontWeight: '600' }}>
                          {contentView === 'notes' ? 'AI 整理后的讲义：' : '清洗后的 Markdown 文稿预览与编辑：'}
                        </span>
                        {lectureNotes && (
                          <div style={{ display: 'flex', gap: '4px' }}>
                            <button
                              type="button"
                              className={`button ${contentView === 'transcript' ? 'button--primary' : 'button--secondary'}`}
                              style={{ fontSize: '11px', padding: '2px 8px' }}
                              onClick={() => setContentView('transcript')}
                            >
                              原始文稿
                            </button>
                            <button
                              type="button"
                              className={`button ${contentView === 'notes' ? 'button--primary' : 'button--secondary'}`}
                              style={{ fontSize: '11px', padding: '2px 8px' }}
                              onClick={() => setContentView('notes')}
                            >
                              整理后讲义
                            </button>
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                        {organizing ? (
                          <>
                            <button
                              type="button"
                              className="button button--secondary"
                              disabled
                              style={{ fontSize: '12px', padding: '4px 10px' }}
                            >
                              {organizeProgress.total > 0
                                ? `AI 整理中（第 ${organizeProgress.done + 1}/${organizeProgress.total} 块）…`
                                : 'AI 整理中…'}
                            </button>
                            <button
                              type="button"
                              className="button button--secondary"
                              disabled={cancelling}
                              style={{ fontSize: '12px', padding: '4px 10px' }}
                              onClick={handleCancelOrganize}
                            >
                              {cancelling ? '正在取消…' : '取消'}
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="button button--secondary"
                            style={{ fontSize: '12px', padding: '4px 10px' }}
                            onClick={handleOrganizeLecture}
                          >
                            AI 整理成讲义
                          </button>
                        )}
                        <button
                          type="button"
                          className="button button--secondary"
                          style={{ fontSize: '12px', padding: '4px 10px' }}
                          onClick={() => {
                            const curText = (contentView === 'notes' && lectureNotes) ? lectureNotes : markdown
                            navigator.clipboard.writeText(curText)
                            setMessage('内容已复制到剪贴板！')
                          }}
                        >
                          复制文稿
                        </button>
                        <button
                          type="button"
                          className="button button--secondary"
                          style={{ fontSize: '12px', padding: '4px 10px' }}
                          onClick={handleSaveMarkdown}
                        >
                          另存为 .md
                        </button>
                      </div>
                    </div>

                    <textarea
                      className="input markitdown-panel__textarea"
                      style={{
                        width: '100%',
                        fontFamily: 'var(--font-mono, monospace)',
                        fontSize: '13px',
                        lineHeight: 1.6,
                        minHeight: '220px',
                        marginBottom: '16px',
                      }}
                      value={contentView === 'notes' ? lectureNotes : markdown}
                      onChange={(e) => {
                        if (contentView === 'notes') {
                          setLectureNotes(e.target.value)
                        } else {
                          setMarkdown(e.target.value)
                        }
                      }}
                    />

                    {/* Import to notebook row */}
                    <div
                      style={{
                        background: 'var(--canvas)',
                        border: '1px solid var(--hairline)',
                        borderRadius: 'var(--radius-md)',
                        padding: '14px 16px',
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '12px',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '13px', fontWeight: '500' }}>导入目标笔记本：</span>
                        <select
                          className="input"
                          style={{ padding: '6px 10px', fontSize: '13px' }}
                          value={selectedBookId}
                          onChange={(e) => setSelectedBookId(e.target.value)}
                        >
                          {books.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                          <option value="new">+ 新建笔记本...</option>
                        </select>
                        {selectedBookId === 'new' && (
                          <input
                            type="text"
                            className="input"
                            style={{ padding: '6px 10px', fontSize: '13px', minWidth: '160px' }}
                            placeholder="输入新笔记本名称"
                            value={newBookName}
                            onChange={(e) => setNewBookName(e.target.value)}
                          />
                        )}
                      </div>
                      <button
                        type="button"
                        className="button button--primary"
                        onClick={handleImportToNotebook}
                      >
                        📥 导入到笔记本资料库
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Tab 2: Audio Download */}
            {activeTab === 'audio' && (
              <div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'center' }}>
                    <label style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span>音频格式：</span>
                      <select
                        className="input"
                        style={{ padding: '6px 12px' }}
                        value={audioFormat}
                        onChange={(e) => setAudioFormat(e.target.value)}
                      >
                        <option value="mp3">MP3 高品质 (默认推荐)</option>
                        <option value="m4a">M4A (AAC)</option>
                        <option value="wav">WAV (无损)</option>
                      </select>
                    </label>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                      <span style={{ color: 'var(--muted)' }}>保存目录：</span>
                      <span
                        style={{
                          background: 'var(--canvas)',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          border: '1px solid var(--hairline)',
                          maxWidth: '260px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {downloadDir || config.downloadDir || '默认下载目录'}
                      </span>
                      <button
                        type="button"
                        className="button button--secondary"
                        style={{ fontSize: '12px', padding: '4px 10px' }}
                        onClick={handleChooseDirectory}
                      >
                        更改目录
                      </button>
                    </div>
                  </div>

                  <div>
                    <button
                      type="button"
                      className="button button--primary"
                      onClick={() => handleStartDownload('audio')}
                      disabled={downloading}
                    >
                      {downloading ? '下载中...' : '开始下载音频'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Tab 3: Video Download */}
            {activeTab === 'video' && (
              <div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'center' }}>
                    <label style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span>清晰度 / 画质：</span>
                      <select
                        className="input"
                        style={{ padding: '6px 12px' }}
                        value={videoFormat}
                        onChange={(e) => setVideoFormat(e.target.value)}
                      >
                        {videoInfo.formats && videoInfo.formats.length > 0 ? (
                          videoInfo.formats.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.label}
                            </option>
                          ))
                        ) : (
                          <>
                            <option value="best">最佳画质与音质 (推荐)</option>
                            <option value="1080p">1080p 全高清</option>
                            <option value="720p">720p 高清</option>
                            <option value="480p">480p 标清</option>
                          </>
                        )}
                      </select>
                    </label>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                      <span style={{ color: 'var(--muted)' }}>保存目录：</span>
                      <span
                        style={{
                          background: 'var(--canvas)',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          border: '1px solid var(--hairline)',
                          maxWidth: '260px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {downloadDir || config.downloadDir || '默认下载目录'}
                      </span>
                      <button
                        type="button"
                        className="button button--secondary"
                        style={{ fontSize: '12px', padding: '4px 10px' }}
                        onClick={handleChooseDirectory}
                      >
                        更改目录
                      </button>
                    </div>
                  </div>

                  <div>
                    <button
                      type="button"
                      className="button button--primary"
                      onClick={() => handleStartDownload('video')}
                      disabled={downloading}
                    >
                      {downloading ? '下载中...' : '开始下载视频'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Progress & Log section */}
        {(downloading || progress) && (
          <div
            style={{
              background: 'var(--surface-card)',
              border: '1px solid var(--hairline)',
              borderRadius: 'var(--radius-lg)',
              padding: '18px 20px',
              marginBottom: '20px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <span style={{ fontSize: '14px', fontWeight: '600' }}>
                {downloading ? '正在下载 / 处理中...' : '下载状态'}
              </span>
              <div style={{ display: 'flex', gap: '8px' }}>
                {downloading && (
                  <button
                    type="button"
                    className="button button--secondary"
                    style={{ fontSize: '12px', padding: '3px 10px' }}
                    onClick={handleCancelDownload}
                  >
                    取消下载
                  </button>
                )}
                {!downloading && lastSavedDir && (
                  <button
                    type="button"
                    className="button button--secondary"
                    style={{ fontSize: '12px', padding: '3px 10px' }}
                    onClick={() => openFolder(lastSavedDir)}
                  >
                    打开保存目录
                  </button>
                )}
              </div>
            </div>

            {/* Progress Bar */}
            <div
              style={{
                width: '100%',
                height: '10px',
                borderRadius: '5px',
                background: 'var(--canvas)',
                border: '1px solid var(--hairline)',
                overflow: 'hidden',
                marginBottom: '8px',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${Math.min(100, Math.max(0, progress?.percent || 0))}%`,
                  background: 'var(--primary)',
                  transition: 'width 0.2s ease',
                }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--muted)' }}>
              <span>
                进度：<strong>{progress?.percent != null ? `${progress.percent.toFixed(1)}%` : '计算中...'}</strong>
                {progress?.totalSize ? ` · 大小: ${progress.totalSize}` : ''}
              </span>
              <span>
                {progress?.speed ? `速度: ${progress.speed}` : ''}
                {progress?.eta ? ` · 预估剩余: ${progress.eta}` : ''}
              </span>
            </div>

            {/* Collapsible log view */}
            {logs.length > 0 && (
              <details style={{ marginTop: '12px', fontSize: '12px' }}>
                <summary style={{ cursor: 'pointer', color: 'var(--muted)' }}>
                  查看运行日志 ({logs.length} 行)
                </summary>
                <pre
                  style={{
                    marginTop: '8px',
                    padding: '10px',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--canvas)',
                    border: '1px solid var(--hairline)',
                    maxHeight: '140px',
                    overflowY: 'auto',
                    fontSize: '11px',
                    lineHeight: 1.4,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                  }}
                >
                  {logs.join('\n')}
                </pre>
              </details>
            )}
          </div>
        )}
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div className="modal-backdrop" onClick={() => setShowSettings(false)}>
          <div
            className="modal"
            style={{ maxWidth: '540px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal__header">
              <h2 className="modal__title">yt-dlp 工具设置</h2>
              <button
                type="button"
                className="modal__close"
                onClick={() => setShowSettings(false)}
              >
                ×
              </button>
            </div>
            <form onSubmit={handleSaveConfig} className="modal__body">
              <div className="form-group" style={{ marginBottom: '14px' }}>
                <label className="label">yt-dlp 可执行文件路径：</label>
                <input
                  type="text"
                  className="input"
                  value={config.ytdlpPath}
                  onChange={(e) => setConfig({ ...config, ytdlpPath: e.target.value })}
                  placeholder="默认: yt-dlp"
                />
                <span style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginTop: '4px' }}>
                  默认指向 yt-dlp，若重新安装或迁移可在此修改。
                </span>
              </div>

              {/* yt-dlp Update Section */}
              <div
                style={{
                  background: 'var(--surface-hover)',
                  border: '1px solid var(--hairline)',
                  borderRadius: 'var(--radius-md)',
                  padding: '10px 12px',
                  marginBottom: '14px',
                  fontSize: '12px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                  <div>
                    <span style={{ color: 'var(--muted)' }}>当前版本：</span>
                    <strong>{envStatus?.ytdlp?.version || '未检测到'}</strong>
                  </div>
                  <button
                    type="button"
                    className="button button--secondary"
                    style={{ fontSize: '12px', padding: '4px 10px' }}
                    onClick={handleUpdateYtdlp}
                    disabled={updatingYtdlp}
                  >
                    {updatingYtdlp ? '正在更新...' : '检查并一键更新 yt-dlp'}
                  </button>
                </div>
                {updateMessage && (
                  <div style={{ marginTop: '8px', color: updateMessage.includes('失败') ? 'var(--rose)' : 'var(--success)' }}>
                    {updateMessage}
                  </div>
                )}
                <span style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginTop: '6px' }}>
                  提示：若 YouTube 出现 100~150 KiB/s 限速，通常是因为 YouTube 调整了签名算法，点击一键更新即可解除限速。
                </span>
              </div>

              <div className="form-group" style={{ marginBottom: '14px' }}>
                <label className="label">并发分片下载数（-N / 提速）：</label>
                <input
                  type="number"
                  min="1"
                  max="16"
                  className="input"
                  value={config.concurrentFragments ?? 5}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      concurrentFragments: parseInt(e.target.value, 10) || 1,
                    })
                  }
                  placeholder="推荐: 4 - 8"
                />
                <span style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginTop: '4px' }}>
                  设置同时下载视频分片的线程数（默认 5），可大幅提升 YouTube/Bilibili 等分片流视频的下载速度。
                </span>
              </div>

              <div className="form-group" style={{ marginBottom: '14px' }}>
                <label className="label">网络代理（Proxy，可选）：</label>
                <input
                  type="text"
                  className="input"
                  value={config.proxy || ''}
                  onChange={(e) => setConfig({ ...config, proxy: e.target.value })}
                  placeholder="例如: http://127.0.0.1:7890 (留空使用系统网络)"
                />
                <span style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginTop: '4px' }}>
                  若下载国外视频（如 YouTube）速度慢或连接超时，可填入本地代理端口（例如 Clash 的 7890 端口）。
                </span>
              </div>

              <div className="form-group" style={{ marginBottom: '14px' }}>
                <label className="label">ffmpeg 可执行文件路径：</label>
                <input
                  type="text"
                  className="input"
                  value={config.ffmpegPath}
                  onChange={(e) => setConfig({ ...config, ffmpegPath: e.target.value })}
                  placeholder="默认: ffmpeg.exe 或 ffmpeg"
                />
                <span style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginTop: '4px' }}>
                  用于音视频合并与高质量转码（如 MP3 提取）。
                </span>
              </div>

              <div className="form-group" style={{ marginBottom: '14px' }}>
                <label className="label">默认下载保存目录：</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    className="input"
                    value={config.downloadDir}
                    onChange={(e) => setConfig({ ...config, downloadDir: e.target.value })}
                    placeholder="系统默认 Downloads 文件夹"
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="button button--secondary"
                    onClick={async () => {
                      const dir = await selectDirectory('选择默认下载目录')
                      if (dir) setConfig({ ...config, downloadDir: dir })
                    }}
                  >
                    浏览...
                  </button>
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: '20px' }}>
                <label className="label">默认字幕抓取语言：</label>
                <input
                  type="text"
                  className="input"
                  value={config.defaultSubLang}
                  onChange={(e) => setConfig({ ...config, defaultSubLang: e.target.value })}
                  placeholder="zh-Hans,zh,en"
                />
              </div>

              <div className="modal__footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => setShowSettings(false)}
                >
                  取消
                </button>
                <button type="submit" className="button button--primary">
                  保存设置
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
