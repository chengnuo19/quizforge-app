// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePwaInstall, promptInstall, __resetInstallState } from './usePwaInstall.js'

// Simulate the browser's beforeinstallprompt event with the shape we rely on.
function fireBeforeInstallPrompt({ outcome = 'accepted' } = {}) {
  const e = new Event('beforeinstallprompt')
  e.prompt = vi.fn()
  e.userChoice = Promise.resolve({ outcome })
  act(() => {
    window.dispatchEvent(e)
  })
  return e
}

beforeEach(() => {
  __resetInstallState()
})

describe('usePwaInstall', () => {
  it('is not installable before any beforeinstallprompt event', () => {
    const { result } = renderHook(() => usePwaInstall())
    expect(result.current.canInstall).toBe(false)
  })

  it('becomes installable after beforeinstallprompt fires', () => {
    const { result } = renderHook(() => usePwaInstall())
    fireBeforeInstallPrompt()
    expect(result.current.canInstall).toBe(true)
  })

  it('promptInstall triggers the native prompt and clears availability', async () => {
    const { result } = renderHook(() => usePwaInstall())
    const evt = fireBeforeInstallPrompt({ outcome: 'accepted' })
    expect(result.current.canInstall).toBe(true)

    let outcome
    await act(async () => {
      outcome = await promptInstall()
    })
    expect(evt.prompt).toHaveBeenCalledTimes(1)
    expect(outcome).toBe('accepted')
    // Single-use: the button should disappear after prompting.
    expect(result.current.canInstall).toBe(false)
  })

  it('promptInstall returns null when nothing is deferred', async () => {
    let outcome
    await act(async () => {
      outcome = await promptInstall()
    })
    expect(outcome).toBeNull()
  })
})
