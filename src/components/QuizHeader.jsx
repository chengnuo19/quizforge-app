import ThemeToggle from './ThemeToggle.jsx'
import ShareButton from './ShareButton.jsx'

// Top bar of the player: quiz title, optional sources line, position counter,
// share, theme toggle, edit, and a back-to-home affordance.
export default function QuizHeader({
  title,
  sources,
  index,
  total,
  onExit,
  onEdit,
  shareLink,
  theme,
  onToggleTheme,
}) {
  return (
    <header className="quiz-header">
      <div className="quiz-header__row">
        <h1 className="quiz-header__title">{title}</h1>
        <div className="quiz-header__tools">
          {shareLink && <ShareButton url={shareLink} />}
          {onEdit && (
            <button type="button" className="icon-button" onClick={onEdit} aria-label="编辑测验" title="编辑">
              ✎
            </button>
          )}
          {onToggleTheme && <ThemeToggle theme={theme} onToggle={onToggleTheme} />}
          <button type="button" className="icon-button" onClick={onExit} aria-label="返回">
            ✕
          </button>
        </div>
      </div>
      {sources != null && (
        <button type="button" className="quiz-header__sources">
          View prompt and {sources} sources
        </button>
      )}
      <div className="quiz-header__counter">
        {index + 1} / {total}
      </div>
    </header>
  )
}
