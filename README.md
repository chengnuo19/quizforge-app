<div align="center">

# ✳ QuizForge

**把 Markdown 题库变成可交互测验的笔记本式学习应用**

[![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=white)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vitejs.dev)
[![Electron](https://img.shields.io/badge/Electron-42-47848F?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![PWA](https://img.shields.io/badge/PWA-可安装-5BB974?style=flat-square&logo=googlechrome&logoColor=white)](https://web.dev/progressive-web-apps/)
[![Tests](https://img.shields.io/badge/测试-294个通过-brightgreen?style=flat-square&logo=vitest&logoColor=white)](./src)
[![License](https://img.shields.io/badge/License-MIT-orange?style=flat-square)](./LICENSE)

[🌐 在线体验](https://zingy-baklava-cda6f7.netlify.app/) · [📖 Markdown 格式](#-markdown-题目格式) · [GitHub](https://github.com/chengnuo19/quizforge-app)

</div>

---

## 📖 项目介绍

QuizForge 是一个**纯前端、无需后端**的刷题 PWA。你只需要用 Markdown 写好题目和答案，上传到笔记本，就能立刻开始可交互的测验。数据全部存在本地浏览器，不需要账号，不需要服务器。

**为什么做这个？** 市面上的刷题网站题库固定、无法自定义。QuizForge 让你把课本例题、错题集、考研真题——任何内容——变成属于自己的动态题库。

在此之上，QuizForge 还有一层 **Electron 桌面外壳**：题库落到本地文件夹（Vault），并解锁 PDF 工作台、文档转换（MarkItDown / Docling）、AI 截图整理、音视频工作台（yt-dlp）、ChatGPT / Gemini 浏览器剪藏扩展、To do 邮件提醒等「把材料变成题库」的完整工作流。Web 版与桌面版共用同一套代码，桌面独有的能力在界面上会明确标注。

---

## ✨ 核心功能

### 📚 笔记本系统
- **笔记本首页**：题库按笔记本分组，卡片式展示（可自定义图标 + 配色）
- **内置笔记本**：`content/` 文件夹下的子目录自动成为只读笔记本，随仓库发布
- **自建笔记本**：浏览器内创建、编辑、删除笔记本，上传或粘贴 Markdown 即可添加题目
- **URL 路由**：视图状态写进 hash（`#book=…`、`#play=…`），刷新不丢失当前页面

### 🧠 间隔重复复习（SRS）
- 内置 **SM-2 算法**，根据你的答对率自动调整下次复习时间
- 首页显示当日待复习卡片数量，一键进入复习模式
- 统计仪表盘：新卡 / 学习中 / 复习中 / 已掌握的分布

### 🎯 答题体验
| 功能 | 说明 |
|------|------|
| 题型 | 单选、多选、判断题 |
| 键盘操作 | `1-9` / `A-Z` 选择，`Enter` 提交，方向键移动焦点 |
| 即时反馈 | 选错高亮正确答案 + 逐项详解 |
| LaTeX 公式 | `$...$` 行内，`$$...$$` 块级，由 KaTeX 渲染 |
| 进度持久化 | 自动续答，关掉再开不丢进度 |
| 错题重练 | 结束后一键「重练错题」，仅用错题再来一轮 |

### 📊 统计与导出
- **成绩历史**：记录每次答题的得分与用时，显示进步趋势（↑↓）
- **多格式导出错题**：Markdown（含「你选了 B，正确答案为 A」标注）、Anki CSV、Quizlet 文本
- **分享链接**：把整份测验压缩进 URL（`#q=…`），发给别人直接打开，无需服务器

### 📖 错题本与整理
- **自动收录与移除**：答错题目自动进入全局错题本，后续在任何地方答对该题将自动从错题本移出。
- **筛选与管理**：支持按来源笔记本筛选错题、按关键字搜索错题。
- **批量操作**：提供单选、全选功能，支持批量删除或将错题加入收藏复习。
- **转化为新题库**：可将选中的错题导出为 Markdown，或一键生成专属错题笔记本以供集中攻克。

### 🌟 其他
- 🌙 深色 / 浅色主题（记忆选择）
- 📱 移动端适配（触摸友好，窄屏单列布局）
- 📲 PWA 可安装：首页「安装应用」按钮，支持离线使用
- ♿ ARIA 无障碍：选项为 radio/checkbox，支持键盘完整操作

---

## 🧰 材料加工工作流

上面讲的是「有题库之后怎么刷」，这一节是「怎么把手上的材料变成题库」。五个模块都从首页快捷入口进入，标注 💻 的仅在桌面版可用。

### 🛠 PDF 工作台 `#pdf-workbench`

浏览器内完成的离线 PDF 套件：底层用 **pdf-lib** 做编辑与生成，**pdfjs-dist** 做页面渲染与缩略图（带 `ThumbCache` 缓存），文件不出本机。左侧工具栏共八个工具：

| 工具 | 能力 |
|------|------|
| 🗂️ 整理页面 | 缩略图画布上多选页面，旋转 90°/180°/270°、复制、删除、提取为新文件、调整顺序 |
| 🔗 合并 PDF | 多文件导入，上移 / 下移调整顺序后合并为一份 |
| ✂️ 拆分 PDF | 三种模式：按页码区间（`1-5, 6-10, 15`）、每 N 页一份、每页一份 |
| 📦 压缩 PDF | 低 / 中 / 高三档，运行前先给出预计体积；**不动文字**，只重编码内嵌 JPEG 图像并启用对象流 |
| 🖼️ 图片转换 | 双向：PDF → 图片、图片 → PDF |
| 🧠 准备测验 | 勾选页面渲染成图 → 交给 AI 识别出题 → 生成测验 Markdown → 直接导入笔记本（可现场新建） |
| ⚡ 批量处理 | 对导入的全部文件一次性执行：全部旋转 90°、全部压缩（中）、全部转图片、全部合并为一个 |
| 📋 PDF 信息 | 标题 / 作者 / 创建工具 / 生成程序 / 创建与修改日期 / 页数 / 文件大小，以及前 20 页的页面尺寸（pt） |

> 压缩策略刻意保守：文字层完全不动，只处理 `DCTDecode` 且色彩空间为 `/DeviceRGB`、`/DeviceGray`、`/DeviceCMYK` 的图像流，带 SMask 的图像直接跳过，避免破坏蒙版与特殊色彩空间。

### 📄 文档转换 `#markitdown` 💻

把 Word / PPT / Excel / PDF 等文档转成 Markdown。同一个面板后面挂了**两个引擎**，按材料难度选：

| 引擎 | 特点 | 什么时候用 |
|------|------|-----------|
| **MarkItDown** | 快 · 轻量，纯文本抽取 | 已有文字层的单栏文档，秒级出结果 |
| **Docling** | 慢 · 做版面分析、阅读顺序、表格结构、公式转 LaTeX | 双栏学术 PDF、扫描件、表格 / 公式密集的材料 |

流程一致：

1. 选引擎（Docling 可另外勾选 **OCR**，读扫描件里的文字，更慢）
2. **选择文件并转换** → 结果进入可编辑文本框，随时手改；Docling 运行时会实时回传进度
3. **保存为 .md** → 另存到任意位置（默认文件名取自源文件名）
4. **导入到笔记本资料** → 存进某个笔记本的资料库，可选已有笔记本或现场新建（名称留空则用文档标题）；资料会记录实际用的是哪个引擎

**Docling 有两条执行路径**，面板会自动选快的那条：

| 路径 | 每份文档 | 说明 |
|------|---------|------|
| `docling-serve` 常驻服务 | **约 8–10 秒** | 首次用到时拉起（启动约 50 秒），之后整个会话复用 |
| `docling convert` 单次命令行 | **约 53 秒** | 服务不可用时的兜底 |

差距来自 `docling` CLI 每次调用都要重新 import `docling.document_converter`——实测冷热三次都是 **34–36 秒**，是真实的 import 开销而非磁盘缓存问题。常驻服务只在启动时付一次，之后复用已加载的模型，连推理本身也从 12.9 秒降到 7.7 秒。

没装 `docling-serve` 时会自动回落到 CLI 并在界面上提示；没装 Docling 时选它会给出安装指引，都不影响 MarkItDown。

### 🖼 截图自动整理 `#screenshot-organizer` 💻

用视觉模型给截图自动分类 + 重命名并归档。界面负责配置与调度，实际执行的是外部 Python 包 `screenshot_organizer`。

桌面端默认从应用数据目录中的 screenshot-organizer/config.yaml 读取配置；需要时可通过 SCREENSHOT_ORGANIZER_DIR 或 SCREENSHOT_ORGANIZER_CONFIG 指定路径。

- **三种模式**：仅预览（不移动文件）/ 批量整理（重命名并分类）/ 监听新增（实时整理，可随时停止）
- **撤销**：一键撤销上一次整理操作
- **多服务商**：从 [`config.yaml`](config.yaml) 读取 provider 列表——mock、OpenAI、Claude、Gemini、GLM、MiMo、Kimi、Qwen、豆包、Ollama，切换服务商时自动带出默认模型名
- **成本与配额可见**：配置里可写单价、上下文窗口、单次请求成本上限（`max_estimated_request_cost_cny`）与配额耗尽关键词；界面显示预计成本，缺少对应 API Key 环境变量时给出警告
- **安全降级**：配置缺失或 YAML 解析失败会自动回落到 Mock 模式并在顶部横幅说明原因；正式整理前还有一次二次确认

默认分类：代码、报错、聊天记录、网页文章、文档、设计图、数据图表、购物订单、设置页面、社交媒体、视频截图、游戏、地图、其他。

### ✅ To do 任务与邮件提醒 `#todos` 💻

轻量任务清单，带截止时间与 Gmail 邮件提醒：

- **任务字段**：标题、备注、截止时间、预计耗时（分钟）、提前提醒小时数
- **自动推算**：根据截止时间与预计耗时算出「预计开始时间」和「提醒发送时间」，在表单里实时显示
- **提醒状态机**：`none` → `scheduled` → `sent` / `failed`，已发送的任务不会重复发信
- **发信方式**：主进程用 **nodemailer** 走 Gmail SMTP 定时发送；邮箱与 16 位应用专用密码存在 `<Vault>/.quizforge/gmail.json`，支持「发送测试邮件」验证配置
- 只有状态为「进行中」且渠道为 Gmail 的任务会被排程

### 🎬 音视频工作台 `#media-downloader` 💻

集成 `yt-dlp`（可在设置中指定可执行文件路径），实现从网络公开课、讲座视频到学习题库的快速转换：

- **文稿与字幕提取**：自动下载官方或自动生成的字幕（VTT/SRT），剔除时间戳与重复行号，清洗并自动组织为段落分明的 Markdown 文档。
- **一键导入题库资料**：清洗好的讲座文稿可直接一键存入笔记本资料库，方便直接利用视频演讲原文进行 AI 出题或复习。
- **音频 / 视频下载**：支持提取 MP3/M4A 音频或 1080p/720p 视频，自选保存目录，自带平滑进度条、下载速率、ETA 预估与取消控制。
- **灵活配置**：默认直接开箱即用，同时支持在界面设置中修改可执行文件路径与默认下载目录。

### 🌐 ChatGPT / Gemini 网页剪藏扩展与对话导入 💻

支持从 **ChatGPT (`chatgpt.com`)** 与 **Google Gemini (`gemini.google.com`)** 网页端一键采集笔记与错题：

- **Chrome / Edge 扩展插件**：目录位于 `chrome-extension/`，开启浏览器开发者模式后直接加载即可使用。
- **LaTeX 公式无损提取**：解析底层 KaTeX 源码，将复杂的网页数学公式无损还原为标准 `$E=mc^2$`，彻底解决复制公式乱码问题。
- **本地极速入库（Localhost HTTP）**：桌面端主进程运行轻量接收服务（`127.0.0.1:41414`），点击网页按钮即可静默存入指定笔记本，无需切屏。
- **双形态自由沉淀**：
  - **📝 知识点笔记**：将完整问答富文本整理为 Markdown 存入笔记本资料库。
  - **❌ 测验与错题**：自动解析题干、选项、正确答案与名师解析，直接转为交互式测验并自动收录进全局错题本。
- **应用内对话导入面板**：未安装扩展时，也可在应用内点击「🤖 AI 对话导入」直接粘贴聊天记录，自动智能提取题干与选项。

### 📎 资料库

每个笔记本除了「测验」标签页，还有一个「资料」标签页，用来存放生成题目的原始材料：

- **两类资料**：`document`（由文档转换导入的 Markdown，`sourceSite` 记录是 MarkItDown 还是 Docling）与 `pdf`（PDF 工作台存入的 PDF）
- **文档资料** → 「生成测验」，直接把资料变成该笔记本里的一份测验
- **PDF 资料** → 「在工作台打开」，带着字节流跳回 PDF 工作台继续加工
- **移动**：把资料挪到别的笔记本 / 分类下
- 桌面版的 PDF 字节存在 Vault 里（`sourcePath`），Web 端才退化为内联 base64

---

## 💻 桌面版与 Vault

桌面版首次启动会让你选一个 **Vault 目录**（路径由你选择），之后：

- 笔记本、测验、答题进度、成绩历史、资料清单都以文件形式落在 Vault 里，可以直接用 Git 管理或云盘同步
- 内置笔记本（`content/`）会在首次使用时拷进 Vault
- 主进程通过 IPC 暴露受控的文件能力：读写文本 / 二进制 / JSON、建目录、判断存在、拼接路径
- 桌面独有入口：文档转换（MarkItDown / Docling）、截图整理、To do 邮件提醒、PDF 资料直读

纯浏览器打开时这些入口会提示「仅桌面版可用」，其余功能（刷题、SRS、错题本、统计、分享、PDF 工作台）完全不受影响。

---

## 🛠️ 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | React 18 + Vite 5 |
| 样式 | 纯 CSS（自定义设计系统，暖色调） |
| 公式渲染 | KaTeX |
| Markdown 解析 | react-markdown + remark-gfm + remark-math |
| SRS 算法 | SM-2（自研实现） |
| PDF 处理 | pdf-lib（编辑 / 生成）+ pdfjs-dist（渲染 / 缩略图） |
| 桌面外壳 | Electron 42 + electron-builder（Windows NSIS） |
| 邮件提醒 | nodemailer（Gmail SMTP） |
| 配置解析 | js-yaml |
| 数据存储 | localStorage（Web）/ 本地 Vault 文件（桌面） |
| PWA | vite-plugin-pwa + Workbox |
| 测试 | Vitest + Testing Library |
| 部署 | Netlify（Web）· electron-builder（桌面） |

---

## 🚀 快速开始

```bash
# 克隆项目
git clone https://github.com/chengnuo19/quizforge-app.git
cd quizforge-app

# 安装依赖
npm install

# 本地开发（访问 http://localhost:5173）
npm run dev

# 运行测试
npm test

# 生产构建
npm run build
```

### 桌面版

```bash
# 桌面版开发：同时起 Vite 与 Electron
npm run app:dev

# 打包桌面版（Windows NSIS 安装包，输出到 dist_electron/）
npm run electron:build
```

**桌面版功能的前置条件：**

| 功能 | 需要什么 |
|------|----------|
| 文档转换 · MarkItDown | `pip install "markitdown[all]"`；或用 `MARKITDOWN_BIN` 指向可执行文件 |
| 文档转换 · Docling | `pip install docling`；或用 `DOCLING_BIN` 指向可执行文件。首次运行会下载版面 / 表格模型（约 1–2 GB） |
| 文档转换 · Docling 加速（强烈建议） | 额外装 `docling-serve`，让每份文档从 53 秒降到 8–10 秒。用 uv 装时是 `uv tool install docling --with docling-serve`，但 uv 只为主包创建 shim，所以要把 `DOCLING_SERVE_BIN` 指向 `<uv tools>\docling\Scripts\docling-serve.exe` |
| 截图自动整理 | Python 3.12（`py -3.12`）+ `screenshot_organizer` 包；模型配置写在 `config.yaml`，API Key 走环境变量 |
| To do 邮件提醒 | Gmail 账号 + 16 位应用专用密码（在应用内填写，存于 Vault） |
| 音视频工作台 · yt-dlp | yt-dlp 与 FFmpeg 路径可在设置中指定。 |
| 浏览器剪藏扩展 · Web Clipper | Chrome / Edge 扩展位于 `chrome-extension/` 目录；桌面端自动在 `127.0.0.1:41414` 提供静默接收服务 |
| 准备测验 / AI 出题 | 右上角设置里三选一：① API Key（OpenAI 兼容的 vision 接口，Web 版也可用）；② ChatGPT 订阅（桌面版，浏览器 OAuth 登录，基于 [`@earendil-works/pi-ai`](https://github.com/earendil-works/pi)，令牌用系统 safeStorage 加密存在应用数据目录）；③ Antigravity 订阅（桌面版，调用本机已登录的官方 `agy` CLI，首次使用会写入只读专用 agent `~/.gemini/config/agents/quizforge-ai.md`） |

---

## 📝 Markdown 题目格式

把下面的 Markdown 文件上传到 QuizForge，就能自动生成测验：

```markdown
---
title: 排序算法
shuffle: true    # 可选，打乱题序与选项顺序
---

## 快速排序的平均时间复杂度是？

- [ ] $O(n)$
  线性时间只有桶排序等特殊情况才能达到。
- [x] $O(n \log n)$
  快排平均划分均匀时为 $O(n \log n)$，是对比排序的理论下界。
- [ ] $O(n^2)$
  这是最坏情况（每次选到最大/最小元素作为 pivot）。

> Explain: 快排通过分治将数组分成两部分递归排序。选好 pivot 是关键。

## 以下哪些是稳定排序？（多选）

- [x] 归并排序
- [ ] 快速排序
- [x] 冒泡排序
- [ ] 堆排序
```

**格式规则：**
- 每道题用 `## 题目文字` 开头
- `- [ ]` 表示选项，`- [x]` 标记正确答案（多个 `[x]` = 多选题）
- 选项下方缩进的文字 = 该选项的单独详解
- `> Explain:` 开头的引用块 = 整题讲解
- 支持 LaTeX 公式、GFM 表格、代码块等

---

## 🗺 路由一览

应用状态全部写在 hash 里，刷新不丢，链接可收藏。

| Hash | 视图 |
|------|------|
| `#` | 笔记本首页 |
| `#book=<bookId>` | 笔记本详情（测验 / 资料） |
| `#play=<bookId>/<quizId>` | 答题播放器 |
| `#q=<compressed>` | 分享链接打开的测验 |
| `#srs` | 今日复习（SRS） |
| `#stats` | 学习报告 |
| `#favorites` | 收藏题目复习 |
| `#wrong` | 错题本重练 |
| `#organizeWrong` | 错题整理 |
| `#markitdown` | 文档转换（MarkItDown / Docling）💻 |
| `#screenshot-organizer` | 截图自动整理 💻 |
| `#todos` | To do 任务 💻 |
| `#media-downloader` | 音视频工作台（yt-dlp 音视频下载与字幕提取）💻 |
| `#pdf-workbench` | PDF 工作台 |

---

## 📁 项目结构

```
QuizForge/
├── chrome-extension/     # Chrome / Edge 浏览器剪藏扩展 (Manifest V3)
│   ├── manifest.json             # 扩展配置与权限定义
│   ├── popup/                    # 扩展弹出层 UI
│   ├── scripts/                  # 内容脚本注入与 KaTeX/HTML 转 Markdown 引擎
│   └── icons/                    # 扩展图标
├── content/              # 内置笔记本（按文件夹分组）
│   ├── 数据结构与算法/
│   └── 计算机网络/
├── docs/                 # 架构决策与实施计划
├── electron/             # 桌面主进程
│   ├── main.cjs                  # 窗口 + IPC（文件系统 / 对话框）
│   ├── preload.cjs               # contextBridge 暴露面
│   ├── markitdown.cjs            # MarkItDown 引擎（execFile → stdout）
│   ├── docling.cjs               # Docling 单次命令行（spawn → 临时目录 + 进度流）
│   ├── doclingServe.cjs          # Docling 常驻服务（生命周期 + HTTP 客户端）
│   ├── screenshotOrganizer.cjs   # 截图整理子进程调度
│   ├── clipServer.cjs            # 浏览器剪藏 Localhost HTTP 接收服务
│   ├── ytdlp.cjs                 # yt-dlp 子进程管理、参数拼装与字幕清洗
│   └── reminders.cjs             # Gmail 定时提醒
├── public/               # 静态资源（PWA 图标）
├── src/
│   ├── components/       # React 组件
│   │   ├── Library.jsx                  # 首页笔记本列表
│   │   ├── AiDialogueImportModal.jsx    # ChatGPT / Gemini 对话智能导入面板
│   │   ├── BookDetail.jsx               # 笔记本详情（测验 / 资料）
│   │   ├── QuizPlayer.jsx               # 答题播放器
│   │   ├── SrsSession.jsx               # SRS 复习模式
│   │   ├── StatsView.jsx                # 统计仪表盘
│   │   ├── WrongOrganize.jsx            # 错题整理
│   │   ├── ResourcesView.jsx            # 资料库
│   │   ├── MarkitdownPanel.jsx          # 文档转换面板（双引擎）
│   │   ├── MediaDownloaderPanel.jsx     # 音视频工作台（yt-dlp 视频/音频下载与字幕提取）
│   │   ├── ScreenshotOrganizerPanel.jsx # 截图整理面板
│   │   ├── TodoPanel.jsx                # To do 任务
│   │   ├── VaultSelector.jsx            # Vault 目录选择
│   │   └── pdf/                         # PDF 工作台 + 八个工具
│   ├── hooks/
│   │   └── usePwaInstall.js  # PWA 安装引导 hook
│   ├── pdf/              # PDF 引擎
│   │   ├── engine.js         # pdf-lib：合并 / 拆分 / 旋转 / 压缩 / 图片转 PDF
│   │   ├── renderer.js       # pdfjs-dist：页面渲染 + 缩略图缓存
│   │   ├── pageRanges.js     # 页码区间解析
│   │   ├── filename.js       # 输出文件名清洗 / 去重
│   │   └── export.js         # 批量下载
│   ├── quiz/             # 核心逻辑
│   │   ├── parseQuiz.js      # Markdown 题目解析器
│   │   ├── books.js          # 笔记本数据管理
│   │   ├── srs.js            # SM-2 间隔重复算法
│   │   ├── router.js         # hash 路由
│   │   ├── exportQuiz.js     # 多格式导出
│   │   ├── aiDialogueParser.js # AI 聊天记录题干/选项/答案/笔记智能解析器
│   │   ├── ai.js             # 图片 → 测验 Markdown
│   │   ├── aiClient.js       # 统一 AI 调用入口（API Key / ChatGPT 订阅 / Antigravity 订阅）
│   │   ├── resources.js      # 资料库数据模型
│   │   ├── todos.js          # To do 数据模型
│   │   ├── markitdown.js     # 文档转换桥接（引擎选择 + 进度订阅）
│   │   ├── pdfBridge.js      # PDF 工作台 ⇄ 资料库桥接
│   │   ├── localFsStorage.js # Vault 读写
│   │   └── fsSync.js         # Vault ⇄ 本地状态同步
│   └── styles/           # 设计系统（CSS 变量 + 组件样式）
├── config.yaml           # 截图整理的模型 / 路径配置
└── vite.config.js        # Vite + PWA 配置
```

---

## 📄 License

MIT © 2025 [chengnuo19](https://github.com/chengnuo19)
