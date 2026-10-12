import { useEffect, useMemo, useRef, useState } from 'react'
import QuizHeader from './QuizHeader.jsx'
import QuestionCard from './QuestionCard.jsx'
import Markdown from './Markdown.jsx'
import ShareButton from './ShareButton.jsx'
import { quizKey, loadProgress, saveProgress, clearProgress, loadHistory, addAttempt, loadQuizNote, saveQuizNote } from '../quiz/storage.js'
import { shuffleQuiz, makeSeed } from '../quiz/shuffle.js'
import { shareUrl } from '../quiz/share.js'
import { parseQuiz } from '../quiz/parseQuiz.js'
import { buildQuizMarkdown } from '../quiz/exportQuiz.js'
import { cardId as srsCardId, updateCard as srsUpdateCard } from '../quiz/srs.js'
import { isFavorite, toggleFavorite } from '../quiz/favorites.js'
import { logWrongQuestion, removeWrongQuestion } from '../quiz/wrongBook.js'
import ExportMenu from './ExportMenu.jsx'

// True when the recorded answer is correct. `answer` is an option label for
// single-choice, or an array of labels for multi-select.
function isQuestionCorrect(question, answer) {
  if (answer == null) return false
  const correct = question.options.filter((o) => o.correct).map((o) => o.label).sort()
  if (question.multi) {
    if (!Array.isArray(answer)) return false
    const picked = [...answer].sort()
    return picked.length === correct.length && picked.every((l, i) => l === correct[i])
  }
  return question.options.find((o) => o.label === answer)?.correct === true
}

// Normalize a recorded answer to an array of chosen labels.
function pickedLabels(answer) {
  if (answer == null) return []
  return Array.isArray(answer) ? answer : [answer]
}

// Format a millisecond duration as "12.3s" or "1m 05s".
function fmtTime(ms) {
  if (!ms) return '—'
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  return `${m}m ${String(Math.round(s % 60)).padStart(2, '0')}s`
}

// Drives a quiz: tracks the current question and the answer chosen per question,
// persists progress to localStorage, then shows a score summary + review.
export default function QuizPlayer({
  quiz: rawQuiz,
  source,
  onExit,
  onEdit,
  onRetry,
  transient = false,
  // Optional: the book and quiz IDs used to compute SRS card IDs.
  // When present (and !transient) the player feeds results back to SRS.
  bookId,
  quizId,
  theme,
  onToggleTheme,
}) {
  const key = useMemo(() => quizKey(rawQuiz), [rawQuiz])
  const link = useMemo(() => (source ? shareUrl(source) : null), [source])

  // Hydrate from any saved attempt for this quiz (transient quizzes never persist).
  const saved = useMemo(() => (transient ? null : loadProgress(key)), [key, transient])
  // Past attempts (loaded once at mount; excludes the current run until recorded).
  const priorHistory = useMemo(() => (transient ? [] : loadHistory(key)), [key, transient])
  const [seed, setSeed] = useState(saved?.seed ?? makeSeed())
  const [index, setIndex] = useState(saved?.index ?? 0)
  const [answers, setAnswers] = useState(saved?.answers ?? {})
  const [finished, setFinished] = useState(saved?.finished ?? false)
  const [times, setTimes] = useState(saved?.times ?? {}) // ms spent per question
  const [recorded, setRecorded] = useState(saved?.recorded ?? false)
  const [review, setReview] = useState(false)
  const [favoritesState, setFavoritesState] = useState(0) // force re-render on toggle
  const [note, setNote] = useState(() => transient ? '' : loadQuizNote(key))

  useEffect(() => {
    setNote(transient ? '' : loadQuizNote(key))
  }, [key, transient])

  useEffect(() => {
    if (transient) return
    saveQuizNote(key, note)
  }, [note, key, transient])


  // Time spent on the current question (reset whenever the index changes).
  const startRef = useRef(Date.now())
  useEffect(() => {
    startRef.current = Date.now()
  }, [index])

  // Apply shuffle deterministically from the persisted seed so reloads keep the
  // same order (and persisted answers stay valid).
  const quiz = useMemo(() => shuffleQuiz(rawQuiz, seed), [rawQuiz, seed])
  const total = quiz.questions.length

  // Persist on every change (skip for transient quizzes).
  useEffect(() => {
    if (transient) return
    saveProgress(key, { seed, index, answers, finished, times, recorded })
  }, [transient, key, seed, index, answers, finished, times, recorded])

  const score = useMemo(
    () =>
      quiz.questions.reduce(
        (acc, q, i) => acc + (isQuestionCorrect(q, answers[i]) ? 1 : 0),
        0,
      ),
    [quiz, answers],
  )

  const wrong = useMemo(
    () =>
      quiz.questions
        .map((q, i) => ({ q, i, answer: answers[i] }))
        .filter(({ q, answer }) => !isQuestionCorrect(q, answer)),
    [quiz, answers],
  )

  const handleAnswer = (label) => {
    if (answers[index] != null) return
    const elapsed = Date.now() - startRef.current
    setTimes((t) => ({ ...t, [index]: elapsed }))
    setAnswers((prev) => ({ ...prev, [index]: label }))
  }

  const handleNext = () => {
    if (index + 1 < total) setIndex(index + 1)
    else setFinished(true)
  }

  const handlePrev = () => setIndex((i) => Math.max(0, i - 1))

  // Wrong questions with the user's pick, for export-with-annotations.
  const wrongForExport = useMemo(
    () => wrong.map(({ q, answer }) => ({ ...q, _picked: pickedLabels(answer) })),
    [wrong],
  )

  const handleRetryWrong = () => {
    const md = buildQuizMarkdown(`错题重练 — ${rawQuiz.title}`, wrong.map(({ q }) => q))
    try {
      onRetry?.(parseQuiz(md), md)
    } catch {
      /* a retry deck should always parse; ignore if not */
    }
  }

  const restart = () => {
    clearProgress(key)
    setSeed(makeSeed())
    setAnswers({})
    setTimes({})
    setIndex(0)
    setFinished(false)
    setRecorded(false)
    setReview(false)
  }

  const totalMs = useMemo(
    () => Object.values(times).reduce((a, b) => a + b, 0),
    [times],
  )

  // Record one attempt into history when the quiz is first finished.
  useEffect(() => {
    if (finished && !recorded) {
      if (!transient) {
        addAttempt(key, { score, total, timeMs: totalMs })
      }
      setRecorded(true)
    }
  }, [finished, transient, recorded, key, score, total, totalMs])

  // Feed per-question results back into SRS and Wrong Book when a quiz
  // finishes. Only runs once per attempt (guarded by `recorded` becoming true).
  useEffect(() => {
    if (!finished || !recorded) return
    quiz.questions.forEach((q, i) => {
      const qBookId = q._bookId || bookId
      const qQuizId = q._quizId || quizId
      if (!qBookId || !qQuizId) return
      
      const correct = isQuestionCorrect(q, answers[i])
      const id = srsCardId(qBookId, qQuizId, q.prompt)
      srsUpdateCard(id, correct)
      
      if (correct) {
        removeWrongQuestion(qBookId, qQuizId, q)
      } else {
        logWrongQuestion(qBookId, qQuizId, q)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorded])

  // Trend vs. past attempts (computed from history loaded at mount).
  const lastAttempt = priorHistory.length ? priorHistory[priorHistory.length - 1] : null
  const bestScore = priorHistory.length ? Math.max(...priorHistory.map((a) => a.score)) : null

  if (finished) {
    return (
      <div className="player">
        <QuizHeader
          title={quiz.title}
          sources={quiz.sources}
          index={total - 1}
          total={total}
          onExit={onExit}
          shareLink={link}
          theme={theme}
          onToggleTheme={onToggleTheme}
        />

        {review ? (
          <div className="review">
            <div className="review__topbar">
              <button type="button" className="button button--secondary" onClick={() => setReview(false)}>
                ← 返回结果
              </button>
              {onRetry && wrong.length > 0 && (
                <button type="button" className="button button--secondary" onClick={handleRetryWrong}>
                  重练错题（{wrong.length}）
                </button>
              )}
              <ExportMenu
                title={`错题复习 — ${quiz.title}`}
                questions={wrongForExport}
                label="导出错题"
              />
            </div>
            <h2 className="review__title">错题（{wrong.length}）</h2>
            {wrong.length === 0 ? (
              <p className="review__empty">全部答对，没有错题 🎉</p>
            ) : (
              wrong.map(({ q, i, answer }) => {
                const correctOpts = q.options.filter((o) => o.correct)
                const picks = pickedLabels(answer)
                const pickedOpts = q.options.filter((o) => picks.includes(o.label))
                const fmt = (opts) => opts.map((o) => `${o.label}. ${o.text}`).join('；')
                return (
                  <div key={i} className="review__item">
                    <Markdown className="review__prompt">{q.prompt}</Markdown>
                    <p className="review__line review__line--picked">
                      你的选择：{pickedOpts.length ? fmt(pickedOpts) : '未作答'}
                    </p>
                    <p className="review__line review__line--correct">
                      正确答案：{fmt(correctOpts)}
                    </p>
                    {correctOpts.map(
                      (o) =>
                        o.explanation && (
                          <Markdown key={o.label} className="review__explanation">
                            {o.explanation}
                          </Markdown>
                        ),
                    )}
                  </div>
                )
              })
            )}
          </div>
        ) : (
          <div className="summary">
            <p className="summary__label">测验完成</p>
            <p className="summary__score">
              {score} <span>/ {total}</span>
            </p>
            <p className="summary__time">用时 {fmtTime(totalMs)}</p>

            {!transient && lastAttempt && (
              <p className="summary__history">
                上次 {lastAttempt.score}/{lastAttempt.total}
                {score > lastAttempt.score && <span className="summary__trend up"> ↑ 进步</span>}
                {score < lastAttempt.score && <span className="summary__trend down"> ↓ 退步</span>}
                {score === lastAttempt.score && <span className="summary__trend"> · 持平</span>}
                {bestScore != null && <span> · 最佳 {Math.max(bestScore, score)}/{total}</span>}
              </p>
            )}

            <ul className="stats">
              {quiz.questions.map((q, i) => (
                <li key={i} className="stats__row">
                  <span className="stats__q">第 {i + 1} 题</span>
                  <span
                    className={
                      isQuestionCorrect(q, answers[i])
                        ? 'stats__mark stats__mark--correct'
                        : 'stats__mark stats__mark--wrong'
                    }
                  >
                    {isQuestionCorrect(q, answers[i]) ? '✓' : '✕'}
                  </span>
                  <span className="stats__time">{fmtTime(times[i])}</span>
                </li>
              ))}
            </ul>

            <div className="summary__note" style={{ marginTop: '24px', textAlign: 'left' }}>
              <label htmlFor="quiz-note" style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>测验笔记</label>
              <textarea
                id="quiz-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="在这里写下你的测验笔记..."
                style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontFamily: 'inherit', resize: 'vertical' }}
                rows={4}
              />
            </div>

            <div className="summary__actions">
              {wrong.length > 0 && (
                <>
                  <button type="button" className="button button--secondary" onClick={() => setReview(true)}>
                    查看错题
                  </button>
                  {onRetry && (
                    <button type="button" className="button button--secondary" onClick={handleRetryWrong}>
                      重练错题（{wrong.length}）
                    </button>
                  )}
                  <ExportMenu
                    title={`错题复习 — ${quiz.title}`}
                    questions={wrongForExport}
                    label="导出错题"
                  />
                </>
              )}
              <button type="button" className="button button--secondary" onClick={restart}>
                重新开始
              </button>
              {link && <ShareButton url={link} variant="text" />}
              <button type="button" className="button button--primary" onClick={onExit}>
                返回
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  const currentQ = quiz.questions[index]
  const qBookId = currentQ?._bookId || bookId
  const qQuizId = currentQ?._quizId || quizId
  const currentCardId = (qBookId && qQuizId && currentQ) ? srsCardId(qBookId, qQuizId, currentQ.prompt) : null

  return (
    <div className="player">
      <QuizHeader
        title={quiz.title}
        sources={quiz.sources}
        index={index}
        total={total}
        onExit={onExit}
        onEdit={onEdit}
        shareLink={link}
        theme={theme}
        onToggleTheme={onToggleTheme}
      />
      <QuestionCard
        key={index}
        question={currentQ}
        cardId={currentCardId}
        answer={answers[index] ?? null}
        onAnswer={handleAnswer}
        onPrev={handlePrev}
        onNext={handleNext}
        isFirst={index === 0}
        isLast={index + 1 === total}
        isFavorited={currentCardId ? isFavorite(currentCardId) : false}
        onToggleFavorite={currentCardId ? () => {
          toggleFavorite(currentCardId, { bookId: qBookId, quizId: qQuizId, prompt: currentQ.prompt })
          setFavoritesState(s => s + 1)
        } : undefined}
      />
    </div>
  )
}
