# PDF Workbench — PDF 引擎选型决策

> Phase 1 交付物：记录引擎选择原因与许可证核查结论。
> 日期：2026-08-14 · 决策：**pdf-lib（页面操作）+ pdfjs-dist（渲染，已在用）**，全部本地、纯 JS。

---

## 1. 候选引擎许可证核查（必须项）

| 引擎 | 语言/运行时 | 许可证 | 能否直接复用 |
|---|---|---|---|
| **pdfjs-dist** | JS / 浏览器+Node | **Apache-2.0** ✅ | ✅ 已在 `package.json`（v6.0.227），做渲染/缩略图/页面转图 |
| **pdf-lib** | JS / 浏览器+Node | **MIT** ✅ | ✅ 页面级操作全都能做 |
| PDFKit | JS / 浏览器+Node | MIT | 偏"生成新 PDF"，不能高效改写已有 PDF；pdf-lib 已覆盖 → 不引入 |
| PyMuPDF | Python | **AGPL-3.0** ❌ | 许可证与"纯前端零后端"架构都不匹配 → 排除 |
| pikepdf | Python | MPL-2.0 | 需 Python 后端 + 进程编排，违背离线/打包原则 → 排除 |
| PDFBox | Java | Apache-2.0 | 需 JVM，打包体积与启动成本不可接受 → 排除 |
| **Stirling PDF** | Java / Spring Boot | **open-core**：核心 MIT，`engine/`、`app/proprietary/` 等目录为专有授权 ⚠️ | 不能整体复用其代码；仅参考产品功能与交互（Merge/Split/Organize/Compress 的产品思路） |

**结论**：所有被排除项要么许可证不兼容（AGPL / 专有），要么运行时（JVM / Python）与 QuizForge「纯前端 PWA + Electron」架构冲突。Stirling PDF 按任务要求只借鉴产品形态，不复制实现。

---

## 2. 候选选型 vs. 8 条选择原则

| 原则 | pdf-lib + pdfjs-dist | 排除项（PyMuPDF 为例） |
|---|---|---|
| 1. License | MIT + Apache-2.0，零风险 | AGPL 传染性强 |
| 2. 跨平台 | 纯 JS，Windows/macOS/Linux/Web 一致 | 需每平台装 Python |
| 3. Offline | 完全本地，无网络调用 | 本地但需运行时 |
| 4. Reliability | 久经考验（pdf-lib 1.x 广泛使用；pdfjs 为 Firefox 内置） | 好，但引入跨语言边界 |
| 5. 中文文件名 | 引擎只处理字节流，文件名由 `filename.js` 层处理 → 无阻碍 | 无阻碍 |
| 6. Performance | 页面操作在内存 PDF 对象上进行，适合分页处理 | 快，但进程开销大 |
| 7. 现有栈兼容 | pdfjs 已依赖；pdf-lib 与 Vite/ESM 天然契合 | 需新增 child_process/IPC |
| 8. 打包难度 | 打进 renderer bundle，Electron/Tauri/PWA 三端零改动 | 需把 Python 运行时塞进安装包 |

---

## 3. 各引擎职责划分

### 3.1 pdf-lib（页面操作引擎，MIT，纯 JS）

浏览器 + Node 都能跑 → 引擎层 `src/pdf/engine.js` 可以在 Vitest（`environment:'node'`）里直接用内存 Buffer 做单元测试，无需浏览器。

支持的第一批能力：

- `PDFDocument.load(bytes, { ignoreEncryption })` / `create()` / `.save({ useObjectStreams })`
- **Merge**：`target.copyPages(src, indices)` + `target.addPage(page)`
- **Split / Extract**：复制选中页到新文档
- **Reorder / Delete / Duplicate**：`target.removePage(i)` + `insertPage` + `copyPages`
- **Rotate**：`page.setRotation(degrees)`，支持单页/多页/全部
- **Images→PDF**：`embedJpg / embedPng` + `page.drawImage`（可设页面尺寸、margin）
- **Compress 基础**：`save({ useObjectStreams: true, addDefaultPage: false })` 重存 + 遍历页面资源中的图像 XObject 做重编码（图片型 PDF 的主要体积来源）

能力边界：pdf-lib 不重排版文本内容流，所以对"纯文字 PDF"压缩幅度有限——但面向的使用场景是试卷/课件（图片为主），图像重编码是真实有效的压缩手段。不会默认以破坏文字清晰度换体积。

### 3.2 pdfjs-dist（渲染引擎，Apache-2.0，已安装）

- 缩略图 / 预览 / 页面 → 图片（PNG/JPEG、DPI/质量）
- `renderer.js` 的职责：懒渲染 + 虚拟网格 + 缩略图缓存 + `AbortController` 取消过期任务
- 现 `src/quiz/pdfHelper.js` 只做参数化改造（支持"指定页码 + 可中止"），默认行为不变

### 3.3 明确不引入

| 能力 | 决策 |
|---|---|
| 文本级重排版压缩 / 高级压缩 | 不做（依赖复杂，收益低） |
| OCR | 后续阶段评估，不用第三方云 OCR |
| 完整 PDF 编辑器（填表单、签章） | 后续高级阶段，不进第一批 |
| Python/Java 引擎 | 一律排除 |

---

## 4. 体积与打包影响

- pdfjs-dist：**已在依赖中**，零新增。
- pdf-lib：npm 包解包 ~19MB，但 Vite 按需打进 renderer bundle 的 ESM min 版本仅 **523 KB（gzip 约 140 KB）**；浏览器端会做 tree-shaking。不引入几百 MB 级别的依赖。
- 不新增原生模块 → Electron 无需 rebuild，Tauri 无需额外 crate，PWA 无需改 workbox 规则（新增资源自动进入 `globPatterns` 的白名单之外，构建即打包）。

---

## 5. 记录在案的备选（若 pdf-lib 遇到不可行场景）

| 场景 | 回退方案 |
|---|---|
| 需要文本抽取（Prepare for Quiz 的"文本版"路径） | pdfjs-dist `getTextContent()`（已依赖，无新成本） |
| 需要打印为 PDF / 高质量矢量导出 | Electron `webContents.printToPDF`（仅桌面，不进 PWA） |
| 需要真·压缩（DCT 重编码之外的深度优化） | 不引入第三方，按需自研图像重编码策略 |

---

## 6. 决策结论

> **第一批 PDF Workbench 采用 `pdf-lib`（页面操作）+ `pdfjs-dist`（渲染）。**
> 理由：许可清白（MIT + Apache-2.0）、纯 JS 离线、与现有 Vite/Electron/PWA 三端架构零摩擦、打包体积可控、能在 Node 下直接单测；Stirling PDF 仅作产品交互参考，不复制代码。
