const fs = require('fs/promises')
const path = require('path')
const { existsSync } = require('fs')
const nodemailer = require('nodemailer')

let vaultPath = ''
const activeTimers = new Map()
let mainIpc = null
let getWindowRef = null

// Helper to get Gmail configuration
async function getGmailConfig() {
  if (!vaultPath) return null
  const configPath = path.join(vaultPath, '.quizforge', 'gmail.json')
  try {
    if (existsSync(configPath)) {
      const content = await fs.readFile(configPath, 'utf-8')
      return JSON.parse(content)
    }
  } catch (err) {
    console.error('Failed to read gmail.json config:', err)
  }
  return null
}

// Helper to write Gmail configuration
async function saveGmailConfig(config) {
  if (!vaultPath) return false
  const qfDir = path.join(vaultPath, '.quizforge')
  const configPath = path.join(qfDir, 'gmail.json')
  try {
    if (!existsSync(qfDir)) {
      await fs.mkdir(qfDir, { recursive: true })
    }
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8')
    return true
  } catch (err) {
    console.error('Failed to write gmail.json config:', err)
    return false
  }
}

// Helper to read todos
async function getTodosData() {
  if (!vaultPath) return { schemaVersion: 1, todos: [] }
  const todosPath = path.join(vaultPath, '.quizforge', 'todos.json')
  try {
    if (existsSync(todosPath)) {
      const content = await fs.readFile(todosPath, 'utf-8')
      return JSON.parse(content)
    }
  } catch (err) {
    console.error('Failed to read todos.json:', err)
  }
  return { schemaVersion: 1, todos: [] }
}

// Helper to write todos and notify renderer
async function saveTodosData(todosData) {
  if (!vaultPath) return
  const todosPath = path.join(vaultPath, '.quizforge', 'todos.json')
  try {
    await fs.writeFile(todosPath, JSON.stringify(todosData, null, 2), 'utf-8')
    
    // Notify window that todos has been updated
    if (getWindowRef) {
      const win = getWindowRef()
      if (win && win.webContents) {
        win.webContents.send('todos-updated')
      }
    }
  } catch (err) {
    console.error('Failed to write todos.json:', err)
  }
}

// Nodemailer transport helper
function createTransporter(config) {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: config.user,
      pass: config.appPassword
    }
  })
}

// Send actual email notification
async function sendReminderEmail(todo) {
  const config = await getGmailConfig()
  if (!config || !config.user || !config.appPassword) {
    throw new Error('Gmail configuration is missing or incomplete')
  }

  const transporter = createTransporter(config)
  const estimatedStartAt = todo.dueAt - (todo.estimateMinutes * 60 * 1000)

  const mailOptions = {
    from: `"QuizForge Reminders" <${config.user}>`,
    to: config.user, // Send to self
    subject: `【QuizForge 提醒】任务即将开始：${todo.title}`,
    text: `您好，这是来自 QuizForge 的定时任务提醒。

任务：${todo.title}
${todo.notes ? `备注：\n${todo.notes}\n` : ''}
预计用时：${todo.estimateMinutes} 分钟
预计开始时间：${new Date(estimatedStartAt).toLocaleString()}
截止日期：${new Date(todo.dueAt).toLocaleString()}

请合理安排时间，加油！`
  }

  return await transporter.sendMail(mailOptions)
}

// Trigger immediate sending and save status
async function triggerReminder(todoId) {
  console.log(`Triggering reminder for todo ${todoId}`)
  activeTimers.delete(todoId)

  const todosData = await getTodosData()
  const todo = todosData.todos.find(t => t.id === String(todoId))
  
  if (!todo || todo.status !== 'open' || todo.reminderStatus === 'sent') {
    return
  }

  try {
    await sendReminderEmail(todo)
    console.log(`Successfully sent email reminder for todo: ${todo.title}`)
    
    // Update status to sent
    todo.reminderStatus = 'sent'
    todo.updatedAt = Date.now()
    await saveTodosData(todosData)
  } catch (err) {
    console.error(`Failed to send email reminder for ${todo.title}:`, err)
    
    // Update status to failed
    todo.reminderStatus = 'failed'
    todo.updatedAt = Date.now()
    await saveTodosData(todosData)
  }
}

// Primary scheduling logic
async function scheduleTodos(todos) {
  // Clear all existing timers
  for (const timer of activeTimers.values()) {
    clearTimeout(timer)
  }
  activeTimers.clear()

  const config = await getGmailConfig()
  if (!config || !config.user || !config.appPassword) {
    console.log('Skipping scheduling: Gmail is not configured yet.')
    return
  }

  const now = Date.now()
  let hasScheduledStatusChanges = false
  const updatedTodos = [...todos]

  for (const todo of updatedTodos) {
    // Only schedule open tasks with gmail reminder which haven't been successfully sent
    if (todo.status !== 'open' || todo.reminderChannel !== 'gmail' || todo.reminderStatus === 'sent') {
      continue
    }

    const estimatedStartAt = todo.dueAt - (todo.estimateMinutes * 60 * 1000)
    const sendAt = estimatedStartAt - (todo.remindBeforeHours * 60 * 60 * 1000)

    if (sendAt > now) {
      // Future reminder - schedule it
      const delay = sendAt - now
      const timer = setTimeout(() => {
        triggerReminder(todo.id)
      }, delay)
      
      activeTimers.set(todo.id, timer)
      
      if (todo.reminderStatus !== 'scheduled') {
        todo.reminderStatus = 'scheduled'
        todo.updatedAt = now
        hasScheduledStatusChanges = true
      }
    } else if (todo.dueAt > now) {
      // Past trigger time, but task is not yet due - trigger immediately
      if (todo.reminderStatus !== 'sent' && todo.reminderStatus !== 'failed') {
        console.log(`Reminder time has passed for "${todo.title}" (sendAt: ${new Date(sendAt).toLocaleString()}), triggering immediately.`)
        // Trigger in next tick to avoid blocking the loop
        setTimeout(() => {
          triggerReminder(todo.id)
        }, 0)
      }
    }
  }

  // If any status changed to 'scheduled', save back to file
  if (hasScheduledStatusChanges) {
    await saveTodosData({ schemaVersion: 1, todos: updatedTodos })
  }
}

// Load todos.json and run schedule
async function loadAndScheduleTodos() {
  if (!vaultPath) return
  const todosData = await getTodosData()
  await scheduleTodos(todosData.todos)
}

function initReminders(ipcMain, getWindow) {
  mainIpc = ipcMain
  getWindowRef = getWindow

  ipcMain.handle('reminders:setCurrentVault', async (event, pathStr) => {
    if (vaultPath !== pathStr) {
      vaultPath = pathStr
      console.log(`Setting active vault for reminders to: ${vaultPath}`)
      // Load configuration and bootstrap timers
      await loadAndScheduleTodos()
    }
    return true
  })

  ipcMain.handle('reminders:getStatus', async () => {
    const config = await getGmailConfig()
    if (!config) return { configured: false, user: '' }
    return {
      configured: !!(config.user && config.appPassword),
      user: config.user || ''
    }
  })

  ipcMain.handle('reminders:saveConfig', async (event, config) => {
    const success = await saveGmailConfig(config)
    if (success) {
      // Reload and schedule all pending timers with new credential
      await loadAndScheduleTodos()
      return { success: true }
    } else {
      return { success: false, error: '无法写入配置文件' }
    }
  })

  ipcMain.handle('reminders:sendTest', async () => {
    const config = await getGmailConfig()
    if (!config || !config.user || !config.appPassword) {
      return { success: false, error: 'Gmail 未配置，请先保存配置' }
    }

    try {
      const transporter = createTransporter(config)
      const mailOptions = {
        from: `"QuizForge Reminders" <${config.user}>`,
        to: config.user,
        subject: '【QuizForge 测试】这是一封测试邮件',
        text: `恭喜！您的 QuizForge Gmail 邮件通知服务已配置成功。

发送时间：${new Date().toLocaleString()}

后续如果您的任务到达设定时间，将会收到类似的提醒邮件。`
      }

      await transporter.sendMail(mailOptions)
      return { success: true }
    } catch (err) {
      console.error('Test email sending failed:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('reminders:todosChanged', async (event, todos) => {
    console.log('Todos changed in renderer, rescheduling reminders...')
    await scheduleTodos(todos)
    return true
  })
}

module.exports = {
  initReminders
}
