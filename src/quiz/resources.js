import { fsWriteResources } from './fsSync.js'

const RESOURCES_KEY = 'quizforge:resources'

function uid() {
  return `qfr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

function basename(filePath) {
  const name = String(filePath || '').split(/[\\/]/).filter(Boolean).pop() || ''
  return name.replace(/\.[^.]+$/, '')
}

function extractMarkdownTitle(markdown) {
  const lines = String(markdown || '').split(/\r?\n/)
  const heading = lines.find(line => /^#\s+/.test(line.trim()))
  return heading ? heading.replace(/^#\s+/, '').trim() : ''
}

function summarizeMarkdown(markdown) {
  return String(markdown || '')
    .replace(/^---[\s\S]*?---/, '')
    .replace(/[#>*_`-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

export function getDocumentResourceTitle({ title, markdown, path } = {}) {
  return (title || extractMarkdownTitle(markdown) || basename(path) || '未命名文档').trim()
}

export function normalizeResourcesPayload(value) {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.resources)) {
    return { schemaVersion: 1, resources: [] }
  }

  return {
    schemaVersion: 1,
    resources: value.resources.filter(resource =>
      resource &&
      typeof resource.id === 'string' &&
      typeof resource.notebookId === 'string' &&
      typeof resource.title === 'string'
    ),
  }
}

export function loadResourcesPayload() {
  try {
    return normalizeResourcesPayload(JSON.parse(localStorage.getItem(RESOURCES_KEY) || 'null'))
  } catch {
    return { schemaVersion: 1, resources: [] }
  }
}

export function saveResourcesPayload(payload) {
  const normalized = normalizeResourcesPayload(payload)
  localStorage.setItem(RESOURCES_KEY, JSON.stringify(normalized))
  fsWriteResources(normalized)
}

export function appendResource(resource) {
  const payload = loadResourcesPayload()
  const next = { schemaVersion: 1, resources: [resource, ...payload.resources] }
  saveResourcesPayload(next)
  return resource
}

export function filterResourcesForBook(resources, bookId) {
  return resources.filter(resource => resource.notebookId === bookId)
}

export function createDocumentResource({
  notebookId,
  notebookName,
  title,
  markdown,
  sourcePath,
  categoryPath = [],
  // Which converter produced this Markdown — MarkItDown or Docling.
  sourceSite = 'MarkItDown',
}) {
  const contentMarkdown = String(markdown || '').trim()
  const now = Date.now()
  return {
    id: uid(),
    type: 'document',
    notebookId,
    notebookName,
    categoryPath,
    title: getDocumentResourceTitle({ title, markdown: contentMarkdown, path: sourcePath }),
    summary: summarizeMarkdown(contentMarkdown) || `已通过 ${sourceSite} 导入的文档资料。`,
    contentMarkdown,
    sourceSite,
    sourceUrl: '',
    sourcePath: sourcePath || '',
    createdAt: now,
    updatedAt: now,
  }
}

// A PDF saved from the PDF Workbench. On desktop the bytes live in the Vault
// (sourcePath); `pdfBase64` is only populated for web sessions.
export function createPdfResource({
  notebookId,
  notebookName,
  title,
  sourcePath = '',
  pdfBase64 = '',
  categoryPath = [],
}) {
  const now = Date.now()
  return {
    id: uid(),
    type: 'pdf',
    notebookId,
    notebookName,
    categoryPath,
    title: String(title || basename(sourcePath) || '未命名 PDF'),
    summary: '通过 PDF 工作台存入的 PDF 资料。',
    sourceSite: 'PDF Workbench',
    sourceUrl: '',
    sourcePath,
    pdfBase64: pdfBase64 || '',
    createdAt: now,
    updatedAt: now,
  }
}

export function isPdfResource(resource) {
  return resource?.type === 'pdf' || /\.pdf$/i.test(resource?.sourcePath || '')
}

export function removeResource(id) {
  const payload = loadResourcesPayload()
  saveResourcesPayload({
    schemaVersion: 1,
    resources: payload.resources.filter(resource => resource.id !== id),
  })
}

export function moveResource(resource, target) {
  return {
    ...resource,
    notebookId: target.notebookId,
    notebookName: target.notebookName,
    categoryPath: target.categoryPath,
    updatedAt: Date.now(),
  }
}

export function formatResourceMarkdown(resource) {
  if (resource.type === 'document') {
    return resource.contentMarkdown || ''
  }
  if (resource.type === 'pdf') {
    return `# ${resource.title}\n\n（PDF 资料：${resource.sourcePath || '无路径'}）`
  }

  const category = resource.categoryPath?.length ? `\nCategory: ${resource.categoryPath.join(' / ')}` : ''
  return `# ${resource.title}${category}\n\nQuestion:\n${resource.question}\n\nAnswer:\n${resource.answer}\n\nSource:\n${resource.sourceUrl}`
}
