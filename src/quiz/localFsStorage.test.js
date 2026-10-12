import { afterEach, describe, expect, it, vi } from 'vitest'

function createLocalStorage(initial = {}) {
  const store = new Map(Object.entries(initial))
  return {
    getItem: vi.fn(key => store.get(key) ?? null),
    setItem: vi.fn((key, value) => store.set(key, String(value))),
    removeItem: vi.fn(key => store.delete(key)),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('localFsStorage', () => {
  it('requires a vault selection when desktop has no stored vault path', async () => {
    vi.resetModules()
    vi.stubGlobal('window', { electronAPI: {} })
    vi.stubGlobal('localStorage', createLocalStorage())

    const { DEFAULT_VAULT_PATH, getVaultPath, isDesktop } = await import('./localFsStorage.js')

    expect(isDesktop).toBe(true)
    expect(getVaultPath()).toBe(DEFAULT_VAULT_PATH)
  })

  it('keeps an explicitly selected vault path', async () => {
    vi.resetModules()
    vi.stubGlobal('window', { electronAPI: {} })
    vi.stubGlobal('localStorage', createLocalStorage({ 'quizforge:vaultPath': 'D:\\OtherVault' }))

    const { getVaultPath } = await import('./localFsStorage.js')

    expect(getVaultPath()).toBe('D:\\OtherVault')
  })
})
