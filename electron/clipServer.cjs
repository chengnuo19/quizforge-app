const http = require('http')

const DEFAULT_PORT = 41414

let serverInstance = null
let currentPort = DEFAULT_PORT
let isRunning = false
let cachedNotebooks = []

function setCachedNotebooks(notebooks) {
  if (Array.isArray(notebooks)) {
    cachedNotebooks = notebooks.map(b => ({
      id: b.id,
      name: b.name,
      icon: b.icon || '📘',
      color: b.color || 'sky',
    }))
  }
}

function getCachedNotebooks() {
  return cachedNotebooks
}

function getClipServerStatus() {
  return {
    running: isRunning,
    port: currentPort,
    notebooksCount: cachedNotebooks.length,
  }
}

function sendCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => {
      body += chunk.toString('utf-8')
      if (body.length > 5 * 1024 * 1024) {
        // Guard against massive payloads
        reject(new Error('Payload too large'))
      }
    })
    req.on('end', () => {
      try {
        if (!body.trim()) return resolve({})
        resolve(JSON.parse(body))
      } catch (err) {
        reject(new Error('Invalid JSON'))
      }
    })
    req.on('error', reject)
  })
}

function createClipServer(options = {}) {
  const onClipReceived = options.onClip || (() => Promise.resolve({ success: true }))
  const getVaultPath = options.getVaultPath || (() => null)

  const server = http.createServer(async (req, res) => {
    sendCors(res)

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const parsedUrl = new URL(req.url, `http://127.0.0.1:${currentPort}`)
    const pathname = parsedUrl.pathname

    if (req.method === 'GET' && pathname === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({
        online: true,
        version: '0.1.0',
        port: currentPort,
        vaultPath: getVaultPath(),
      }))
      return
    }

    if (req.method === 'GET' && pathname === '/api/notebooks') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({
        success: true,
        notebooks: cachedNotebooks,
      }))
      return
    }

    if (req.method === 'POST' && pathname === '/api/clip') {
      try {
        const payload = await parseJsonBody(req)
        if (!payload || (!payload.contentMarkdown && !payload.question)) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ success: false, error: '内容不能为空' }))
          return
        }

        const result = await onClipReceived(payload)
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({
          success: true,
          message: result?.message || `已成功保存到《${result?.notebookName || '笔记本'}》`,
          item: result?.item,
        }))
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ success: false, error: err.message }))
      }
      return
    }

    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ success: false, error: 'Not Found' }))
  })

  return server
}

function startClipServer(options = {}) {
  const desiredPort = options.port || DEFAULT_PORT

  return new Promise((resolve, reject) => {
    if (serverInstance) {
      return resolve({ server: serverInstance, port: currentPort })
    }

    const server = createClipServer(options)

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`[ClipServer] Port ${desiredPort} in use, trying ${desiredPort + 1}...`)
        currentPort = desiredPort + 1
        server.listen(currentPort, '127.0.0.1')
      } else {
        reject(err)
      }
    })

    server.listen(desiredPort, '127.0.0.1', () => {
      currentPort = server.address().port
      serverInstance = server
      isRunning = true
      console.log(`[ClipServer] Listening on http://127.0.0.1:${currentPort}`)
      resolve({ server, port: currentPort })
    })
  })
}

function stopClipServer() {
  return new Promise((resolve) => {
    if (serverInstance) {
      serverInstance.close(() => {
        serverInstance = null
        isRunning = false
        resolve(true)
      })
    } else {
      resolve(false)
    }
  })
}

module.exports = {
  DEFAULT_PORT,
  createClipServer,
  startClipServer,
  stopClipServer,
  getClipServerStatus,
  setCachedNotebooks,
  getCachedNotebooks,
}
