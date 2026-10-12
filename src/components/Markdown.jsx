import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'

const remarkPlugins = [remarkGfm, remarkMath]
const rehypePlugins = [rehypeKatex]

// Renders quiz markdown (prompts, option text, explanations) with GFM + LaTeX.
// `inline` unwraps the single top-level paragraph so short option labels don't
// get block margins.
export default function Markdown({ children, inline = false, className }) {
  const components = inline
    ? { p: ({ children }) => <>{children}</> }
    : undefined
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {children || ''}
      </ReactMarkdown>
    </div>
  )
}
