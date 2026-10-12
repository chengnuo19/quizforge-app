// Presentational light/dark toggle. State lives in App.
export default function ThemeToggle({ theme, onToggle }) {
  const dark = theme === 'dark'
  return (
    <button
      type="button"
      className="icon-button"
      onClick={onToggle}
      aria-label={dark ? '切换到浅色主题' : '切换到深色主题'}
      title={dark ? '浅色' : '深色'}
    >
      {dark ? '☀' : '☾'}
    </button>
  )
}
