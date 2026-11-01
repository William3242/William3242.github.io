---
title: Agent Harness：模型之外的一切
description: 同一个模型，换一套 Harness，评测分数可以差十几个点。这篇专门讲 Harness：它到底包括什么，为什么它和模型一样决定 Agent 的上限，引导和反馈两类控制怎么搭配，钩子怎么把确定性插进循环，长任务怎么跨过上下文窗口，为什么要把生成和评估分开，"Harness Engineering"在仓库层面意味着什么，以及模型变强以后 Harness 会不会变薄。
pubDate: 2026-10-31
tags: [Agent, LLM, 架构]
---

在 [搭建 Agent 的基础知识](/posts/agent-basics/#最小的-agent-循环) 里，我用一小段话带过了 Harness：最大步数和预算、错误处理和截断、权限检查、日志追踪，然后说了一句"很多 Agent 产品之间的差距，与其说在模型，不如说在 Harness"。

之后写的几篇其实一直在讲 Harness 的某一块：[工具](/posts/agent-tools/) 讲执行权为什么在 Harness 手里，[上下文管理](/posts/agent-context-management/) 讲 Harness 往窗口里放什么，[子 Agent](/posts/agent-subagents/) 讲 Harness 怎么再开一个循环，[Skills](/posts/agent-skills/#一次激活在-harness-里是怎么发生的) 讲 Harness 怎么发现和加载一份说明。这篇把它们拼回到一起，回答几个一直没正面回答的问题：Harness 的边界在哪里，它为什么重要，以及怎么系统地把它做好。

## Harness 是什么：模型之外的一切

Harness 原意是马具，套在马身上、让人能驾驭它的那一整套东西。马跑得多快取决于马，往哪里跑、什么时候停，取决于缰绳。

放到 Agent 上，最干脆的定义来自 LangChain 的一篇文章<sup class="cite" id="cite-1"><a href="#ref-1" title="The Anatomy of an Agent Harness">1</a></sup>：

> **Agent = 模型 + Harness。** 如果你不是模型，你就是 Harness。

也就是说，**除了模型权重本身，所有的代码、配置和执行逻辑都算 Harness**：系统提示词、工具和它们的描述、文件系统和沙箱、子 Agent 的编排、压缩和续跑这些确定性的逻辑。各家现在也都这么叫：OpenAI 把 Codex CLI 里"提供核心 Agent 循环和执行逻辑"的那部分称为 Codex harness<sup class="cite" id="cite-2"><a href="#ref-2" title="Unrolling the Codex agent loop">2</a></sup>，Anthropic 把 Claude Agent SDK 称为"一个强大的通用 Agent Harness"<sup class="cite" id="cite-3"><a href="#ref-3" title="Effective harnesses for long-running agents">3</a></sup>。

<figure class="diagram">
<svg viewBox="0 0 640 300" role="img" aria-label="模型位于中心，周围是 Harness 的各个组成部分，最外层是环境">
<rect class="frame" x="10" y="10" width="620" height="280" rx="8"/>
<text class="ts" x="26" y="30">环境：文件系统 · 沙箱 · 网络 · 外部服务</text>
<rect class="c-gray" x="30" y="40" width="580" height="234" rx="6"/>
<text class="t" x="46" y="60">Harness</text>
<rect class="c-amber" x="50" y="72" width="160" height="46" rx="4"/>
<text class="t" x="130" y="91" text-anchor="middle">上下文组装</text>
<text class="ts" x="130" y="109" text-anchor="middle">提示词 · 历史 · 缓存</text>
<rect class="c-amber" x="240" y="72" width="160" height="46" rx="4"/>
<text class="t" x="320" y="91" text-anchor="middle">循环与停止</text>
<text class="ts" x="320" y="109" text-anchor="middle">步数 · 预算 · 超时</text>
<rect class="c-amber" x="430" y="72" width="160" height="46" rx="4"/>
<text class="t" x="510" y="91" text-anchor="middle">工具与执行</text>
<text class="ts" x="510" y="109" text-anchor="middle">定义 · 调用 · 结果</text>
<rect class="c-red" x="50" y="137" width="160" height="46" rx="4"/>
<text class="t" x="130" y="156" text-anchor="middle">权限与钩子</text>
<text class="ts" x="130" y="174" text-anchor="middle">拦截 · 确认 · 改写</text>
<rect class="c-blue" x="250" y="132" width="140" height="56" rx="6"/>
<text class="t" x="320" y="156" text-anchor="middle">模型</text>
<text class="ts" x="320" y="176" text-anchor="middle">决定"做什么"</text>
<rect class="c-purple" x="430" y="137" width="160" height="46" rx="4"/>
<text class="t" x="510" y="156" text-anchor="middle">状态与交接</text>
<text class="ts" x="510" y="174" text-anchor="middle">进度文件 · git · 记忆</text>
<rect class="c-green" x="50" y="202" width="160" height="46" rx="4"/>
<text class="t" x="130" y="221" text-anchor="middle">验证与反馈</text>
<text class="ts" x="130" y="239" text-anchor="middle">测试 · lint · 评审者</text>
<rect class="c-purple" x="240" y="202" width="160" height="46" rx="4"/>
<text class="t" x="320" y="221" text-anchor="middle">编排</text>
<text class="ts" x="320" y="239" text-anchor="middle">子 Agent · 模型路由</text>
<rect class="c-gray" x="430" y="202" width="160" height="46" rx="4"/>
<text class="t" x="510" y="221" text-anchor="middle">可观测性</text>
<text class="ts" x="510" y="239" text-anchor="middle">日志 · 轨迹 · 成本</text>
</svg>
<figcaption>图 1：模型只占中间一小块。它看到的每一个 token、能做的每一个动作、什么时候停下，都由外面这一层决定。</figcaption>
</figure>

有两个容易混的词顺便分开。**评测里也有 harness**，比如跑基准测试的那套脚本，它负责把任务喂给 Agent、收集结果、打分，在 [Agent 评测](/posts/agent-evaluation/) 里讲过。**这篇说的是 Agent 自己的 Harness**，它跟着 Agent 一起上线，用户每一次使用都在经过它。两者有交集：同一个 Agent 换一个评测 harness 跑分可能不同，换一个 Agent Harness 跑分**一定**不同。

## 同一个模型，换一套 Harness

说 Harness 和模型一样重要，听起来像是给工程师找存在感。但这件事有相当直接的证据。

**SWE-agent（2024）** 是较早把这件事讲清楚的论文。它没有改模型，而是给模型设计了一套专门的"Agent-计算机接口"（ACI）：带行号的文件查看器、有语法检查的编辑命令、会截断过长结果的搜索。论文明确在研究"接口设计怎样影响语言模型 Agent 的表现"，结论是这套接口显著提升了 Agent 创建和编辑代码文件的能力<sup class="cite" id="cite-4"><a href="#ref-4" title="SWE-agent">4</a></sup>。

**Anthropic 在《Building Effective Agents》里** 说过一句很有代表性的话：为 SWE-bench 搭 Agent 时，"我们花在优化工具上的时间，实际上比花在整体提示词上的还多"。其中一个改动是让工具强制要求绝对路径，因为模型离开根目录之后经常把相对路径搞错；改完之后，模型"用得毫无差错"<sup class="cite" id="cite-5"><a href="#ref-5" title="Building effective agents">5</a></sup>。

**LangChain 在 2026 年初做了一次更干净的对照**：模型固定为 gpt-5.2-codex，只改 Harness，他们的编码 Agent 在 Terminal Bench 2.0 上从 52.8% 提到了 66.5%，排名从三十名开外进了前五<sup class="cite" id="cite-6"><a href="#ref-6" title="Improving Deep Agents with harness engineering">6</a></sup>。改动里没有一条是"换个更好的提示词"这么简单，后面讲钩子时会具体说。

这三件事说的是同一个道理：**模型的能力是一个上限，Harness 决定你能摸到这个上限的多少。** LangChain 那篇文章的说法是，Harness 的目标是"把模型参差不齐的智能，塑造成适合我们关心的任务的形状"<sup class="cite"><a href="#ref-6" title="Improving Deep Agents with harness engineering">6</a></sup>。模型在有些地方强得惊人，在另一些地方又会犯很初级的错，Harness 的工作就是把强的地方用上，把弱的地方兜住。

## 拆开一个 Harness

图 1 里的每一块，前面的文章大多单独讲过，这里只说它们作为 Harness 的一部分，各自承担什么责任。

**循环与停止条件。** 最核心的那个 `while` 循环，加上什么时候停：模型不再调用工具、达到最大步数、超出 token 或金额预算、超时、用户打断。停止条件写在 Harness 里，而不是指望模型自己说"我做完了"，因为它会过早宣布完成，下面讲长任务时会看到具体例子。

**上下文组装。** 每一轮请求发给模型的到底是什么，是 Harness 拼出来的。Codex 的做法很有代表性：在用户请求前面插入几条消息，分别是沙箱权限说明、可选的开发者指令、从各级目录汇总来的 `AGENTS.md`，以及当前工作目录和 shell 这类环境信息<sup class="cite"><a href="#ref-2" title="Unrolling the Codex agent loop">2</a></sup>。拼法本身也有讲究。缓存只在**前缀完全一致**时才命中，所以对话中途换工具列表、换模型、改沙箱或审批模式，都会让缓存失效；Codex 的办法是**只追加、不修改**，状态变了就在末尾追加一条新消息，而不是回头改前面的内容<sup class="cite"><a href="#ref-2" title="Unrolling the Codex agent loop">2</a></sup>。Manus 的团队把 KV 缓存命中率称为生产环境 Agent"最重要的单一指标"，他们的输入输出 token 比大约是 100:1，缓存和不缓存的输入价格差十倍<sup class="cite" id="cite-7"><a href="#ref-7" title="Context Engineering for AI Agents: Lessons from Building Manus">7</a></sup>。这部分在 [上下文管理](/posts/agent-context-management/#一个容易被忽略的约束缓存) 里有更细的账。

**工具与执行。** 工具定义怎么写、结果怎么返回、错误怎么处理，见 [Agent 的工具](/posts/agent-tools/)。站在 Harness 的角度只强调一点：**模型只是提出调用，执行权在 Harness 手里。** 它可以执行、拒绝、改写参数，或者停下来问人。

**权限与沙箱。** 哪些操作直接放行，哪些要确认，哪些一律不许；命令在什么样的隔离环境里跑，能不能上网，凭证在不在里面。这些见 [权限分级](/posts/agent-tools/#权限不是所有工具都一样危险) 和 [Agent 沙箱](/posts/agent-sandbox/)。

**状态与交接。** 上下文窗口会满，会话会结束，下一个循环要从哪里接着做，靠的是 Harness 留在窗口之外的东西：进度文件、git 历史、[记忆](/posts/agent-memory/)、[计划文件](/posts/agent-planning-reasoning/#把计划写下来待办清单与计划文件)。

**验证与反馈。** 测试、类型检查、lint、构建，以及一个专门挑错的评审者。模型能不能自己纠错，很大程度上取决于 Harness 给不给它可靠的外部信号，这一点在 [规划与推理](/posts/agent-planning-reasoning/#反思与自我纠错外部信号才是关键) 里讨论过。

**编排。** 什么时候开 [子 Agent](/posts/agent-subagents/)，给它什么工具，规划用哪个模型、执行用哪个模型。

**可观测性。** 每一轮发了什么、模型回了什么、调用了哪个工具、花了多少钱。没有这一层，上面所有的改进都无从谈起，因为你不知道 Agent 在哪里出的错。[去读轨迹](/posts/agent-evaluation/#去读轨迹) 是改进 Harness 最可靠的起点。

## 两类控制：引导和反馈

组件按功能列出来，容易变成一张清单。换个角度看会更清楚：**Harness 里的每一样东西，本质上都是在控制模型的行为**，只是控制的时机和方式不同。

Thoughtworks 的 Birgitta Böckeler 在 Martin Fowler 网站上的文章里，给了一个很好用的分类<sup class="cite" id="cite-8"><a href="#ref-8" title="Harness engineering for coding agent users">8</a></sup>。按时机分：

- **引导（guides，前馈）**：在 Agent 行动之前预判它的行为，提前把它引到对的方向上；
- **反馈（sensors，传感器）**：在 Agent 行动之后观察结果，帮它自我纠正。

按执行者分：

- **计算型**：确定性的、快的，由 CPU 跑，比如测试、类型检查、lint；
- **推理型**：由模型来判断，比如让另一个模型审查代码，结果更灵活，但也更不确定。

两两组合，就是一张 2×2 的表：

<figure class="diagram">
<svg viewBox="0 0 640 270" role="img" aria-label="按引导与反馈、计算型与推理型划分的四类 Harness 控制及例子">
<text class="t" x="257" y="34" text-anchor="middle">计算型：确定、快、便宜</text>
<text class="t" x="500" y="34" text-anchor="middle">推理型：灵活、慢、不确定</text>
<text class="t" x="30" y="94">引导</text>
<text class="ts" x="30" y="114">行动之前</text>
<text class="t" x="30" y="199">反馈</text>
<text class="ts" x="30" y="219">行动之后</text>
<rect class="c-blue" x="140" y="48" width="235" height="98" rx="6"/>
<text class="ts" x="156" y="78">项目脚手架 · 代码模板</text>
<text class="ts" x="156" y="100">类型定义 · 受限的工具参数</text>
<text class="ts" x="156" y="122">权限规则 · 沙箱配置</text>
<rect class="c-purple" x="385" y="48" width="235" height="98" rx="6"/>
<text class="ts" x="401" y="78">AGENTS.md · Skill</text>
<text class="ts" x="401" y="100">系统提示词里的约定</text>
<text class="ts" x="401" y="122">计划文件 · 任务规格</text>
<rect class="c-green" x="140" y="156" width="235" height="98" rx="6"/>
<text class="ts" x="156" y="186">测试 · 类型检查 · lint</text>
<text class="ts" x="156" y="208">结构测试 · 构建</text>
<text class="ts" x="156" y="230">钩子里跑的脚本检查</text>
<rect class="c-amber" x="385" y="156" width="235" height="98" rx="6"/>
<text class="ts" x="401" y="186">评审 Agent · 模型打分</text>
<text class="ts" x="401" y="208">在浏览器里点一遍的评估者</text>
<text class="ts" x="401" y="230">人工审查</text>
</svg>
<figcaption>图 2：引导在模型行动之前塑造它，反馈在之后纠正它。分类来自 Böckeler<sup class="cite"><a href="#ref-8" title="Harness engineering for coding agent users">8</a></sup>，例子是我补的。</figcaption>
</figure>

这张表有几个用法。

**第一，两列都要有。** 只有引导，Agent 读了一堆规则，但不知道自己有没有遵守；只有反馈，Agent 会反复犯同一个错，再被同一个检查拦下来，白白浪费轮次。规则写进 `AGENTS.md`，同时用一条 lint 去检查它，两边互相加固。

**第二，能放左边的，别只放右边。** 计算型的控制便宜、快、每次结果一样，适合放在每一步之后都跑；推理型的控制贵、慢、有噪声，适合放在关键节点。"函数不能超过 200 行"这种规则，写一个脚本检查，比写进提示词再请另一个模型审查可靠得多。

**第三，反馈信息本身也是引导。** OpenAI 的团队在自定义 lint 的报错信息里直接写上修复方法，这样报错一进上下文，就成了下一步该怎么改的说明<sup class="cite" id="cite-9"><a href="#ref-9" title="Harness engineering: leveraging Codex in an agent-first world">9</a></sup>。这和 [工具的错误信息要告诉它怎么改](/posts/agent-tools/#错误信息告诉它怎么改) 是同一个原则。

Böckeler 还提了一个词，**可驾驭性（harnessability）**：不是每个代码库都同样适合套上 Harness<sup class="cite"><a href="#ref-8" title="Harness engineering for coding agent users">8</a></sup>。有强类型、有测试、有清晰模块边界的代码库，左下角那一格天然就是满的；一个没有测试、到处是隐式约定的老项目，Agent 在里面几乎拿不到任何可靠的反馈，只能靠右边一列硬撑。

## 钩子：把确定性插进循环

"在模型行动之前或之后跑一段代码"，落到实现上就是**钩子（hooks）**，有的框架叫中间件（middleware）。它是 Harness 里把确定性逻辑插进循环最直接的方式。

以 Claude Code 为例，它在循环的各个节点都开放了钩子：会话开始、用户提交提示词、工具调用前、工具调用后、压缩前、准备停止时，等等<sup class="cite" id="cite-10"><a href="#ref-10" title="Claude Code Docs: Hooks">10</a></sup>。

<figure class="diagram">
<svg viewBox="0 0 640 300" role="img" aria-label="Agent 循环中可以挂钩子的位置：会话开始、压缩前、工具调用前、工具调用后、停止前">
<defs><marker id="hk1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0 0 L10 5 L0 10 z"/></marker></defs>
<rect class="c-gray" x="80" y="100" width="110" height="44" rx="4"/>
<text class="t" x="135" y="127" text-anchor="middle">组装上下文</text>
<rect class="c-blue" x="230" y="100" width="110" height="44" rx="4"/>
<text class="t" x="285" y="127" text-anchor="middle">模型推理</text>
<rect class="c-gray" x="390" y="100" width="110" height="44" rx="4"/>
<text class="t" x="445" y="127" text-anchor="middle">执行工具</text>
<rect class="c-green" x="540" y="100" width="80" height="44" rx="4"/>
<text class="t" x="580" y="127" text-anchor="middle">结束</text>
<path class="ln" d="M20 122 H78" marker-end="url(#hk1)"/>
<path class="ln" d="M190 122 H228" marker-end="url(#hk1)"/>
<path class="ln" d="M340 122 H388" marker-end="url(#hk1)"/>
<text class="ts" x="364" y="98" text-anchor="middle">tool_use</text>
<path class="ln" d="M445 144 V190 H135 V146" marker-end="url(#hk1)"/>
<text class="ts" x="290" y="206" text-anchor="middle">tool_result</text>
<path class="ln" d="M285 100 V60 H580 V98" marker-end="url(#hk1)"/>
<text class="ts" x="420" y="52" text-anchor="middle">没有工具调用</text>
<path class="ln dash" d="M580 144 V232 H105 V146" marker-end="url(#hk1)"/>
<text class="ts" x="342" y="248" text-anchor="middle">停止钩子拒绝：把原因喂回去，继续干</text>
<circle class="c-amber" cx="48" cy="122" r="9"/><text class="ts" x="48" y="126" text-anchor="middle">1</text>
<circle class="c-amber" cx="190" cy="100" r="9"/><text class="ts" x="190" y="104" text-anchor="middle">2</text>
<circle class="c-amber" cx="366" cy="122" r="9"/><text class="ts" x="366" y="126" text-anchor="middle">3</text>
<circle class="c-amber" cx="445" cy="168" r="9"/><text class="ts" x="445" y="172" text-anchor="middle">4</text>
<circle class="c-amber" cx="520" cy="60" r="9"/><text class="ts" x="520" y="64" text-anchor="middle">5</text>
<text class="ts" x="320" y="276" text-anchor="middle">1 SessionStart · UserPromptSubmit　　2 PreCompact　　3 PreToolUse</text>
<text class="ts" x="320" y="294" text-anchor="middle">4 PostToolUse　　5 Stop　　（钩子名以 Claude Code 为例）</text>
</svg>
<figcaption>图 3：钩子挂在循环的关键节点上。最有用的两个是工具调用前（拦截）和停止前（不让它过早收工）。</figcaption>
</figure>

钩子的力量在于它**不经过模型的判断**。一个 `PreToolUse` 钩子以退出码 2 结束，这次工具调用就被拦下，钩子的 stderr 会作为原因交给模型；而且即使钩子同时输出了"允许"的 JSON，退出码 2 照样拦截<sup class="cite"><a href="#ref-10" title="Claude Code Docs: Hooks">10</a></sup>。模型被说服了、被注入了、或者单纯理解错了，都绕不过去。

`Stop` 钩子更有意思。它在 Agent 准备结束时触发，退出码 2 的效果是**不让它停**，把原因喂回去让它继续<sup class="cite"><a href="#ref-10" title="Claude Code Docs: Hooks">10</a></sup>。文档里的例子就是"构建没过就不许收工"：

```bash
#!/bin/bash
# Stop 钩子：构建失败时让 Agent 继续修
if ! npm run build --silent >/dev/null 2>&1; then
  echo "构建失败，修好再结束。" >&2
  exit 2
fi
exit 0
```

这几行代码做的事，是把"做完之前先验证"从一句提示词里的叮嘱，变成了一条**强制的**规则。

前面提到的 LangChain 那次 13.7 个点的提升，大部分改动也是钩子形状的<sup class="cite"><a href="#ref-6" title="Improving Deep Agents with harness engineering">6</a></sup>：

- **退出前检查清单**：Agent 准备结束时拦下来，要求它对照任务规格做一遍验证；
- **启动时注入环境**：一开始就把工作目录和附近目录的结构放进上下文，并告诉它"你的结果会被程序化的测试打分"；
- **时间预算提醒**：快到时限时插一条提醒，让它从继续开发转向验证；
- **死循环检测**：统计每个文件被编辑了多少次，同一个文件改到第 N 次时，插一条"要不要换个思路"的提示；
- **分阶段的思考预算**：规划和验证用最高档的推理，实现阶段用低一档。全程最高档反而只有 53.9%，因为太多任务超时了，全程高档是 63.6%。

注意这些改动的共同点：**它们都不是更聪明的提示词，而是在循环的特定时刻插进来的一段确定性逻辑。** 模型知道"应该验证"，但它不一定在对的时候想起来；钩子保证它在对的时候被提醒，或者被强制。

最后一条还说明了一件事：**Harness 的旋钮不全是"加"**。推理预算开得越大不一定越好，Harness 的工作是在对的阶段给对的量，这和 [思考预算](/posts/agent-planning-reasoning/#思考预算想多久合适) 那一节说的一样。

## 长任务：跨过上下文窗口

一个任务要做几个小时，就一定会跨过好几个上下文窗口。窗口之间什么都不记得，下一个窗口里的模型像是一个刚到岗、没有任何交接的新同事。这时候，Harness 几乎是唯一能让工作延续下去的东西。

Anthropic 在 2025 年底的一篇文章里，记录了让 Agent 从零做一个 claude.ai 克隆的过程<sup class="cite"><a href="#ref-3" title="Effective harnesses for long-running agents">3</a></sup>。只给一句高层的需求、让 Opus 4.5 在 Agent SDK 里循环跑，结果有两种典型的失败：

- **一口气做太多**：试图一次把整个应用写出来，做到一半上下文用完，留下一个写了一半、没有任何记录的功能，下一个窗口只能猜；
- **过早宣布胜利**：后面的窗口看到已经有了不少进展，就认定项目做完了。

他们的解法完全在 Harness 层面，而且出乎意料地朴素：

<figure class="diagram">
<svg viewBox="0 0 640 250" role="img" aria-label="初始化会话写出交接物，之后每个编码会话先读交接物，完成一个功能后再写回">
<defs><marker id="hk2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0 0 L10 5 L0 10 z"/></marker></defs>
<rect class="c-purple" x="20" y="30" width="170" height="56" rx="6"/>
<text class="t" x="105" y="54" text-anchor="middle">会话 1：初始化</text>
<text class="ts" x="105" y="74" text-anchor="middle">搭环境 · 列功能清单</text>
<rect class="c-blue" x="235" y="30" width="170" height="56" rx="6"/>
<text class="t" x="320" y="54" text-anchor="middle">会话 2：编码</text>
<text class="ts" x="320" y="74" text-anchor="middle">只做一个功能</text>
<rect class="c-blue" x="450" y="30" width="170" height="56" rx="6"/>
<text class="t" x="535" y="54" text-anchor="middle">会话 N：编码</text>
<text class="ts" x="535" y="74" text-anchor="middle">只做一个功能</text>
<path class="ln dash" d="M192 58 H233" marker-end="url(#hk2)"/>
<path class="ln dash" d="M407 58 H448" marker-end="url(#hk2)"/>
<text class="ts" x="212" y="22" text-anchor="middle">清空</text>
<text class="ts" x="427" y="22" text-anchor="middle">清空 …</text>
<path class="ln" d="M105 88 V148" marker-end="url(#hk2)"/>
<text class="ts" x="113" y="122">写</text>
<path class="ln" d="M300 148 V88" marker-end="url(#hk2)"/>
<text class="ts" x="292" y="122" text-anchor="end">读</text>
<path class="ln" d="M340 88 V148" marker-end="url(#hk2)"/>
<text class="ts" x="348" y="122">写</text>
<path class="ln" d="M515 148 V88" marker-end="url(#hk2)"/>
<text class="ts" x="507" y="122" text-anchor="end">读</text>
<path class="ln" d="M555 88 V148" marker-end="url(#hk2)"/>
<text class="ts" x="563" y="122">写</text>
<rect class="c-gray" x="20" y="150" width="600" height="80" rx="6"/>
<text class="t" x="40" y="174">仓库里的交接物</text>
<text class="ts" x="40" y="196">feature_list.json：200 多条功能，初始全部标记为未通过，只许改 passes 字段</text>
<text class="ts" x="40" y="217">claude-progress.txt · 带说明的 git 提交 · 一键启动开发环境的 init.sh</text>
</svg>
<figcaption>图 4：每个窗口之间什么都不记得，延续性全靠写在仓库里的交接物。改编自 Anthropic 的长任务 Harness<sup class="cite"><a href="#ref-3" title="Effective harnesses for long-running agents">3</a></sup>。</figcaption>
</figure>

**第一个会话专门做初始化。** 它和后面的会话用的是同一套系统提示词、同一套工具、同一个 Harness，只有第一条用户提示词不同<sup class="cite"><a href="#ref-3" title="Effective harnesses for long-running agents">3</a></sup>。它要做的是：写一个启动开发环境的 `init.sh`，建一个进度日志 `claude-progress.txt`，做第一次 git 提交，再把需求展开成一份 200 多条的功能清单，每一条都标记为"未通过"。

**之后每个会话只做一个功能。** 开工前有固定的几步：`pwd` 确认目录；读 git 日志和进度文件；读功能清单，挑优先级最高的未完成项；跑 `init.sh` 启动服务，先做一次基本的端到端测试，确认没有被上一个会话弄坏，再开始新的工作。做完之后提交代码、更新进度。

几个细节很能说明 Harness 设计的思路：

- **功能清单用 JSON 而不是 Markdown**，因为模型不太会随手改写或覆盖一个 JSON 文件；而且明确规定编码会话只能改 `passes` 字段，删改测试项是"不可接受的"<sup class="cite"><a href="#ref-3" title="Effective harnesses for long-running agents">3</a></sup>。清单在这里是防止过早宣布胜利的那道闸：还有一条没通过，就没做完；
- **一次只做一个功能**，直接针对"一口气做太多"。这和 [先计划后执行](/posts/agent-planning-reasoning/#先计划后执行) 里讲的粒度问题是一回事，只不过这里粒度是被 Harness 强制的；
- **git 是最好的交接工具**：带说明的提交让下一个会话能快速看懂发生了什么，出了问题也能回滚到能用的版本；
- **验证要像用户一样**：一开始模型只跑单元测试或 `curl`，漏掉了很多端到端才会暴露的问题；让它通过 Puppeteer 在浏览器里像真人一样操作之后，效果明显变好。

还有一个跨窗口的选择：**压缩还是重置**。压缩是把历史就地总结，同一个 Agent 带着摘要继续；重置是彻底清空，开一个全新的 Agent，只靠结构化的交接物接上。Anthropic 后来的一篇文章提到，有些模型在快接近它以为的上下文上限时，会表现出"上下文焦虑"，开始草草收尾；Sonnet 4.5 上这种现象明显到必须用重置，而 Opus 4.5 基本没有这个问题，他们就在后来的版本里去掉了重置<sup class="cite" id="cite-11"><a href="#ref-11" title="Harness design for long-running application development">11</a></sup>。用哪种不是一个通用答案，取决于你手上的模型有什么毛病。更多的权衡见 [压缩](/posts/agent-context-management/#手段三压缩compaction)。

## 自评不可信：把生成和评估分开

长任务里还有一个更根本的问题：**Agent 评价自己的工作时，会系统性地偏乐观。** Anthropic 那篇文章的原话是，Agent 在给自己的工作打分时"稳定地偏向正面"<sup class="cite"><a href="#ref-11" title="Harness design for long-running application development">11</a></sup>。

他们的做法借鉴了 GAN 的思路，把一个 Agent 拆成三个角色：

<figure class="diagram">
<svg viewBox="0 0 640 210" role="img" aria-label="规划者、生成者、评估者三个 Agent 的协作流程">
<defs><marker id="hk3" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0 0 L10 5 L0 10 z"/></marker></defs>
<text class="ts" x="20" y="96">一句话需求</text>
<path class="ln" d="M86 92 H118" marker-end="url(#hk3)"/>
<rect class="c-purple" x="120" y="64" width="130" height="56" rx="6"/>
<text class="t" x="185" y="88" text-anchor="middle">规划者</text>
<text class="ts" x="185" y="108" text-anchor="middle">展开成产品规格</text>
<path class="ln" d="M250 92 H288" marker-end="url(#hk3)"/>
<text class="ts" x="269" y="82" text-anchor="middle">规格</text>
<rect class="c-blue" x="290" y="64" width="130" height="56" rx="6"/>
<text class="t" x="355" y="88" text-anchor="middle">生成者</text>
<text class="ts" x="355" y="108" text-anchor="middle">写代码 · 搭应用</text>
<path class="ln" d="M420 92 H468" marker-end="url(#hk3)"/>
<text class="ts" x="444" y="82" text-anchor="middle">应用</text>
<rect class="c-amber" x="470" y="64" width="150" height="56" rx="6"/>
<text class="t" x="545" y="88" text-anchor="middle">评估者</text>
<text class="ts" x="545" y="108" text-anchor="middle">在浏览器里点一遍</text>
<path class="ln" d="M545 120 V160 H355 V122" marker-end="url(#hk3)"/>
<text class="ts" x="450" y="178" text-anchor="middle">按标准打分 + 具体的问题</text>
<text class="ts" x="320" y="30" text-anchor="middle">评估者比生成者更容易调成"挑剔"的样子</text>
</svg>
<figcaption>图 5：规划者防止把需求做小，评估者防止"自我感觉良好"。改编自 Anthropic 的三 Agent Harness<sup class="cite"><a href="#ref-11" title="Harness design for long-running application development">11</a></sup>。</figcaption>
</figure>

- **规划者**把一句话的需求展开成完整的产品规格，防止生成者把范围做小；
- **生成者**负责实现；
- **评估者**用 Playwright 打开运行中的应用，像用户一样操作，按事先定好的标准打分，并把具体问题反馈给生成者。

为什么要单独一个评估者？文章的解释是：**把一个独立的评估者调得挑剔，比让生成者学会批评自己容易得多**<sup class="cite"><a href="#ref-11" title="Harness design for long-running application development">11</a></sup>。这和 [子 Agent 的结论也是不可信输入](/posts/agent-subagents/#信任子-agent-的结论也是不可信输入) 是同一个思路：判断和执行分开，判断的那一方不承担"证明自己做对了"的压力。

代价也很实在。同一个复古游戏编辑器的需求，单个 Agent 跑 20 分钟、花 9 美元；完整的三 Agent Harness 跑了 6 个小时、花了 200 美元，成本是 20 多倍，但做出来的东西功能完整得多<sup class="cite"><a href="#ref-11" title="Harness design for long-running application development">11</a></sup>。Harness 不是免费的，加一个组件就要问一句：它带来的提升，值不值这些时间和钱。

## Harness Engineering：仓库本身就是 Harness

前面说的都是"搭 Agent 的人"怎么做 Harness。2026 年初，这个词开始被"用 Agent 的人"拿来描述另一件事：**让你的代码库变得适合 Agent 工作。**

Mitchell Hashimoto 在一篇讲自己怎么用 AI 写代码的文章里，把其中一步叫作"打造 Harness"：**每当 Agent 犯一个错，就花时间做一个工程上的解决方案，让它以后不再犯**<sup class="cite" id="cite-12"><a href="#ref-12" title="My AI Adoption Journey">12</a></sup>。简单的问题，比如总是跑错命令、找错 API，就更新 `AGENTS.md`，他说那个文件里"每一行都对应一次糟糕的 Agent 行为"，而这几乎全部解决了问题；复杂一点的，就写一个专门的脚本，比如截图、只跑相关测试，再在 `AGENTS.md` 里告诉 Agent 有这个脚本。

OpenAI 的一个内部团队把这件事推到了极端<sup class="cite"><a href="#ref-9" title="Harness engineering: leveraging Codex in an agent-first world">9</a></sup>。大约五个月里，团队从 3 个工程师增加到 7 个，不手写一行代码，由 Codex 写出了约 1500 个合并的 PR、百万行量级的代码，平均每个工程师每天 3.5 个 PR。他们的原则是"人掌舵，Agent 执行"，而工程师的主要工作变成了搭 Harness：

- **`AGENTS.md` 是地图，不是百科全书**。他们一开始写了一个很大的 `AGENTS.md`，失败了：上下文是稀缺的，指导太多会淹没真正关键的约束，文件也会很快过时，而且没法机械地检查。后来改成大约 100 行的目录，详细知识放进结构化的 `docs/` 目录，作为唯一的事实来源，再用 lint 和 CI 检查文档是不是最新、有没有交叉链接。原话是"给 Codex 一张地图，而不是一本一千页的说明书"；
- **架构靠检查，不靠叮嘱**。每个业务域按固定的分层组织，依赖方向、结构化日志、命名、文件大小，都由自定义 lint 和结构测试强制执行；而且只强制不变量，不规定具体实现；
- **熵要定期清理**。Agent 会照着已有的代码模式写，包括写得不好的那些，偏差会累积。每周五花 20% 的时间手动清理，跟不上 Agent 写代码的速度；他们就把"黄金原则"写进仓库，跑后台任务定期扫描偏差、开小的重构 PR，大多数一分钟内就能审完；另有一个专门的 Agent 定期找出过时的文档并修正；
- **让 Agent 看得见应用**。每个 git worktree 都能启动自己的应用实例，接上 Chrome DevTools 协议让 Agent 截图、看 DOM、复现 UI 问题；每个任务还有一套临时的日志、指标、链路追踪，任务结束就销毁。单个 Codex 任务曾经连续工作超过六个小时。

把这些对照图 2 看：`AGENTS.md` 和 `docs/` 是推理型引导，自定义 lint 和结构测试是计算型反馈，带修复方法的报错把反馈又变回了引导，后台清理任务是一个定期运行的推理型反馈。**仓库本身成了 Harness 的一部分，而且是最大的那部分。**

这也是 Hashimoto 那句话最值得记住的地方：**一个错误第一次出现时，修掉它；第二次出现时，修掉产生它的环境。** 这和 [Skills](/posts/agent-skills/) 里"第三次解释同一件事时就该写成 Skill"、[评测](/posts/agent-evaluation/) 里"从真实失败开始"是同一个习惯。

## 模型变强以后，Harness 会变薄吗

这是一个绕不开的问题。Rich Sutton 在《苦涩的教训》里说，70 年 AI 研究最大的教训是，能利用算力的通用方法最终会以很大的优势胜出<sup class="cite" id="cite-13"><a href="#ref-13" title="The Bitter Lesson">13</a></sup>。按这个逻辑，Harness 里那些精心设计的规则，会不会都是迟早要被模型吸收的"人类知识"？

部分是的。Anthropic 那篇三 Agent 文章里有一句话，我觉得是理解 Harness 最好的钥匙<sup class="cite"><a href="#ref-11" title="Harness design for long-running application development">11</a></sup>：

> Harness 里的每一个组件，都编码了一个关于"模型自己做不到什么"的假设。

假设会过时。换到 Opus 4.6 之后，他们把把任务切成小冲刺（sprint）的结构整个删了，因为新模型不用切分也能保持长时间的连贯；评估者从每个冲刺都打分改成只在最后检查一次。前面说的上下文重置也是一样，Sonnet 4.5 必须要，Opus 4.5 就可以去掉。Manus 的团队说他们把 Agent 框架**重写了四次**，每次都是因为发现了更好的组织上下文的方式<sup class="cite"><a href="#ref-7" title="Context Engineering for AI Agents: Lessons from Building Manus">7</a></sup>。

但也有一部分不会消失。那篇文章保留了规划者和评估者，因为前者仍然能防止范围被做小，后者在模型能力边缘的任务上仍然有用；作者的结论是，**模型变强之后，值得探索的 Harness 组合并不会变少，只是会移动**<sup class="cite"><a href="#ref-11" title="Harness design for long-running application development">11</a></sup>。

我自己的理解是把 Harness 分成两类来看：

- **弥补模型短板的部分会变薄**：任务切分、上下文重置、"记得先验证"这类提醒、为了防止模型犯某个具体错误而写的规则。这些是图 2 里的引导，会随模型变强逐渐失去意义；
- **连接真实世界的部分不会**：权限和沙箱、执行环境、测试和构建这些客观信号、状态的持久化、可观测性。模型再强，也需要有人决定它能碰什么、在哪里跑、做完以后怎么证明它做对了。

所以每次换模型时，值得做一件事：**把 Harness 里的组件逐个拿掉，重新跑一遍评测。** 拿掉之后分数不变的，就是已经过时的假设；拿掉之后掉分的，才是现在还在起作用的部分。Anthropic 那篇文章给的原则是"找最简单的方案，只在必要时增加复杂度"<sup class="cite"><a href="#ref-11" title="Harness design for long-running application development">11</a></sup>，这句话反过来也成立：模型变强了，就该回头看看哪些复杂度已经不必要了。

## 动手时的几条建议

1. **先有可观测性，再改别的**。每一轮的输入、输出、工具调用、成本都要能看到；改 Harness 的依据应该来自读轨迹，而不是直觉；
2. **停止条件写在 Harness 里**：步数、预算、超时，以及"还有没通过的检查就不许结束"，不要指望模型自己判断做完了；
3. **只追加、不修改**：上下文按前缀稳定的方式组装，状态变化用追加消息表达，保护缓存命中率；
4. **引导和反馈都要有，能计算的别只靠推理**：规则写进 `AGENTS.md`，同时用脚本或 lint 去检查它；报错信息里写上怎么改；
5. **用钩子把关键规则变成强制的**：危险操作在执行前拦截，"先验证再结束"放进停止钩子；
6. **长任务靠交接物，不靠记忆力**：进度文件、带说明的 git 提交、一份只能勾选不能改写的功能清单；一次只做一件事；
7. **生成和评估分开**：评估者单独一个上下文、单独一份标准，能实际运行就别只读代码；
8. **每个组件都写下它在弥补什么**：换模型时逐个拿掉重新评测，删掉已经过时的假设。

## 小结

1. **Agent = 模型 + Harness**：除了模型权重以外的一切，提示词、工具、沙箱、编排、钩子、状态、反馈、可观测性，都是 Harness；
2. **Harness 决定你能用到模型能力的多少**：只改 Harness、不换模型，评测分数可以差十几个点；
3. **Harness 里的控制可以分成引导和反馈、计算型和推理型**：两类都要有，确定性的检查尽量多用，反馈信息本身写成引导；
4. **钩子把确定性插进循环**：工具调用前拦截，停止前验证；很多有效的改进不是更好的提示词，而是在对的时刻插进来的一段代码；
5. **长任务的延续性全靠交接物**：初始化会话搭好环境和清单，之后每个会话读、做一件事、写回；压缩还是重置，取决于你的模型有什么毛病；
6. **自评不可信**：把生成和评估分开，评估者更容易调得挑剔，但要为此付出时间和成本；
7. **仓库本身就是 Harness**：`AGENTS.md` 当地图，知识放进有检查的文档，架构靠 lint 强制，熵靠定期清理；Agent 每犯一个错，就修一次产生它的环境；
8. **Harness 的一部分会随模型变强而变薄，连接真实世界的那部分不会**：每个组件都是一个关于模型短板的假设，换模型时要重新验证它。

回到开头那个马具的比喻。马越来越快，缰绳不会因此消失，但用不着再勒得那么紧；真正不会变的，是马车要走在路上，到了地方要有人检查货物是不是完好。**模型决定 Agent 能做到什么，Harness 决定它在什么地方、按什么规矩、做到什么程度停下，以及你怎么知道它真的做到了。**

## 参考文献

<section class="refs">
<ol>
<li id="ref-1"><span class="ref-n">[1]</span><span>Trivedy V. <a href="https://www.langchain.com/blog/the-anatomy-of-an-agent-harness">The Anatomy of an Agent Harness</a>. <i>LangChain Blog</i>, 2026. <a class="ref-back" href="#cite-1" aria-label="回到正文">↩</a></span></li>
<li id="ref-2"><span class="ref-n">[2]</span><span>Bolin M. <a href="https://openai.com/index/unrolling-the-codex-agent-loop/">Unrolling the Codex agent loop</a>. <i>OpenAI</i>, 2026. <a class="ref-back" href="#cite-2" aria-label="回到正文">↩</a></span></li>
<li id="ref-3"><span class="ref-n">[3]</span><span>Young J. <a href="https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents">Effective harnesses for long-running agents</a>. <i>Anthropic Engineering Blog</i>, 2025. <a class="ref-back" href="#cite-3" aria-label="回到正文">↩</a></span></li>
<li id="ref-4"><span class="ref-n">[4]</span><span>Yang J. et al. <a href="https://arxiv.org/abs/2405.15793">SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering</a>. <i>NeurIPS</i>, 2024. <a class="ref-back" href="#cite-4" aria-label="回到正文">↩</a></span></li>
<li id="ref-5"><span class="ref-n">[5]</span><span>Schluntz E., Zhang B. <a href="https://www.anthropic.com/engineering/building-effective-agents">Building effective agents</a>. <i>Anthropic Engineering Blog</i>, 2024. <a class="ref-back" href="#cite-5" aria-label="回到正文">↩</a></span></li>
<li id="ref-6"><span class="ref-n">[6]</span><span>Trivedy V. <a href="https://www.langchain.com/blog/improving-deep-agents-with-harness-engineering">Improving Deep Agents with harness engineering</a>. <i>LangChain Blog</i>, 2026. <a class="ref-back" href="#cite-6" aria-label="回到正文">↩</a></span></li>
<li id="ref-7"><span class="ref-n">[7]</span><span>Ji Y. <a href="https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus">Context Engineering for AI Agents: Lessons from Building Manus</a>. <i>Manus Blog</i>, 2025. <a class="ref-back" href="#cite-7" aria-label="回到正文">↩</a></span></li>
<li id="ref-8"><span class="ref-n">[8]</span><span>Böckeler B. <a href="https://martinfowler.com/articles/harness-engineering.html">Harness engineering for coding agent users</a>. <i>martinfowler.com</i>, 2026. <a class="ref-back" href="#cite-8" aria-label="回到正文">↩</a></span></li>
<li id="ref-9"><span class="ref-n">[9]</span><span>Lopopolo R. <a href="https://openai.com/index/harness-engineering/">Harness engineering: leveraging Codex in an agent-first world</a>. <i>OpenAI</i>, 2026. <a class="ref-back" href="#cite-9" aria-label="回到正文">↩</a></span></li>
<li id="ref-10"><span class="ref-n">[10]</span><span>Anthropic. <a href="https://code.claude.com/docs/en/hooks">Hooks reference</a>. <i>Claude Code Documentation</i>. <a class="ref-back" href="#cite-10" aria-label="回到正文">↩</a></span></li>
<li id="ref-11"><span class="ref-n">[11]</span><span>Rajasekaran P. <a href="https://www.anthropic.com/engineering/harness-design-long-running-apps">Harness design for long-running application development</a>. <i>Anthropic Engineering Blog</i>, 2026. <a class="ref-back" href="#cite-11" aria-label="回到正文">↩</a></span></li>
<li id="ref-12"><span class="ref-n">[12]</span><span>Hashimoto M. <a href="https://mitchellh.com/writing/my-ai-adoption-journey">My AI Adoption Journey</a>. <i>mitchellh.com</i>, 2026. <a class="ref-back" href="#cite-12" aria-label="回到正文">↩</a></span></li>
<li id="ref-13"><span class="ref-n">[13]</span><span>Sutton R. <a href="http://www.incompleteideas.net/IncIdeas/BitterLesson.html">The Bitter Lesson</a>. <i>incompleteideas.net</i>, 2019. <a class="ref-back" href="#cite-13" aria-label="回到正文">↩</a></span></li>
</ol>
</section>
