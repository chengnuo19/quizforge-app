/**
 * content.js
 * Injects QuizForge clipper buttons into ChatGPT and Gemini pages,
 * and handles one-click clipping to QuizForge desktop app.
 */

const LOCAL_SERVER_URL = 'http://127.0.0.1:41414'

function showToast(message, isSuccess = true) {
  const existing = document.querySelector('.quizforge-toast')
  if (existing) existing.remove()

  const toast = document.createElement('div')
  toast.className = 'quizforge-toast'
  toast.innerHTML = `<span>${isSuccess ? '✅' : '⚠️'}</span><span>${message}</span>`
  document.body.appendChild(toast)

  setTimeout(() => {
    toast.style.opacity = '0'
    toast.style.transition = 'opacity 0.3s'
    setTimeout(() => toast.remove(), 300)
  }, 3500)
}

function getSiteInfo() {
  const host = window.location.hostname
  if (host.includes('chatgpt.com')) return 'ChatGPT'
  if (host.includes('gemini.google.com')) return 'Gemini'
  return 'AI'
}

async function fetchNotebooks() {
  try {
    const res = await fetch(`${LOCAL_SERVER_URL}/api/notebooks`, { mode: 'cors' })
    if (res.ok) {
      const data = await res.json()
      return data.notebooks || []
    }
  } catch (e) {
    console.warn('[QuizForge Clipper] Local server not reachable:', e)
  }
  return []
}

async function sendClipToQuizForge(payload) {
  const res = await fetch(`${LOCAL_SERVER_URL}/api/clip`, {
    method: 'POST',
    mode: 'cors',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return await res.json()
}

function openClipModal({ promptText, answerMarkdown, quizData, sourceUrl, provider }) {
  const existing = document.querySelector('.quizforge-clip-modal')
  if (existing) existing.remove()

  const modal = document.createElement('div')
  modal.className = 'quizforge-clip-modal'

  const titleGuess = (promptText || answerMarkdown.split('\n')[0] || 'AI 学习笔记')
    .replace(/[#*`_]/g, '')
    .trim()
    .slice(0, 40)

  let selectedType = quizData?.isQuiz ? 'quiz' : 'document'

  modal.innerHTML = `
    <div class="quizforge-clip-modal__header">
      <div class="quizforge-clip-modal__title">
        <span>✦</span> 保存到 QuizForge
      </div>
      <button class="quizforge-clip-modal__close">×</button>
    </div>
    <div class="quizforge-clip-modal__body">
      <div class="quizforge-type-tabs">
        <button type="button" class="quizforge-type-tab ${selectedType === 'document' ? 'active' : ''}" data-type="document">
          📝 知识点笔记
        </button>
        <button type="button" class="quizforge-type-tab ${selectedType === 'quiz' ? 'active' : ''}" data-type="quiz">
          ❌ 测验与错题
        </button>
      </div>

      <div class="quizforge-form-row">
        <label>目标笔记本：</label>
        <select class="quizforge-select" id="qf-notebook-select">
          <option value="">加载中...</option>
        </select>
        <input type="text" class="quizforge-input" id="qf-new-book" placeholder="或输入新笔记本名称" style="display:none; margin-top:4px;" />
      </div>

      <div class="quizforge-form-row">
        <label>标题：</label>
        <input type="text" class="quizforge-input" id="qf-title" value="${titleGuess}" />
      </div>

      <div class="quizforge-form-row">
        <label>内容预览：</label>
        <textarea class="quizforge-input" id="qf-content" rows="4" style="font-family:monospace; font-size:12px; resize:vertical;">${answerMarkdown.slice(0, 400)}${answerMarkdown.length > 400 ? '...' : ''}</textarea>
      </div>
    </div>
    <div class="quizforge-clip-modal__footer">
      <button type="button" class="quizforge-btn quizforge-btn--secondary" id="qf-cancel">取消</button>
      <button type="button" class="quizforge-btn quizforge-btn--primary" id="qf-submit">一键入库</button>
    </div>
  `

  document.body.appendChild(modal)

  const close = () => modal.remove()
  modal.querySelector('.quizforge-clip-modal__close').onclick = close
  modal.querySelector('#qf-cancel').onclick = close

  // Tab switching
  const tabs = modal.querySelectorAll('.quizforge-type-tab')
  tabs.forEach((tab) => {
    tab.onclick = () => {
      tabs.forEach((t) => t.classList.remove('active'))
      tab.classList.add('active')
      selectedType = tab.dataset.type
    }
  })

  // Load notebooks
  const select = modal.querySelector('#qf-notebook-select')
  const newBookInput = modal.querySelector('#qf-new-book')

  fetchNotebooks().then((books) => {
    select.innerHTML = ''
    if (!books.length) {
      select.innerHTML = '<option value="default">AI 剪藏笔记本 (默认)</option><option value="new">+ 新建笔记本...</option>'
      return
    }
    books.forEach((b) => {
      const opt = document.createElement('option')
      opt.value = b.id
      opt.textContent = `${b.icon || '📘'} ${b.name}`
      select.appendChild(opt)
    })
    const newOpt = document.createElement('option')
    newOpt.value = 'new'
    newOpt.textContent = '+ 新建笔记本...'
    select.appendChild(newOpt)
  })

  select.onchange = () => {
    newBookInput.style.display = select.value === 'new' ? 'block' : 'none'
  }

  // Handle submit
  const submitBtn = modal.querySelector('#qf-submit')
  submitBtn.onclick = async () => {
    submitBtn.textContent = '保存中...'
    submitBtn.disabled = true

    const title = modal.querySelector('#qf-title').value.trim() || titleGuess
    const notebookId = select.value === 'new' ? '' : select.value
    const newNotebookName = select.value === 'new' ? newBookInput.value.trim() : ''

    const payload = {
      type: selectedType,
      title,
      notebookId,
      newNotebookName,
      contentMarkdown: answerMarkdown,
      question: selectedType === 'quiz' && quizData?.isQuiz ? quizData : undefined,
      promptText,
      sourceUrl,
      provider,
    }

    try {
      const result = await sendClipToQuizForge(payload)
      close()
      showToast(result.message || '已成功保存到 QuizForge！', true)
    } catch (err) {
      submitBtn.textContent = '重试'
      submitBtn.disabled = false
      showToast(`保存失败: ${err.message}。请确认 QuizForge 桌面版已打开。`, false)
    }
  }
}

// Button injection into ChatGPT & Gemini
function injectClipperButton() {
  const provider = getSiteInfo()

  if (provider === 'ChatGPT') {
    // Target: [data-message-author-role="assistant"]
    const turns = document.querySelectorAll('article [data-message-author-role="assistant"]')
    turns.forEach((turn) => {
      // Find the turn container or action bar
      const actionBar = turn.querySelector('.items-center.gap-1') || turn.parentElement?.querySelector('.items-center.gap-1') || turn
      if (!actionBar || actionBar.querySelector('.quizforge-clip-btn')) return

      const btn = document.createElement('button')
      btn.className = 'quizforge-clip-btn'
      btn.type = 'button'
      btn.title = '将回答保存到 QuizForge'
      btn.innerHTML = '<span class="quizforge-clip-btn__icon">✦</span><span>存到 QuizForge</span>'

      btn.onclick = (e) => {
        e.preventDefault()
        e.stopPropagation()

        // Get user prompt: preceding user article turn
        const article = turn.closest('article')
        let promptText = ''
        let prev = article ? article.previousElementSibling : null
        while (prev) {
          const userElem = prev.querySelector('[data-message-author-role="user"]')
          if (userElem) {
            promptText = userElem.textContent || ''
            break
          }
          prev = prev.previousElementSibling
        }

        const answerHtml = turn.innerHTML
        const answerMd = window.convertHtmlToMarkdown ? window.convertHtmlToMarkdown(turn) : (turn.textContent || '')
        const quizData = window.extractQuizFromMarkdown ? window.extractQuizFromMarkdown(answerMd) : { isQuiz: false }

        openClipModal({
          promptText,
          answerMarkdown: answerMd,
          quizData,
          sourceUrl: window.location.href,
          provider: 'ChatGPT',
        })
      }

      actionBar.appendChild(btn)
    })
  } else if (provider === 'Gemini') {
    // Target: <model-response> or .response-container
    const responses = document.querySelectorAll('model-response, .response-container')
    responses.forEach((res) => {
      const actionBar = res.querySelector('.actions-container, .bottom-container, [role="toolbar"]') || res
      if (!actionBar || actionBar.querySelector('.quizforge-clip-btn')) return

      const btn = document.createElement('button')
      btn.className = 'quizforge-clip-btn'
      btn.type = 'button'
      btn.title = '将回答保存到 QuizForge'
      btn.innerHTML = '<span class="quizforge-clip-btn__icon">✦</span><span>存到 QuizForge</span>'

      btn.onclick = (e) => {
        e.preventDefault()
        e.stopPropagation()

        // Get user prompt
        let promptText = ''
        const parentTurn = res.closest('.conversation-turn, .chat-turn')
        if (parentTurn) {
          const query = parentTurn.querySelector('.user-query, .query-text')
          if (query) promptText = query.textContent || ''
        }

        const answerMd = window.convertHtmlToMarkdown ? window.convertHtmlToMarkdown(res) : (res.textContent || '')
        const quizData = window.extractQuizFromMarkdown ? window.extractQuizFromMarkdown(answerMd) : { isQuiz: false }

        openClipModal({
          promptText,
          answerMarkdown: answerMd,
          quizData,
          sourceUrl: window.location.href,
          provider: 'Gemini',
        })
      }

      actionBar.appendChild(btn)
    })
  }
}

// Initialize observer
let observerTimeout = null
const observer = new MutationObserver(() => {
  if (observerTimeout) clearTimeout(observerTimeout)
  observerTimeout = setTimeout(injectClipperButton, 500)
})

observer.observe(document.body, { childList: true, subtree: true })
injectClipperButton()
