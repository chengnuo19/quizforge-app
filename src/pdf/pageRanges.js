// Page-range parsing for PDF operations (split / extract / rotate / delete).
// 1-based page numbers. Accepts "1-5, 6-10, 15" (also full-width "，" and
// whitespace). Overlapping / adjacent ranges are merged so results are
// predictable. All functions throw Chinese, actionable errors — never "Unknown".

export function parsePageRanges(input, pageCount) {
  const text = String(input ?? '')
    .replace(/，/g, ',')
    .trim()
  if (!text) throw new Error('请输入要处理的页码，例如：1-5, 6-10, 15')
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new Error('无效的页面总数')
  }

  const parts = text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (parts.length === 0) throw new Error('请输入要处理的页码，例如：1-5, 6-10, 15')

  const ranges = []
  for (const part of parts) {
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(part)
    const single = /^(\d+)$/.exec(part)
    const m = range || single
    if (!m) {
      throw new Error(`无法识别的页码："${part}"（支持的格式：1-5、6、1,3,5-12）`)
    }
    const start = Number(m[1])
    const end = m[2] ? Number(m[2]) : start
    if (start < 1) throw new Error(`页码必须从 1 开始："${part}"`)
    if (end > pageCount) {
      throw new Error(`页码 ${end} 超出范围（文档共 ${pageCount} 页）："${part}"`)
    }
    if (start > end) throw new Error(`页码区间无效（开始大于结束）："${part}"`)
    ranges.push({ start, end })
  }

  return mergeRanges(ranges)
}

// Merge OVERLAPPING ranges only. Adjacent ranges (e.g. "1-5, 6-10") stay
// separate — for Split they must produce two output files, and for Extract the
// flattened result is identical either way.
export function mergeRanges(ranges) {
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const out = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && r.start <= last.end) {
      last.end = Math.max(last.end, r.end)
    } else {
      out.push({ start: r.start, end: r.end })
    }
  }
  return out
}

// Split a document into chunks of `n` pages → [{ start, end }, ...].
export function splitEveryN(pageCount, n) {
  if (!Number.isInteger(n) || n < 1) throw new Error('每份页数必须是大于 0 的整数')
  const ranges = []
  for (let start = 1; start <= pageCount; start += n) {
    ranges.push({ start, end: Math.min(start + n - 1, pageCount) })
  }
  return ranges
}

// Flatten ranges into a list of 1-based page numbers.
export function expandRanges(ranges) {
  const pages = []
  for (const r of ranges) {
    for (let i = r.start; i <= r.end; i++) pages.push(i)
  }
  return pages
}
