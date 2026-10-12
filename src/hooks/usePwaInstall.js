// PWA install-prompt hook.
//
// Chromium fires `beforeinstallprompt` when the app meets installability
// criteria. We call preventDefault() to suppress the browser's mini-infobar and
// stash the event so our own "安装应用" button can trigger the native prompt on
// demand. The event can fire *before* React mounts, so we listen at module load
// and keep the deferred prompt in module scope; a small observer set lets the
// hook re-render whenever install availability changes.
//
// Safari/Firefox don't support beforeinstallprompt, so canInstall stays false
// there and the button simply never shows.
import { useEffect, useState } from 'react'

let deferredPrompt = null
const listeners = new Set()

// True when already running as an installed PWA (don't offer install again).
function isStandalone() {
  if (typeof window === 'undefined') return false
  // matchMedia is absent in jsdom / older environments — guard with optional chaining.
  const mql = window.matchMedia?.('(display-mode: standalone)')
  return mql?.matches === true || window.navigator?.standalone === true
}

let installed = isStandalone()

function emit() {
  for (const fn of listeners) fn()
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredPrompt = e
    emit()
  })
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    installed = true
    emit()
  })
}

// Trigger the native install prompt. Resolves to 'accepted' | 'dismissed' | null
// (null when no prompt is available). A deferred prompt can only be used once.
export async function promptInstall() {
  if (!deferredPrompt) return null
  const evt = deferredPrompt
  deferredPrompt = null
  emit() // hide the button immediately; the prompt is single-use
  evt.prompt()
  try {
    const choice = await evt.userChoice
    const outcome = choice?.outcome ?? null
    if (outcome === 'accepted') {
      installed = true
      emit()
    }
    return outcome
  } catch {
    return null
  }
}

export function usePwaInstall() {
  const [, bump] = useState(0)
  useEffect(() => {
    const fn = () => bump((n) => n + 1)
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  }, [])
  return {
    canInstall: deferredPrompt !== null && !installed,
    installed,
    promptInstall,
  }
}

// Test-only: reset module-scoped state so each test starts clean.
export function __resetInstallState() {
  deferredPrompt = null
  installed = false
}
