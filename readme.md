# akiaki1996.github.io

王秋扬（Aki）的个人网站，采用 **Aki Swiss**（瑞士网格极简风 · 森林绿点缀 · 明暗双主题）设计系统与零外部依赖 Node.js 静态构建。

## 栏目结构

- `/` — 个人枢纽首页（简介、`livevents.app` 与 GitHub 外链、三大板块入口）
- `/resume/` — 个人简历（支持一键打印 / 导出 PDF，数据源为 `content/resume.json`）
- `/notes/` — 开发 Notes（支持分类筛选与锚点分享，数据源为 `content/notes/*.md`）
- `/life/` — 生活与个人档案（完整保留 2023 验光度数与手写原单 `2023glasses.jpg`，数据源为 `content/life/*.md`）

## 本地命令（Node 20+，无需 `npm install`）

```bash
npm run build   # 生成静态站点至 public/
npm run dev     # 启动本地预览 http://127.0.0.1:4000（支持监听自动重建）
npm run deploy  # 构建并推送 public/ 至 origin/deployment 分支
```

## 新增笔记或更新简历

1. **新增开发 Note**：在 `content/notes/` 下新建 `.md` 文件，加上 `id`、`index`、`title`、`date`、`category`、`tags`、`summary` 的 frontmatter 后运行 `npm run build`。
2. **新增生活记录**：在 `content/life/` 下新建 `.md` 文件。
3. **更新首页「最近在读」**：编辑 `content/reading.json`。
4. **更新简历**：编辑 `content/resume.json`。
5. **设计稿与 Design System**：保留在 `designs/aki-swiss-ds/` 与 `designs/aki-personal-site/`。
