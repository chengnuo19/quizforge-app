import React, { useState } from 'react'
import { isDesktop, getVaultPath, setVaultPath } from '../quiz/localFsStorage.js'
import { syncVaultToLocalOnStart } from '../quiz/fsSync.js'

export function VaultSelector({ onVaultSelected }) {
  const [error, setError] = useState(null)
  
  const handleSelectVault = async () => {
    try {
      const path = await window.electronAPI.selectVault()
      if (path) {
        setVaultPath(path)
        
        // Copy built-ins into the new vault
        await window.electronAPI.copyBuiltin(path)
        
        // Sync any existing data from the vault into localStorage
        await syncVaultToLocalOnStart()
        
        onVaultSelected()
      }
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-sand-50 p-8">
      <div className="bg-white p-8 rounded-xl shadow-sm border border-sand-200 max-w-md text-center">
        <h1 className="text-2xl font-bold text-sand-800 mb-4">欢迎使用 QuizForge</h1>
        <p className="text-sand-600 mb-8">
          QuizForge 桌面版使用纯本地的 Markdown 文件存储题库。<br/>
          请选择一个电脑上的文件夹作为您的<b>“题库仓库” (Vault)</b>。
        </p>
        
        <button 
          onClick={handleSelectVault}
          className="bg-sky-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-sky-700 transition-colors"
        >
          选择题库仓库文件夹
        </button>

        {error && <p className="text-red-500 mt-4 text-sm">{error}</p>}
      </div>
    </div>
  )
}
