// Deterministic shuffle helpers. A seed is stored with each attempt so the same
// shuffled order survives reloads (keeping persisted answers valid), and a new
// seed on restart re-shuffles.

const LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

export function makeSeed() {
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0
}

// mulberry32 PRNG — small, deterministic, good enough for shuffling.
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffled(arr, next) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Returns a (possibly) shuffled copy of the quiz. Options are relabeled A/B/C…
// by their new position so the display stays ordered; correctness rides on
// `option.correct`, not the label.
export function shuffleQuiz(quiz, seed) {
  if (!quiz.shuffle && !quiz.shuffleOptions) return quiz
  const next = rng(seed)
  let questions = quiz.shuffle ? shuffled(quiz.questions, next) : quiz.questions
  questions = questions.map((q) => {
    const opts = quiz.shuffleOptions ? shuffled(q.options, next) : q.options
    return { ...q, options: opts.map((o, i) => ({ ...o, label: LABELS[i] ?? '?' })) }
  })
  return { ...quiz, questions }
}
