// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import SettingsModal from './SettingsModal.jsx'

vi.mock('../quiz/aiClient.js', async (importOriginal) => ({
  ...(await importOriginal()),
  chatCompletion: vi.fn(async () => 'OK'),
}))

function memoryStorage() {
  const data = {}
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v) },
    removeItem: (k) => { delete data[k] },
  }
}

function fakeBridge() {
  return {
    status: vi.fn(async (provider) => (provider === 'chatgpt' ? { loggedIn: false } : { agyPath: 'agy', accountMode: true })),
    login: vi.fn(async () => ({ loggedIn: true })),
    logout: vi.fn(async () => ({ loggedIn: false })),
    listModels: vi.fn(async () => [{ id: 'gpt-5.5', name: 'GPT-5.5' }]),
    complete: vi.fn(),
  }
}

describe('SettingsModal AI settings', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage())
  })

  afterEach(() => {
    cleanup()
    delete window.aiBridge
    vi.unstubAllGlobals()
  })

  it('disables subscriptions outside the desktop app', () => {
    render(<SettingsModal onClose={() => {}} />)
    expect(screen.getByRole('radio', { name: /ChatGPT 订阅/ }).disabled).toBe(true)
    expect(screen.getByRole('radio', { name: /Antigravity 订阅/ }).disabled).toBe(true)
    expect(screen.getByRole('radio', { name: /API Key/ }).checked).toBe(true)
  })

  it('logs in to ChatGPT through the bridge', async () => {
    window.aiBridge = fakeBridge()
    render(<SettingsModal onClose={() => {}} />)
    fireEvent.click(screen.getByRole('radio', { name: /ChatGPT 订阅/ }))

    await screen.findByText('未登录')
    expect(await screen.findByRole('option', { name: 'GPT-5.5（gpt-5.5）' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '登录 ChatGPT' }))

    await screen.findByText('已登录 ChatGPT')
    expect(window.aiBridge.login).toHaveBeenCalledWith('chatgpt')
  })

  it('saves the chosen provider and model', async () => {
    window.aiBridge = fakeBridge()
    const onClose = vi.fn()
    render(<SettingsModal onClose={onClose} />)
    fireEvent.click(screen.getByRole('radio', { name: /ChatGPT 订阅/ }))
    await screen.findByRole('option', { name: 'GPT-5.5（gpt-5.5）' })

    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    const saved = JSON.parse(localStorage.getItem('quizforge:aiSettings'))
    expect(saved.provider).toBe('chatgpt')
    expect(onClose).toHaveBeenCalled()
  })

  it('tests the connection with the unsaved settings', async () => {
    const { chatCompletion } = await import('../quiz/aiClient.js')
    render(<SettingsModal onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '测试连接' }))

    await screen.findByText('连接成功：OK')
    await waitFor(() => expect(chatCompletion).toHaveBeenCalled())
    expect(chatCompletion.mock.calls[0][1].settings.baseUrl).toBe('https://api.openai.com/v1')
  })
})
