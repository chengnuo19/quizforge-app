import { useState } from 'react'
import { canUsePdfFiles, readPdfBytes, launchWorkbenchWithPdf } from '../quiz/pdfBridge.js'
import { isPdfResource } from '../quiz/resources.js'

function parseCategory(value) {
  return value.split('/').map(part => part.trim()).filter(Boolean)
}

export default function ResourcesView({ resources, books, onMove, onCreateQuiz }) {
  const [movingId, setMovingId] = useState('')
  const [targetBookId, setTargetBookId] = useState(books[0]?.id || '')
  const [targetCategory, setTargetCategory] = useState('')

  const openInWorkbench = async (resource) => {
    try {
      const bytes = await readPdfBytes(resource.sourcePath)
      launchWorkbenchWithPdf(bytes, resource.title)
    } catch (err) {
      window.alert(err.message)
    }
  }

  if (resources.length === 0) {
    return <p className="home__empty">这个笔记本还没有资料。</p>
  }

  const canOpenPdf = canUsePdfFiles()

  const saveMove = () => {
    const book = books.find(item => item.id === targetBookId)
    if (!book || !movingId) return
    onMove(movingId, {
      notebookId: book.id,
      notebookName: book.name,
      categoryPath: parseCategory(targetCategory),
    })
    setMovingId('')
    setTargetCategory('')
  }

  return (
    <div className="resources-list">
      {resources.map(resource => {
        const isDocument = resource.type === 'document'
        return (
          <article key={resource.id} className="resource-card">
            <div className="resource-card__header">
              <h2 className="resource-card__title">{resource.title}</h2>
              <span className="resource-card__source">{resource.sourceSite}</span>
            </div>
            {resource.categoryPath?.length > 0 && (
              <p className="resource-card__category">{resource.categoryPath.join(' / ')}</p>
            )}
            <p className="resource-card__summary">{resource.summary}</p>
            <details className="resource-card__details">
              <summary>{isDocument ? '查看文档内容' : '查看问答'}</summary>
              {isDocument ? (
                <pre className="resource-card__markdown">{resource.contentMarkdown}</pre>
              ) : (
                <>
                  <strong>Question</strong>
                  <p>{resource.question}</p>
                  <strong>Answer</strong>
                  <p>{resource.answer}</p>
                </>
              )}
            </details>
            <div className="resource-card__actions">
              {resource.sourceUrl ? (
                <a className="button button--secondary" href={resource.sourceUrl} target="_blank" rel="noreferrer">
                  打开来源
                </a>
              ) : resource.sourcePath ? (
                <span className="resource-card__path" title={resource.sourcePath}>
                  {resource.sourcePath}
                </span>
              ) : null}
              {isDocument && onCreateQuiz && (
                <button type="button" className="button button--secondary" onClick={() => onCreateQuiz(resource)}>
                  生成测验
                </button>
              )}
              {isPdfResource(resource) && canOpenPdf && (
                <button type="button" className="button button--secondary" onClick={() => openInWorkbench(resource)}>
                  在 PDF 工作台打开
                </button>
              )}
              <button type="button" className="button button--secondary" onClick={() => setMovingId(resource.id)}>
                移动
              </button>
            </div>
            {movingId === resource.id && (
              <div className="resource-card__move">
                <select value={targetBookId} onChange={event => setTargetBookId(event.target.value)}>
                  {books.map(book => <option key={book.id} value={book.id}>{book.name}</option>)}
                </select>
                <input
                  aria-label="目标分类"
                  value={targetCategory}
                  placeholder="分类，例如 随机变量 / 分布"
                  onChange={event => setTargetCategory(event.target.value)}
                />
                <button type="button" className="button button--primary" onClick={saveMove}>保存移动</button>
              </div>
            )}
          </article>
        )
      })}
    </div>
  )
}
