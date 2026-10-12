export function getDailyTrendData() {
  const data = {}
  
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && key.startsWith('quizforge:history:')) {
      try {
        const history = JSON.parse(localStorage.getItem(key))
        for (const attempt of history) {
          if (!attempt.date) continue
          const day = attempt.date.slice(0, 10)
          if (!data[day]) {
            data[day] = { count: 0, correct: 0, total: 0 }
          }
          data[day].count += 1
          data[day].correct += attempt.score
          data[day].total += attempt.total
        }
      } catch {}
    }
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  
  const trend = []
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const iso = d.toISOString().slice(0, 10)
    const dayData = data[iso] || { count: 0, correct: 0, total: 0 }
    
    trend.push({
      date: iso,
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      questions: dayData.total,
      accuracy: dayData.total > 0 ? dayData.correct / dayData.total : 0
    })
  }
  
  return trend
}
