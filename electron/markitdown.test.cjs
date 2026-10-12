import { describe, it, expect } from 'vitest'
const {
  getMarkitdownCommand,
  convertDocumentWithMarkitdown,
} = require('./markitdown.cjs')

describe('markitdown helper', () => {
  it('uses MARKITDOWN_BIN when configured', () => {
    expect(getMarkitdownCommand({ MARKITDOWN_BIN: 'C:\\tools\\markitdown.exe' }))
      .toBe('C:\\tools\\markitdown.exe')
  })

  it('falls back to the markitdown command on PATH', () => {
    expect(getMarkitdownCommand({})).toBe('markitdown')
  })

  it('uses PATH instead of selecting an arbitrary user Python installation', () => {
    expect(getMarkitdownCommand({ APPDATA: 'C:\\test-fixtures\\AppData\\Roaming' }))
      .toBe('markitdown')
  })

  it('passes the selected file as an argument and returns stdout', async () => {
    const calls = []
    const execFileImpl = (command, args, options, callback) => {
      calls.push({ command, args, options })
      callback(null, { stdout: '# Converted', stderr: '' })
    }

    await expect(convertDocumentWithMarkitdown('C:\\notes\\exam.docx', {
      execFileImpl,
      env: { MARKITDOWN_BIN: 'markitdown' },
    })).resolves.toBe('# Converted')

    expect(calls[0].command).toBe('markitdown')
    expect(calls[0].args).toEqual(['C:\\notes\\exam.docx'])
    expect(calls[0].options.shell).toBe(false)
    expect(calls[0].options.windowsHide).toBe(true)
  })

  it('rejects when the selected file path is empty', async () => {
    await expect(convertDocumentWithMarkitdown('')).rejects.toThrow(
      'No document file was selected.'
    )
  })

  it('converts missing command errors into setup guidance', async () => {
    const execFileImpl = (command, args, options, callback) => {
      const err = new Error('spawn markitdown ENOENT')
      err.code = 'ENOENT'
      callback(err, { stdout: '', stderr: '' })
    }

    await expect(convertDocumentWithMarkitdown('C:\\notes\\exam.docx', {
      execFileImpl,
      env: {},
    })).rejects.toThrow('MarkItDown was not found')
  })
})
