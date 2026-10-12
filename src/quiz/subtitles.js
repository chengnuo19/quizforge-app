import { loadAiSettings } from './storage.js'
import { chatCompletion, isAiConfigured } from './aiClient.js'

// Line-length budgets for short-video platforms: a Chinese line beyond ~16
// characters wraps on a 1080-wide vertical frame, English beyond ~42 chars.
const MAX_CHARS = { zh: 16, en: 42 }
const MAX_CUE_SECONDS = 6
const MIN_CUE_SECONDS = 1
const WORD_GAP_SECONDS = 0.8
const SENTENCE_END = /[。！？!?.…]$/
const CLAUSE_END = /[，、；：,;:]$/

export const SUBTITLE_MODES = ['bilingual', 'zh', 'en']

export function detectLang(text) {
  const value = String(text || '')
  const cjk = (value.match(/[㐀-鿿豈-﫿]/g) || []).length
  const latinWords = (value.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) || []).length
  return cjk > 0 && cjk >= latinWords ? 'zh' : 'en'
}

function displayLength(text) {
  return String(text || '').trim().length
}

function makeCue(words) {
  const text = words.map((w) => w.word).join('').replace(/\s+/g, ' ').trim()
  return { start: words[0].start, end: words[words.length - 1].end, text }
}

// Sentence ends and long pauses are hard breaks.
function splitSentences(words) {
  const sentences = []
  let current = []
  for (const word of words) {
    const prev = current[current.length - 1]
    if (prev && word.start - prev.end > WORD_GAP_SECONDS) {
      sentences.push(current)
      current = []
    }
    current.push(word)
    if (SENTENCE_END.test(String(word.word || '').trim())) {
      sentences.push(current)
      current = []
    }
  }
  if (current.length) sentences.push(current)
  return sentences
}

// Cuts an over-long sentence into evenly sized cues ("Hello everyone, and
// welcome back" / "to the channel." rather than a 41-char line plus a
// one-word orphan), preferring to break right after a comma.
function balancedSplit(words, limit) {
  const text = makeCue(words).text
  const duration = words[words.length - 1].end - words[0].start
  const parts = Math.max(Math.ceil(displayLength(text) / limit), Math.ceil(duration / MAX_CUE_SECONDS))
  if (parts <= 1 || words.length === 1) return [words]

  const target = displayLength(text) / parts
  let best = 1
  let bestScore = Infinity
  for (let i = 1; i < words.length; i += 1) {
    const left = displayLength(makeCue(words.slice(0, i)).text)
    if (left > limit && i > 1) break
    const token = String(words[i - 1].word || '').trim()
    const bonus = CLAUSE_END.test(token) ? limit * 0.25 : 0
    const score = Math.abs(left - target) - bonus
    if (score < bestScore) {
      bestScore = score
      best = i
    }
  }
  return [words.slice(0, best), ...balancedSplit(words.slice(best), limit)]
}

function splitByWords(words, lang) {
  return splitSentences(words)
    .flatMap((sentence) => balancedSplit(sentence, MAX_CHARS[lang]))
    .map(makeCue)
}

// Whisper's Chinese output often uses ASCII punctuation ("你好,世界"); use
// full-width marks after Chinese characters so the subtitle reads naturally.
function normalizeChinesePunctuation(text) {
  const map = { ',': '，', '?': '？', '!': '！', ':': '：', ';': '；' }
  return text.replace(/([㐀-鿿])\s*([,?!:;])\s*/g, (_, ch, mark) => ch + map[mark])
}

// Turns whisper segments (which can run 20+ seconds) into short subtitle cues.
export function resegment(rawSegments = []) {
  const cues = []
  for (const seg of rawSegments) {
    const lang = seg.lang === 'zh' || seg.lang === 'en' ? seg.lang : detectLang(seg.text)
    const words = (seg.words || []).filter((w) => String(w.word || '').trim())
    const pieces = words.length ? splitByWords(words, lang) : [{ start: seg.start, end: seg.end, text: String(seg.text || '').trim() }]
    for (const piece of pieces) {
      const text = lang === 'zh' ? normalizeChinesePunctuation(piece.text) : piece.text
      if (text) cues.push({ ...piece, text, lang })
    }
  }

  cues.sort((a, b) => a.start - b.start)
  return cues.map((cue, index) => {
    const next = cues[index + 1]
    let end = Math.max(cue.end, cue.start + MIN_CUE_SECONDS)
    if (next) end = Math.min(end, next.start)
    return {
      id: index + 1,
      start: round(cue.start),
      end: round(Math.max(end, cue.start + 0.2)),
      lang: cue.lang,
      text: cue.text,
      translation: '',
    }
  })
}

function round(value) {
  return Math.round(value * 1000) / 1000
}

export function zhText(seg) {
  return (seg.lang === 'zh' ? seg.text : seg.translation) || seg.text || ''
}

export function enText(seg) {
  return (seg.lang === 'en' ? seg.text : seg.translation) || seg.text || ''
}

export function needsTranslation(seg, mode) {
  if (seg.translation) return false
  if (mode === 'bilingual') return true
  return seg.lang !== mode
}

const TRANSLATE_PROMPT = `你是专业的视频字幕翻译。
输入是 JSON：{"context": [前文几句], "items": [{"i": 编号, "lang": "zh" 或 "en", "text": 原文}]}。
规则：
1. lang 为 zh 的条目翻译成自然的英文；lang 为 en 的条目翻译成简体中文。
2. 译文口语化、简洁，适合做短视频字幕；专有名词和技术术语可保留英文。
3. 每条单独翻译，不要合并、拆分或遗漏条目。context 只用来理解语境，不要翻译它。
4. 只输出 JSON 数组：[{"i": 1, "t": "译文"}, ...]，条数必须和 items 相同，不要输出任何解释。`

function parseTranslationReply(content, expectedCount) {
  const text = String(content || '').replace(/```(?:json)?/gi, '')
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end <= start) throw new Error('AI 返回的不是 JSON 数组')
  const list = JSON.parse(text.slice(start, end + 1))
  const byIndex = new Map(list.map((item) => [Number(item.i), String(item.t ?? '').trim()]))
  const result = []
  for (let i = 1; i <= expectedCount; i += 1) {
    if (!byIndex.has(i)) throw new Error(`AI 返回的条数不对（缺少第 ${i} 条）`)
    result.push(byIndex.get(i))
  }
  return result
}

async function requestTranslations(batch, context, settings, fetchImpl) {
  let reply
  try {
    reply = await chatCompletion({
      system: TRANSLATE_PROMPT,
      user: JSON.stringify({
        context,
        items: batch.map((seg, k) => ({ i: k + 1, lang: seg.lang, text: seg.text })),
      }),
      temperature: 0.3,
    }, { settings, fetchImpl })
  } catch (err) {
    // 请求本身失败（网络、鉴权、额度）重试也没用，交给 translateBatch 直接抛出。
    err.isRequestError = true
    throw err
  }
  return parseTranslationReply(reply, batch.length)
}

// One retry, then halve the batch: a model that miscounts 40 lines usually
// gets 20 right, and a single line can never be miscounted.
async function translateBatch(batch, context, settings, fetchImpl) {
  try {
    return await requestTranslations(batch, context, settings, fetchImpl)
  } catch (firstError) {
    if (firstError.isRequestError) throw firstError
    try {
      return await requestTranslations(batch, context, settings, fetchImpl)
    } catch (secondError) {
      if (batch.length === 1) throw secondError
      const mid = Math.ceil(batch.length / 2)
      const left = await translateBatch(batch.slice(0, mid), context, settings, fetchImpl)
      const right = await translateBatch(batch.slice(mid), batch.slice(Math.max(0, mid - 3), mid).map((s) => s.text), settings, fetchImpl)
      return [...left, ...right]
    }
  }
}

// Translates only the cues the chosen mode still needs, so a resumed job
// picks up where it stopped. onProgress receives the updated segment list
// after every batch so the caller can persist it.
export async function translateSegments(segments, options = {}) {
  const settings = options.settings || loadAiSettings()
  if (!isAiConfigured(settings)) {
    throw new Error('未配置 AI API Key，请先在右上角设置中配置。')
  }
  const fetchImpl = options.fetchImpl || globalThis.fetch
  const batchSize = options.batchSize || 40
  const mode = options.mode || 'bilingual'
  const shouldStop = options.shouldStop || (() => false)
  const result = segments.map((seg) => ({ ...seg }))
  const pending = result.map((seg, index) => ({ seg, index })).filter(({ seg }) => needsTranslation(seg, mode))
  const total = pending.length

  for (let offset = 0; offset < pending.length; offset += batchSize) {
    if (shouldStop()) break
    const chunk = pending.slice(offset, offset + batchSize)
    const firstIndex = chunk[0].index
    const context = result.slice(Math.max(0, firstIndex - 3), firstIndex).map((seg) => seg.text)
    const translations = await translateBatch(chunk.map(({ seg }) => seg), context, settings, fetchImpl)
    chunk.forEach(({ index }, k) => {
      result[index] = { ...result[index], translation: translations[k] }
    })
    options.onProgress?.({ done: Math.min(offset + chunk.length, total), total, segments: result.map((seg) => ({ ...seg })) })
  }
  return result
}

function linesFor(seg, mode) {
  if (mode === 'zh') return [zhText(seg)]
  if (mode === 'en') return [enText(seg)]
  return [zhText(seg), enText(seg)].filter((line, index, all) => line && all.indexOf(line) === index)
}

function pad(value, size = 2) {
  return String(value).padStart(size, '0')
}

export function formatSrtTime(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000))
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`
}

export function formatAssTime(seconds) {
  const cs = Math.max(0, Math.round(seconds * 100))
  const h = Math.floor(cs / 360000)
  const m = Math.floor((cs % 360000) / 6000)
  const s = Math.floor((cs % 6000) / 100)
  return `${h}:${pad(m)}:${pad(s)}.${pad(cs % 100)}`
}

export function toSrt(segments, mode = 'bilingual') {
  return segments
    .map((seg, index) => `${index + 1}\n${formatSrtTime(seg.start)} --> ${formatSrtTime(seg.end)}\n${linesFor(seg, mode).join('\n')}\n`)
    .join('\n')
}

export function resolveLayout(width, height, layout = 'auto') {
  if (layout === 'vertical' || layout === 'horizontal') return layout
  return height > width ? 'vertical' : 'horizontal'
}

function escapeAss(text) {
  return String(text || '').replace(/\r?\n/g, ' ').replace(/{/g, '（').replace(/}/g, '）')
}

// Vertical videos keep subtitles ~18% above the bottom edge so Douyin /
// Xiaohongshu captions and buttons don't cover them.
export function toAss(segments, mode = 'bilingual', options = {}) {
  const width = Number(options.width) || 1920
  const height = Number(options.height) || 1080
  const layout = resolveLayout(width, height, options.layout)
  const base = Math.min(width, height)
  const mainSize = Math.round(base * 0.055)
  const subSize = Math.round(mainSize * 0.7)
  const outline = Math.max(2, Math.round(base * 0.004))
  const marginV = Math.round(height * (layout === 'vertical' ? 0.18 : 0.06))
  const marginH = Math.round(width * 0.05)
  const font = 'Microsoft YaHei'

  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Main,${font},${mainSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,${outline},1,2,${marginH},${marginH},${marginV},1`,
    `Style: Sub,${font},${subSize},&H00E6E6E6,&H00E6E6E6,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,${Math.max(2, outline - 1)},1,2,${marginH},${marginH},${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ]

  const events = segments.map((seg) => {
    const lines = linesFor(seg, mode).map(escapeAss)
    const text = lines.length > 1 ? `${lines[0]}\\N{\\rSub}${lines.slice(1).join(' ')}` : lines[0] || ''
    return `Dialogue: 0,${formatAssTime(seg.start)},${formatAssTime(seg.end)},Main,,0,0,0,,${text}`
  })

  return `${[...header, ...events].join('\n')}\n`
}
