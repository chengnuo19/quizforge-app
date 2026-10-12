// PDF Workbench ↔ desktop / library bridge.
//
// Reads and writes raw PDF bytes through the Electron shell (base64 across the
// IPC boundary) and hands a file from the Document Library to the Workbench
// without routing bytes through the URL hash.

import { goPdfWorkbench } from './router.js'
import { isDesktop } from './localFsStorage.js'

export function canUsePdfFiles() {
  return (
    isDesktop &&
    !!window.electronAPI &&
    typeof window.electronAPI.readFileBuffer === 'function' &&
    typeof window.electronAPI.writeFileBuffer === 'function'
  )
}

function base64ToBytes(b64) {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function bytesToBase64(bytes) {
  const chunks = []
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)))
  }
  return btoa(chunks.join(''))
}

export async function readPdfBytes(filePath) {
  if (!canUsePdfFiles()) throw new Error('读取文件仅支持桌面版。')
  const { base64 } = await window.electronAPI.readFileBuffer(filePath)
  return base64ToBytes(base64)
}

export async function writePdfBytes(filePath, bytes) {
  if (!canUsePdfFiles()) throw new Error('写入文件仅支持桌面版。')
  await window.electronAPI.writeFileBuffer(filePath, bytesToBase64(bytes))
}

// ---- Library → Workbench hand-off ------------------------------------------

let pending = null

// Store a PDF to load and navigate to the Workbench.
export function launchWorkbenchWithPdf(bytes, name) {
  pending = { bytes, name }
  goPdfWorkbench()
}

// The Workbench calls this on mount; returns the pending file once.
export function consumePendingOpen() {
  const p = pending
  pending = null
  return p
}
