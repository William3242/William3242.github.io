# William 的技术笔记

基于 [Astro](https://astro.build) 的极简技术博客，部署在 GitHub Pages。

## 本地开发

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # 输出到 dist/
```

## 写文章

在 `src/content/posts/` 新建 `.md` 或 `.mdx` 文件：

```yaml
---
title: 文章标题
description: 一句话摘要
pubDate: 2026-10-21
tags: [Agent, RAG]
draft: false
---
```

## 部署

推送到 `main` 分支后，GitHub Actions 会自动构建并发布。首次使用需在仓库 Settings → Pages 中把 Source 设为 **GitHub Actions**。
