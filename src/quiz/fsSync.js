import { isDesktop, readJsonFile, writeJsonFile, ensureQuizForgeDir, getVaultPath } from './localFsStorage.js'

const SYNC_MAP = {
  'quizforge:aiSettings': 'aiSettings.json',
  'quizforge:theme': 'theme.json',
  'quizforge:favorites': 'favorites.json',
  'quizforge:wrongBook': 'wrongBook.json',
  'quizforge:srs': 'srs.json',
  'quizforge:aiExplanations': 'aiExplanations.json',
  // Progress and History use dynamic keys, we'll store them in aggregate files
}

async function scanMarkdownQuizzes(bookPath) {
  const files = await window.electronAPI.readDir(bookPath);
  const quizzes = [];
  for (const f of files) {
    if (!f.isDirectory && f.name.endsWith('.md')) {
      const filePath = await window.electronAPI.joinPath(bookPath, f.name);
      const content = await window.electronAPI.readFile(filePath);
      quizzes.push({
        id: filePath,
        title: f.name.replace(/\.md$/, ''),
        source: content,
      });
    }
  }
  return quizzes;
}

export async function syncVaultToLocalOnStart() {
  if (!isDesktop) return
  await ensureQuizForgeDir()
  
  // Load fixed keys
  for (const [localKey, filename] of Object.entries(SYNC_MAP)) {
    const data = await readJsonFile(filename, null)
    if (data !== null) {
      localStorage.setItem(localKey, typeof data === 'string' ? data : JSON.stringify(data))
    }
  }

  // Load progress.json (which contains a map of all quiz progresses)
  const allProgress = await readJsonFile('progress.json', {})
  for (const [key, value] of Object.entries(allProgress)) {
    localStorage.setItem(key, JSON.stringify(value))
  }

  // Load history.json
  const allHistory = await readJsonFile('history.json', {})
  for (const [key, value] of Object.entries(allHistory)) {
    localStorage.setItem(key, JSON.stringify(value))
  }

  const resources = await readJsonFile('resources.json', { schemaVersion: 1, resources: [] })
  localStorage.setItem('quizforge:resources', JSON.stringify(resources))

  const todos = await readJsonFile('todos.json', { schemaVersion: 1, todos: [] })
  localStorage.setItem('quizforge:todos', JSON.stringify(todos))

  // Tell main process the current vault path to boot up reminder services
  const vault = getVaultPath()
  if (vault && window.electronAPI && typeof window.electronAPI.setCurrentVault === 'function') {
    await window.electronAPI.setCurrentVault(vault)
  }

  // Scan Vault for notebooks (folders) and quizzes (.md files)
  try {
    const vault = getVaultPath()
    if (vault) {
      const entries = await window.electronAPI.readDir(vault)
      const desktopBooks = []

      for (const e of entries) {
        if (e.isDirectory && !e.name.startsWith('.')) {
          const bookPath = await window.electronAPI.joinPath(vault, e.name)
          desktopBooks.push({
            id: bookPath,
            name: e.name,
            icon: '📌',
            color: 'sky',
            quizzes: await scanMarkdownQuizzes(bookPath),
          });
        }
      }
      localStorage.setItem('quizforge:desktopBooks', JSON.stringify(desktopBooks))
    }
  } catch (err) {
    console.error('Failed to scan vault books:', err)
  }
}

// Write-through helpers to be called whenever localStorage is updated
export function fsWriteSettings(key, value) {
  if (!isDesktop) return
  const filename = SYNC_MAP[key]
  if (filename) {
    writeJsonFile(filename, value)
  }
}

export async function fsWriteProgress() {
  if (!isDesktop) return
  const progressData = {}
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && k.startsWith('quizforge:progress:')) {
      progressData[k] = JSON.parse(localStorage.getItem(k) || 'null')
    }
  }
  await writeJsonFile('progress.json', progressData)
}

export async function fsWriteHistory() {
  if (!isDesktop) return
  const historyData = {}
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && k.startsWith('quizforge:history:')) {
      historyData[k] = JSON.parse(localStorage.getItem(k) || '[]')
    }
  }
  await writeJsonFile('history.json', historyData)
}

export async function fsCreateBook(bookName) {
  if (!isDesktop) return
  const vault = getVaultPath()
  if (!vault) return
  const bookPath = await window.electronAPI.joinPath(vault, bookName)
  await window.electronAPI.mkdir(bookPath)
  return bookPath
}

export async function fsWriteQuiz(bookPath, title, source) {
  if (!isDesktop) return
  const filePath = await window.electronAPI.joinPath(bookPath, `${title}.md`)
  await window.electronAPI.writeFile(filePath, source)
  return filePath
}

export async function fsReadResources() {
  if (!isDesktop) return { schemaVersion: 1, resources: [] }
  return readJsonFile('resources.json', { schemaVersion: 1, resources: [] })
}

export function fsWriteResources(payload) {
  if (!isDesktop) return
  writeJsonFile('resources.json', payload)
}

