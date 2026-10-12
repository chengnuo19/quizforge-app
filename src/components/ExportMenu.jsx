import { useEffect, useRef, useState } from 'react'
import {
  buildQuizMarkdown,
  buildAnkiCsv,
  buildQuizletTsv,
  downloadTextFile,
} from '../quiz/exportQuiz.js'

// A small dropdown that exports the given questions to Markdown / Anki CSV /
// Quizlet TSV. `questions` may carry `_picked` per question for annotation.
export default function ExportMenu({ title, questions, label = '导出' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const safeName = (title || 'quiz').replace(/[\\/:*?"<>|]/g, '_')

  const exportAs = (kind) => {
    if (kind === 'md') {
      downloadTextFile(`${safeName}.md`, buildQuizMarkdown(title, questions), 'md')
    } else if (kind === 'anki') {
      downloadTextFile(`${safeName}_anki.csv`, buildAnkiCsv(questions), 'csv')
    } else if (kind === 'quizlet') {
      downloadTextFile(`${safeName}_quizlet.txt`, buildQuizletTsv(questions), 'tsv')
    }
    setOpen(false)
  }

  return (
    <div className="export-menu" ref={ref}>
      <button
        type="button"
        className="button button--secondary"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {label} ▾
      </button>
      {open && (
        <div className="export-menu__list" role="menu">
          <button type="button" role="menuitem" onClick={() => exportAs('md')}>
            Markdown（.md，可重新导入）
          </button>
          <button type="button" role="menuitem" onClick={() => exportAs('anki')}>
            Anki（.csv）
          </button>
          <button type="button" role="menuitem" onClick={() => exportAs('quizlet')}>
            Quizlet（.txt）
          </button>
        </div>
      )}
    </div>
  )
}
