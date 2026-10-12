// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { canUsePdfFiles, readPdfBytes, writePdfBytes, launchWorkbenchWithPdf, consumePendingOpen } from './pdfBridge.js'

// The bridge gates file I/O on the desktop shell.
vi.mock('./localFsStorage.js', () => ({ isDesktop: true }))

beforeEach(() => {
  window.electronAPI = {
    readFileBuffer: vi.fn(async () => ({ base64: 'aGVsbG8=' })), // "hello"
    writeFileBuffer: vi.fn(async () => true),
  }
  consumePendingOpen() // clear any leftover session
})

describe('pdfBridge file I/O', () => {
  it('detects the desktop shell', () => {
    expect(canUsePdfFiles()).toBe(true)
  })

  it('reads raw bytes decoded from base64', async () => {
    const bytes = await readPdfBytes('C:\\vault\\x.pdf')
    expect(window.electronAPI.readFileBuffer).toHaveBeenCalledWith('C:\\vault\\x.pdf')
    expect([...bytes]).toEqual([...new TextEncoder().encode('hello')])
  })

  it('writes bytes as base64', async () => {
    await writePdfBytes('C:\\vault\\y.pdf', new TextEncoder().encode('pdf!'))
    expect(window.electronAPI.writeFileBuffer).toHaveBeenCalledWith(
      'C:\\vault\\y.pdf',
      'cGRmIQ==', // "pdf!"
    )
  })
})

describe('pdfBridge library → workbench hand-off', () => {
  it('stores a pending open exactly once', () => {
    const bytes = new Uint8Array([1, 2, 3])
    launchWorkbenchWithPdf(bytes, '试卷.pdf')
    const p = consumePendingOpen()
    expect(p).toEqual({ bytes, name: '试卷.pdf' })
    expect(consumePendingOpen()).toBeNull()
  })

  it('navigates to the workbench route', () => {
    window.location.hash = '#'
    launchWorkbenchWithPdf(new Uint8Array([1]), 'a.pdf')
    expect(window.location.hash).toBe('#pdf-workbench')
  })
})
