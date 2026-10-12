import Markdown from './Markdown.jsx'

// One answer option. Rendered as an ARIA radio (a div, so it can legally contain
// block markdown / links). Before answering it is selectable; after answering it
// reveals correctness and the per-option explanation.
export default function OptionItem({ option, multi, answered, selected, tabIndex, onSelect }) {
  const isCorrect = option.correct
  const isWrongPick = answered && selected && !isCorrect

  let state = 'default'
  if (answered && isCorrect) state = 'correct'
  else if (isWrongPick) state = 'incorrect'

  const showExplanation = answered && option.explanation

  const activate = () => {
    if (!answered) onSelect()
  }

  const onKeyDown = (e) => {
    if (answered) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect()
    }
  }

  return (
    <div
      className={`option option--${state}`}
      role={multi ? 'checkbox' : 'radio'}
      aria-checked={selected}
      aria-disabled={answered}
      tabIndex={tabIndex}
      onClick={activate}
      onKeyDown={onKeyDown}
    >
      <div className="option__head">
        <span className="option__label">{option.label}</span>
        <Markdown inline className="option__text">
          {option.text}
        </Markdown>
      </div>

      {answered && (isCorrect || isWrongPick) && (
        <div className="option__verdict">
          {isCorrect ? (
            <span className="verdict verdict--correct">✓ Right answer</span>
          ) : (
            <span className="verdict verdict--incorrect">✕ Not quite</span>
          )}
        </div>
      )}

      {showExplanation && (
        <Markdown className="option__explanation">{option.explanation}</Markdown>
      )}
    </div>
  )
}
