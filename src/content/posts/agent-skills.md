---
title: Agent Skills：把做事的经验打包成 Agent 按需取用的能力
description: 一个 Skill 就是一个文件夹，里面一份 SKILL.md，再加几份参考资料和脚本。这篇讲清楚它为什么要这样设计：渐进式披露怎么省上下文，一次激活在 Harness 里是怎么发生的，它和工具、MCP、子 Agent、记忆分别是什么关系，怎么写 description 和正文，怎么评估一个 Skill 有没有用，以及为什么安装 Skill 要像安装依赖一样谨慎。
pubDate: 2026-10-31
tags: [Agent, LLM, Skills]
---

Skill 在这个系列里出现过两次，都只是一笔带过。在 [MCP 还是 CLI](/posts/mcp-vs-cli/#什么时候用哪个) 的结尾，我提到一种"文档 + 脚本"的中间形态：写一份说明，告诉 Agent 要做 X 就去跑某个脚本，Agent 需要时才去读这份说明。在 [搭建 Agent 的基础知识](/posts/agent-basics/#记忆跨越上下文窗口) 里，我把记忆分成四类，其中"程序记忆"指的是"怎么做一件事"的知识。

Agent Skills 就是把这两件事落到了一个具体的格式上。Anthropic 在 2025 年 10 月推出这个概念<sup class="cite" id="cite-1"><a href="#ref-1" title="Equipping agents for the real world with Agent Skills">1</a></sup>，12 月把格式作为开放标准发布<sup class="cite" id="cite-2"><a href="#ref-2" title="Agent Skills Specification">2</a></sup>，之后很多 Agent 产品都开始支持同样的目录结构。

格式本身简单到几乎没什么可讲：一个文件夹，一份 Markdown，开头几行 YAML。值得讲的是这个格式背后的取舍：为什么不把这些说明直接写进系统提示词，模型怎么知道该用哪个 Skill，它和工具、子 Agent、记忆的边界在哪里，以及写出一个真正有用的 Skill 有多难。这篇就讲这些。

## 一个 Skill 就是一个文件夹

按照规范<sup class="cite"><a href="#ref-2" title="Agent Skills Specification">2</a></sup>，一个 Skill 是一个目录，里面至少有一个 `SKILL.md`。其余的都是可选的，常见的约定是三个子目录：`scripts/` 放可执行的脚本，`references/` 放需要时再读的文档，`assets/` 放模板、数据表这类静态资源。

为了让后面的讨论具体一点，我用一个贴近这个博客的例子：一个帮我把草稿整理成博客文章的 Skill。

<figure class="diagram">
<svg viewBox="0 0 640 300" role="img" aria-label="一个 Skill 目录的结构，以及每个部分在什么时候被读入上下文">
<defs><marker id="sk1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0 0 L10 5 L0 10 z"/></marker></defs>
<rect class="frame" x="16" y="20" width="248" height="260" rx="8"/>
<g style="font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace">
<text class="t" x="32" y="52">blog-post/</text>
<text class="t" x="32" y="82">├─ SKILL.md</text>
<text class="t" x="32" y="122">├─ references/</text>
<text class="ts" x="32" y="144">│  ├─ diagrams.md</text>
<text class="ts" x="32" y="164">│  └─ citations.md</text>
<text class="t" x="32" y="198">├─ scripts/</text>
<text class="ts" x="32" y="220">│  └─ check_refs.py</text>
<text class="t" x="32" y="248">└─ assets/</text>
<text class="ts" x="32" y="268">   └─ post-template.md</text>
</g>
<rect class="c-purple" x="330" y="30" width="294" height="36" rx="4"/>
<text class="ts" x="477" y="53" text-anchor="middle">frontmatter：name + description，始终可见</text>
<rect class="c-blue" x="330" y="76" width="294" height="36" rx="4"/>
<text class="ts" x="477" y="99" text-anchor="middle">正文：步骤和规则，判断相关时才读入</text>
<rect class="c-amber" x="330" y="134" width="294" height="36" rx="4"/>
<text class="ts" x="477" y="157" text-anchor="middle">参考资料：正文里提到、而且用得上时再读</text>
<rect class="c-green" x="330" y="196" width="294" height="36" rx="4"/>
<text class="ts" x="477" y="219" text-anchor="middle">脚本：直接执行，只有输出进上下文</text>
<rect class="c-gray" x="330" y="242" width="294" height="36" rx="4"/>
<text class="ts" x="477" y="265" text-anchor="middle">模板：复制到工作目录里使用</text>
<path class="ln" d="M150 70 C 230 70, 260 48, 328 48" marker-end="url(#sk1)"/>
<path class="ln" d="M150 86 C 230 86, 260 94, 328 94" marker-end="url(#sk1)"/>
<path class="ln" d="M160 154 H328" marker-end="url(#sk1)"/>
<path class="ln" d="M180 216 H328" marker-end="url(#sk1)"/>
<path class="ln" d="M200 262 H328" marker-end="url(#sk1)"/>
</svg>
<figcaption>图 1：一个 Skill 的目录结构。同一个文件夹里的不同部分，进入上下文的时机各不相同。</figcaption>
</figure>

`SKILL.md` 分两部分。开头是 YAML frontmatter，规范要求的字段只有两个：

- **name**：最多 64 个字符，只能是小写字母、数字和连字符，并且要和目录名一致；
- **description**：最多 1024 个字符，说明这个 Skill 做什么、什么时候该用。

另外还有几个可选字段：`license`、`compatibility`（运行环境要求，比如需要 git 和网络）、`metadata`（任意键值对），以及一个标为实验性的 `allowed-tools`。frontmatter 之后是 Markdown 正文，格式不限，写什么能帮 Agent 把事情做好就写什么。

这个例子的 `SKILL.md` 大致是这样：

```markdown
---
name: blog-post
description: 按这个博客的约定把草稿整理成可发布的文章，包括 frontmatter、系列内链、
  内联 SVG 示意图和文末参考文献。当用户要写新文章、把笔记或草稿改成博客文章、
  给文章加图或加参考文献时使用。只是润色措辞、不涉及发布格式时不需要。
---

# 写博客文章

## 步骤
1. 复制 assets/post-template.md 到 src/content/posts/<slug>.md，填好 frontmatter；
2. 开头一段说明这篇和系列里哪几篇有关，用站内链接；
3. 示意图用 <figure class="diagram"> 包内联 SVG，只用已有的颜色类，
   具体写法见 references/diagrams.md；
4. 引用写成 <sup class="cite">，文末参考文献的格式见 references/citations.md；
5. 运行 python scripts/check_refs.py <文件>，有报错就改，直到通过；
6. 运行 npm run build，确认构建通过。

## 规则
- 不用 emoji，不用渐变、阴影这类装饰；
- 每条参考文献都要打开链接核对过标题、作者和年份；
- 数字要有出处，拿不准的写"约"。
```

这份文件里没有任何"代码"层面的新东西。它就是你会写给一个新同事的那种交接文档：先做什么，再做什么，哪些地方有坑，细节去哪里查。Skill 的设计重点不在这份文档本身，而在 **它什么时候、以多大的代价被模型看到**。

## 渐进式披露：为什么不直接写进系统提示词

最直接的做法，是把上面这些说明写进系统提示词，或者写进项目根目录的 `CLAUDE.md`、`AGENTS.md` 这类项目说明文件里。只有一两件事的时候，这样完全没问题。

问题在于数量。一个用得久的 Agent，可能需要知道怎么写博客、怎么处理 PDF 表单、怎么按公司模板做幻灯片、怎么跑数据库迁移、怎么发版。每一件都写一两千字，二十件就是几万 token，每一轮对话都要带着。这不只是钱的问题，[上下文管理](/posts/agent-context-management/#为什么装得下不等于用得好) 那篇讲过，无关的内容越多，模型越容易被干扰，真正相关的那几条反而不容易被注意到。

Skill 的解法叫 **渐进式披露（Progressive Disclosure）**<sup class="cite"><a href="#ref-1" title="Equipping agents for the real world with Agent Skills">1</a></sup>，把一个 Skill 的内容分成三层，每一层只在需要时才进入上下文：

1. **元数据**：所有 Skill 的 `name` 和 `description`，会话开始时就放进上下文。规范给的估计是每个 Skill 大约 100 token；
2. **正文**：模型判断某个 Skill 和当前任务相关时，才把整份 `SKILL.md` 读进来。规范建议正文控制在 5000 token 以内、500 行以内；
3. **资源**：正文里引用的参考文档、脚本、模板，只有在正文指向它们、而且任务确实用得上时才读，或者才执行。

<figure class="diagram">
<svg viewBox="0 0 640 290" role="img" aria-label="渐进式披露的三层：元数据始终在上下文里，正文在判断相关时读入，资源在需要时读入或执行">
<defs><marker id="sk2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0 0 L10 5 L0 10 z"/></marker></defs>
<text class="t" x="20" y="34">第一层 · 会话开始时</text>
<text class="ts" x="620" y="34" text-anchor="end">每个约 100 token</text>
<rect class="c-purple" x="20" y="46" width="66" height="34" rx="4"/><text class="ts" x="53" y="68" text-anchor="middle">blog-post</text>
<rect class="c-purple" x="96" y="46" width="66" height="34" rx="4"/><text class="ts" x="129" y="68" text-anchor="middle">pdf-forms</text>
<rect class="c-purple" x="172" y="46" width="66" height="34" rx="4"/><text class="ts" x="205" y="68" text-anchor="middle">slides</text>
<rect class="c-purple" x="248" y="46" width="66" height="34" rx="4"/><text class="ts" x="281" y="68" text-anchor="middle">db-migrate</text>
<rect class="c-purple" x="324" y="46" width="66" height="34" rx="4"/><text class="ts" x="357" y="68" text-anchor="middle">release</text>
<rect class="c-purple" x="400" y="46" width="66" height="34" rx="4"/><text class="ts" x="433" y="68" text-anchor="middle">……</text>
<text class="ts" x="480" y="60">只有 name 和</text>
<text class="ts" x="480" y="76">description</text>
<path class="ln" d="M53 82 V122" marker-end="url(#sk2)"/>
<text class="ts" x="62" y="106">模型判断"这件事用得上"</text>
<text class="t" x="20" y="146">第二层 · 判断相关时</text>
<text class="ts" x="620" y="146" text-anchor="end">建议 &lt; 5000 token</text>
<rect class="c-blue" x="20" y="158" width="294" height="34" rx="4"/><text class="ts" x="167" y="180" text-anchor="middle">blog-post/SKILL.md 的完整正文</text>
<path class="ln" d="M53 194 V234" marker-end="url(#sk2)"/>
<text class="ts" x="62" y="218">正文提到、而且这次用得上</text>
<text class="t" x="356" y="262">第三层 · 需要时</text>
<text class="ts" x="620" y="262" text-anchor="end">不设上限</text>
<rect class="c-amber" x="20" y="240" width="170" height="34" rx="4"/><text class="ts" x="105" y="262" text-anchor="middle">references/diagrams.md</text>
<rect class="c-green" x="200" y="240" width="140" height="34" rx="4"/><text class="ts" x="270" y="262" text-anchor="middle">check_refs.py 的输出</text>
</svg>
<figcaption>图 2：渐进式披露。装了二十个 Skill，每一轮固定付出的只是二十段简短的描述；某个 Skill 的正文和资源，只在用到它的那次会话里才付费。</figcaption>
</figure>

算一笔账：二十个 Skill，第一层合计大约两千 token；如果把它们的正文全写进系统提示词，可能是五六万 token。更重要的是第三层几乎没有上限。Anthropic 的文章里说，因为资源文件只在需要时才读，一个 Skill 能打包的内容 **实际上是没有上限的**<sup class="cite"><a href="#ref-1" title="Equipping agents for the real world with Agent Skills">1</a></sup>。一份几百页的 API 参考、一个很大的数据表，都可以放进 Skill 目录，只要正文告诉模型什么时候该去查哪一部分。

这个思路在 [上下文管理](/posts/agent-context-management/#手段五按需检索而不是预先塞满) 里讲过，叫"按需检索，而不是预先塞满"。Skill 的特别之处在于，**检索由模型自己完成，而检索的依据是一段人写的描述**。没有向量库，没有关键词匹配，模型读到目录，自己决定要不要打开。这让它非常简单，也让 description 变成了整个设计里最关键的一行字，后面会专门讲。

第三层里还有一个容易被忽略的区别：**脚本是执行的，不是读的。** Anthropic 举的例子是一个 PDF Skill，里面带了一个提取表单字段的 Python 脚本，Claude 可以直接运行它，脚本的源码和 PDF 本身都不需要进上下文<sup class="cite"><a href="#ref-1" title="Equipping agents for the real world with Agent Skills">1</a></sup>。排序、解析、格式校验这类事情，让代码来做比让模型逐个 token 生成更便宜，也更确定。

## 一次激活在 Harness 里是怎么发生的

从模型的角度看，"使用一个 Skill"并没有什么特殊的机制。agentskills.io 上有一份写给 Agent 开发者的实现指南<sup class="cite" id="cite-3"><a href="#ref-3" title="How to add skills support to your agent">3</a></sup>，把整个过程拆成了几步，读下来会发现，每一步用的都是 Agent 已经有的能力。

**第一步，发现。** 会话开始时，Harness 扫描几个约定的目录，找出所有包含 `SKILL.md` 的子目录。常见的是两个作用域：项目级（当前仓库里）和用户级（主目录下）。各家产品有自己的原生目录，比如 Claude Code 的 `.claude/skills/`；同时，`.agents/skills/` 逐渐成了跨产品共享的约定，OpenAI 的 Codex 就会从当前目录一路向上扫描到仓库根目录下的 `.agents/skills`<sup class="cite" id="cite-4"><a href="#ref-4" title="Codex: Agent Skills">4</a></sup>。重名的时候，通行的规则是项目级覆盖用户级。

**第二步，解析。** 读出每个 `SKILL.md` 的 frontmatter，记下 name、description 和文件路径。正文可以这时就读，也可以等到激活时再读。

**第三步，告诉模型有哪些 Skill。** 把所有 Skill 的 name、description 和路径整理成一个目录，放进系统提示词，或者放进一个专门的激活工具的描述里，再附上一小段说明："任务和某个 Skill 的描述吻合时，先读取它的 SKILL.md 再动手。"

**第四步，激活。** 有两种实现。一种是模型直接用读文件的工具去读 `SKILL.md`，不需要任何额外设施；另一种是注册一个专门的工具，比如 `activate_skill(name)`，好处是可以去掉 frontmatter、给内容包上标签、顺便列出目录里有哪些资源文件、在这里做权限检查。实现指南还建议把这个工具的 `name` 参数限定成一个枚举，免得模型编出一个不存在的 Skill 名字。

<figure class="diagram">
<svg viewBox="0 0 640 380" role="img" aria-label="一次 Skill 激活的时序：Harness 先把目录放进上下文，模型读取 SKILL.md，再执行脚本">
<defs><marker id="sk3" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0 0 L10 5 L0 10 z"/></marker></defs>
<rect class="c-gray" x="30" y="16" width="100" height="30" rx="4"/><text class="t" x="80" y="36" text-anchor="middle">用户</text>
<rect class="c-blue" x="200" y="16" width="100" height="30" rx="4"/><text class="t" x="250" y="36" text-anchor="middle">模型</text>
<rect class="c-purple" x="370" y="16" width="100" height="30" rx="4"/><text class="t" x="420" y="36" text-anchor="middle">Harness</text>
<rect class="c-amber" x="520" y="16" width="100" height="30" rx="4"/><text class="t" x="570" y="36" text-anchor="middle">Skill 目录</text>
<path class="ln dash" d="M80 48 V368"/>
<path class="ln dash" d="M250 48 V368"/>
<path class="ln dash" d="M420 48 V368"/>
<path class="ln dash" d="M570 48 V368"/>
<path class="ln" d="M568 74 H422" marker-end="url(#sk3)"/>
<text class="ts" x="495" y="68" text-anchor="middle">① 扫描 frontmatter</text>
<path class="ln" d="M418 104 H252" marker-end="url(#sk3)"/>
<text class="ts" x="335" y="98" text-anchor="middle">② 目录放进系统提示词</text>
<path class="ln" d="M82 142 H248" marker-end="url(#sk3)"/>
<text class="ts" x="165" y="136" text-anchor="middle">③ "把这篇草稿整理成文章"</text>
<path class="ln" d="M252 182 H418" marker-end="url(#sk3)"/>
<text class="ts" x="335" y="176" text-anchor="middle">④ read SKILL.md</text>
<path class="ln" d="M422 192 H568" marker-end="url(#sk3)"/>
<path class="ln" d="M568 208 H422" marker-end="url(#sk3)"/>
<path class="ln" d="M418 218 H252" marker-end="url(#sk3)"/>
<text class="ts" x="335" y="236" text-anchor="middle">正文作为工具结果返回</text>
<path class="ln" d="M252 268 H418" marker-end="url(#sk3)"/>
<text class="ts" x="335" y="262" text-anchor="middle">⑤ 运行 check_refs.py</text>
<path class="ln" d="M418 298 H252" marker-end="url(#sk3)"/>
<text class="ts" x="335" y="292" text-anchor="middle">输出："2 条引用缺链接"</text>
<path class="ln" d="M248 340 H82" marker-end="url(#sk3)"/>
<text class="ts" x="165" y="334" text-anchor="middle">⑥ 修好后交付</text>
</svg>
<figcaption>图 3：一次 Skill 激活。①② 发生在会话开始时，④ 是一次普通的读文件，⑤ 是一次普通的命令执行。</figcaption>
</figure>

除了模型自己决定，用户也应该能直接点名一个 Skill。最常见的写法是斜杠命令或者提及语法，比如 `/blog-post` 或 `$blog-post`，由 Harness 拦截下来，直接把正文注入上下文，模型不需要再做一次激活动作<sup class="cite"><a href="#ref-3" title="How to add skills support to your agent">3</a></sup>。Claude Code 后来干脆把自定义斜杠命令并进了 Skill：`.claude/commands/deploy.md` 和 `.claude/skills/deploy/SKILL.md` 都会生成 `/deploy`，行为一样<sup class="cite" id="cite-5"><a href="#ref-5" title="Claude Code Docs: Skills">5</a></sup>。它还加了一个 `disable-model-invocation` 字段，设为 `true` 的 Skill 只能由用户手动触发。发版、部署这种你不希望模型自己决定什么时候做的事，适合这样配置。

激活之后还有一个工程细节，和 [压缩](/posts/agent-context-management/#手段三压缩compaction) 有关。一个长任务做到一半，上下文满了，Harness 开始总结或丢弃早先的内容，如果刚好把 Skill 的正文压掉了，模型会继续干活，但已经不再按那份说明做事，而且不会有任何报错。实现指南的建议是把 Skill 内容标记为受保护的，压缩时跳过它<sup class="cite"><a href="#ref-3" title="How to add skills support to your agent">3</a></sup>。用专门的激活工具、给内容包上标签，这时就派上了用场。

## 它和工具、MCP、子 Agent、记忆是什么关系

Skill 刚出来的时候，很多讨论是"Skill 会不会取代 MCP"。我觉得这个问题问偏了。把这几样东西放在一张表里，会清楚很多：

| | 解决的问题 | 什么时候进上下文 | 通常由谁写 |
| --- | --- | --- | --- |
| 系统提示词、项目说明文件 | 每次都适用的规则和背景 | 始终 | 人 |
| Skill | 某一类任务该怎么做 | 判断相关时 | 人，也可以是 Agent |
| 工具、MCP | Agent 能调用什么 | 定义通常始终在 | 开发者 |
| 子 Agent | 在哪个上下文里做 | 委派时 | 开发者定义角色，父 Agent 写任务 |
| 记忆 | 关于用户和项目的事实 | 检索到时 | 多半是 Agent 自己 |

**工具给 Agent 手，Skill 教它怎么用这双手。** 一个 GitHub 的 MCP 服务器让 Agent 能建 issue、开 PR；一个 Skill 告诉它"在我们团队，PR 描述要按这个模板写，改了数据库表要先跑迁移检查，打这三个标签"。前者是能力，后者是做法。Anthropic 在文章结尾把"让 Skill 和 MCP 互补、教 Agent 使用外部工具的工作流"列为接下来的方向之一<sup class="cite"><a href="#ref-1" title="Equipping agents for the real world with Agent Skills">1</a></sup>。Skill 正文里提到 MCP 工具时，最好写全限定名，比如 `GitHub:create_issue`，否则装了多个服务器时模型可能找不到工具<sup class="cite" id="cite-6"><a href="#ref-6" title="Skill authoring best practices">6</a></sup>。

当然两者也有重叠的地方。一个包装了 CLI 的脚本，放进 Skill 里就是一个"工具"，只不过它的定义不常驻上下文，而是在 Skill 被激活后才出现。这正是 [MCP 还是 CLI](/posts/mcp-vs-cli/) 里讨论过的那种取舍：MCP 工具的定义一直占着上下文，换来的是结构化的调用；Skill 里的脚本按需出现，换来的是更省的上下文和更灵活的组合。[工具多了怎么办](/posts/agent-tools/#工具多了怎么办) 里提到的问题，有一部分可以通过把低频工具挪进 Skill 来缓解。

**Skill 和子 Agent 是正交的。** Skill 决定"按什么做法做"，子 Agent 决定"在哪个上下文里做"。两者可以组合：一个工作流很长、中间产物很多的 Skill，可以放到一个子 Agent 里跑，主线只拿回结果。Claude Code 的 Skill 支持 `context: fork`，激活时在一个分叉出来的子 Agent 里执行<sup class="cite"><a href="#ref-5" title="Claude Code Docs: Skills">5</a></sup>；实现指南也把这种"子 Agent 委派"列为一种可选的高级模式<sup class="cite"><a href="#ref-3" title="How to add skills support to your agent">3</a></sup>。反过来，[专用子 Agent](/posts/agent-subagents/#专用子-agent把委派变成可复用的角色) 那份定义文件，和 `SKILL.md` 长得几乎一样：frontmatter 里一段描述，正文是一份工作说明。区别在于子 Agent 带着自己的工具集和上下文，Skill 只是一份被读进当前上下文的说明。

**Skill 是人写的程序记忆。** [记忆](/posts/agent-memory/#先想清楚要记的到底是什么) 那篇讲的主要是事实性的记忆，比如用户的偏好、项目的约定，大多由 Agent 自己在对话中写下。Skill 存的是做法，而且主要由人来写、来审。

学术界其实很早就在做"让 Agent 积累技能"这件事。2023 年的 Voyager 在 Minecraft 里让 Agent 把学会的行为写成可执行的代码，存进一个不断增长的技能库，之后遇到类似的任务就检索出来复用<sup class="cite" id="cite-7"><a href="#ref-7" title="Voyager">7</a></sup>。Agent Workflow Memory 从过去的成功轨迹里归纳出可复用的工作流，在 WebArena 上把成功率相对提高了 51.1%<sup class="cite" id="cite-8"><a href="#ref-8" title="Agent Workflow Memory">8</a></sup>。这些工作里，技能是 Agent 自动生成、自动检索的。

今天的 Agent Skills 走的是另一条路：**技能主要由人写，以文件的形式存在，靠模型读描述来选择。** 它放弃了自动积累，换来的是可读、可审查、可以用 Git 管理和分享。后面讲评估时会看到，这个选择在目前是有道理的，因为模型自己写的 Skill，效果并不好。

## 写好 description：它决定 Skill 会不会被用上

一个 Skill 写得再好，没被触发就等于不存在。而触发与否，几乎完全取决于 description 这一段话。模型在第一层只看得到它，[工具描述](/posts/agent-tools/#描述最被低估的提示词) 那篇说过的"描述是最被低估的提示词"，在这里同样成立，甚至更严重：工具描述写得不好，模型可能用错；Skill 描述写得不好，模型根本不会去打开它。

几条我觉得最有用的原则：

**同时写清楚"做什么"和"什么时候用"。** 规范里给的反例是 `Helps with PDFs.`，正例是"从 PDF 中提取文字和表格、填写表单、合并文件。当处理 PDF 文档，或用户提到 PDF、表单、文档提取时使用"<sup class="cite"><a href="#ref-2" title="Agent Skills Specification">2</a></sup>。后半句列出的触发场景，往往比前半句更重要。

**写用户的意图，而不是实现细节。** 模型拿 description 去匹配的是用户说的话。用户会说"帮我把这些笔记整理成一篇文章"，不会说"请生成符合 Astro 内容集合规范的 Markdown 文件"。

**宁可积极一点。** agentskills.io 的指南建议明确列出适用的场景，包括用户没有直接点名这个领域的情况，比如"即使用户没有明确提到 CSV 或分析"<sup class="cite" id="cite-9"><a href="#ref-9" title="Optimizing skill descriptions">9</a></sup>。模型的默认倾向是能自己做就自己做，一个简单的"读一下这个 PDF"可能根本不会触发 PDF Skill，因为它用基础工具就能完成。

**也写清楚什么时候不用。** 上面例子里的"只是润色措辞、不涉及发布格式时不需要"，就是为了防止它在每次改错别字时都被拉进来。几个职责相近的 Skill 之间尤其需要这样的边界。

**把最关键的用途放在最前面。** 装的 Skill 多了，目录本身也会变长，有的产品会截断过长的描述。Claude Code 会把 description 加上补充说明截断在 1536 个字符<sup class="cite"><a href="#ref-5" title="Claude Code Docs: Skills">5</a></sup>。

有一处两份官方文档的说法不太一样：Anthropic 的写作指南建议 description 一律用第三人称，因为它会被注入系统提示词<sup class="cite"><a href="#ref-6" title="Skill authoring best practices">6</a></sup>；agentskills.io 的指南则建议用祈使句，"在……时使用这个 Skill"<sup class="cite"><a href="#ref-9" title="Optimizing skill descriptions">9</a></sup>。我的理解是两者要解决的是同一个问题：别写成"我可以帮你……"这种第一人称的自我介绍，它在系统提示词里读起来很别扭。至于用陈述还是祈使，不如交给下面要讲的触发评测去决定。

## 写好正文：只写模型不知道的

description 决定 Skill 会不会被打开，正文决定打开之后有没有用。Anthropic 的写作指南开头就有一句话："假设 Claude 已经很聪明了"<sup class="cite"><a href="#ref-6" title="Skill authoring best practices">6</a></sup>。正文一旦被读进来，每一个 token 都在和对话历史抢位置，所以只写模型自己不知道的东西。

"PDF 是一种文档格式"不用写，"我们的报销单第三页那个签名框，字段名叫 `sig_2` 而不是 `signature`"要写。"写博客要注意结构清晰"不用写，"这个博客的示意图只用 global.css 里那六个颜色类，不要自己加渐变"要写。真正值钱的内容，往往是那些你踩过坑才知道的、不在公开资料里的东西。

**具体程度要匹配任务有多脆弱。** 指南里打了个比方：一座两边都是悬崖的窄桥，需要一步一步的精确指令，比如数据库迁移；一片没有障碍的开阔地，给个大方向就够了，比如代码审查<sup class="cite"><a href="#ref-6" title="Skill authoring best practices">6</a></sup>。很多 Skill 写不好，是因为把开阔地也写成了窄桥，十几条"必须"和"禁止"，模型反而抓不住重点。

**给一个默认选项，再留一个出口。** 与其列出五个可以用的库让模型挑，不如写"用 pdfplumber 提取文字；如果是需要 OCR 的扫描件，改用 pdf2image 加 pytesseract"<sup class="cite"><a href="#ref-6" title="Skill authoring best practices">6</a></sup>。选项太多，模型每次都要重新做一遍本该由你做完的决定。

**多步骤的工作流写成清单，加上校验循环。** 上面例子里的第 5 步就是这个意思：跑校验脚本，有错就改，直到通过才能往下走。"运行校验、修复、重复"这种反馈循环，比在正文里写"请仔细检查引用格式"可靠得多，这和 [评测](/posts/agent-evaluation/#评结果而不是评路径) 那篇说的"能用代码判断就用代码"是一个道理。

**参考文件只引用一层。** 正文可以指向 `references/diagrams.md`，但 `diagrams.md` 最好别再指向第三个文件。指南观察到，引用链太深时，模型可能只用 `head` 看个开头就当作读完了；超过一百行的参考文件，最好在开头放一个目录<sup class="cite"><a href="#ref-6" title="Skill authoring best practices">6</a></sup>。

**说清楚脚本是拿来执行的，还是拿来读的。** "运行 `analyze_form.py` 提取字段"和"实现方式参考 `analyze_form.py`"，模型会做完全不同的事。脚本本身要自己处理错误，而不是把报错丢回给模型去猜；脚本里的常数也要写明来由，指南管这叫避免"巫毒常数"<sup class="cite"><a href="#ref-6" title="Skill authoring best practices">6</a></sup>。

**拆得小一点。** 一个 Skill 只管一类任务。"写博客"和"做幻灯片"是两个 Skill，而不是一个叫 `writing` 的大杂烩。名字也要具体，`helper`、`utils` 这种名字在目录里什么都说明不了。

## 怎么知道一个 Skill 有用

写 Skill 很容易产生一种错觉：说明写得这么详细，模型肯定会做得更好。实际情况不一定。评估一个 Skill，要分开看两件事：**它有没有在该触发的时候触发，以及触发之后结果有没有变好。**

### 触发评测

agentskills.io 给了一套很具体的做法<sup class="cite"><a href="#ref-9" title="Optimizing skill descriptions">9</a></sup>：

- 准备大约 20 条真实风格的用户请求，8 到 10 条应该触发，8 到 10 条不应该触发；
- 应该触发的那一组，要在措辞、明确程度、长短、复杂度上有变化，最有价值的是"这个 Skill 能帮上忙、但请求里没直接说"的情况；
- 不应该触发的那一组，最有价值的是 **近似但不同** 的请求，和 Skill 共享关键词，实际需要的是别的东西。"写一个斐波那契函数"这种毫不相干的反例，什么也测不出来；
- 每条跑 3 次，算触发率，以 0.5 为界；
- 按大约六比四分成训练集和验证集，只根据训练集的失败去改描述，最后按验证集的通过率选版本，避免描述过拟合到那几条具体的说法上。

这其实就是 [评测](/posts/agent-evaluation/#非确定性跑一次不算数) 那篇里讲过的东西，套在了一个很小的问题上：非确定性要多跑几次，评测集要防过拟合，负样本要选难的。

### 效果评测

Anthropic 的写作指南建议 **先写评测，再写文档**<sup class="cite"><a href="#ref-6" title="Skill authoring best practices">6</a></sup>：先让模型在不装 Skill 的情况下做几个有代表性的任务，看它在哪里出错，至少写三个评测，记下基线，然后只写够弥补这些差距的最少说明，再迭代。这和 [从真实失败开始](/posts/agent-evaluation/#从真实失败开始) 是同一个顺序。没有基线，你就无法区分"Skill 让它做对了"和"它本来就会做"。

指南还描述了一个很实用的迭代方式：用一个 Claude 实例和你一起写、改 Skill，再开一个全新的、装好了这个 Skill 的实例去做真实任务，观察它读了哪些文件、漏看了哪些引用、忽略了哪些说明，把观察带回去修改<sup class="cite"><a href="#ref-6" title="Skill authoring best practices">6</a></sup>。另外，要在你打算使用的每一个模型上都测一遍，小模型往往需要更多指导，大模型可能嫌你啰嗦。

### 一个系统性的测量

2026 年初的 SkillsBench 是我见过最系统的一次测量<sup class="cite" id="cite-10"><a href="#ref-10" title="SkillsBench">10</a></sup>。它在 8 个领域的 87 个任务上，比较了 18 种模型和 Harness 的组合在有、无 Skill 时的表现。几个结论很值得写 Skill 的人看一眼：

<figure class="diagram">
<svg viewBox="0 0 640 300" role="img" aria-label="SkillsBench 中不同条件下装上 Skill 后通过率的变化，单位为百分点">
<text class="ts" x="300" y="24" text-anchor="middle">0</text>
<path class="ln" d="M300 32 V272" style="stroke-width:1"/>
<text class="ts" x="20" y="24">装上 Skill 后通过率的变化（百分点）</text>
<g><title>整体：33.9% → 50.5%，+16.6 个百分点</title>
<text class="t" x="240" y="57" text-anchor="end">精选 Skill · 整体</text>
<rect class="c-blue" x="300" y="44" width="89.6" height="18" rx="2"/>
<text class="ts" x="396" y="57">+16.6</text></g>
<g><title>医疗领域：34.2% → 86.1%，+51.9 个百分点</title>
<text class="ts" x="240" y="89" text-anchor="end">领域：医疗</text>
<rect class="c-blue" x="300" y="76" width="280.3" height="18" rx="2"/>
<text class="ts" x="586" y="89">+51.9</text></g>
<g><title>软件工程领域：34.4% → 38.9%，+4.5 个百分点</title>
<text class="ts" x="240" y="121" text-anchor="end">领域：软件工程</text>
<rect class="c-blue" x="300" y="108" width="24.3" height="18" rx="2"/>
<text class="ts" x="331" y="121">+4.5</text></g>
<path class="ln" d="M40 140 H620" style="stroke:var(--border);stroke-width:1"/>
<g><title>写法详细的 Skill：+18.8 个百分点</title>
<text class="ts" x="240" y="165" text-anchor="end">写法：详细</text>
<rect class="c-blue" x="300" y="152" width="101.5" height="18" rx="2"/>
<text class="ts" x="408" y="165">+18.8</text></g>
<g><title>写法精简的 Skill：+17.1 个百分点</title>
<text class="ts" x="240" y="197" text-anchor="end">写法：精简</text>
<rect class="c-blue" x="300" y="184" width="92.3" height="18" rx="2"/>
<text class="ts" x="399" y="197">+17.1</text></g>
<g><title>面面俱到的 Skill：−2.9 个百分点</title>
<text class="ts" x="240" y="229" text-anchor="end">写法：面面俱到</text>
<rect class="c-gray" x="284.3" y="216" width="15.7" height="18" rx="2"/>
<text class="ts" x="278" y="229" text-anchor="end">−2.9</text></g>
<path class="ln" d="M40 248 H620" style="stroke:var(--border);stroke-width:1"/>
<g><title>模型做题前自己写的 Skill：平均 −1.3 个百分点</title>
<text class="ts" x="240" y="267" text-anchor="end">模型自己写的 Skill</text>
<rect class="c-gray" x="293" y="254" width="7" height="18" rx="2"/>
<text class="ts" x="287" y="267" text-anchor="end">−1.3</text></g>
</svg>
<figcaption>图 4：SkillsBench 的几组结果，数字都是相对"不装 Skill"的变化。前三行来自精选 Skill 的整体和分领域结果，中间三行按 Skill 的写法分组，最后一行是让模型在做题前自己写 Skill。各组的比较条件不完全相同，只适合看方向，不适合横向相加。</figcaption>
</figure>

1. **人工精选的 Skill 平均有用**：平均通过率从 33.9% 提高到 50.5%，提高 16.6 个百分点；不同配置之间，提升从 4.1 到 25.7 个百分点不等；
2. **领域差异非常大**：医疗领域从 34.2% 提高到 86.1%，软件工程只从 34.4% 提高到 38.9%。作者的解释是，预训练数据里覆盖得少的专门流程，Skill 帮助最大；模型本来就很熟悉的领域，Skill 能补的东西不多；
3. **面面俱到反而有害**：详细的 Skill 提高 18.8 个百分点，精简的提高 17.1，而事无巨细的"全面型"Skill 是负 2.9。最多包含三个模块的聚焦型 Skill，比大而全的 Skill 包效果更好；
4. **模型自己写的 Skill 没用**：让模型在做题前先给自己写一个 Skill，平均反而下降 1.3 个百分点。作者认为模型能意识到需要领域知识，但写出来的流程不够准确、不够完整；
5. **小模型加上 Skill，可以追平不加 Skill 的大模型**。

第 2 条和第 4 条合在一起看，结论其实很朴素：**Skill 的价值来自模型不知道的东西，而模型不知道的东西，它自己也写不出来。** 这也是为什么我觉得"只写模型不知道的"是写 Skill 最重要的一条原则，以及为什么 Skill 目前还主要是人写的。

## 安全：安装 Skill 就是安装依赖

一个 Skill 里有指令，也可能有脚本。指令会被模型当作工作说明来遵循，脚本会在你的机器上执行。从安全的角度看，装一个来路不明的 Skill，和 `pip install` 一个来路不明的包没有本质区别，甚至更糟：它还能用自然语言直接指挥你的 Agent。

Anthropic 在推出 Skill 时就提醒过，恶意的 Skill 可能引入漏洞，或者指使 Claude 把数据外传，建议只从可信来源安装，对不太可信的来源，要审查里面的每一个文件、依赖，以及任何连接外部网络的指令<sup class="cite"><a href="#ref-1" title="Equipping agents for the real world with Agent Skills">1</a></sup>。

2026 年 1 月的一篇实证研究把这个担心量化了<sup class="cite" id="cite-11"><a href="#ref-11" title="Agent Skills in the Wild">11</a></sup>。作者从两个 Skill 市场收集了 42,447 个 Skill，分析了其中 31,132 个，发现 **26.1% 至少含有一个漏洞**。漏洞分四类：提示词注入、数据外传、权限提升和供应链风险，其中数据外传（13.3%）和权限提升（11.8%）最常见。而且，带可执行脚本的 Skill 含有漏洞的可能性，是纯指令 Skill 的 2.12 倍。

<figure class="diagram">
<svg viewBox="0 0 640 250" role="img" aria-label="Skill 的来源离自己越远，安装前越要仔细审查，运行时越要依靠模型之外的边界">
<defs><marker id="sk5" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0 0 L10 5 L0 10 z"/></marker></defs>
<rect class="c-green" x="20" y="30" width="138" height="54" rx="6"/>
<text class="t" x="89" y="53" text-anchor="middle">自己写的</text><text class="ts" x="89" y="72" text-anchor="middle">用户级目录</text>
<rect class="c-blue" x="172" y="30" width="138" height="54" rx="6"/>
<text class="t" x="241" y="53" text-anchor="middle">团队仓库里的</text><text class="ts" x="241" y="72" text-anchor="middle">经过代码审查</text>
<rect class="c-amber" x="324" y="30" width="138" height="54" rx="6"/>
<text class="t" x="393" y="53" text-anchor="middle">公开市场下载的</text><text class="ts" x="393" y="72" text-anchor="middle">作者未知</text>
<rect class="c-red" x="476" y="30" width="144" height="54" rx="6"/>
<text class="t" x="548" y="53" text-anchor="middle">陌生仓库自带的</text><text class="ts" x="548" y="72" text-anchor="middle">克隆即生效？</text>
<path class="ln" d="M20 104 H618" marker-end="url(#sk5)"/>
<text class="ts" x="320" y="124" text-anchor="middle">来源离自己越远，信任越低</text>
<text class="ts" x="89" y="156" text-anchor="middle">照常使用</text>
<text class="ts" x="241" y="156" text-anchor="middle">和代码一起审查</text>
<text class="ts" x="393" y="148" text-anchor="middle">安装前读完每个文件</text>
<text class="ts" x="393" y="166" text-anchor="middle">尤其是脚本和网络访问</text>
<text class="ts" x="548" y="148" text-anchor="middle">默认不加载</text>
<text class="ts" x="548" y="166" text-anchor="middle">用户信任该目录后才加载</text>
<rect class="frame" x="20" y="190" width="600" height="44" rx="6"/>
<text class="ts" x="320" y="217" text-anchor="middle">不论来源：脚本在沙箱里跑，Skill 不能扩大 Agent 的权限，不可逆操作在模型之外确认</text>
</svg>
<figcaption>图 5：按来源决定审查的力度。最危险的往往不是你主动去下载的，而是随着一个仓库悄悄进来的。</figcaption>
</figure>

图里最右边那一格值得多说一句。项目级 Skill 放在仓库里，会随着代码一起被克隆下来。如果 Harness 一打开项目就自动加载它们，那么克隆一个陌生的开源仓库，就等于让一个陌生人往你的 Agent 的系统提示词里写了几段话。实现指南专门提到了这一点，建议只在用户把这个目录标记为可信之后，才加载项目级的 Skill<sup class="cite"><a href="#ref-3" title="How to add skills support to your agent">3</a></sup>。

其他几条，和这个系列前面讲过的一样：

- **Skill 内容也是一种持久化的注入面**，和 [记忆投毒](/posts/agent-memory/#安全记忆是一个持久化的注入面) 是同一种模式，区别只是记忆是 Agent 自己写进去的，Skill 是你装进去的；
- **`allowed-tools` 是便利，不是授权**。它的作用是让 Skill 激活后某些工具调用不必每次都问你，规范里也只把它标为实验性字段。它不应该让一个 Skill 获得 Agent 原本没有的权限，这和 [权限分级](/posts/agent-tools/#权限不是所有工具都一样危险) 的原则一致；
- **脚本在沙箱里跑**，不可逆的操作仍然要经过 [沙箱之外的确认](/posts/agent-sandbox/#三不可逆操作需要沙箱之外的确认)。不管 Skill 里写得多么理直气壮，"把这个文件上传到某个地址"都不应该在没有人确认的情况下发生。

## 不只是一家的功能

Skill 最初是 Claude 的功能，在 Claude.ai、Claude Code、Agent SDK 和开发者平台上都能用<sup class="cite"><a href="#ref-1" title="Equipping agents for the real world with Agent Skills">1</a></sup>。2025 年 12 月，Anthropic 把格式作为开放标准发布在 agentskills.io 上。现在 OpenAI 的 Codex 也明确说自己的 Skill 建立在这个开放标准之上，用的是同样的 `SKILL.md`，同样靠 description 来隐式触发，也支持用 `$` 显式点名<sup class="cite"><a href="#ref-4" title="Codex: Agent Skills">4</a></sup>。

对写 Skill 的人来说，这意味着同一个文件夹放进 `.agents/skills/`，就可能在好几个 Agent 里都能用。不过，规范只规定了文件夹里有什么，没有规定所有行为。`disable-model-invocation`、`context: fork` 这类字段是各家自己的扩展，换一个产品可能会被直接忽略。如果你的 Skill 依赖某个产品特有的行为，最好在 `compatibility` 字段里写清楚。

## 动手时的几条建议

1. **先找重复**。你第三次向 Agent 解释同一套做法的时候，就该把它写成 Skill 了；
2. **先跑基线**。不装 Skill 让模型做几次，记下它在哪里出错，Skill 只写够弥补这些差距的内容；
3. **description 写意图和边界**：做什么、什么时候用、什么时候不用，最重要的用途放最前面；
4. **正文只写模型不知道的**，具体程度匹配任务的脆弱程度，给默认选项而不是一串选项；
5. **一个 Skill 只管一类任务**，正文控制在 500 行以内，细节拆进参考文件，引用只走一层；
6. **能用代码做的交给脚本**，说清楚是执行还是阅读，正文里写好"校验、修复、重复"的循环；
7. **测触发也测效果**：20 条左右正反请求，反例选近似的，每条跑几次；效果和不装 Skill 的基线比；
8. **把 Skill 当依赖管理**：放进版本控制，和代码一起审查，外来的 Skill 读完再装，陌生仓库里的 Skill 默认不加载。

## 小结

1. **一个 Skill 是一个文件夹**：一份带 frontmatter 的 `SKILL.md`，加上可选的脚本、参考资料和模板；规范要求的字段只有 name 和 description；
2. **渐进式披露是核心设计**：元数据始终在上下文里，正文在判断相关时读入，资源在需要时读入或执行，所以可以装很多 Skill，而且单个 Skill 能打包的内容几乎没有上限；
3. **激活没有特殊机制**：Harness 负责发现和列目录，模型用读文件或一个激活工具把正文拿进来，脚本靠普通的命令执行；用户也可以直接点名；压缩时要保护 Skill 的内容；
4. **Skill 和工具、MCP、子 Agent、记忆各管一件事**：工具给能力，Skill 教做法，子 Agent 决定在哪个上下文里做，记忆存事实；它们可以组合，而不是互相取代；
5. **description 决定会不会被用上，正文决定用上之后有没有用**：前者写意图和边界，后者只写模型不知道的；
6. **评估要分触发和效果两头**；公开的测量显示，精选的 Skill 平均有明显帮助，但面面俱到的 Skill 和模型自己写的 Skill 都没有用；
7. **Skill 是一种依赖**：它的指令会被遵循，它的脚本会被执行，审查、信任和沙箱一样都不能少。

回到开头那个"程序记忆"的说法。把一件事怎么做写下来，本来就是人类传递经验最古老的办法，菜谱、操作手册、新员工的交接文档都是。Agent Skills 没有发明什么新东西，它只是认真回答了一个具体的问题：**一份交接文档，怎样才能在不占用注意力的前提下，在恰好需要的时候被读到。**

## 参考文献

<section class="refs">
<ol>
<li id="ref-1"><span class="ref-n">[1]</span><span>Zhang B., Lazuka K., Murag M. <a href="https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills">Equipping agents for the real world with Agent Skills</a>. <i>Anthropic Engineering Blog</i>, 2025. <a class="ref-back" href="#cite-1" aria-label="回到正文">↩</a></span></li>
<li id="ref-2"><span class="ref-n">[2]</span><span><a href="https://agentskills.io/specification">Agent Skills Specification</a>. <i>agentskills.io</i>, 2025. <a class="ref-back" href="#cite-2" aria-label="回到正文">↩</a></span></li>
<li id="ref-3"><span class="ref-n">[3]</span><span><a href="https://agentskills.io/client-implementation/adding-skills-support">How to add skills support to your agent</a>. <i>agentskills.io</i>. <a class="ref-back" href="#cite-3" aria-label="回到正文">↩</a></span></li>
<li id="ref-4"><span class="ref-n">[4]</span><span>OpenAI. <a href="https://developers.openai.com/codex/skills">Agent Skills</a>. <i>Codex Documentation</i>. <a class="ref-back" href="#cite-4" aria-label="回到正文">↩</a></span></li>
<li id="ref-5"><span class="ref-n">[5]</span><span>Anthropic. <a href="https://code.claude.com/docs/en/skills">Skills</a>. <i>Claude Code Documentation</i>. <a class="ref-back" href="#cite-5" aria-label="回到正文">↩</a></span></li>
<li id="ref-6"><span class="ref-n">[6]</span><span>Anthropic. <a href="https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices">Skill authoring best practices</a>. <i>Claude Documentation</i>. <a class="ref-back" href="#cite-6" aria-label="回到正文">↩</a></span></li>
<li id="ref-7"><span class="ref-n">[7]</span><span>Wang G. et al. <a href="https://arxiv.org/abs/2305.16291">Voyager: An Open-Ended Embodied Agent with Large Language Models</a>. <i>arXiv</i>, 2023. <a class="ref-back" href="#cite-7" aria-label="回到正文">↩</a></span></li>
<li id="ref-8"><span class="ref-n">[8]</span><span>Wang Z. Z. et al. <a href="https://arxiv.org/abs/2409.07429">Agent Workflow Memory</a>. <i>ICML</i>, 2025. <a class="ref-back" href="#cite-8" aria-label="回到正文">↩</a></span></li>
<li id="ref-9"><span class="ref-n">[9]</span><span><a href="https://agentskills.io/skill-creation/optimizing-descriptions">Optimizing skill descriptions</a>. <i>agentskills.io</i>. <a class="ref-back" href="#cite-9" aria-label="回到正文">↩</a></span></li>
<li id="ref-10"><span class="ref-n">[10]</span><span>Li X. et al. <a href="https://arxiv.org/abs/2602.12670">SkillsBench: Benchmarking How Well Agent Skills Work Across Diverse Tasks</a>. <i>arXiv</i>, 2026. <a class="ref-back" href="#cite-10" aria-label="回到正文">↩</a></span></li>
<li id="ref-11"><span class="ref-n">[11]</span><span>Liu Y. et al. <a href="https://arxiv.org/abs/2601.10338">Agent Skills in the Wild: An Empirical Study of Security Vulnerabilities at Scale</a>. <i>arXiv</i>, 2026. <a class="ref-back" href="#cite-11" aria-label="回到正文">↩</a></span></li>
</ol>
</section>
