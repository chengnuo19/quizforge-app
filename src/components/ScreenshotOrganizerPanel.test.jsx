// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ScreenshotOrganizerPanel from './ScreenshotOrganizerPanel.jsx'
import { saveAiSettings } from '../quiz/storage.js'

const mockConfig = {
  success: true,
  source: 'C:\\test-fixtures\\ScreenshotOrganizer\\config.yaml',
  config: {
    watchDir: 'C:\\Users\\User\\Pictures\\Screenshots',
    outputDir: 'E:\\屏幕截图',
    providerOrder: ['gemini'],
    providers: {
      gemini: {
        label: 'Google Gemini',
        model: 'gemini-2.5-flash',
        adapter: 'openai_compatible',
        apiKeyEnv: 'GEMINI_API_KEY',
        hasApiKey: true,
        pricing: 'test pricing',
      },
    },
  },
}

const runScreenshotOrganizer = vi.fn()
const stopScreenshotWatcher = vi.fn()

beforeEach(() => {
  runScreenshotOrganizer.mockResolvedValue({ output: 'command completed', watching: false })
  stopScreenshotWatcher.mockResolvedValue({ output: 'watcher stopped', watching: false })
  vi.stubGlobal('electronAPI', {
    getScreenshotConfig: vi.fn().mockResolvedValue(mockConfig),
    runScreenshotOrganizer,
    stopScreenshotWatcher,
  })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('ScreenshotOrganizerPanel', () => {
  it('runs a real dry-run preview through the desktop bridge', async () => {
    render(<ScreenshotOrganizerPanel onExit={() => {}} />)

    await waitFor(() => expect(screen.getByTestId('screenshot-preview')).toBeTruthy())
    fireEvent.click(screen.getByTestId('screenshot-preview'))

    await waitFor(() => {
      expect(runScreenshotOrganizer).toHaveBeenCalledWith(expect.objectContaining({
        action: 'preview',
        provider: '__app__',
        watchDir: 'C:\\Users\\User\\Pictures\\Screenshots',
        outputDir: 'E:\\屏幕截图',
        aiSettings: expect.any(Object),
      }))
    })
    expect(screen.getByTestId('screenshot-command-output').textContent).toContain('command completed')
  })

  it('allows switching to a specific provider and sends its model name', async () => {
    render(<ScreenshotOrganizerPanel onExit={() => {}} />)

    await waitFor(() => expect(screen.getByLabelText('服务商 (Provider)')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('服务商 (Provider)'), { target: { value: 'gemini' } })

    fireEvent.click(screen.getByTestId('screenshot-preview'))

    await waitFor(() => {
      expect(runScreenshotOrganizer).toHaveBeenCalledWith(expect.objectContaining({
        action: 'preview',
        provider: 'gemini',
        modelName: 'gemini-2.5-flash',
      }))
    })
  })

  it('requires a confirmation before starting a batch operation', async () => {
    render(<ScreenshotOrganizerPanel onExit={() => {}} />)

    await waitFor(() => expect(screen.getByTestId('screenshot-start')).toBeTruthy())
    fireEvent.click(screen.getByTestId('screenshot-start'))

    expect(window.confirm).toHaveBeenCalledTimes(1)
    expect(runScreenshotOrganizer).toHaveBeenCalledWith(expect.objectContaining({ action: 'batch' }))
  })

  it('starts and stops watch mode through dedicated desktop APIs', async () => {
    runScreenshotOrganizer.mockResolvedValueOnce({ output: 'watching', watching: true, pid: 1234 })
    render(<ScreenshotOrganizerPanel onExit={() => {}} />)

    await waitFor(() => expect(screen.getByTestId('screenshot-mode')).toBeTruthy())
    fireEvent.change(screen.getByTestId('screenshot-mode'), { target: { value: 'watch' } })
    fireEvent.click(screen.getByTestId('screenshot-start'))

    await waitFor(() => expect(runScreenshotOrganizer).toHaveBeenCalledWith(expect.objectContaining({ action: 'watch' })))
    fireEvent.click(screen.getByTestId('screenshot-start'))
    await waitFor(() => expect(stopScreenshotWatcher).toHaveBeenCalledTimes(1))
  })

  it('runs the real undo command instead of showing a prototype alert', async () => {
    render(<ScreenshotOrganizerPanel onExit={() => {}} />)

    await waitFor(() => expect(screen.getByTestId('screenshot-undo')).toBeTruthy())
    fireEvent.click(screen.getByTestId('screenshot-undo'))

    await waitFor(() => expect(runScreenshotOrganizer).toHaveBeenCalledWith(expect.objectContaining({ action: 'undo' })))
  })

  it('renders app AI settings status and opens the settings modal', async () => {
    saveAiSettings({
      provider: 'antigravity',
      antigravityModel: 'gemini-3.8-flash-high',
    })

    render(<ScreenshotOrganizerPanel onExit={() => {}} />)

    expect(screen.getByText('Antigravity 订阅')).toBeTruthy()
    expect(screen.getByText('gemini-3.8-flash-high')).toBeTruthy()

    const configBtn = screen.getByRole('button', { name: /配置应用 AI/i })
    expect(configBtn).toBeTruthy()
    fireEvent.click(configBtn)

    expect(screen.getByText('应用设置')).toBeTruthy()
  })

  it('displays warning when apiKey is empty and allows switching back from external provider', async () => {
    saveAiSettings({
      provider: 'apiKey',
      apiKey: '',
      model: 'gpt-4o',
    })

    const customConfig = {
      ...mockConfig,
      config: {
        ...mockConfig.config,
        providers: {
          gemini: {
            ...mockConfig.config.providers.gemini,
            hasApiKey: false,
          },
        },
      },
    }
    window.electronAPI.getScreenshotConfig.mockResolvedValueOnce(customConfig)

    render(<ScreenshotOrganizerPanel onExit={() => {}} />)

    await waitFor(() => expect(screen.getByText(/未配置全局 API Key/i)).toBeTruthy())

    fireEvent.change(screen.getByLabelText('服务商 (Provider)'), { target: { value: 'gemini' } })

    await waitFor(() => expect(screen.getByText(/缺少环境变量/i)).toBeTruthy())
    const switchBackBtn = screen.getByRole('button', { name: /切回应用全局 AI/i })
    expect(switchBackBtn).toBeTruthy()
    fireEvent.click(switchBackBtn)

    expect(screen.getByLabelText('服务商 (Provider)').value).toBe('__app__')
  })
})
