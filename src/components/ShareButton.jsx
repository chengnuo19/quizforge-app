import { useState } from 'react'

// Copies a share URL to the clipboard with brief visual confirmation. Variant
// "icon" renders a round icon button; "text" renders a labeled secondary button.
export default function ShareButton({ url, variant = 'icon' }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      /* clipboard may be blocked; still show feedback */
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (variant === 'text') {
    return (
      <button type="button" className="button button--secondary" onClick={copy}>
        {copied ? '已复制链接' : '分享'}
      </button>
    )
  }

  return (
    <button
      type="button"
      className="icon-button"
      onClick={copy}
      aria-label="复制分享链接"
      title={copied ? '已复制' : '分享'}
    >
      {copied ? '✓' : '⤴'}
    </button>
  )
}
