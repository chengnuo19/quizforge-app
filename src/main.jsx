import React from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/app.css'
import App from './App.jsx'

import { syncVaultToLocalOnStart } from './quiz/fsSync.js'
import { isDesktop } from './quiz/localFsStorage.js'

async function initApp() {
  if (isDesktop) {
    await syncVaultToLocalOnStart()
  }
  
  createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}

initApp()
