// Desktop document-conversion bridge. Two engines sit behind the same preload
// object: MarkItDown (fast, text extraction) and Docling (slow, layout-aware).
// The legacy `*WithMarkitdown` helpers stay as-is so older callers keep working.

// Engine metadata, rendered as the panel's engine picker.
export const ENGINES = [
  {
    id: 'markitdown',
    label: 'MarkItDown',
    hint: '快 · 轻量，适合有文字层的单栏文档',
  },
  {
    id: 'docling',
    label: 'Docling',
    hint: '慢 · 做版面分析，双栏 / 表格 / 公式更准',
  },
]

export const DEFAULT_ENGINE = 'markitdown'

export function engineLabel(engineId) {
  return ENGINES.find((engine) => engine.id === engineId)?.label || engineId
}

function getApi() {
  if (typeof window === 'undefined') return null
  return window.markitdown || null
}

export function canUseMarkitdown() {
  const api = getApi()
  return !!api
    && typeof api.selectAndConvertFile === 'function'
    && typeof api.saveMarkdownFile === 'function'
}

export async function selectAndConvertWithMarkitdown() {
  if (!canUseMarkitdown()) {
    throw new Error('MarkItDown is only available in the desktop app.')
  }

  const result = await getApi().selectAndConvertFile()
  if (result == null) return null

  return {
    path: String(result.path || ''),
    markdown: String(result.markdown || ''),
  }
}

// True once the desktop shell is new enough to pick an engine. An older preload
// only knows MarkItDown, so the panel silently falls back rather than breaking.
export function canSelectEngine() {
  const api = getApi()
  return !!api && typeof api.selectAndConvertWithEngine === 'function'
}

export async function selectAndConvertWithEngine(engine = DEFAULT_ENGINE, { ocr = false } = {}) {
  if (!canUseMarkitdown()) {
    throw new Error('MarkItDown is only available in the desktop app.')
  }

  if (!canSelectEngine()) {
    const legacy = await selectAndConvertWithMarkitdown()
    return legacy && { ...legacy, engine: DEFAULT_ENGINE, via: 'cli' }
  }

  const result = await getApi().selectAndConvertWithEngine({ engine, ocr })
  if (result == null) return null

  return {
    path: String(result.path || ''),
    markdown: String(result.markdown || ''),
    engine: String(result.engine || engine),
    // 'serve' (warm Docling service) or 'cli' (one-shot, much slower).
    via: String(result.via || 'cli'),
  }
}

// Docling streams stage-by-stage progress. Returns an unsubscribe function; a
// no-op when the desktop shell does not publish progress at all.
export function onConvertProgress(callback) {
  const api = getApi()
  if (!api || typeof api.onConvertProgress !== 'function') return () => {}
  return api.onConvertProgress(callback)
}

export async function saveMarkdownWithMarkitdown({ defaultFileName, markdown }) {
  if (!canUseMarkitdown()) {
    throw new Error('MarkItDown is only available in the desktop app.')
  }

  const result = await getApi().saveMarkdownFile({
    defaultFileName: String(defaultFileName || 'markitdown-output.md'),
    markdown: String(markdown || ''),
  })
  if (result == null) return null

  return {
    path: String(result.path || ''),
  }
}
