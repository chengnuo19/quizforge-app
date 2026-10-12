import React, { useState, useEffect, useMemo } from 'react'
import {
  loadTodos,
  createTodo,
  updateTodo,
  deleteTodo,
  toggleTodoStatus
} from '../quiz/todos.js'
import { isDesktop } from '../quiz/localFsStorage.js'

export default function TodoPanel({ onExit, theme, onToggleTheme, onTodosChange }) {
  const [todosData, setTodosData] = useState({ schemaVersion: 1, todos: [] })
  const [filter, setFilter] = useState('open') // 'open' | 'done' | 'today' | 'overdue' | 'all'
  const [editingTodo, setEditingTodo] = useState(null) // null or todo object for form
  const [showFormModal, setShowFormModal] = useState(false)

  // Form states
  const [formTitle, setFormTitle] = useState('')
  const [formNotes, setFormNotes] = useState('')
  const [formDueAt, setFormDueAt] = useState('') // datetime-local string
  const [formEstimate, setFormEstimate] = useState(30)
  const [formRemindHours, setFormRemindHours] = useState(1)

  // Email Config states
  const [emailConfig, setEmailConfig] = useState({ configured: false, user: '' })
  const [showConfig, setShowConfig] = useState(false)
  const [gmailUser, setGmailUser] = useState('')
  const [gmailPass, setGmailPass] = useState('')
  const [configError, setConfigError] = useState('')
  const [configSuccess, setConfigSuccess] = useState('')
  const [testingEmail, setTestingEmail] = useState(false)

  // Load todos initially
  const reloadTodos = () => {
    const data = loadTodos()
    setTodosData(data)
  }

  useEffect(() => {
    reloadTodos()
    
    // Fetch Gmail configuration status if in Desktop
    if (isDesktop && window.electronAPI && typeof window.electronAPI.getReminderStatus === 'function') {
      window.electronAPI.getReminderStatus().then(status => {
        if (status) {
          setEmailConfig(status)
          if (status.user) setGmailUser(status.user)
        }
      })
    }
  }, [])

  // Filtered list
  const filteredTodos = useMemo(() => {
    const list = todosData.todos
    const now = Date.now()
    
    // Get start and end of today in local time
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    const endOfToday = new Date()
    endOfToday.setHours(23, 59, 59, 999)

    switch (filter) {
      case 'open':
        return list.filter(t => t.status === 'open')
      case 'done':
        return list.filter(t => t.status === 'done')
      case 'today':
        return list.filter(t => {
          const due = new Date(t.dueAt).getTime()
          return due >= startOfToday.getTime() && due <= endOfToday.getTime() && t.status === 'open'
        })
      case 'overdue':
        return list.filter(t => t.dueAt < now && t.status === 'open')
      case 'all':
      default:
        return list
    }
  }, [todosData, filter])

  // Open form for creating
  const handleNewTodo = () => {
    setEditingTodo(null)
    setFormTitle('')
    setFormNotes('')
    
    // Set default dueAt to tomorrow this time
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setSeconds(0, 0)
    
    // Format to YYYY-MM-DDTHH:MM
    const offset = tomorrow.getTimezoneOffset()
    const localTomorrow = new Date(tomorrow.getTime() - (offset * 60 * 1000))
    setFormDueAt(localTomorrow.toISOString().slice(0, 16))
    
    setFormEstimate(30)
    setFormRemindHours(1)
    setShowFormModal(true)
  }

  // Open form for editing
  const handleEditTodo = (todo) => {
    setEditingTodo(todo)
    setFormTitle(todo.title)
    setFormNotes(todo.notes)
    
    const due = new Date(todo.dueAt)
    const offset = due.getTimezoneOffset()
    const localDue = new Date(due.getTime() - (offset * 60 * 1000))
    setFormDueAt(localDue.toISOString().slice(0, 16))
    
    setFormEstimate(todo.estimateMinutes)
    setFormRemindHours(todo.remindBeforeHours)
    setShowFormModal(true)
  }

  // Save Todo Form
  const handleSaveTodo = async (e) => {
    e.preventDefault()
    if (!formTitle.trim()) return

    const dueTimestamp = new Date(formDueAt).getTime()
    const estimate = parseInt(formEstimate, 10) || 0
    const remind = parseFloat(formRemindHours) || 0

    if (editingTodo) {
      await updateTodo(editingTodo.id, {
        title: formTitle.trim(),
        notes: formNotes.trim(),
        dueAt: dueTimestamp,
        estimateMinutes: estimate,
        remindBeforeHours: remind
      })
    } else {
      await createTodo({
        title: formTitle.trim(),
        notes: formNotes.trim(),
        dueAt: dueTimestamp,
        estimateMinutes: estimate,
        remindBeforeHours: remind
      })
    }

    reloadTodos()
    setShowFormModal(false)
    if (onTodosChange) onTodosChange()
  }

  // Delete Todo
  const handleDelete = async (id) => {
    if (window.confirm('确认删除此任务吗？')) {
      await deleteTodo(id)
      reloadTodos()
      if (onTodosChange) onTodosChange()
    }
  }

  // Toggle complete status
  const handleToggle = async (id) => {
    await toggleTodoStatus(id)
    reloadTodos()
    if (onTodosChange) onTodosChange()
  }

  // Save Gmail Config
  const handleSaveEmailConfig = async (e) => {
    e.preventDefault()
    setConfigError('')
    setConfigSuccess('')

    if (!gmailUser || !gmailPass) {
      setConfigError('请输入完整的 Gmail 邮箱及应用密码')
      return
    }

    if (isDesktop && window.electronAPI && typeof window.electronAPI.saveReminderConfig === 'function') {
      try {
        const res = await window.electronAPI.saveReminderConfig({
          user: gmailUser.trim(),
          appPassword: gmailPass.trim()
        })
        if (res.success) {
          setConfigSuccess('Gmail 配置保存成功！')
          setGmailPass('') // clear input password
          setEmailConfig({ configured: true, user: gmailUser.trim() })
          
          // Re-trigger todos changed to schedule with new config
          if (window.electronAPI && typeof window.electronAPI.todosChanged === 'function') {
            window.electronAPI.todosChanged(todosData.todos)
          }
        } else {
          setConfigError(`保存配置失败: ${res.error || '未知错误'}`)
        }
      } catch (err) {
        setConfigError(`配置发生异常: ${err.message}`)
      }
    }
  }

  // Send Test Mail
  const handleSendTestMail = async () => {
    setConfigError('')
    setConfigSuccess('')
    setTestingEmail(true)

    if (isDesktop && window.electronAPI && typeof window.electronAPI.sendTestReminder === 'function') {
      try {
        const res = await window.electronAPI.sendTestReminder()
        if (res.success) {
          setConfigSuccess('测试邮件已发送，请检查收件箱！')
        } else {
          setConfigError(`测试发送失败: ${res.error || '未知错误'}`)
        }
      } catch (err) {
        setConfigError(`测试发生异常: ${err.message}`)
      } finally {
        setTestingEmail(false)
      }
    } else {
      setConfigError('当前环境不支持发送邮件（仅支持 Electron 桌面版）')
      setTestingEmail(false)
    }
  }

  // Calculate estimated start time and reminder send time
  const previewTimes = useMemo(() => {
    if (!formDueAt) return null
    const due = new Date(formDueAt).getTime()
    const estimate = parseInt(formEstimate, 10) || 0
    const remind = parseFloat(formRemindHours) || 0

    const estStart = due - (estimate * 60 * 1000)
    const sendAt = estStart - (remind * 60 * 60 * 1000)

    return {
      estStart: new Date(estStart).toLocaleString(),
      sendAt: new Date(sendAt).toLocaleString(),
      isInPast: sendAt < Date.now()
    }
  }, [formDueAt, formEstimate, formRemindHours])

  return (
    <div className="todos-panel" style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--canvas)', color: 'var(--ink)' }}>
      {/* 顶部标题栏 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', borderBottom: '1px solid var(--hairline)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button onClick={onExit} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--muted)' }} title="返回首页">
            ←
          </button>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '24px', fontWeight: '600', margin: 0 }}>To do 任务管理</h1>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button type="button" className="button button--secondary" onClick={() => setShowConfig(!showConfig)}>
            📧 {emailConfig.configured ? 'Gmail 已配置' : '配置 Gmail 提醒'}
          </button>
          <button type="button" className="button button--primary" onClick={handleNewTodo}>
            ＋ 新建任务
          </button>
        </div>
      </div>

      {/* Gmail 配置面板（折叠） */}
      {showConfig && (
        <div style={{ background: 'var(--surface-soft)', padding: '20px 24px', borderBottom: '1px solid var(--hairline)', animation: 'slideDown 0.2s ease-out' }}>
          <div style={{ maxWidth: '600px', margin: '0 auto' }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '16px' }}>Gmail 邮件提醒配置</h3>
            <p style={{ color: 'var(--muted)', fontSize: '13px', margin: '0 0 16px 0', lineHeight: '1.5' }}>
              桌面版可以使用 Gmail 自动发送提醒。需要启用 Google 两步验证并创建一个 <b>“应用专用密码 (App Password)”</b>，而不是您的原始密码。
            </p>
            <form onSubmit={handleSaveEmailConfig} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', gap: '16px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>Gmail 邮箱</label>
                  <input
                    type="email"
                    placeholder="your-name@gmail.com"
                    value={gmailUser}
                    onChange={(e) => setGmailUser(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--hairline)', background: 'var(--canvas)', color: 'var(--ink)' }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>应用专用密码 (16位)</label>
                  <input
                    type="password"
                    placeholder={emailConfig.configured ? '••••••••••••••••' : 'xxxx xxxx xxxx xxxx'}
                    value={gmailPass}
                    onChange={(e) => setGmailPass(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--hairline)', background: 'var(--canvas)', color: 'var(--ink)' }}
                  />
                </div>
              </div>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button type="submit" className="button button--primary" style={{ padding: '0 16px', height: '32px', fontSize: '13px' }}>
                    保存配置
                  </button>
                  {emailConfig.configured && (
                    <button
                      type="button"
                      className="button button--secondary"
                      onClick={handleSendTestMail}
                      disabled={testingEmail}
                      style={{ padding: '0 16px', height: '32px', fontSize: '13px' }}
                    >
                      {testingEmail ? '发送中...' : '发送测试邮件'}
                    </button>
                  )}
                </div>
                <div>
                  {configError && <span style={{ color: 'var(--error)', fontSize: '13px' }}>⚠️ {configError}</span>}
                  {configSuccess && <span style={{ color: 'var(--success)', fontSize: '13px' }}>✓ {configSuccess}</span>}
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 主工作区 */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* 左侧过滤边栏 */}
        <div style={{ width: '220px', borderRight: '1px solid var(--hairline)', padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: '8px', background: 'var(--surface-soft)' }}>
          <button
            onClick={() => setFilter('open')}
            style={{
              padding: '10px 12px',
              borderRadius: 'var(--radius-md)',
              border: 'none',
              background: filter === 'open' ? 'var(--surface-cream-strong)' : 'none',
              color: filter === 'open' ? 'var(--primary)' : 'var(--body)',
              fontWeight: filter === 'open' ? '600' : 'normal',
              textAlign: 'left',
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}
          >
            <span>📝 未完成</span>
            <span style={{ fontSize: '12px', background: 'var(--surface-card)', padding: '2px 6px', borderRadius: '99px' }}>
              {todosData.todos.filter(t => t.status === 'open').length}
            </span>
          </button>
          
          <button
            onClick={() => setFilter('today')}
            style={{
              padding: '10px 12px',
              borderRadius: 'var(--radius-md)',
              border: 'none',
              background: filter === 'today' ? 'var(--surface-cream-strong)' : 'none',
              color: filter === 'today' ? 'var(--primary)' : 'var(--body)',
              fontWeight: filter === 'today' ? '600' : 'normal',
              textAlign: 'left',
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}
          >
            <span>📅 今日待办</span>
            <span style={{ fontSize: '12px', background: 'var(--surface-card)', padding: '2px 6px', borderRadius: '99px' }}>
              {todosData.todos.filter(t => {
                const due = new Date(t.dueAt).getTime()
                const startOfToday = new Date().setHours(0,0,0,0)
                const endOfToday = new Date().setHours(23,59,59,999)
                return due >= startOfToday && due <= endOfToday && t.status === 'open'
              }).length}
            </span>
          </button>

          <button
            onClick={() => setFilter('overdue')}
            style={{
              padding: '10px 12px',
              borderRadius: 'var(--radius-md)',
              border: 'none',
              background: filter === 'overdue' ? 'var(--surface-cream-strong)' : 'none',
              color: filter === 'overdue' ? 'var(--error)' : 'var(--body)',
              fontWeight: filter === 'overdue' ? '600' : 'normal',
              textAlign: 'left',
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}
          >
            <span>⚠️ 已逾期</span>
            <span style={{ fontSize: '12px', background: 'var(--error-tint)', color: 'var(--error)', padding: '2px 6px', borderRadius: '99px' }}>
              {todosData.todos.filter(t => t.dueAt < Date.now() && t.status === 'open').length}
            </span>
          </button>

          <button
            onClick={() => setFilter('done')}
            style={{
              padding: '10px 12px',
              borderRadius: 'var(--radius-md)',
              border: 'none',
              background: filter === 'done' ? 'var(--surface-cream-strong)' : 'none',
              color: filter === 'done' ? 'var(--primary)' : 'var(--body)',
              fontWeight: filter === 'done' ? '600' : 'normal',
              textAlign: 'left',
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}
          >
            <span>✓ 已完成</span>
            <span style={{ fontSize: '12px', background: 'var(--surface-card)', padding: '2px 6px', borderRadius: '99px' }}>
              {todosData.todos.filter(t => t.status === 'done').length}
            </span>
          </button>

          <button
            onClick={() => setFilter('all')}
            style={{
              padding: '10px 12px',
              borderRadius: 'var(--radius-md)',
              border: 'none',
              background: filter === 'all' ? 'var(--surface-cream-strong)' : 'none',
              color: filter === 'all' ? 'var(--primary)' : 'var(--body)',
              fontWeight: filter === 'all' ? '600' : 'normal',
              textAlign: 'left',
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}
          >
            <span>🗂 全部</span>
            <span style={{ fontSize: '12px', background: 'var(--surface-card)', padding: '2px 6px', borderRadius: '99px' }}>
              {todosData.todos.length}
            </span>
          </button>
        </div>

        {/* 右侧列表区 */}
        <div style={{ flex: 1, padding: '32px 48px', overflowY: 'auto' }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '20px', fontWeight: '600', marginBottom: '24px' }}>
            {filter === 'open' && '未完成任务'}
            {filter === 'done' && '已完成任务'}
            {filter === 'today' && '今日待办'}
            {filter === 'overdue' && '已逾期任务'}
            {filter === 'all' && '全部任务'}
          </h2>

          {filteredTodos.length === 0 ? (
            <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--muted)' }}>
              <span style={{ fontSize: '32px', display: 'block', marginBottom: '16px' }}>🍃</span>
              没有找到匹配的任务。
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {filteredTodos.map((todo) => {
                const estStart = todo.dueAt - (todo.estimateMinutes * 60 * 1000)
                const isOverdue = todo.dueAt < Date.now() && todo.status === 'open'
                
                return (
                  <div
                    key={todo.id}
                    className="todo-card"
                    style={{
                      background: 'var(--surface-card)',
                      border: isOverdue ? '1px solid var(--error)' : '1px solid var(--hairline)',
                      borderRadius: 'var(--radius-lg)',
                      padding: '16px 20px',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '16px',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
                      transition: 'transform 0.15s ease'
                    }}
                  >
                    {/* Checkbox */}
                    <button
                      onClick={() => handleToggle(todo.id)}
                      style={{
                        width: '20px',
                        height: '20px',
                        borderRadius: '50%',
                        border: todo.status === 'done' ? '2px solid var(--success)' : '2px solid var(--muted-soft)',
                        background: todo.status === 'done' ? 'var(--success)' : 'none',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginTop: '3px',
                        padding: 0
                      }}
                      title={todo.status === 'done' ? '标记为未完成' : '标记为已完成'}
                    >
                      {todo.status === 'done' && <span style={{ color: 'white', fontSize: '12px', fontWeight: 'bold' }}>✓</span>}
                    </button>

                    {/* Content */}
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <h4
                          style={{
                            margin: 0,
                            fontSize: '16px',
                            fontWeight: '600',
                            color: todo.status === 'done' ? 'var(--muted)' : 'var(--ink)',
                            textDecoration: todo.status === 'done' ? 'line-through' : 'none'
                          }}
                        >
                          {todo.title}
                        </h4>
                        
                        {/* Actions */}
                        <div style={{ display: 'flex', gap: '12px' }}>
                          <button
                            onClick={() => handleEditTodo(todo)}
                            style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '13px' }}
                          >
                            编辑
                          </button>
                          <button
                            onClick={() => handleDelete(todo.id)}
                            style={{ background: 'none', border: 'none', color: 'var(--error)', cursor: 'pointer', fontSize: '13px' }}
                          >
                            删除
                          </button>
                        </div>
                      </div>

                      {todo.notes && (
                        <p style={{ margin: '6px 0 12px 0', fontSize: '14px', color: 'var(--body)', whiteSpace: 'pre-wrap' }}>
                          {todo.notes}
                        </p>
                      )}

                      {/* Meta information */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', fontSize: '12px', color: 'var(--muted)', marginTop: '8px' }}>
                        <span>⏱ 预计耗时: {todo.estimateMinutes} 分钟</span>
                        <span>
                          📅 截止于: {new Date(todo.dueAt).toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })}
                        </span>
                        {todo.status === 'open' && (
                          <span>
                            🚀 预计开始: {new Date(estStart).toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })}
                          </span>
                        )}
                        
                        {/* Reminder Status */}
                        {todo.status === 'open' && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            📧 提醒状态:
                            {todo.reminderStatus === 'none' && <span style={{ color: 'var(--muted)' }}>未开始</span>}
                            {todo.reminderStatus === 'scheduled' && <span style={{ color: 'var(--primary)', fontWeight: '600' }}>已调度</span>}
                            {todo.reminderStatus === 'sent' && <span style={{ color: 'var(--success)' }}>已发送</span>}
                            {todo.reminderStatus === 'failed' && <span style={{ color: 'var(--error)' }}>发送失败</span>}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* 新建/编辑任务模态框 */}
      {showFormModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: 'var(--canvas)', border: '1px solid var(--hairline)', borderRadius: 'var(--radius-xl)', width: '90%', maxWidth: '520px', padding: '28px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
            <h3 style={{ margin: '0 0 20px 0', fontSize: '18px', fontWeight: '600', fontFamily: 'var(--font-display)' }}>
              {editingTodo ? '编辑任务' : '新建任务'}
            </h3>
            
            <form onSubmit={handleSaveTodo} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px' }}>任务标题 *</label>
                <input
                  type="text"
                  required
                  placeholder="要完成的事情..."
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--hairline)', background: 'var(--canvas)', color: 'var(--ink)' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px' }}>备注</label>
                <textarea
                  placeholder="添加说明或大纲..."
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  rows="3"
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--hairline)', background: 'var(--canvas)', color: 'var(--ink)', resize: 'vertical' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '16px' }}>
                <div style={{ flex: 1.2 }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px' }}>截止时间</label>
                  <input
                    type="datetime-local"
                    required
                    value={formDueAt}
                    onChange={(e) => setFormDueAt(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--hairline)', background: 'var(--canvas)', color: 'var(--ink)' }}
                  />
                </div>

                <div style={{ flex: 0.8 }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px' }}>预计耗时 (分)</label>
                  <input
                    type="number"
                    min="0"
                    value={formEstimate}
                    onChange={(e) => setFormEstimate(parseInt(e.target.value, 10) || 0)}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--hairline)', background: 'var(--canvas)', color: 'var(--ink)' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px' }}>
                  提前提醒配置 (小时)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={formRemindHours}
                  onChange={(e) => setFormRemindHours(parseFloat(e.target.value) || 0)}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--hairline)', background: 'var(--canvas)', color: 'var(--ink)' }}
                />
              </div>

              {/* 提醒预览 */}
              {previewTimes && (
                <div style={{ background: 'var(--surface-soft)', padding: '12px 14px', borderRadius: 'var(--radius-md)', fontSize: '12px', lineHeight: '1.6', border: '1px dashed var(--hairline)' }}>
                  <div>⏳ 预计开始时间：{previewTimes.estStart}</div>
                  <div style={{ color: previewTimes.isInPast ? 'var(--error)' : 'var(--primary)', fontWeight: '600' }}>
                    📧 邮件提醒发送：{previewTimes.sendAt}
                    {previewTimes.isInPast && ' (过去时间，将立即触发)'}
                  </div>
                </div>
              )}

              {/* 操作按钮 */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px' }}>
                <button type="button" className="button button--secondary" onClick={() => setShowFormModal(false)}>
                  取消
                </button>
                <button type="submit" className="button button--primary">
                  保存
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
