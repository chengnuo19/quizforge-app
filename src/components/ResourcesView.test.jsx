// @vitest-environment jsdom
import { fireEvent, render, screen, cleanup } from '@testing-library/react'
import { describe, expect, it, vi, afterEach } from 'vitest'
import ResourcesView from './ResourcesView.jsx'

const resource = {
  id: 'qfr_1',
  notebookId: 'book-a',
  notebookName: '线性代数',
  categoryPath: ['方程组', '基础解系'],
  title: '基础解系',
  summary: '基础解系是解空间的一组线性无关生成元。',
  question: '基础解系是什么？',
  answer: '基础解系是解空间的一组线性无关生成元。',
  sourceSite: 'gemini',
  sourceUrl: 'https://gemini.google.com/app/test',
  createdAt: 1,
  updatedAt: 1,
}

const documentResource = {
  id: 'qfr_doc',
  type: 'document',
  notebookId: 'book-a',
  notebookName: '线性代数',
  categoryPath: [],
  title: '线性代数讲义',
  summary: '矩阵和线性方程组讲义。',
  contentMarkdown: '# 线性代数讲义\n\n矩阵和线性方程组。',
  sourceSite: 'MarkItDown',
  sourceUrl: '',
  sourcePath: 'C:\\notes\\linear.docx',
  createdAt: 1,
  updatedAt: 1,
}

afterEach(cleanup)

describe('ResourcesView', () => {
  it('renders notebook resources with category and source actions', () => {
    render(<ResourcesView resources={[resource]} books={[{ id: 'book-a', name: '线性代数' }]} onMove={vi.fn()} />)

    expect(screen.getByText('基础解系')).toBeTruthy()
    expect(screen.getByText('方程组 / 基础解系')).toBeTruthy()
    expect(screen.getByRole('link', { name: /打开来源/ }).getAttribute('href')).toBe(resource.sourceUrl)
  })

  it('calls onMove with selected notebook and category', () => {
    const onMove = vi.fn()
    render(<ResourcesView resources={[resource]} books={[{ id: 'book-b', name: '概率论' }]} onMove={onMove} />)

    fireEvent.click(screen.getByRole('button', { name: /移动/ }))
    fireEvent.change(screen.getByLabelText(/目标分类/), { target: { value: '随机变量 / 分布' } })
    fireEvent.click(screen.getByRole('button', { name: /保存移动/ }))

    expect(onMove).toHaveBeenCalledWith('qfr_1', {
      notebookId: 'book-b',
      notebookName: '概率论',
      categoryPath: ['随机变量', '分布'],
    })
  })

  it('renders imported documents and starts quiz creation from the resource', () => {
    const onCreateQuiz = vi.fn()
    render(
      <ResourcesView
        resources={[documentResource]}
        books={[{ id: 'book-a', name: '线性代数' }]}
        onMove={vi.fn()}
        onCreateQuiz={onCreateQuiz}
      />
    )

    expect(screen.getByText('线性代数讲义')).toBeTruthy()
    expect(screen.getByText('查看文档内容')).toBeTruthy()
    expect(screen.getByText('C:\\notes\\linear.docx')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /生成测验/ }))

    expect(onCreateQuiz).toHaveBeenCalledWith(documentResource)
  })
})
