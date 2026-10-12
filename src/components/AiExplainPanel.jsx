import { useState, useEffect } from 'react'
import Markdown from './Markdown.jsx'
import { isAiConfigured } from '../quiz/aiClient.js'
import { getCachedExplanation, explainQuestion } from '../quiz/aiExplanations.js'

export default function AiExplainPanel({ cardId, question, answer }) {
  const [explanation, setExplanation] = useState(() => getCachedExplanation(cardId, question))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    setExplanation(getCachedExplanation(cardId, question))
    setError(null)
  }, [cardId, question])

  const configured = isAiConfigured()

  const handleRequestExplain = async () => {
    if (!configured || loading) return
    setLoading(true)
    setError(null)
    try {
      const text = await explainQuestion({ cardId, question, answer })
      setExplanation(text)
    } catch (err) {
      setError(err?.message || 'AI 讲解失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  if (explanation) {
    return (
      <div
        className="ai-explain-panel"
        style={{
          marginTop: '12px',
          padding: '12px 14px',
          borderRadius: 'var(--radius-md, 8px)',
          border: '1px solid var(--hairline, rgba(0,0,0,0.1))',
          backgroundColor: 'var(--canvas-subtle, rgba(0,0,0,0.02))',
          color: 'var(--ink, #1f2328)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '8px',
            fontSize: '13px',
            fontWeight: 600,
            color: 'var(--muted, #656d76)',
          }}
        >
          <span>💡 AI 错题讲解</span>
        </div>
        <div style={{ fontSize: '14px', lineHeight: 1.6 }}>
          <Markdown>{explanation}</Markdown>
        </div>
      </div>
    )
  }

  return (
    <div
      className="ai-explain-panel"
      style={{
        marginTop: '12px',
        padding: '10px 12px',
        borderRadius: 'var(--radius-md, 8px)',
        border: '1px dashed var(--hairline, rgba(0,0,0,0.15))',
        backgroundColor: 'var(--canvas-subtle, rgba(0,0,0,0.02))',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="button button--secondary"
          disabled={loading || !configured}
          onClick={handleRequestExplain}
          style={{ cursor: loading || !configured ? 'not-allowed' : 'pointer' }}
        >
          {loading ? 'AI 讲解中…' : error ? '重试' : 'AI 讲解'}
        </button>

        {!configured && (
          <span style={{ fontSize: '12px', color: 'var(--muted, #656d76)' }}>
            请先在右上角设置中配置 AI
          </span>
        )}

        {error && (
          <span style={{ fontSize: '12px', color: '#cf222e' }}>
            {error}
          </span>
        )}
      </div>
    </div>
  )
}
