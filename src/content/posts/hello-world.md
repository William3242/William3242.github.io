---
title: 你好，世界：这个博客会写什么
description: 博客的第一篇文章，介绍写作方向，同时作为文章模板。
pubDate: 2026-10-21
tags: [随笔]
---

这是博客的第一篇文章，也是一份写作模板。新文章只需要在 `src/content/posts/` 下新建一个 `.md` 或 `.mdx` 文件。

## 接下来会写什么

- **Agent 架构**：规划、记忆、工具调用和多 Agent 协作
- **AI 应用工程化**：RAG、评测、可观测性和成本控制
- **实战记录**：真实项目里的取舍和踩坑

## 代码示例

```python
def run_agent(task: str) -> str:
    messages = [{"role": "user", "content": task}]
    while True:
        reply = llm(messages, tools=TOOLS)
        if not reply.tool_calls:
            return reply.text
        messages += execute(reply.tool_calls)
```

> 文章头部的 `draft: true` 可以把文章标记为草稿，本地预览可见，线上不会发布。
