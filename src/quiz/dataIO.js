export function exportAllData() {
  const data = {}
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && key.startsWith('quizforge:')) {
      data[key] = localStorage.getItem(key)
    }
  }
  return JSON.stringify(data, null, 2)
}

export function importAllData(jsonStr) {
  try {
    const data = JSON.parse(jsonStr)
    let imported = 0
    for (const key in data) {
      if (key.startsWith('quizforge:')) {
        localStorage.setItem(key, data[key])
        imported++
      }
    }
    return imported > 0
  } catch {
    return false
  }
}
