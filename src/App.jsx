import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import Library from './components/Library.jsx'
import BookDetail from './components/BookDetail.jsx'
import { getBook } from './quiz/books.js'
import { loadTheme, saveTheme } from './quiz/storage.js'
import { parseQuiz } from './quiz/parseQuiz.js'
import { decodeShare } from './quiz/share.js'
import { parseHash, goLibrary, goBook, bookHash } from './quiz/router.js'
import { getDueCards } from './quiz/srs.js'
import { getFavoriteQuestions } from './quiz/favorites.js'
import { getWrongQuestions } from './quiz/wrongBook.js'
import { VaultSelector } from './components/VaultSelector.jsx'
import { isDesktop, getVaultPath } from './quiz/localFsStorage.js'

// The player and SRS session pull in react-markdown + KaTeX — load lazily.
const QuizPlayer = lazy(() => import('./components/QuizPlayer.jsx'))
const SrsSession = lazy(() => import('./components/SrsSession.jsx'))
const StatsView = lazy(() => import('./components/StatsView.jsx'))
const WrongOrganize = lazy(() => import('./components/WrongOrganize.jsx'))
const MarkitdownPanel = lazy(() => import('./components/MarkitdownPanel.jsx'))
const ScreenshotOrganizerPanel = lazy(() => import('./components/ScreenshotOrganizerPanel.jsx'))
const TodoPanel = lazy(() => import('./components/TodoPanel.jsx'))
const PdfWorkbench = lazy(() => import('./components/pdf/PdfWorkbench.jsx'))
const MediaDownloaderPanel = lazy(() => import('./components/MediaDownloaderPanel.jsx'))
const VideoSubtitlePanel = lazy(() => import('./components/VideoSubtitlePanel.jsx'))

// Hash-routed app: Library ⇄ BookDetail ⇄ Player. State lives in location.hash so
// a refresh lands on the same view. A transient quiz (retry-wrong / shared link)
// overrides the route while active.
export default function App() {
  const [vaultSelected, setVaultSelected] = useState(() => !isDesktop || !!getVaultPath())
  const [route, setRoute] = useState(() => parseHash())
  const [theme, setTheme] = useState(loadTheme())
  // { quiz, source, returnHash } for retry-wrong; null otherwise.
  const [transient, setTransient] = useState(null)
  // { bookId, quizId, source } when arriving at a book to edit a quiz.
  const [editTarget, setEditTarget] = useState(null)
  // Bump to force book reloads after user-book mutations.
  const [booksVersion, setBooksVersion] = useState(0)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    saveTheme(theme)
  }, [theme])

  useEffect(() => {
    const onHash = () => {
      setTransient(null)
      setRoute(parseHash())
    }
    window.addEventListener('hashchange', onHash)

    let unsubscribe
    if (window.electronAPI && typeof window.electronAPI.onTodosUpdated === 'function') {
      unsubscribe = window.electronAPI.onTodosUpdated(() => {
        setBooksVersion((v) => v + 1)
      })
    }

    return () => {
      window.removeEventListener('hashchange', onHash)
      if (unsubscribe) unsubscribe()
    }
  }, [])

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  const refreshBooks = () => setBooksVersion((v) => v + 1)

  // Resolve a shared (#q=) quiz from the compressed hash payload.
  const shared = useMemo(() => {
    if (route.view !== 'shared') return null
    try {
      const source = decodeShare(route.shared)
      return { quiz: parseQuiz(source), source }
    } catch {
      return null
    }
  }, [route])

  // Resolve a #play route to its book + quiz entry.
  const playing = useMemo(() => {
    if (route.view !== 'play') return null
    const book = getBook(route.bookId)
    const entry = book?.quizzes.find((q) => q.id === route.quizId)
    if (!entry || !entry.quiz) return null
    return { book, entry }
  }, [route, booksVersion])

  // ----- Render -----

  if (!vaultSelected) {
    return <VaultSelector onVaultSelected={() => setVaultSelected(true)} />
  }

  // Transient quiz (retry-wrong) takes over the screen.
  if (transient) {
    return (
      <div className="app">
        <Suspense fallback={<div className="player" />}>
          <QuizPlayer
            key={transient.id}
            quiz={transient.quiz}
            source={transient.source}
            transient
            onExit={() => {
              const back = transient.returnHash
              setTransient(null)
              if (back) window.location.hash = back
              else goLibrary()
            }}
            onRetry={(quiz, source) =>
              setTransient((t) => ({ quiz, source, returnHash: t?.returnHash, id: Date.now() }))
            }
            theme={theme}
            onToggleTheme={toggleTheme}
          />
        </Suspense>
      </div>
    )
  }

  let body
  if (route.view === 'srs') {
    const cards = getDueCards()
    body = (
      <Suspense fallback={<div className="player" />}>
        <SrsSession
          cards={cards}
          onExit={goLibrary}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
      </Suspense>
    )
  } else if (route.view === 'stats') {
    body = (
      <Suspense fallback={<div className="player" />}>
        <StatsView onExit={goLibrary} theme={theme} onToggleTheme={toggleTheme} />
      </Suspense>
    )
  } else if (route.view === 'favorites') {
    const favs = getFavoriteQuestions()
    const favQuiz = {
      title: '收藏复习',
      sources: undefined,
      shuffle: false,
      shuffleOptions: true,
      questions: favs.map(f => ({
        ...f.question,
        _bookId: f.bookId,
        _quizId: f.quizId
      }))
    }
    
    body = favs.length > 0 ? (
      <Suspense fallback={<div className="player" />}>
        <QuizPlayer
          key="favorites"
          quiz={favQuiz}
          transient
          onExit={goLibrary}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
      </Suspense>
    ) : (
      <Library theme={theme} onToggleTheme={toggleTheme} onBooksChange={refreshBooks} key={booksVersion} />
    )
  } else if (route.view === 'wrong') {
    const wrongs = getWrongQuestions()
    const wrongQuiz = {
      title: '错题本',
      sources: undefined,
      shuffle: false,
      shuffleOptions: true,
      questions: wrongs.map(w => ({
        ...w.question,
        _bookId: w.bookId,
        _quizId: w.quizId
      }))
    }
    
    body = wrongs.length > 0 ? (
      <Suspense fallback={<div className="player" />}>
        <QuizPlayer
          key="wrong"
          quiz={wrongQuiz}
          transient
          onExit={goLibrary}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
      </Suspense>
    ) : (
      <Library theme={theme} onToggleTheme={toggleTheme} onBooksChange={refreshBooks} key={booksVersion} />
    )
  } else if (route.view === 'organizeWrong') {
    body = (
      <Suspense fallback={<div className="player" />}>
        <WrongOrganize
          onExit={goLibrary}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
      </Suspense>
    )
  } else if (route.view === 'shared') {
    body = shared ? (
      <Suspense fallback={<div className="player" />}>
        <QuizPlayer
          key={route.shared}
          quiz={shared.quiz}
          source={shared.source}
          onExit={goLibrary}
          onRetry={(quiz, source) => setTransient({ quiz, source, returnHash: '#', id: Date.now() })}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
      </Suspense>
    ) : (
      <Library theme={theme} onToggleTheme={toggleTheme} onBooksChange={refreshBooks} key={booksVersion} />
    )
  } else if (route.view === 'play' && playing) {
    const isUserBook = !playing.book.builtin
    body = (
      <Suspense fallback={<div className="player" />}>
        <QuizPlayer
          key={`${playing.book.id}:${playing.entry.id}`}
          quiz={playing.entry.quiz}
          source={playing.entry.source}
          bookId={playing.book.id}
          quizId={playing.entry.id}
          onExit={() => goBook(playing.book.id)}
          onEdit={
            isUserBook
              ? () => {
                  setEditTarget({
                    bookId: playing.book.id,
                    quizId: playing.entry.id,
                    source: playing.entry.source,
                  })
                  goBook(playing.book.id)
                }
              : undefined
          }
          onRetry={(quiz, source) =>
            setTransient({ quiz, source, returnHash: bookHash(playing.book.id), id: Date.now() })
          }
          theme={theme}
          onToggleTheme={toggleTheme}
        />
      </Suspense>
    )
  } else if (route.view === 'markitdown') {
    body = (
      <Suspense fallback={<div className="player" />}>
        <MarkitdownPanel
          onExit={goLibrary}
          theme={theme}
          onToggleTheme={toggleTheme}
          onResourcesChange={refreshBooks}
        />
      </Suspense>
    )
  } else if (route.view === 'screenshot-organizer') {
    body = (
      <Suspense fallback={<div className="player" />}>
        <ScreenshotOrganizerPanel
          onExit={goLibrary}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
      </Suspense>
    )
  } else if (route.view === 'todos') {
    body = (
      <Suspense fallback={<div className="player" />}>
        <TodoPanel
          onExit={goLibrary}
          theme={theme}
          onToggleTheme={toggleTheme}
          onTodosChange={refreshBooks}
        />
      </Suspense>
    )
  } else if (route.view === 'pdf-workbench') {
    body = (
      <Suspense fallback={<div className="player" />}>
        <PdfWorkbench
          onExit={goLibrary}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
      </Suspense>
    )
  } else if (route.view === 'media-downloader') {
    body = (
      <Suspense fallback={<div className="player" />}>
        <MediaDownloaderPanel
          onExit={goLibrary}
          theme={theme}
          onToggleTheme={toggleTheme}
          onResourcesChange={refreshBooks}
        />
      </Suspense>
    )
  } else if (route.view === 'video-subtitles') {
    body = (
      <Suspense fallback={<div className="player" />}>
        <VideoSubtitlePanel
          onExit={goLibrary}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
      </Suspense>
    )
  } else if (route.view === 'book') {
    body = (
      <BookDetail
        key={`${route.bookId}:${booksVersion}`}
        bookId={route.bookId}
        editTarget={editTarget}
        onConsumeEditTarget={() => setEditTarget(null)}
        onChange={refreshBooks}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
    )
  } else {
    // library (default) — also the fallback for missing book/quiz.
    body = (
      <Library
        key={booksVersion}
        theme={theme}
        onToggleTheme={toggleTheme}
        onBooksChange={refreshBooks}
      />
    )
  }

  return <div className="app">{body}</div>
}
