// Tiny hash-based router. No dependency; the whole app state lives in the URL
// hash so a refresh lands on the same view and links are bookmarkable.
//
// Routes:
//   #                     → { view: 'library' }
//   #book=<bookId>        → { view: 'book', bookId }
//   #play=<bookId>/<quizId> → { view: 'play', bookId, quizId }
//   #q=<compressed>       → { view: 'shared', shared: '<compressed>' }
//   #srs                  → { view: 'srs' }
//   #stats                → { view: 'stats' }
//
// bookId may itself contain a colon (e.g. "builtin:数据结构与算法") and quizId may
// contain slashes (built-in quiz ids are full paths), so #play is split on the
// FIRST "/" only.

export function parseHash(hash = window.location.hash) {
  const h = (hash || '').replace(/^#/, '')
  if (!h) return { view: 'library' }

  if (h === 'srs') return { view: 'srs' }
  if (h === 'stats') return { view: 'stats' }
  if (h === 'favorites') return { view: 'favorites' }
  if (h === 'wrong') return { view: 'wrong' }
  if (h === 'organizeWrong') return { view: 'organizeWrong' }
  if (h === 'markitdown') return { view: 'markitdown' }
  if (h === 'screenshot-organizer') return { view: 'screenshot-organizer' }
  if (h === 'todos') return { view: 'todos' }
  if (h === 'pdf-workbench') return { view: 'pdf-workbench' }
  if (h === 'media-downloader') return { view: 'media-downloader' }
  if (h === 'video-subtitles') return { view: 'video-subtitles' }

  if (h.startsWith('q=')) {
    return { view: 'shared', shared: h.slice(2) }
  }
  if (h.startsWith('book=')) {
    return { view: 'book', bookId: decodeURIComponent(h.slice(5)) }
  }
  if (h.startsWith('play=')) {
    const rest = h.slice(5)
    const slash = rest.indexOf('/')
    if (slash === -1) return { view: 'library' }
    return {
      view: 'play',
      bookId: decodeURIComponent(rest.slice(0, slash)),
      quizId: decodeURIComponent(rest.slice(slash + 1)),
    }
  }
  return { view: 'library' }
}

export function libraryHash() {
  return '#'
}

export function bookHash(bookId) {
  return `#book=${encodeURIComponent(bookId)}`
}

export function playHash(bookId, quizId) {
  return `#play=${encodeURIComponent(bookId)}/${encodeURIComponent(quizId)}`
}

// Navigation helpers — set the hash; the App's hashchange listener re-renders.
export function go(hash) {
  window.location.hash = hash
}

export function goLibrary() {
  go(libraryHash())
}
export function goBook(bookId) {
  go(bookHash(bookId))
}
export function goPlay(bookId, quizId) {
  go(playHash(bookId, quizId))
}
export function goSrs() {
  go('#srs')
}
export function goStats() {
  go('#stats')
}
export function goFavorites() {
  go('#favorites')
}
export function goWrongBook() {
  go('#wrong')
}
export function goOrganizeWrong() {
  go('#organizeWrong')
}

export function markitdownHash() {
  return '#markitdown'
}

export function goMarkitdown() {
  go(markitdownHash())
}

export function screenshotOrganizerHash() {
  return '#screenshot-organizer'
}

export function goScreenshotOrganizer() {
  go(screenshotOrganizerHash())
}

export function todosHash() {
  return '#todos'
}

export function goTodos() {
  go(todosHash())
}

export function pdfWorkbenchHash() {
  return '#pdf-workbench'
}

export function goPdfWorkbench() {
  go(pdfWorkbenchHash())
}

export function mediaDownloaderHash() {
  return '#media-downloader'
}

export function goMediaDownloader() {
  go(mediaDownloaderHash())
}

export function videoSubtitlesHash() {
  return '#video-subtitles'
}

export function goVideoSubtitles() {
  go(videoSubtitlesHash())
}

