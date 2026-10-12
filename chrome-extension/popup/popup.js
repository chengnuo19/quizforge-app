const SERVER_URL = 'http://127.0.0.1:41414'

let isServerOnline = false
let currentType = 'document' // 'document' | 'quiz'

const statusDot = document.getElementById('status-dot')
const statusText = document.getElementById('status-text')
const notebookSelect = document.getElementById('notebook-select')
const newNotebookInput = document.getElementById('new-notebook-input')
const titleInput = document.getElementById('title-input')
const contentInput = document.getElementById('content-input')
const btnSave = document.getElementById('btn-save')
const btnTypeDoc = document.getElementById('btn-type-doc')
const btnTypeQuiz = document.getElementById('btn-type-quiz')
const btnGrabPage = document.getElementById('btn-grab-page')
const msgBox = document.getElementById('msg-box')

function showMessage(msg, isError = false) {
  msgBox.style.display = 'block'
  msgBox.className = `msg-box ${isError ? 'error' : 'success'}`
  msgBox.textContent = msg
}

function clearMessage() {
  msgBox.style.display = 'none'
  msgBox.textContent = ''
}

// Check local server connection & load notebooks
async function initConnection() {
  try {
    const statusRes = await fetch(`${SERVER_URL}/api/status`, { mode: 'cors' })
    if (statusRes.ok) {
      isServerOnline = true
      statusDot.className = 'status-dot status-dot--online'
      statusText.textContent = '桌面版已连接'
      btnSave.disabled = false
    } else {
      throw new Error()
    }
  } catch {
    isServerOnline = false
    statusDot.className = 'status-dot status-dot--offline'
    statusText.textContent = '桌面版未启动'
    showMessage('未检测到 QuizForge 桌面端。请先启动 QuizForge 桌面版以使用一键存入功能。', true)
  }

  if (isServerOnline) {
    try {
      const nbRes = await fetch(`${SERVER_URL}/api/notebooks`, { mode: 'cors' })
      if (nbRes.ok) {
        const data = await nbRes.json()
        const books = data.notebooks || []
        notebookSelect.innerHTML = ''
        if (!books.length) {
          notebookSelect.innerHTML = '<option value="default">AI 剪藏笔记本 (默认)</option><option value="new">+ 新建笔记本...</option>'
        } else {
          books.forEach((b) => {
            const opt = document.createElement('option')
            opt.value = b.id
            opt.textContent = `${b.icon || '📘'} ${b.name}`
            notebookSelect.appendChild(opt)
          })
          const newOpt = document.createElement('option')
          newOpt.value = 'new'
          newOpt.textContent = '+ 新建笔记本...'
          notebookSelect.appendChild(newOpt)
        }
      }
    } catch (e) {
      console.error('Failed to load notebooks:', e)
    }
  }
}

notebookSelect.addEventListener('change', () => {
  newNotebookInput.style.display = notebookSelect.value === 'new' ? 'block' : 'none'
})

// Type selector buttons
btnTypeDoc.addEventListener('click', () => {
  currentType = 'document'
  btnTypeDoc.classList.add('active')
  btnTypeQuiz.classList.remove('active')
})

btnTypeQuiz.addEventListener('click', () => {
  currentType = 'quiz'
  btnTypeQuiz.classList.add('active')
  btnTypeDoc.classList.remove('active')
})

// Grab content from active tab
btnGrabPage.addEventListener('click', async () => {
  clearMessage()
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) return

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        // Try getting selection first
        const sel = window.getSelection()?.toString()?.trim()
        if (sel) return { text: sel, title: sel.slice(0, 30) }

        // Otherwise get last assistant message
        const isChatGPT = window.location.hostname.includes('chatgpt.com')
        const isGemini = window.location.hostname.includes('gemini.google.com')

        if (isChatGPT) {
          const assistantTurns = document.querySelectorAll('article [data-message-author-role="assistant"]')
          if (assistantTurns.length > 0) {
            const lastTurn = assistantTurns[assistantTurns.length - 1]
            const md = window.convertHtmlToMarkdown ? window.convertHtmlToMarkdown(lastTurn) : (lastTurn.textContent || '')
            return { text: md, title: document.title || 'ChatGPT 笔记' }
          }
        } else if (isGemini) {
          const responses = document.querySelectorAll('model-response, .response-container')
          if (responses.length > 0) {
            const lastRes = responses[responses.length - 1]
            const md = window.convertHtmlToMarkdown ? window.convertHtmlToMarkdown(lastRes) : (lastRes.textContent || '')
            return { text: md, title: document.title || 'Gemini 笔记' }
          }
        }

        return null
      },
    })

    if (results?.[0]?.result) {
      const { text, title } = results[0].result
      contentInput.value = text
      if (!titleInput.value) {
        titleInput.value = (title || 'AI 学习笔记').slice(0, 40)
      }
      // Check if it's quiz-like
      if (window.extractQuizFromMarkdown) {
        const qData = window.extractQuizFromMarkdown(text)
        if (qData.isQuiz) {
          btnTypeQuiz.click()
        }
      }
      showMessage('成功从当前页面抓取最新回答！')
    } else {
      showMessage('未在当前页面检测到回答，请手动选中内容或粘贴。', true)
    }
  } catch (err) {
    showMessage(`抓取失败: ${err.message}`, true)
  }
})

// Submit to QuizForge
btnSave.addEventListener('click', async () => {
  clearMessage()
  const content = contentInput.value.trim()
  if (!content) {
    return showMessage('内容不能为空！', true)
  }

  btnSave.disabled = true
  btnSave.textContent = '保存中...'

  const title = titleInput.value.trim() || content.slice(0, 30)
  const isNew = notebookSelect.value === 'new'
  const notebookId = isNew ? '' : notebookSelect.value
  const newNotebookName = isNew ? newNotebookInput.value.trim() : ''

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  const sourceUrl = tab?.url || ''
  const provider = sourceUrl.includes('gemini') ? 'Gemini' : (sourceUrl.includes('chatgpt') ? 'ChatGPT' : 'AI')

  const quizData = currentType === 'quiz' && window.extractQuizFromMarkdown ? window.extractQuizFromMarkdown(content) : null

  const payload = {
    type: currentType,
    title,
    notebookId,
    newNotebookName,
    contentMarkdown: content,
    question: quizData?.isQuiz ? quizData : undefined,
    sourceUrl,
    provider,
  }

  try {
    const res = await fetch(`${SERVER_URL}/api/clip`, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `HTTP ${res.status}`)
    }

    const data = await res.json()
    showMessage(data.message || '已成功保存到 QuizForge！')
    btnSave.textContent = '已保存 ✓'
    setTimeout(() => {
      window.close()
    }, 1500)
  } catch (err) {
    btnSave.disabled = false
    btnSave.textContent = '保存到 QuizForge'
    showMessage(`保存失败: ${err.message}。请确认 QuizForge 桌面版已启动。`, true)
  }
})

// Start initialization
initConnection()
