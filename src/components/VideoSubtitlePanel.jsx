import { memo, useCallback, useEffect, useRef, useState } from 'react'
import {
  canUseVideoSubtitle,
  checkSubtitleEnv,
  selectVideo,
  transcribeVideo,
  saveSubtitleProject,
  exportSrtFile,
  burnVideo,
  cancelSubtitleJob,
  showInFolder,
  onSubtitleProgress,
  onSubtitleLog,
} from '../quiz/videoSubtitle.js'
import { resegment, translateSegments, needsTranslation, toSrt, toAss, resolveLayout } from '../quiz/subtitles.js'

const WHISPER_INSTALL_CMD = 'py -3.12 -m pip install faster-whisper nvidia-cublas-cu12 "nvidia-cudnn-cu12==9.*"'
const FFMPEG_INSTALL_CMD = 'winget install Gyan.FFmpeg'

const MODE_OPTIONS = [
  { value: 'bilingual', label: '中英双语' },
  { value: 'zh', label: '仅中文' },
  { value: 'en', label: '仅英文' },
]

const LAYOUT_OPTIONS = [
  { value: 'auto', label: '按视频自动' },
  { value: 'vertical', label: '竖屏（抖音/小红书）' },
  { value: 'horizontal', label: '横屏' },
]

const STAGE_LABELS = {
  audio: '正在提取音频',
  transcribe: '正在识别语音',
  translate: '正在翻译',
  burn: '正在烧录字幕',
}

function formatClock(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

function fileName(filePath) {
  return String(filePath || '').split(/[\\/]/).pop()
}

const SegmentRow = memo(function SegmentRow({ seg, index, onChange, onToggleLang }) {
  return (
    <tr>
      <td style={{ whiteSpace: 'nowrap', fontSize: '12px', verticalAlign: 'top', paddingTop: '10px' }}>
        {formatClock(seg.start)}
      </td>
      <td style={{ verticalAlign: 'top', paddingTop: '6px' }}>
        <button
          type="button"
          className="button button--secondary"
          style={{ padding: '2px 8px', fontSize: '12px' }}
          title="语言识别错了？点一下切换，并清空译文"
          onClick={() => onToggleLang(index)}
        >
          {seg.lang === 'zh' ? '中' : 'EN'}
        </button>
      </td>
      <td style={{ width: '45%' }}>
        <input
          className="book-editor__input"
          style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px' }}
          aria-label={`第 ${index + 1} 句原文`}
          value={seg.text}
          onChange={(e) => onChange(index, 'text', e.target.value)}
        />
      </td>
      <td style={{ width: '45%' }}>
        <input
          className="book-editor__input"
          style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px' }}
          aria-label={`第 ${index + 1} 句译文`}
          value={seg.translation}
          placeholder="（未翻译）"
          onChange={(e) => onChange(index, 'translation', e.target.value)}
        />
      </td>
    </tr>
  )
})

export default function VideoSubtitlePanel({ onExit, theme, onToggleTheme }) {
  const available = canUseVideoSubtitle()
  const [env, setEnv] = useState(null)
  const [checkingEnv, setCheckingEnv] = useState(false)
  const [video, setVideo] = useState(null)
  const [segments, setSegments] = useState([])
  const [mode, setMode] = useState('bilingual')
  const [layout, setLayout] = useState('auto')
  const [busy, setBusy] = useState('')
  const [progress, setProgress] = useState(null)
  const [logs, setLogs] = useState([])
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [outputPath, setOutputPath] = useState('')
  const stopTranslateRef = useRef(false)

  const runEnvCheck = useCallback(async () => {
    setCheckingEnv(true)
    try {
      setEnv(await checkSubtitleEnv())
    } catch (err) {
      setError(err.message)
    } finally {
      setCheckingEnv(false)
    }
  }, [])

  useEffect(() => {
    if (!available) return undefined
    runEnvCheck()
    const unsubProgress = onSubtitleProgress((data) => setProgress(data))
    const unsubLog = onSubtitleLog((line) => setLogs((prev) => [...prev.slice(-199), line]))
    return () => {
      unsubProgress()
      unsubLog()
    }
  }, [available, runEnvCheck])

  // Autosave so an hour-long job survives a crash or an accidental close.
  useEffect(() => {
    if (!video || !segments.length) return undefined
    const timer = setTimeout(() => {
      saveSubtitleProject(video.videoPath, { version: 1, probe: video.probe, mode, layout, segments }).catch(() => {})
    }, 800)
    return () => clearTimeout(timer)
  }, [video, segments, mode, layout])

  const ready = env?.whisper?.available && env?.ffmpeg?.available
  const pendingCount = segments.filter((seg) => needsTranslation(seg, mode)).length

  const resetFeedback = () => {
    setError('')
    setMessage('')
    setOutputPath('')
    setProgress(null)
  }

  const handleSelectVideo = async () => {
    resetFeedback()
    try {
      const picked = await selectVideo()
      if (!picked) return
      setVideo({ videoPath: picked.videoPath, probe: picked.probe })
      setLogs([])
      const saved = picked.project
      if (saved && Array.isArray(saved.segments) && saved.segments.length) {
        setSegments(saved.segments)
        if (saved.mode) setMode(saved.mode)
        if (saved.layout) setLayout(saved.layout)
        setMessage(`已恢复上次的进度：${saved.segments.length} 句字幕。`)
      } else {
        setSegments([])
      }
    } catch (err) {
      setError(err.message)
    }
  }

  const handleTranscribe = async () => {
    resetFeedback()
    setBusy('transcribe')
    try {
      const result = await transcribeVideo({ videoPath: video.videoPath, duration: video.probe.duration })
      if (result.cancelled) {
        setMessage('已取消识别。')
        return
      }
      const cues = resegment(result.segments)
      setSegments(cues)
      setMessage(`识别完成（${result.device === 'cuda' ? 'GPU' : 'CPU'}）：共 ${cues.length} 句。`)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy('')
      setProgress(null)
    }
  }

  const handleTranslate = async () => {
    resetFeedback()
    setBusy('translate')
    stopTranslateRef.current = false
    try {
      const result = await translateSegments(segments, {
        mode,
        shouldStop: () => stopTranslateRef.current,
        onProgress: ({ done, total, segments: partial }) => {
          setSegments(partial)
          setProgress({ stage: 'translate', percent: total ? (done / total) * 100 : 100, done, total })
        },
      })
      setSegments(result)
      setMessage(stopTranslateRef.current ? '已暂停翻译，已翻译的部分已保存。' : '翻译完成，可以逐句检查修改。')
    } catch (err) {
      setError(`${err.message}（已翻译的部分已保存，可再次点击继续）`)
    } finally {
      setBusy('')
      setProgress(null)
    }
  }

  const handleCancel = async () => {
    stopTranslateRef.current = true
    await cancelSubtitleJob()
  }

  const handleExportSrt = async () => {
    resetFeedback()
    try {
      const filePath = await exportSrtFile({ videoPath: video.videoPath, mode, content: toSrt(segments, mode) })
      setOutputPath(filePath)
      setMessage(`已导出字幕：${fileName(filePath)}`)
    } catch (err) {
      setError(err.message)
    }
  }

  const handleBurn = async () => {
    resetFeedback()
    setBusy('burn')
    try {
      const assContent = toAss(segments, mode, { width: video.probe.width, height: video.probe.height, layout })
      const result = await burnVideo({ videoPath: video.videoPath, assContent, mode, duration: video.probe.duration })
      if (result.cancelled) {
        setMessage('已取消烧录。')
        return
      }
      setOutputPath(result.outputPath)
      setMessage(`成片已生成：${fileName(result.outputPath)}`)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy('')
      setProgress(null)
    }
  }

  const handleSegmentChange = useCallback((index, field, value) => {
    setSegments((prev) => prev.map((seg, i) => (i === index ? { ...seg, [field]: value } : seg)))
  }, [])

  const handleToggleLang = useCallback((index) => {
    setSegments((prev) => prev.map((seg, i) => (i === index ? { ...seg, lang: seg.lang === 'zh' ? 'en' : 'zh', translation: '' } : seg)))
  }, [])

  const progressLabel = progress
    ? `${STAGE_LABELS[progress.stage] || '处理中'} ${Math.round(progress.percent || 0)}%` +
      (progress.stage === 'transcribe' && progress.segments ? `（已识别 ${progress.segments} 段）` : '') +
      (progress.stage === 'translate' ? `（${progress.done}/${progress.total} 句）` : '')
    : busy
      ? `${STAGE_LABELS[busy] || '处理中'}…`
      : ''

  const card = { border: '1px solid var(--hairline)', borderRadius: '12px', padding: '16px', marginBottom: '16px' }
  const resolvedLayout = video ? resolveLayout(video.probe.width, video.probe.height, layout) : ''

  return (
    <div className="home">
      <div className="home__topbar">
        <button type="button" className="button button--secondary" onClick={onExit}>
          ← 返回首页
        </button>
        <h1 className="home__title">💬 视频加字幕</h1>
        <button type="button" className="button button--secondary" onClick={onToggleTheme}>
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </div>

      <div className="home__content" style={{ maxWidth: '1100px', margin: '0 auto', padding: '0 var(--space-md) var(--space-xl)' }}>
        {!available ? (
          <div className="banner banner--error">视频加字幕需要在桌面版（Electron）中使用。</div>
        ) : (
          <>
            {message && <div className="banner banner--success" style={{ marginBottom: '16px' }}>{message}</div>}
            {error && <div className="banner banner--error" style={{ marginBottom: '16px', whiteSpace: 'pre-wrap' }}>{error}</div>}

            <section style={card} aria-label="环境检查">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                <h2 style={{ margin: 0, fontSize: '16px' }}>① 环境检查</h2>
                <button type="button" className="button button--secondary" onClick={runEnvCheck} disabled={checkingEnv || !!busy}>
                  {checkingEnv ? '检查中…' : '重新检查'}
                </button>
              </div>
              {env && (
                <ul style={{ margin: '12px 0 0', paddingLeft: '20px', lineHeight: 1.8 }}>
                  <li>
                    语音识别 faster-whisper：
                    {env.whisper.available
                      ? `✅ ${env.whisper.version}（${env.whisper.cudaDevices > 0 ? '可用 GPU 加速' : '仅 CPU，速度较慢'}）`
                      : `❌ ${env.whisper.error}`}
                    {!env.whisper.available && <div><code>{WHISPER_INSTALL_CMD}</code></div>}
                  </li>
                  <li>
                    ffmpeg（字幕烧录）：
                    {env.ffmpeg.available
                      ? `✅ ${env.ffmpeg.ffmpeg}${env.ffmpeg.hasNvenc ? '（支持显卡编码）' : ''}`
                      : `❌ ${env.ffmpeg.error}`}
                    {!env.ffmpeg.available && <div><code>{FFMPEG_INSTALL_CMD}</code></div>}
                  </li>
                </ul>
              )}
            </section>

            <section style={card} aria-label="选择视频">
              <h2 style={{ margin: '0 0 12px', fontSize: '16px' }}>② 选择视频并识别</h2>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
                <button type="button" className="button button--secondary" onClick={handleSelectVideo} disabled={!ready || !!busy}>
                  选择视频
                </button>
                {video && (
                  <span style={{ wordBreak: 'break-all' }}>
                    {fileName(video.videoPath)} · {formatClock(video.probe.duration)} · {video.probe.width}×{video.probe.height}
                  </span>
                )}
              </div>
              {video && (
                <div style={{ marginTop: '12px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <button type="button" className="button button--primary" onClick={handleTranscribe} disabled={!!busy}>
                    {segments.length ? '重新识别' : '开始识别'}
                  </button>
                  <span style={{ fontSize: '13px', opacity: 0.75 }}>首次识别会自动下载约 1.6GB 的语音模型。</span>
                </div>
              )}
            </section>

            {(busy || progress) && (
              <section style={card} aria-label="进度">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                  <span>{progressLabel}</span>
                  <button type="button" className="button button--secondary" onClick={handleCancel}>
                    {busy === 'translate' ? '暂停' : '取消'}
                  </button>
                </div>
                <div style={{ height: '8px', borderRadius: '4px', background: 'var(--hairline)', overflow: 'hidden' }}>
                  <div
                    role="progressbar"
                    aria-valuenow={Math.round(progress?.percent || 0)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    style={{ height: '100%', width: `${progress?.percent || 0}%`, background: 'var(--primary)', transition: 'width 0.3s' }}
                  />
                </div>
                {logs.length > 0 && (
                  <pre style={{ margin: '10px 0 0', maxHeight: '120px', overflow: 'auto', fontSize: '12px', whiteSpace: 'pre-wrap' }}>
                    {logs.slice(-6).join('\n')}
                  </pre>
                )}
              </section>
            )}

            {segments.length > 0 && (
              <>
                <section style={card} aria-label="字幕设置">
                  <h2 style={{ margin: '0 0 12px', fontSize: '16px' }}>③ 翻译与导出</h2>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'center' }}>
                    <label>
                      字幕语言：
                      <select className="book-editor__input" style={{ marginLeft: '6px' }} value={mode} onChange={(e) => setMode(e.target.value)} disabled={!!busy}>
                        {MODE_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                      </select>
                    </label>
                    <label>
                      画面方向：
                      <select className="book-editor__input" style={{ marginLeft: '6px' }} value={layout} onChange={(e) => setLayout(e.target.value)} disabled={!!busy}>
                        {LAYOUT_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                      </select>
                    </label>
                    <span style={{ fontSize: '13px', opacity: 0.75 }}>
                      当前按{resolvedLayout === 'vertical' ? '竖屏' : '横屏'}排版
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '14px', alignItems: 'center' }}>
                    <button type="button" className="button button--primary" onClick={handleTranslate} disabled={!!busy || pendingCount === 0}>
                      {pendingCount ? `AI 翻译（${pendingCount} 句待翻译）` : '翻译已完成'}
                    </button>
                    <button type="button" className="button button--secondary" onClick={handleExportSrt} disabled={!!busy}>
                      导出 SRT
                    </button>
                    <button type="button" className="button button--primary" onClick={handleBurn} disabled={!!busy}>
                      烧录字幕成片
                    </button>
                    {outputPath && (
                      <button type="button" className="button button--secondary" onClick={() => showInFolder(outputPath)}>
                        打开所在文件夹
                      </button>
                    )}
                  </div>
                  {pendingCount > 0 && (
                    <p style={{ margin: '10px 0 0', fontSize: '13px', opacity: 0.8 }}>
                      还有 {pendingCount} 句没有翻译，导出时会先显示原文。
                    </p>
                  )}
                </section>

                <section style={card} aria-label="字幕校对">
                  <h2 style={{ margin: '0 0 12px', fontSize: '16px' }}>④ 逐句校对（{segments.length} 句，修改会自动保存）</h2>
                  <div style={{ maxHeight: '60vh', overflow: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ textAlign: 'left', fontSize: '13px' }}>
                          <th>时间</th>
                          <th>语言</th>
                          <th>原文</th>
                          <th>译文</th>
                        </tr>
                      </thead>
                      <tbody>
                        {segments.map((seg, index) => (
                          <SegmentRow key={seg.id} seg={seg} index={index} onChange={handleSegmentChange} onToggleLang={handleToggleLang} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
