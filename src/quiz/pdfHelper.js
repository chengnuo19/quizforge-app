import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'

// In Vite, we can import the worker URL directly if needed, or set it to unpkg.
// Legacy build runs in browsers and Node; the PDF Workbench renderer
// (src/pdf/renderer.js) uses the same URL so the two never conflict.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/legacy/build/pdf.worker.mjs',
  import.meta.url
).toString()

/**
 * Parses a PDF file and returns an array of base64 JPEG images (one per page).
 * @param {File} file 
 * @param {Function} onProgress callback for progress updates
 * @returns {Promise<string[]>}
 */
export async function convertPdfToImages(file, onProgress) {
  if (onProgress) onProgress('正在读取 PDF 文件...')
  
  const arrayBuffer = await file.arrayBuffer()
  const isBrowser = typeof window !== 'undefined'
  let wasmUrl = null
  let cMapUrl = null
  let standardFontDataUrl = null

  if (isBrowser && window.location) {
    try {
      wasmUrl = new URL('pdfjs/wasm/', window.location.href).toString()
      cMapUrl = new URL('pdfjs/cmaps/', window.location.href).toString()
      standardFontDataUrl = new URL('pdfjs/standard_fonts/', window.location.href).toString()
    } catch {
      wasmUrl = '/pdfjs/wasm/'
      cMapUrl = '/pdfjs/cmaps/'
      standardFontDataUrl = '/pdfjs/standard_fonts/'
    }
  }

  const loadingTask = pdfjsLib.getDocument({
    data: arrayBuffer,
    cMapPacked: true,
    ...(wasmUrl ? { wasmUrl } : {}),
    ...(cMapUrl ? { cMapUrl } : {}),
    ...(standardFontDataUrl ? { standardFontDataUrl } : {}),
  })
  const pdf = await loadingTask.promise
  
  const numPages = pdf.numPages
  const images = []
  
  // We can render at a higher scale for better OCR/Vision AI recognition
  const scale = 2.0 

  for (let i = 1; i <= numPages; i++) {
    if (onProgress) onProgress(`正在渲染 PDF 页面 (${i}/${numPages})...`)
    
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale })
    
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    canvas.height = viewport.height
    canvas.width = viewport.width
    
    // Render PDF page into canvas context
    const renderContext = {
      canvasContext: context,
      viewport: viewport
    }
    await page.render(renderContext).promise
    
    // Convert canvas to base64 jpeg
    const base64 = canvas.toDataURL('image/jpeg', 0.9)
    images.push(base64)
  }
  
  return images
}
