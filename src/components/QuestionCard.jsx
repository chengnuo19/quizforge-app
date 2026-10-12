import { useEffect, useRef, useState } from 'react'
import Markdown from './Markdown.jsx'
import OptionItem from './OptionItem.jsx'
import AiExplainPanel from './AiExplainPanel.jsx'

// A single question: prompt, options, optional whole-question explanation, and
// the Prev / Explain / Submit / Next controls. `answer` is the recorded answer:
// an option label (single-choice) or an array of labels (multi-select), or null.
// Single-choice locks on click; multi-select requires an explicit 提交.
export default function QuestionCard({
  question,
  answer,
  cardId,
  onAnswer,
  onPrev,
  onNext,
  isFirst,
  isLast,
  isFavorited,
  onToggleFavorite,
}) {
  const multi = question.multi
  const [showExplain, setShowExplain] = useState(false)
  const [draft, setDraft] = useState(() => new Set()) // multi-select pending picks
  const groupRef = useRef(null)
  const sectionRef = useRef(null)
  const answered = answer != null

  // Focus the question container on mount so number/letter shortcuts work
  // immediately without a click. Skip if the user is mid-text-selection.
  useEffect(() => {
    if (!answered) sectionRef.current?.focus({ preventScroll: true })
  }, [])

  const isSelected = (label) => {
    if (answered) return Array.isArray(answer) ? answer.includes(label) : answer === label
    return multi ? draft.has(label) : false
  }

  const isWrongAnswer = () => {
    if (!answered) return false
    const correctLabels = (question.options || [])
      .filter((o) => o.correct)
      .map((o) => o.label)
    if (Array.isArray(answer)) {
      if (answer.length !== correctLabels.length) return true
      const ansSet = new Set(answer)
      return !correctLabels.every((l) => ansSet.has(l))
    }
    return !correctLabels.includes(answer)
  }
  const isWrong = isWrongAnswer()

  const handleSelect = (label) => {
    if (answered) return
    if (multi) {
      setDraft((prev) => {
        const next = new Set(prev)
        next.has(label) ? next.delete(label) : next.add(label)
        return next
      })
    } else {
      onAnswer(label)
    }
  }

  const submitMulti = () => {
    if (draft.size > 0) onAnswer([...draft])
  }

  const moveFocus = (forward) => {
    const items = [...groupRef.current.querySelectorAll('[role="radio"],[role="checkbox"]')]
    const current = items.indexOf(document.activeElement)
    const next = (current + (forward ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
  }

  // Keyboard: 1‑9 / A‑Z pick an option, arrows move focus, Enter submits
  // (multi) or advances when answered.
  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      if (multi && !answered && draft.size > 0) {
        e.preventDefault()
        submitMulti()
      } else if (answered) {
        e.preventDefault()
        onNext()
      }
      return
    }
    if (answered) return

    if (['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(e.key)) {
      e.preventDefault()
      moveFocus(e.key === 'ArrowDown' || e.key === 'ArrowRight')
      return
    }

    let idx = -1
    if (/^[1-9]$/.test(e.key)) idx = Number(e.key) - 1
    else if (/^[a-zA-Z]$/.test(e.key)) idx = e.key.toUpperCase().charCodeAt(0) - 65
    if (idx >= 0 && idx < question.options.length) {
      e.preventDefault()
      handleSelect(question.options[idx].label)
    }
  }

  return (
    <section className="question" onKeyDown={handleKeyDown} ref={sectionRef} tabIndex={-1}>
      <div className="question__header">
        <Markdown className="question__prompt">{question.prompt}</Markdown>
        {onToggleFavorite && (
          <button
            type="button"
            className={`icon-button favorite-btn ${isFavorited ? 'favorite-btn--active' : ''}`}
            onClick={onToggleFavorite}
            aria-label={isFavorited ? '取消收藏' : '收藏此题'}
            title={isFavorited ? '取消收藏' : '收藏此题'}
          >
            {isFavorited ? '★' : '☆'}
          </button>
        )}
      </div>
      {!answered && (
        <p className="question__hint">
          {multi ? '多选题：可选择多个选项，然后点击「提交」。' : '单选题。'}
          {' '}快捷键：按 数字键 1‑{Math.min(question.options.length, 9)} 或字母键选择，Enter {multi ? '提交' : '进入下一题'}。
        </p>
      )}

      <div
        className="question__options"
        role={multi ? 'group' : 'radiogroup'}
        aria-label="选项"
        ref={groupRef}
      >
        {question.options.map((option, i) => (
          <OptionItem
            key={option.label}
            option={option}
            multi={multi}
            answered={answered}
            selected={isSelected(option.label)}
            tabIndex={answered ? -1 : i === 0 ? 0 : -1}
            onSelect={() => handleSelect(option.label)}
          />
        ))}
      </div>

      {answered && showExplain && question.explain && (
        <div className="question__explain">
          <Markdown>{question.explain}</Markdown>
        </div>
      )}

      {answered && isWrong && cardId && (
        <AiExplainPanel cardId={cardId} question={question} answer={answer} />
      )}

      <div className="question__actions">
        <button
          type="button"
          className="button button--secondary"
          disabled={isFirst}
          onClick={onPrev}
        >
          上一题
        </button>
        {question.explain && (
          <button
            type="button"
            className="button button--secondary"
            disabled={!answered}
            onClick={() => setShowExplain((v) => !v)}
          >
            {showExplain ? 'Hide' : 'Explain'}
          </button>
        )}
        <div className="question__actions-spacer" />
        {multi && !answered ? (
          <button
            type="button"
            className="button button--primary"
            disabled={draft.size === 0}
            onClick={submitMulti}
          >
            提交
          </button>
        ) : (
          <button
            type="button"
            className="button button--primary"
            disabled={!answered}
            onClick={onNext}
          >
            {isLast ? 'Finish' : 'Next'}
          </button>
        )}
      </div>
    </section>
  )
}
