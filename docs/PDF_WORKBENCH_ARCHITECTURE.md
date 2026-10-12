# PDF Workbench — QuizForge 架构接入说明

> Phase 0 交付物：在写任何 PDF 代码之前，先完整理解 QuizForge，说明 PDF 模块应该接在哪里。
> 状态：✅ 已基于当前代码库（`master` @ `45376a7` + 工作区在途改动）核对。

---

## 1. QuizForge 技术栈全景

| 层 | 技术 | 关键事实 |
|---|---|---|
| 框架 | **React 18 + Vite 5** | 纯前端 SPA，无后端服务器 |
| 语言 | JavaScript（ESM） | `"type": "module"` |
| 桌面 | **Electron 42**（`electron/`）+ **Tauri 2**（`src-tauri/`） | Electron 是当前主用桌面壳；`window.electronAPI` 由 `preload.cjs` 暴露 |
| 运行形态 | **PWA**（vite-plugin-pwa）+ 浏览器 + Electron | 三端共用同一套渲染进程代码 |
| 路由 | **hash 路由** `src/quiz/router.js` | 全部视图状态在 `location.hash` |
| 状态 | React `useState`/`useMemo` + localStorage | 无 Redux/Zustand |
| 数据存储 | localStorage（键 `quizforge:*`） | 桌面端由 `fsSync.js` 写穿到 Vault（`<Vault>`）下的 `.quizforge/*.json` |
| 文件存储 | Vault 文件夹结构（桌面）+ 浏览器 Blob 下载（Web） | 内置笔记本来自 `content/`，用户笔记本是 Vault 下的子文件夹，测验是 `.md` 文件 |
| PDF | **pdfjs-dist 6.0.227（Apache-2.0，已安装）** | `src/quiz/pdfHelper.js` 已用它做 PDF→图片 |
| AI | `src/quiz/ai.js`，OpenAI 兼容 chat/completions | 需要用户在设置里填 API Key |
| 文档转换 | `electron/markitdown.cjs` 调用 `markitdown` CLI（仅桌面） | PDF/DOCX→Markdown |
| 设计系统 | `src/styles/tokens.css`（CSS 变量）+ `src/styles/app.css` | 奶油色 + 珊瑚红（`--primary:#cc785c`），Tiempos 衬线标题 |
| 测试 | Vitest（`environment:'node'` + jsdom 组件测试） | 143 个测试通过（Phase 0 baseline） |
| 构建 | `vite build` → `dist/`；`electron-builder` → `dist_electron/` | PWA + Electron |

---

## 2. 现有核心流程（PDF 模块必须复用的部分）

### 2.1 路由与视图派发

`App.jsx` 根据 `parseHash()` 的 `route.view` 派发视图。所有重面板都是 `lazy()` + `<Suspense>`：

```
#library / #book= / #play= / #srs / #stats / #favorites
#wrong / #organizeWrong / #markitdown / #screenshot-organizer / #todos / #q=
```

**新增一级功能的标准接入方式**（与 MarkitdownPanel / TodoPanel 完全一致）：

1. `router.js`：加一条 `#pdf-workbench` 路由 + `goPdfWorkbench()`。
2. `App.jsx`：`const PdfWorkbench = lazy(() => import(...))`，在路由树里加一个 `else if (route.view === 'pdf-workbench')` 分支。
3. `Library.jsx`：侧边栏加一个条目（首页/今日复习/收藏/错题/整理/报告/To do 那一栏）+ 主操作卡片网格加一张卡。

### 2.2 文档→资料（Document Library）

- 资源模型：`src/quiz/resources.js`，localStorage 键 `quizforge:resources`，`schemaVersion: 1`。
- 一个 resource：`{ id, type:'document', notebookId, notebookName, title, summary, contentMarkdown, sourcePath, sourceUrl, createdAt, updatedAt }`。
- 创建：`createDocumentResource({...})` → `appendResource(resource)`；桌面端 `fsWriteResources` 写穿到 Vault。
- 展示：`ResourcesView.jsx`（笔记本详情里的"资料"区）。

**这就是"文档库"。PDF Workbench 的 `Save to Library` 应复用 `createDocumentResource` + `appendResource`，不新建存储。**

### 2.3 文档→AI→测验（Document → Parsing → AI → Quiz）

当前只有一条完整链路，**必须复用、不得新建第二条**：

```
PDF / 图片 / Markdown
  → Uploader.jsx (拖拽/选择)
  → convertPdfToImages(file)      // pdfjs-dist 渲染为 base64 JPEG（pdfHelper.js）
  → convertImagesToMarkdown(b64)  // 视觉 AI → Quiz Markdown（ai.js）
  → convertMarkdownToQuizMarkdown(md)  // （可选）文本整理（ai.js）
  → parseQuiz(md)                 // 严格校验 Markdown（parseQuiz.js）
  → addQuizToBook / upsertQuizInBook   // 存入笔记本（books.js）
```

要点：
- `convertImagesToMarkdown` 接收**一组 base64 图片**并一次性发给视觉模型。当前 `Uploader` 对 PDF 是"整本 → 全部页面 → 全部发出去"。
- **Prepare for Quiz 的差异点**：只把"用户勾选、清理、排序后的页面"渲染成 base64，再喂给**同一个** `convertImagesToMarkdown`。渲染逻辑复用/参数化 `pdfHelper.js`（现为固定 `scale 2.0`、整本渲染，需改成"指定页码 + 可中止"）。
- AI 设置（baseUrl/apiKey/model）由 `storage.js` 的 `loadAiSettings()` 提供，UI 在 `SettingsModal.jsx`。隐私边界保持不变：**只有用户显式点击"生成测验"才会把页面图片发往 AI**；普通 PDF 编辑全程本地。

### 2.4 桌面 IPC 边界（electron）

`preload.cjs` 已暴露：`selectVault / readDir / readFile / writeFile / mkdir / exists / copyBuiltin / joinPath` 及 markitdown、截图整理、提醒等。

- 桌面端"保存 PDF"可新增一个 `dialog:saveFile` 类 IPC（仿 `markitdown:saveMarkdownFile`，用 `dialog.showSaveDialog`）；Web/PWA 端用浏览器下载（`a.download`）。
- 不要引入第二套文件存储系统：仍走"Vault 文件夹 + `quizforge:*` localStorage + `fsSync` 写穿"。

---

## 3. PDF Workbench 插到哪里（结论）

```
QuizForge
│
├── 首页 Library ──────── 侧边栏新增「PDF Workbench」+ 快速开始卡
├── #book= …             （笔记本详情，含资料区）
├── #play= …  / #srs  …  （答题）
├── #markitdown          文档→Markdown
├── #screenshot-organizer
├── #todos
└── #pdf-workbench  ★ 新路由，lazy 面板 PdfWorkbench.jsx
      ├── 左：工具列表（Merge / Split / Organize / Compress / Convert / Prepare for Quiz …）
      ├── 中：Document Canvas / 页面缩略图网格（虚拟滚动 + 懒渲染）
      └── 右：Properties / Export
```

### 3.1 新增文件（模块划分）

```
src/
  pdf/                          # PDF Workbench 引擎（纯逻辑，Node 可测）
    engine.js                   # pdf-lib 操作：load/save、merge、split、reorder、
                                #   rotate、delete、duplicate、extract、images→pdf、compress
    pageRanges.js               # 页码区间解析："1-5,6-10,15"、"每 N 页"、"单页"
    filename.js                 # 中文文件名安全化 + 去重（output/foo_processed.pdf）
    renderer.js                 # pdfjs-dist：缩略图/预览/页面→图片
                                #   懒渲染 + 虚拟列表 + 缓存 + AbortController
    engine.test.js  pageRanges.test.js  filename.test.js
  components/
    pdf/
      PdfWorkbench.jsx          # 视图外壳（App.jsx lazy 载入）
      PdfToolList.jsx           # 左栏工具
      PdfPageGrid.jsx           # 中栏缩略图网格（虚拟滚动）
      PdfPropertyPanel.jsx      # 右栏属性/导出
      PdfDropzone.jsx           # 拖入 PDF
      (各工具以配置化形式挂在 PdfWorkbench 内，避免一次性爆出十几个组件)
  quiz/pdfHelper.js             # 现有文件：参数化页码 + 可中止渲染，供 Prepare for Quiz 复用
```

> 选择 `src/pdf/` 顶层而非 `src/quiz/pdf/`：PDF 是独立领域（不只服务出题），与 `src/quiz/`（出题业务）平级更清晰；同时保持"`src/quiz/` 装业务逻辑、`src/components/` 装 UI"的既有约定。UI 统一用现有 `button` / `home-*` / `markitdown-panel` 等 CSS 类与设计 token，**不引入新设计语言**。

### 3.2 与现有系统的四个集成点（对应需求 V、四）

| 集成点 | 复用对象 | 说明 |
|---|---|---|
| **Open in PDF Workbench** | `resources.js` 的 `sourcePath`；桌面 `window.electronAPI.readFile` / `fs:readDir` | 资源卡片/资料区提供一个入口，把 `sourcePath` 指向的 PDF 载入 Workbench |
| **Save to Library** | `createDocumentResource` + `appendResource` + `fsWriteResources` | Workbench 导出/整理结果以 resource 存入 `quizforge:resources`，同一套存储 |
| **Prepare for Quiz** | `pdfHelper` 渲染 + `ai.js: convertImagesToMarkdown` + `parseQuiz` + `books.js` | 只把选中的页面交给**现有** AI 管线，输出走 `upsertQuizInBook` 或暂存到编辑器让用户确认 |
| **文件读写（桌面）** | `window.electronAPI` + `fsSync` | 沿用 Vault 路径约定，不建第二套存储 |

### 3.3 数据流（Prepare for Quiz 复用现有管线）

```
PdfWorkbench（勾选/清理/排序页面）
  → renderer.renderSelectedPages(file, pages[], {abort})   // pdfjs-dist，lazy 逐页
  → convertImagesToMarkdown(base64List, onProgress)        // 现有 ai.js，视觉 AI
  → 结果 Quiz Markdown 进入 Uploader 式编辑器预览/确认
  → parseQuiz → upsertQuizInBook(targetBook)               // 现有 books.js
```

**没有第二套 AI 生成逻辑。** 只有渲染阶段是"按选中页面"而非"整本"，其余全部走现有函数。

---

## 4. 需求 → 现有架构映射（第一批功能）

| 需求 | 实现载体 | 引擎 | 备注 |
|---|---|---|---|
| Merge | `engine.js` | pdf-lib | 多文件数组 → `copyPages` 合并；中文文件名用 `filename.js` |
| Split | `engine.js` + `pageRanges.js` | pdf-lib | `1-5,6-10,15`、每 N 页、单页 |
| Organize（重点） | `PdfPageGrid.jsx` + `engine.js` | pdfjs 缩略图 + pdf-lib | 拖拽排序/旋转/删除/复制/多选/提取；键盘快捷键 |
| PDF→Images | `renderer.js` | pdfjs-dist | PNG/JPEG、DPI/质量 |
| Images→PDF | `engine.js` | pdf-lib | 多图排序、页面尺寸、margin |
| Compress | `engine.js` | pdf-lib 重存 + 图像重编码 | Low/Medium/High；原始/最终大小与压缩率展示 |
| Rotate | `engine.js` | pdf-lib | 单页/多选/全部，90/180/270 |
| Extract | `engine.js` + `pageRanges.js` | pdf-lib | `1,3,5-12` → 独立 PDF |

---

## 5. 关键约束（已在现有架构中确认可行的部分）

1. **离线优先**：Merge/Split/Rotate/Reorder/Images/Compress 全部在渲染进程本地完成（pdf-lib + pdfjs-dist 都是纯 JS，无网络、无原生依赖）。不把 PDF 上传到任何服务器。
2. **隐私**：只有 `Prepare for Quiz` 触发 AI 时，选中页面才会发往用户配置的 AI 服务商——这与现有 Uploader 行为一致，UI 文案沿用现有隐私口径。
3. **大 PDF**：`renderer.js` 采用懒渲染 + 虚拟网格 + 缩略图缓存 + AbortController 取消过期任务，避免一次性把几百页全量渲染进内存。
4. **错误处理**：`engine.js` 统一抛出带中文上下文的错误（加密/损坏/超大/只读/磁盘满/中文路径/超长文件名/重名/密码保护），UI 层映射成明确提示，杜绝"Unknown error"。
5. **导出**：不默认覆盖原文件；默认 `output/<name>_processed.pdf`（或桌面端 Save As 对话框二次选择），遵循 QuizForge 现有保存交互（Web 下载 vs 桌面 `dialog.showSaveDialog`）。
6. **不破坏现有功能**：新增路由与组件均为**追加**；`pdfHelper.js` 仅做向后兼容的参数化（默认行为不变）。

---

## 6. 测试策略（Phase 12 前逐步补齐）

引擎层（Vitest `environment:'node'`，pdf-lib 在 Node 可直接读写内存 PDF）：

- Merge：A+B → 页数正确、顺序正确
- Split：区间/每 N 页 → 分段页数正确
- Reorder：页序正确
- Rotate：`getRotation()` 正确
- Extract：选中页集合正确
- Images→PDF：页数与图片数一致
- 非法 PDF / 加密 PDF：安全报错（不崩溃、不卡死）
- 大文件：内存有界（分页处理，不整本加载到内存外）

组件层（jsdom）：路由可达、缩略图容器渲染、拖拽/旋转/删除的状态迁移、导出按钮存在。

---

## 7. 风险与边界

| 事项 | 决定 |
|---|---|
| 不要 | 重写 QuizForge / 升级全部依赖 / 换框架 / 改数据库架构 / 建独立 Stirling PDF 服务再 iframe / 新建第二套认证或设计系统 |
| Stirling PDF | 核心 MIT、`engine/` 等目录专有授权、Java 栈 → **仅参考产品功能与交互，不复制实现代码**（见 `PDF_ENGINE_DECISION.md`） |
| Tauri | 仓库里有 `src-tauri/`，但当前桌面功能全部走 Electron `window.electronAPI`。PDF 模块同样只依赖渲染进程 + `window.electronAPI`，与 Tauri 不冲突；如未来切 Tauri 可平移 |
| pdf-lib 能力边界 | 不能做"文本级重排版"压缩；Compress 采用"重存 + 图像重编码"路线（对扫描试卷/课件这类图片型 PDF 是真实有效的压缩） |

---

## 8. 完成标准（Phase 0）

- [x] 通读关键源码：`App.jsx`、`router.js`、`Library.jsx`、`books.js`、`storage.js`、`resources.js`、`ai.js`、`pdfHelper.js`、`Uploader.jsx`、`MarkitdownPanel.jsx`、`fsSync.js`、`localFsStorage.js`、`electron/main.cjs`、`preload.cjs`、`tokens.css`
- [x] 建立 baseline：`npm test` → **143 passed（24 files）**
- [x] 运行当前 QuizForge：Vite dev server 启动正常，首页（侧边栏/快速开始/笔记本/复习卡）渲染正常
- [x] 不修改任何现有功能代码（本轮仅新增 `docs/`）

---

## 9. 实施状态（2026-08-14）

全部 Phase 0–14 已实现并在真实浏览器中验证（见各 commit 说明）。测试从 143 增至 **252**。

| Phase | 状态 | 真实浏览器验证 |
|---|---|---|
| 0–1 架构 + 引擎选型 | ✅ | — |
| 2 Workbench shell（`#pdf-workbench`，三栏） | ✅ | 加载多 PDF |
| 3 缩略图引擎（虚拟网格 + LRU 缓存 + 可中止） | ✅ | 300 页 → 仅挂载 ~16 个 tile，窗口随滚动 |
| 4 Merge / Split | ✅ | 8+300→308 页；`1-3,5-8`→2 份 |
| 5 Organize（拖拽/旋转/删除/复制/多选/提取/快捷键） | ✅ | 旋转翻转缩略图；拖拽改变导出内容 |
| 6 Images ↔ PDF | ✅ | PDF→2 张 144DPI JPEG；PNG→A4 PDF |
| 7 Compress（低/中/高 + 大小/压缩率） | ✅ | 75.3→36.9 KB（−51%），文字层保留 |
| 8 资料库集成（二进制 IPC、pdf 资源、打开/存入） | ✅ | 桌面门控，单元测试覆盖 |
| 9 Prepare for Quiz（复用现有 AI 管线） | ✅ | 真实 AI 调用 7 页 → 解析 → 导入笔记本 |
| 10 Batch（队列 + 单错不中断） | ✅ | 2 文件全旋转完成 + 下载 |
| 11 大 PDF 性能 | ✅ | 300 页组织/删除/导出正确 |
| 12 回归 + 真实 UI | ✅ | 全部 8 个工具逐一验证 |
| 13 打包 | ✅ | `vite build` 通过；worker 已 emit；Electron IPC 语法通过 |
| 14 PDF 信息（轻量 Academic Inspector） | ✅ | 元数据 + 每页尺寸 |

**待办**：路由接入（`router.js` / `App.jsx` / `Library.jsx` 的 `#pdf-workbench` 与侧边栏入口）与用户的 AI Favorites 重构一起留在工作区，需用户一并提交。

---

## 10. Fresh Checkout Verification（Phase 14.5）

在最终 commit 上创建全新 `git worktree`（不依赖任何未提交文件），从零验证：

- **Tested commit**：`480b087`（`feat: wire PDF Workbench route…` + `fix: restore excerpt helpers…`）
- **测试**：`npm ci` → `npm test` → **42 files / 276 tests passed**（包含已提交树中仍存在的 AI-Favorites 测试，证明提交态自洽）
- **生产构建**：`npm run build` → **PASS**（`✓ built in 3.53s`）
  - `dist/assets/PdfWorkbench-*.js`（lazy chunk，~475 KB）✅
  - `dist/assets/pdf.worker-*.mjs`（pdf.js worker）✅
  - `electron/main.cjs` / `preload.cjs` 通过 `node --check`，`electron-builder` 配置含 `electron/**/*`，IPC（`fs:readFileBuffer` / `fs:writeFileBuffer`）进入桌面构建 ✅
  - 构建不依赖 `output/playwright` 或任何本机临时文件 ✅
- **Fresh-worktree E2E**（`npm run dev --port 5174`，playwright 真实浏览器）：
  - 首页侧边栏 + 快速开始卡均有「PDF 工作台」 ✅
  - 点击进入 `#pdf-workbench` ✅
  - 加载已提交的 `output/playwright/示例八页.pdf` + `300页测试.pdf`，8/8 缩略图渲染 ✅
  - Merge（2 个条目）、Organize（工具栏 + 网格）、Prepare for Quiz（页面 + Generate 按钮）均可用 ✅
  - 资料库「Open in PDF Workbench」入口为桌面门控（`canUsePdfFiles()`），代码已提交并由 `pdfBridge.test.js` 覆盖 ✅
- **路由接线已独立提交**：`router.js` / `App.jsx` / `Library.jsx` 中仅 PDF Workbench hunks 已入 Git；AI-Favorites 在途删除仍保留在工作区未提交（不包含在上述提交中）。

**结论**：PDF Workbench 可仅凭 Git 已提交内容完整恢复、构建并运行。
