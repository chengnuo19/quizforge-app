// SRS review session: works through today's due cards one at a time,
// updating each card's SM-2 state immediately after the user answers.
// Cards come from getDueCards() (called in App before rendering this component).

import { useState, useEffect } from 'react'
import confetti from 'canvas-confetti'
import QuestionCard from './QuestionCard.jsx'
import { updateCard } from '../quiz/srs.js'
import { goLibrary } from '../quiz/router.js'

// True when the recorded answer is correct (mirrors QuizPlayer logic).
function isCorrect(question, answer) {
  if (answer == null) return false
  const correct = question.options.filter((o) => o.correct).map((o) => o.label).sort()
  if (question.multi) {
    if (!Array.isArray(answer)) return false
    const picked = [...answer].sort()
    return picked.length === correct.length && picked.every((l, i) => l === correct[i])
  }
  return question.options.find((o) => o.label === answer)?.correct === true
}

export default function SrsSession({ cards, onExit, theme, onToggleTheme }) {
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState({}) // index → label/labels
  const [finished, setFinished] = useState(false)

  const total = cards.length

  // Empty state — caller should prevent this, but handle gracefully.
  if (total === 0) {
    return (
      <div className="player">
        <div className="srs-empty">
          <p className="srs-empty__icon" aria-hidden="true">🎉</p>
          <h2 className="srs-empty__title">今日无待复习</h2>
          <p className="srs-empty__sub">所有卡片都在计划内，稍后再来吧。</p>
          <button type="button" className="button button--primary" onClick={onExit}>
            返回首页
          </button>
        </div>
      </div>
    )
  }

  const current = cards[index]
  const answered = answers[index] != null

  const handleAnswer = (label) => {
    if (answers[index] != null) return
    setAnswers((prev) => ({ ...prev, [index]: label }))
    // Update SRS immediately — don't wait for the session to end.
    updateCard(current.cardId, isCorrect(current.question, label))
  }

  const handleNext = () => {
    if (index + 1 < total) setIndex(index + 1)
    else setFinished(true)
  }

  const correctCount = Object.entries(answers).filter(([i, ans]) =>
    isCorrect(cards[Number(i)].question, ans),
  ).length

  useEffect(() => {
    if (finished) {
      confetti({
        particleCount: 150,
        spread: 80,
        origin: { y: 0.6 },
        colors: ['#3b82f6', '#10b981', '#f59e0b', '#ec4899'],
        zIndex: 9999
      })
    }
  }, [finished])

  // ---- Summary screen ----
  if (finished) {
    const pct = total > 0 ? Math.round((correctCount / total) * 100) : 0
    return (
      <div className="player">
        <div className="summary">
          <p className="summary__label">今日复习完成 🎉</p>
          <p className="summary__score" style={{ marginTop: '16px', marginBottom: '8px' }}>
            <span style={{ fontSize: '3rem', fontWeight: 'bold' }}>{correctCount}</span> <span style={{ fontSize: '1.5rem', opacity: 0.8 }}>/ {total}</span>
          </p>
          <p className="summary__time">正确率 {pct}%</p>
          <p className="summary__toast" style={{ color: 'var(--success)', fontWeight: 'bold', margin: '8px 0 24px 0' }}>连续复习打卡！你真棒 🎉</p>

          <ul className="stats">
            {cards.map((card, i) => {
              const ok = isCorrect(card.question, answers[i])
              return (
                <li key={i} className="stats__row">
                  <span className="stats__q srs-result__source">
                    {card.bookName} · {card.quizTitle}
                  </span>
                  <span className={ok ? 'stats__mark stats__mark--correct' : 'stats__mark stats__mark--wrong'}>
                    {ok ? '✓' : '✕'}
                  </span>
                </li>
              )
            })}
          </ul>

          <div className="summary__actions">
            <button type="button" className="button button--primary" onClick={onExit}>
              返回首页
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ---- Active review card ----
  return (
    <div className="player">
      <header className="quiz-header">
        <div className="quiz-header__row">
          <h1 className="quiz-header__title">今日复习</h1>
          <div className="quiz-header__tools">
            <button
              type="button"
              className="icon-button"
              onClick={onExit}
              aria-label="退出复习"
            >
              ✕
            </button>
          </div>
        </div>
        <div className="quiz-header__counter">{index + 1} / {total}</div>
      </header>

      <p className="srs-source">
        <span className="srs-source__book">{current.bookName}</span>
        <span className="srs-source__sep" aria-hidden="true"> · </span>
        <span className="srs-source__quiz">{current.quizTitle}</span>
      </p>

      <QuestionCard
        key={index}
        question={current.question}
        answer={answers[index] ?? null}
        onAnswer={handleAnswer}
        onPrev={() => {}} // SRS is forward-only; noop
        onNext={handleNext}
        isFirst={true} // disables 上一题 btn
        isLast={index + 1 === total}
      />
    </div>
  )
}
