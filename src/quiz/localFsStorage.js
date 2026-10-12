export const isDesktop = typeof window !== 'undefined' && !!window.electronAPI

const VAULT_KEY = 'quizforge:vaultPath'
export const DEFAULT_VAULT_PATH = ''

export function getVaultPath() {
  return localStorage.getItem(VAULT_KEY) || (isDesktop ? DEFAULT_VAULT_PATH : null)
}

export function setVaultPath(path) {
  if (path) {
    localStorage.setItem(VAULT_KEY, path)
  } else {
    localStorage.removeItem(VAULT_KEY)
  }
}

// Ensure the .quizforge directory exists inside the Vault
export async function ensureQuizForgeDir() {
  if (!isDesktop) return
  const vault = getVaultPath()
  if (!vault) return
  
  const qfDir = await window.electronAPI.joinPath(vault, '.quizforge')
  const exists = await window.electronAPI.exists(qfDir)
  if (!exists) {
    await window.electronAPI.mkdir(qfDir)
  }
}

// Generic JSON file reader
export async function readJsonFile(filename, defaultValue) {
  if (!isDesktop) return defaultValue
  const vault = getVaultPath()
  if (!vault) return defaultValue
  
  const filepath = await window.electronAPI.joinPath(vault, '.quizforge', filename)
  try {
    const exists = await window.electronAPI.exists(filepath)
    if (!exists) return defaultValue
    
    const content = await window.electronAPI.readFile(filepath)
    return JSON.parse(content)
  } catch (err) {
    console.error(`Failed to read ${filename}:`, err)
    return defaultValue
  }
}

// Generic JSON file writer
export async function writeJsonFile(filename, data) {
  if (!isDesktop) return
  const vault = getVaultPath()
  if (!vault) return
  
  const filepath = await window.electronAPI.joinPath(vault, '.quizforge', filename)
  try {
    await window.electronAPI.writeFile(filepath, JSON.stringify(data, null, 2))
  } catch (err) {
    console.error(`Failed to write ${filename}:`, err)
  }
}
