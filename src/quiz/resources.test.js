// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  appendResource,
  createDocumentResource,
  createPdfResource,
  filterResourcesForBook,
  formatResourceMarkdown,
  getDocumentResourceTitle,
  isPdfResource,
  loadResourcesPayload,
  moveResource,
  normalizeResourcesPayload,
  saveResourcesPayload,
} from './resources.js'

const resource = {
  id: 'qfr_1',
  notebookId: 'book-a',
  notebookName: '线性代数',
  categoryPath: ['方程组'],
  title: '基础解系',
  summary: '基础解系是解空间的一组线性无关生成元。',
  question: '基础解系是什么？',
  answer: '基础解系是解空间的一组线性无关生成元。',
  sourceSite: 'gemini',
  sourceUrl: 'https://gemini.google.com/app/test',
  createdAt: 1,
  updatedAt: 1,
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('resources', () => {
  it('normalizes invalid payloads to an empty resources file', () => {
    expect(normalizeResourcesPayload(null)).toEqual({ schemaVersion: 1, resources: [] })
    expect(normalizeResourcesPayload({ schemaVersion: 1, resources: [resource] })).toEqual({
      schemaVersion: 1,
      resources: [resource],
    })
  })

  it('saves and loads resources through localStorage', () => {
    saveResourcesPayload({ schemaVersion: 1, resources: [resource] })
    expect(loadResourcesPayload()).toEqual({ schemaVersion: 1, resources: [resource] })
  })

  it('filters resources by notebook id', () => {
    expect(filterResourcesForBook([resource], 'book-a')).toHaveLength(1)
    expect(filterResourcesForBook([resource], 'book-b')).toHaveLength(0)
  })

  it('moves a resource to another notebook and category', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1783247200000)
    expect(moveResource(resource, {
      notebookId: 'book-b',
      notebookName: '概率论',
      categoryPath: ['随机变量'],
    })).toMatchObject({
      notebookId: 'book-b',
      notebookName: '概率论',
      categoryPath: ['随机变量'],
      updatedAt: 1783247200000,
    })
  })

  it('creates a MarkItDown document resource from converted Markdown', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1783247200000)
    const document = createDocumentResource({
      notebookId: 'book-a',
      notebookName: '线性代数',
      markdown: '# 基础解系\n\n基础解系是解空间的一组线性无关生成元。',
      sourcePath: 'C:\\notes\\linear.docx',
    })

    expect(document).toMatchObject({
      type: 'document',
      notebookId: 'book-a',
      notebookName: '线性代数',
      title: '基础解系',
      summary: '基础解系 基础解系是解空间的一组线性无关生成元。',
      contentMarkdown: '# 基础解系\n\n基础解系是解空间的一组线性无关生成元。',
      sourceSite: 'MarkItDown',
      sourcePath: 'C:\\notes\\linear.docx',
      createdAt: 1783247200000,
      updatedAt: 1783247200000,
    })
  })

  it('appends document resources to the saved payload', () => {
    const document = createDocumentResource({
      notebookId: 'book-a',
      notebookName: '线性代数',
      title: '讲义',
      markdown: '文档内容',
    })

    appendResource(document)

    expect(loadResourcesPayload().resources[0]).toMatchObject({
      type: 'document',
      title: '讲义',
      contentMarkdown: '文档内容',
    })
  })

  it('uses document Markdown when turning a resource back into a quiz draft', () => {
    const document = createDocumentResource({
      notebookId: 'book-a',
      notebookName: '线性代数',
      title: '讲义',
      markdown: '# 讲义\n\n## Q\n- [x] A\n- [ ] B',
    })

    expect(formatResourceMarkdown(document)).toContain('## Q')
    expect(getDocumentResourceTitle({ path: 'C:\\notes\\linear.docx' })).toBe('linear')
  })
})

describe('pdf resources (PDF Workbench integration)', () => {
  it('creates a pdf resource with the vault path as source', () => {
    const r = createPdfResource({
      notebookId: 'book-a',
      notebookName: '线性代数',
      title: '矩阵习题',
      sourcePath: 'E:/Vault/.quizforge/workbench/矩阵习题.pdf',
    })
    expect(r).toMatchObject({
      type: 'pdf',
      notebookId: 'book-a',
      title: '矩阵习题',
      sourceSite: 'PDF Workbench',
    })
    expect(isPdfResource(r)).toBe(true)
  })

  it('detects pdf resources by type or by .pdf source path', () => {
    expect(isPdfResource({ type: 'pdf' })).toBe(true)
    expect(isPdfResource({ sourcePath: 'C:/x/试卷.pdf' })).toBe(true)
    expect(isPdfResource({ type: 'document' })).toBe(false)
  })

  it('formats a pdf resource markdown without falling into the Q&A branch', () => {
    const r = createPdfResource({ notebookId: 'b', notebookName: 'n', title: '讲义', sourcePath: 'p.pdf' })
    expect(formatResourceMarkdown(r)).toContain('PDF 资料')
  })
})
