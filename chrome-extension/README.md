# QuizForge Web Clipper (浏览器剪藏扩展)

一键将 **ChatGPT (`chatgpt.com`)** 和 **Google Gemini (`gemini.google.com`)** 网页端问答沉淀为 QuizForge 笔记与交互式错题。

---

## 🚀 安装步骤 (1 分钟)

1. 打开 Chrome、Edge 或基于 Chromium 的浏览器。
2. 在地址栏输入并回车：
   - Chrome: `chrome://extensions/`
   - Edge: `edge://extensions/`
3. 在右上角打开 **「开发者模式」 (Developer mode)** 开关。
4. 点击左上角的 **「加载已解压的扩展程序」 (Load unpacked)**。
5. 选择本项目下的 `chrome-extension` 文件夹即可完成安装！

---

## ✨ 核心特性

1. **AI 回复一键入库**：
   - 自动在 ChatGPT 和 Gemini 的每条 AI 消息操作栏（复制、重新生成旁）添加 `[✦ 存到 QuizForge]` 按钮。
   - 提取时自动关联上一轮提问与完整解答。
2. **LaTeX 数学公式无损还原**：
   - 深入解析 KaTeX 底层 TeX 标签，将复杂的 HTML 公式完美还原为标准 `$E=mc^2$` 与 `$$\sum...$$`，避免复制公式乱码。
3. **双形态沉淀**：
   - **📝 知识点笔记**：将问答富文本整理为标准 Markdown 存入笔记本资料库。
   - **❌ 测验与错题**：自动解析题干、A/B/C/D 选项、正确答案与名师解析，直接转为可刷题的互动题目，并自动收录进全局错题本。
4. **划词右键剪藏**：
   - 划选网页任意文字，右键菜单选择「✦ 保存选中内容为 QuizForge 笔记 / 错题」。
5. **本地秒级通信**：
   - 基于 Localhost HTTP (`http://127.0.0.1:41414`)，静默极速入库，无需频繁切屏。
