// Learning statistics dashboard.
// Shows:
//   1. SRS mastery donut: new / learning / reviewing / mastered
//   2. Study-day heatmap: last 16 weeks (attempt history)
//   3. Per-book table: last attempt accuracy + questions total

import { useMemo } from 'react'
import ThemeToggle from './ThemeToggle.jsx'
import { getSrsStats } from '../quiz/srs.js'
import { listBooks } from '../quiz/books.js'
import { getStudyDateCounts, loadHistory, quizKey } from '../quiz/storage.js'
import { getDailyTrendData } from '../quiz/statsHelpers.js'

// ---------- Mastery donut (pure SVG) ----------

const MASTERY_COLORS = {
  new: 'var(--muted-soft)',
  learning: 'var(--book-amber)',
  reviewing: 'var(--book-sky)',
  mastered: 'var(--book-sage)',
}
// Dark-mode-aware: the book-* tokens already flip.

function MasteryDonut({ stats }) {
  const { total, new: newCards, learning, reviewing, mastered } = stats
  if (total === 0) return <p className="stats-empty">还没有题目。添加笔记本后这里会显示掌握度。</p>

  const slices = [
    { key: 'mastered', label: '已掌握', value: mastered, color: MASTERY_COLORS.mastered },
    { key: 'reviewing', label: '复习中', value: reviewing, color: MASTERY_COLORS.reviewing },
    { key: 'learning', label: '学习中', value: learning, color: MASTERY_COLORS.learning },
    { key: 'new', label: '待学习', value: newCards, color: MASTERY_COLORS.new },
  ]

  // SVG donut: r=40 → circumference ≈ 251.3
  const R = 40
  const CIRC = 2 * Math.PI * R
  let offset = 0
  const segments = slices.map((s) => {
    const dash = (s.value / total) * CIRC
    const seg = { ...s, dash, offset }
    offset += dash
    return seg
  })

  return (
    <div className="mastery-donut">
      <svg viewBox="0 0 100 100" className="mastery-donut__svg" role="img" aria-label="掌握度分布">
        {/* Background ring */}
        <circle cx="50" cy="50" r={R} fill="none" stroke="var(--hairline)" strokeWidth="16" />
        {segments.map((s) =>
          s.dash > 0 ? (
            <circle
              key={s.key}
              cx="50"
              cy="50"
              r={R}
              fill="none"
              stroke={s.color}
              strokeWidth="16"
              strokeDasharray={`${s.dash} ${CIRC - s.dash}`}
              strokeDashoffset={-s.offset + CIRC / 4} /* start at top */
              style={{ transition: 'stroke-dasharray 0.4s ease' }}
            />
          ) : null,
        )}
        {/* Center label */}
        <text x="50" y="46" textAnchor="middle" className="mastery-donut__center-num">
          {total}
        </text>
        <text x="50" y="57" textAnchor="middle" className="mastery-donut__center-label">
          道题
        </text>
      </svg>

      <ul className="mastery-legend">
        {slices.map((s) => (
          <li key={s.key} className="mastery-legend__item">
            <span
              className="mastery-legend__dot"
              style={{ background: s.color }}
              aria-hidden="true"
            />
            <span className="mastery-legend__label">{s.label}</span>
            <span className="mastery-legend__count">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------- Daily Trend Chart ----------

function DailyTrendChart({ trend }) {
  if (!trend || trend.length === 0) return null
  const maxQ = Math.max(...trend.map(t => t.questions), 10) // minimum scale 10
  const width = 600
  const height = 180
  const padX = 30
  const padY = 20
  const graphH = height - padY * 2
  const graphW = width - padX * 2
  const stepX = graphW / (trend.length - 1)
  
  const points = trend.map((t, i) => {
    const x = padX + i * stepX
    const y = padY + graphH - (t.questions / maxQ) * graphH
    return { x, y, label: t.label, val: t.questions }
  })
  
  const pathD = `M ${points[0].x} ${points[0].y} ` + points.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ')
  const areaD = pathD + ` L ${points[points.length-1].x} ${padY+graphH} L ${points[0].x} ${padY+graphH} Z`
  
  return (
    <div className="trend-chart">
      <svg viewBox={`0 0 ${width} ${height}`} className="trend-chart__svg" role="img" aria-label="近14天答题量趋势">
        {/* Grid lines */}
        {[0, 0.5, 1].map(ratio => {
          const y = padY + graphH * ratio
          return <line key={ratio} x1={padX} y1={y} x2={width-padX} y2={y} stroke="var(--hairline)" strokeDasharray="4 4" />
        })}
        {/* Area */}
        <path d={areaD} fill="var(--primary)" opacity="0.15" />
        {/* Line */}
        <path d={pathD} fill="none" stroke="var(--primary)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {/* Points & Labels */}
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r="4" fill="var(--canvas)" stroke="var(--primary)" strokeWidth="2" />
            {(i === 0 || i === points.length - 1 || i % 3 === 0) && (
              <text x={p.x} y={height - 2} textAnchor="middle" className="trend-chart__label">{p.label}</text>
            )}
            {p.val > 0 && (
              <text x={p.x} y={p.y - 10} textAnchor="middle" className="trend-chart__val">{p.val}</text>
            )}
          </g>
        ))}
      </svg>
      {trend.every(t => t.questions === 0) && (
        <p className="stats-empty" style={{marginTop: '1rem'}}>最近两周没有答题记录。</p>
      )}
    </div>
  )
}

// ---------- Study heatmap (last 16 weeks) ----------

function StudyHeatmap({ studyDayCounts }) {
  // Build a 16-week × 7-day grid ending today.
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Go back to the Monday of the week 15 weeks ago.
  const startDate = new Date(today)
  const dow = (today.getDay() + 6) % 7 // Mon=0…Sun=6
  startDate.setDate(today.getDate() - dow - 15 * 7)

  const weeks = []
  const cur = new Date(startDate)
  for (let w = 0; w < 16; w++) {
    const week = []
    for (let d = 0; d < 7; d++) {
      const iso = cur.toISOString().slice(0, 10)
      const count = studyDayCounts.get(iso) || 0
      let level = 0
      if (count >= 60) level = 4
      else if (count >= 30) level = 3
      else if (count >= 10) level = 2
      else if (count > 0) level = 1
      week.push({ iso, count, level, future: cur > today })
      cur.setDate(cur.getDate() + 1)
    }
    weeks.push(week)
  }

  const DAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

  return (
    <div className="heatmap">
      <div className="heatmap__day-labels" aria-hidden="true">
        {DAY_LABELS.map((l) => (
          <span key={l} className="heatmap__day-label">{l}</span>
        ))}
      </div>
      <div className="heatmap__grid" role="grid" aria-label="学习日历">
        {weeks.map((week, wi) => (
          <div key={wi} className="heatmap__week" role="row">
            {week.map((day) => (
              <div
                key={day.iso}
                role="gridcell"
                title={`${day.iso}${day.count > 0 ? `: ${day.count} 题` : ''}`}
                aria-label={`${day.iso}${day.count > 0 ? ` · 答了 ${day.count} 题` : ''}`}
                className={
                  'heatmap__cell' +
                  (day.level > 0 ? ` heatmap__cell--level-${day.level}` : '') +
                  (day.future ? ' heatmap__cell--future' : '')
                }
              />
            ))}
          </div>
        ))}
      </div>
      {studyDayCounts.size === 0 && (
        <p className="stats-empty">完成第一次测验后，这里会出现你的学习日历。</p>
      )}
    </div>
  )
}

// ---------- Per-book accuracy table ----------

function BookTable({ rows }) {
  if (rows.length === 0) return null
  return (
    <table className="book-table">
      <thead>
        <tr>
          <th className="book-table__th">笔记本</th>
          <th className="book-table__th book-table__th--num">题目</th>
          <th className="book-table__th book-table__th--num">上次准确率</th>
          <th className="book-table__th book-table__th--bar" aria-hidden="true" />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.bookId} className="book-table__row">
            <td className="book-table__td">
              <span className="book-table__icon" aria-hidden="true">{row.icon}</span>
              {row.name}
            </td>
            <td className="book-table__td book-table__td--num">{row.questionCount}</td>
            <td className="book-table__td book-table__td--num">
              {row.lastPct != null ? `${row.lastPct}%` : '—'}
            </td>
            <td className="book-table__td book-table__td--bar">
              {row.lastPct != null && (
                <div className="book-table__bar-wrap">
                  <div
                    className="book-table__bar-fill"
                    style={{ width: `${row.lastPct}%` }}
                  />
                </div>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ---------- Main view ----------

export default function StatsView({ onExit, theme, onToggleTheme }) {
  const srsStats = useMemo(() => getSrsStats(), [])
  const studyDayCounts = useMemo(() => getStudyDateCounts(), [])
  const dailyTrend = useMemo(() => getDailyTrendData(), [])

  const bookRows = useMemo(() => {
    const books = listBooks()
    return books
      .map((book) => {
        let questionCount = 0
        let lastPct = null

        for (const entry of book.quizzes ?? []) {
          if (!entry.quiz) continue
          questionCount += entry.quiz.questions?.length ?? 0

          // Get last attempt for this quiz
          const key = quizKey(entry.quiz)
          const history = loadHistory(key)
          if (history.length > 0) {
            const last = history[history.length - 1]
            const pct = last.total > 0 ? Math.round((last.score / last.total) * 100) : 0
            // Track the most recent quiz attempt's accuracy
            if (lastPct === null) lastPct = pct
          }
        }

        return {
          bookId: book.id,
          name: book.name,
          icon: book.icon,
          questionCount,
          lastPct,
        }
      })
      .filter((r) => r.questionCount > 0)
  }, [])

  return (
    <div className="stats-view">
      <div className="home__topbar">
        <button
          type="button"
          className="button button--secondary"
          onClick={onExit}
        >
          ← 返回
        </button>
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </div>

      <header className="stats-view__header">
        <h1 className="stats-view__title">学习报告</h1>
      </header>

      <div className="stats-view__body">
        <section className="stats-card">
          <h2 className="stats-card__title">卡片掌握度</h2>
          <MasteryDonut stats={srsStats} />
        </section>

        <section className="stats-card">
          <h2 className="stats-card__title">近14天答题量</h2>
          <DailyTrendChart trend={dailyTrend} />
        </section>

        <section className="stats-card">
          <h2 className="stats-card__title">学习日历（近 16 周）</h2>
          <StudyHeatmap studyDayCounts={studyDayCounts} />
        </section>

        <section className="stats-card">
          <h2 className="stats-card__title">各笔记本准确率</h2>
          {bookRows.length > 0 ? (
            <BookTable rows={bookRows} />
          ) : (
            <p className="stats-empty">还没有笔记本数据。</p>
          )}
        </section>
      </div>
    </div>
  )
}
