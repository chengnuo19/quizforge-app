import { useState } from 'react'
import PdfToolToImages from './PdfToolToImages.jsx'
import PdfToolFromImages from './PdfToolFromImages.jsx'

// 图片转换 tool: two directions (PDF → images, images → PDF).
export default function PdfToolConvert({ file, exportBytes }) {
  const [dir, setDir] = useState('to-images')
  return (
    <div className="pdfwb-convert">
      <div className="pdfwb-tool-pane__row">
        <button
          type="button"
          className={`button ${dir === 'to-images' ? 'button--primary' : 'button--secondary'}`}
          onClick={() => setDir('to-images')}
        >
          PDF → 图片
        </button>
        <button
          type="button"
          className={`button ${dir === 'from-images' ? 'button--primary' : 'button--secondary'}`}
          onClick={() => setDir('from-images')}
        >
          图片 → PDF
        </button>
      </div>
      {dir === 'to-images' ? <PdfToolToImages file={file} /> : <PdfToolFromImages exportBytes={exportBytes} />}
    </div>
  )
}
