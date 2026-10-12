/**
 * background.js
 * Service worker for context menu and badge management
 */

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'quizforge-clip-note',
    title: '✦ 保存选中内容为 QuizForge 笔记',
    contexts: ['selection'],
  })

  chrome.contextMenus.create({
    id: 'quizforge-clip-quiz',
    title: '✦ 保存选中内容为 QuizForge 错题/测验',
    contexts: ['selection'],
  })
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id || !info.selectionText) return

  const type = info.menuItemId === 'quizforge-clip-quiz' ? 'quiz' : 'document'
  const text = info.selectionText

  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (clipText, clipType, pageUrl) => {
      const quizData = window.extractQuizFromMarkdown ? window.extractQuizFromMarkdown(clipText) : { isQuiz: false }
      const modal = document.querySelector('.quizforge-clip-modal')
      if (modal) modal.remove()

      if (typeof window.openClipModal === 'function') {
        window.openClipModal({
          promptText: '',
          answerMarkdown: clipText,
          quizData,
          sourceUrl: pageUrl,
          provider: window.location.hostname.includes('gemini') ? 'Gemini' : 'ChatGPT',
        })
      } else {
        // Fallback: send directly to local server
        fetch('http://127.0.0.1:41414/api/clip', {
          method: 'POST',
          mode: 'cors',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: clipType,
            title: clipText.slice(0, 30),
            contentMarkdown: clipText,
            sourceUrl: pageUrl,
            provider: window.location.hostname.includes('gemini') ? 'Gemini' : 'ChatGPT',
          }),
        }).then(r => r.json()).then(res => {
          alert(`QuizForge: ${res.message || '已成功保存！'}`)
        }).catch(e => {
          alert(`保存失败: ${e.message}。请确认 QuizForge 桌面版已启动。`)
        })
      }
    },
    args: [text, type, tab.url || ''],
  })
})
