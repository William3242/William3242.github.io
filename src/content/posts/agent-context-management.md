---
title: Agent 的上下文管理：窗口、压缩、记忆与子 Agent
description: Agent 跑得越久，上下文就越满、越乱、越贵。这篇专门聊上下文管理：窗口里到底装了什么，为什么"装满"之前效果就开始变差，以及工具输出裁剪、压缩摘要、外部记忆、按需检索、子 Agent 隔离这些手段各自解决什么问题、怎么取舍。
pubDate: 2026-10-28
tags: [Agent, LLM, 上下文工程]
---

在 [搭建 Agent 的基础知识](/posts/agent-basics/) 里，我把上下文称作"Agent 的工作台"，并简单列了几种应对手段：截断、压缩、按需加载、结构化笔记。那一节只有几段话，但实际搭 Agent 的时候，这几段话背后几乎是最费心思的部分。

一个能跑三五步的 Agent 和一个能连续工作几个小时的 Agent，差距往往不在模型，而在**上下文管理**：每一步给模型看什么、不看什么、旧的东西怎么处理、新的东西从哪里来。这篇就专门把这件事展开讲。

## 先算一笔账：上下文里装了什么

还是从那个最小的 Agent 循环出发。每一轮循环，Harness 都要把下面这些东西**完整地**发给模型：

1. **系统提示词**：角色、规则、输出格式，通常几百到几千 token；
2. **工具定义**：每个工具的名字、描述和 JSON Schema。工具一多，这里能轻松到上万 token，而且每一轮都要带上；
3. **对话历史**：用户消息、模型回复、模型的思考过程、每一次工具调用和它的结果；
4. **注入的外部信息**：检索出来的文档片段、项目说明文件、记忆内容。

前两项是固定成本，第四项可以控制，真正失控的是第三项，尤其是其中的**工具结果**。一个编码 Agent 读几个文件、跑一次测试、看一眼日志，就可能产生几万 token 的输出；而这些输出一旦进入历史，后面的每一轮都要为它买单。

一个粗略的直觉：如果每一步平均新增 3,000 token，跑 50 步之后，单次请求的输入就有 15 万 token，整个任务累计处理的输入 token 是这个数字的几十倍。**上下文管理首先是一个成本和延迟问题。**

<figure class="diagram">
<svg viewBox="0 0 640 250" role="img" aria-label="随着步数增加，上下文中各部分的 token 构成">
<text class="t" x="70" y="40" text-anchor="end">第 1 步</text>
<rect class="c-gray" x="80" y="20" width="10" height="30"/><rect class="c-purple" x="90" y="20" width="42" height="30"/><rect class="c-blue" x="132" y="20" width="4" height="30"/>
<text class="ts" x="144" y="40">约 1.6 万</text>
<text class="t" x="70" y="90" text-anchor="end">第 10 步</text>
<rect class="c-gray" x="80" y="70" width="10" height="30"/><rect class="c-purple" x="90" y="70" width="42" height="30"/><rect class="c-blue" x="132" y="70" width="28" height="30"/><rect class="c-amber" x="160" y="70" width="69" height="30"/>
<text class="ts" x="237" y="90">约 4 万</text>
<text class="t" x="70" y="140" text-anchor="end">第 30 步</text>
<rect class="c-gray" x="80" y="120" width="10" height="30"/><rect class="c-purple" x="90" y="120" width="42" height="30"/><rect class="c-blue" x="132" y="120" width="87" height="30"/><rect class="c-amber" x="219" y="120" width="243" height="30"/>
<text class="ts" x="470" y="140">约 11 万</text>
<text class="t" x="70" y="190" text-anchor="end">第 50 步</text>
<rect class="c-gray" x="80" y="170" width="10" height="30"/><rect class="c-purple" x="90" y="170" width="42" height="30"/><rect class="c-blue" x="132" y="170" width="121" height="30"/><rect class="c-amber" x="253" y="170" width="347" height="30"/>
<text class="ts" x="604" y="190">15 万</text>
<rect class="c-gray" x="80" y="226" width="14" height="14"/><text class="ts" x="100" y="238">系统提示词</text>
<rect class="c-purple" x="185" y="226" width="14" height="14"/><text class="ts" x="205" y="238">工具定义</text>
<rect class="c-blue" x="280" y="226" width="14" height="14"/><text class="ts" x="300" y="238">对话与思考</text>
<rect class="c-amber" x="385" y="226" width="14" height="14"/><text class="ts" x="405" y="238">工具结果</text>
</svg>
<figcaption>图 1：一个示意性的例子。固定成本几乎不变，工具结果随步数快速膨胀，而且每一轮都要整段重发。</figcaption>
</figure>

## 为什么"装得下"不等于"用得好"

现在主流模型的窗口动辄几十万甚至上百万 token，很容易让人觉得"窗口够大就不用管了"。但实践中有两个现象值得警惕：

- **注意力是有限的**。Transformer 里每个 token 都要和其他所有 token 计算注意力（原理可以看 [Transformer 入门](/posts/transformer-intro/)），上下文越长，关键信息被"稀释"得越厉害。很多评测都发现，随着无关内容增加，模型找回关键信息、遵循早期指令的能力会下降，这就是常说的**上下文腐烂（Context Rot）**；
- **位置有影响**。早期研究（如 "Lost in the Middle"）发现，模型对开头和结尾的信息更敏感，对中间部分更容易忽略。新模型在这方面改善了不少，但"把重要的东西放在显眼位置"仍然是个好习惯。

还有一类更隐蔽的问题是**上下文污染**：一次失败的尝试、一个错误的假设、一段过时的文件内容，留在历史里会持续影响模型后面的判断。人类遇到这种情况可以"忘掉重来"，模型做不到，除非 Harness 帮它忘。

所以上下文管理的目标不是"别超出窗口"，而是：**在每一步，让窗口里尽量只有对当前决策有用的信息。** 有人把它总结为"找到最小的、信号最强的那组 token"。

## 一个容易被忽略的约束：缓存

在讲具体手段之前，先说一个会影响所有手段的工程约束：**提示词缓存（Prompt Caching）**。

模型推理时，已经处理过的前缀可以把中间结果（KV Cache）缓存起来，下次请求如果前缀完全相同，就能直接复用，输入成本和首 token 延迟都会大幅下降。各家 API 基本都提供了这个能力，对 Agent 这种"每轮都重发整段历史"的场景，缓存命中率直接决定了成本。

缓存是按**前缀**匹配的，这带来几条很实际的设计约束：

- **把稳定的内容放前面**。系统提示词、工具定义放最前，对话历史在后；
- **尽量只追加，不改写**。如果你在第 10 轮回头修改了第 3 轮的内容，第 3 轮之后的缓存全部失效；
- **别在前缀里放会变的东西**。比如在系统提示词开头写当前时间精确到秒，每一轮都会让整个缓存作废；
- **工具集保持稳定**。动态增删工具定义，同样会破坏前缀。

<figure class="diagram">
<svg viewBox="0 0 640 240" role="img" aria-label="提示词缓存按前缀匹配：只追加与改写中间的对比">
<text class="t" x="20" y="22">只追加：前缀不变，只有新内容需要计算</text>
<rect class="c-gray" x="20" y="34" width="110" height="36" rx="4"/><text class="t" x="75" y="57" text-anchor="middle">系统提示词</text>
<rect class="c-purple" x="136" y="34" width="100" height="36" rx="4"/><text class="t" x="186" y="57" text-anchor="middle">工具定义</text>
<rect class="c-blue" x="242" y="34" width="80" height="36" rx="4"/><text class="t" x="282" y="57" text-anchor="middle">第 1 轮</text>
<rect class="c-blue" x="328" y="34" width="80" height="36" rx="4"/><text class="t" x="368" y="57" text-anchor="middle">第 2 轮</text>
<rect class="c-blue" x="414" y="34" width="80" height="36" rx="4"/><text class="t" x="454" y="57" text-anchor="middle">第 3 轮</text>
<rect class="c-blue dash" x="500" y="34" width="80" height="36" rx="4"/><text class="t" x="540" y="57" text-anchor="middle">新一轮</text>
<path class="sg" d="M20 80 v6 h474 v-6"/><text class="ts" x="257" y="102" text-anchor="middle">命中缓存，便宜且快</text>
<path class="ln" d="M500 80 v6 h80 v-6"/><text class="ts" x="540" y="102" text-anchor="middle">新计算</text>
<text class="t" x="20" y="142">改写中间：改动点之后的缓存全部失效</text>
<rect class="c-gray" x="20" y="154" width="110" height="36" rx="4"/><text class="t" x="75" y="177" text-anchor="middle">系统提示词</text>
<rect class="c-purple" x="136" y="154" width="100" height="36" rx="4"/><text class="t" x="186" y="177" text-anchor="middle">工具定义</text>
<rect class="c-blue" x="242" y="154" width="80" height="36" rx="4"/><text class="t" x="282" y="177" text-anchor="middle">第 1 轮</text>
<rect class="c-red" x="328" y="154" width="80" height="36" rx="4"/><text class="t" x="368" y="177" text-anchor="middle">第 2 轮 ✎</text>
<rect class="c-blue" x="414" y="154" width="80" height="36" rx="4"/><text class="t" x="454" y="177" text-anchor="middle">第 3 轮</text>
<rect class="c-blue dash" x="500" y="154" width="80" height="36" rx="4"/><text class="t" x="540" y="177" text-anchor="middle">新一轮</text>
<path class="sg" d="M20 200 v6 h302 v-6"/><text class="ts" x="171" y="222" text-anchor="middle">命中缓存</text>
<path class="sr" d="M328 200 v6 h252 v-6"/><text class="ts" x="454" y="222" text-anchor="middle">全部重新计算</text>
</svg>
<figcaption>图 2：缓存按前缀匹配。稳定的内容放前面，历史尽量只追加。</figcaption>
</figure>

这意味着很多上下文管理手段之间存在张力：**裁剪和压缩会改写历史，缓存希望历史不变。** 好的做法通常是"批量地、低频地"改写，而不是每一轮都动一点。

## 手段一：控制工具输出

最便宜、最有效的上下文管理，发生在信息**进入**上下文之前。与其事后压缩，不如一开始就别让大块无用输出进来。

**截断，并告诉模型怎么拿更多。** 工具输出超过阈值时截断是基本操作，但关键是截断提示要可操作：

```python
MAX_CHARS = 20_000

def clip(output: str, hint: str) -> str:
    if len(output) <= MAX_CHARS:
        return output
    head, tail = output[:MAX_CHARS // 2], output[-MAX_CHARS // 4:]
    return (f"{head}\n\n... [省略 {len(output) - len(head) - len(tail)} 字符] ...\n\n{tail}\n\n"
            f"[输出已截断。{hint}]")

# 例如读文件时：
clip(content, hint="可以用 read_file(path, offset, limit) 按行分段读取，或用 grep 定位关键内容。")
```

保留头尾通常比只保留头部好：命令的报错、测试的汇总、日志的最新部分，往往在结尾。

**工具设计上就返回精简内容。** 这比截断更根本：

- 搜索类工具默认只返回文件名和匹配行，而不是整个文件；
- 查询类工具支持分页、字段过滤，默认返回摘要字段；
- 返回人类可读的名字而不是一串 UUID，避免模型需要额外的查询去"翻译"；
- 提供一个 `verbose` 或 `detail_level` 参数，让模型在真的需要时再要详细结果。

**让输出落盘，上下文里只放引用。** 对于特别大的结果（一份完整的测试报告、一次大查询的结果集），可以把完整内容写到文件里，上下文里只返回"结果已保存到 `/tmp/result_42.json`，共 1,203 条，前 5 条如下……"。模型需要时再用读文件或 `grep` 的工具去取。这本质上是把文件系统当作上下文的"外存"。

## 手段二：清理旧的工具结果

工具结果有一个特点：**它的价值随时间衰减得很快**。模型读完一个文件、做出修改之后，那份文件的原始内容在后续步骤里大多就没用了，但它还会在历史里一直待着。

一个轻量的做法是**工具结果清理**：当上下文超过某个阈值时，把较早的工具结果替换成一个占位符，保留工具调用本身（模型知道自己做过什么），只丢掉大块的返回内容。

```python
def clear_old_tool_results(messages, keep_recent=5):
    tool_msgs = [m for m in messages if is_tool_result(m)]
    for m in tool_msgs[:-keep_recent]:
        m["content"] = "[该工具结果已清理以节省上下文，如有需要请重新调用]"
    return messages
```

这比摘要更"安全"：它不会引入模型自己总结时可能产生的偏差，模型需要时可以重新调用工具拿到最新的结果（而且往往比旧结果更准确，因为文件可能已经被改过了）。部分模型 API 已经内置了类似的上下文编辑能力，可以配置在超过阈值时自动清理。

需要注意的是缓存：每次清理都会改写历史中间的内容。所以通常是**攒到阈值再一次性清理一批**，而不是每一轮都清理最旧的一条。

## 手段三：压缩（Compaction）

当历史长到工具结果清理也不够用时，就需要更激进的做法：**把一大段历史交给模型总结成一段摘要，然后用摘要替换掉原始历史**，在新的上下文里继续工作。这就是压缩，很多编码 Agent 在接近窗口上限时会自动触发它。

<figure class="diagram">
<svg viewBox="0 0 640 240" role="img" aria-label="原始历史、清理旧工具结果、压缩之后三种状态的对比">
<text class="t" x="20" y="20">原始历史</text>
<rect class="c-gray" x="20" y="30" width="90" height="34" rx="4"/><text class="ts" x="65" y="52" text-anchor="middle">系统 + 工具</text>
<rect class="c-blue" x="114" y="30" width="60" height="34" rx="4"/><text class="ts" x="144" y="52" text-anchor="middle">用户目标</text>
<rect class="c-blue" x="178" y="30" width="34" height="34" rx="4"/><text class="ts" x="195" y="52" text-anchor="middle">调用</text>
<rect class="c-amber" x="216" y="30" width="90" height="34" rx="4"/><text class="ts" x="261" y="52" text-anchor="middle">结果</text>
<rect class="c-blue" x="310" y="30" width="34" height="34" rx="4"/><text class="ts" x="327" y="52" text-anchor="middle">调用</text>
<rect class="c-amber" x="348" y="30" width="70" height="34" rx="4"/><text class="ts" x="383" y="52" text-anchor="middle">结果</text>
<rect class="c-blue" x="422" y="30" width="34" height="34" rx="4"/><text class="ts" x="439" y="52" text-anchor="middle">调用</text>
<rect class="c-amber" x="460" y="30" width="80" height="34" rx="4"/><text class="ts" x="500" y="52" text-anchor="middle">结果</text>
<rect class="c-blue" x="544" y="30" width="76" height="34" rx="4"/><text class="ts" x="582" y="52" text-anchor="middle">最近消息</text>
<text class="t" x="20" y="100">清理旧工具结果：保留调用记录，旧结果换成占位符</text>
<rect class="c-gray" x="20" y="110" width="90" height="34" rx="4"/><text class="ts" x="65" y="132" text-anchor="middle">系统 + 工具</text>
<rect class="c-blue" x="114" y="110" width="60" height="34" rx="4"/><text class="ts" x="144" y="132" text-anchor="middle">用户目标</text>
<rect class="c-blue" x="178" y="110" width="34" height="34" rx="4"/><text class="ts" x="195" y="132" text-anchor="middle">调用</text>
<rect class="c-amber dash" x="216" y="110" width="24" height="34" rx="4"/><text class="ts" x="228" y="132" text-anchor="middle">…</text>
<rect class="c-blue" x="244" y="110" width="34" height="34" rx="4"/><text class="ts" x="261" y="132" text-anchor="middle">调用</text>
<rect class="c-amber dash" x="282" y="110" width="24" height="34" rx="4"/><text class="ts" x="294" y="132" text-anchor="middle">…</text>
<rect class="c-blue" x="310" y="110" width="34" height="34" rx="4"/><text class="ts" x="327" y="132" text-anchor="middle">调用</text>
<rect class="c-amber" x="348" y="110" width="80" height="34" rx="4"/><text class="ts" x="388" y="132" text-anchor="middle">结果</text>
<rect class="c-blue" x="432" y="110" width="76" height="34" rx="4"/><text class="ts" x="470" y="132" text-anchor="middle">最近消息</text>
<text class="t" x="20" y="180">压缩之后：一段摘要替换整段历史</text>
<rect class="c-gray" x="20" y="190" width="90" height="34" rx="4"/><text class="ts" x="65" y="212" text-anchor="middle">系统 + 工具</text>
<rect class="c-green" x="114" y="190" width="130" height="34" rx="4"/><text class="ts" x="179" y="212" text-anchor="middle">摘要：目标·决策·进度</text>
<rect class="c-blue" x="248" y="190" width="76" height="34" rx="4"/><text class="ts" x="286" y="212" text-anchor="middle">最近消息</text>
<rect class="c-amber" x="328" y="190" width="100" height="34" rx="4"/><text class="ts" x="378" y="212" text-anchor="middle">重新读入的文件</text>
</svg>
<figcaption>图 3：清理是轻量的"减法"，压缩是彻底的"重写"。</figcaption>
</figure>

压缩的难点全在"总结什么"。一个好的压缩摘要应该保留：

- **任务目标和用户的原始要求**，尤其是那些约束条件、用户明确说过"不要做"的事；
- **已经做出的关键决策及理由**，否则模型可能在压缩后推翻自己之前想清楚的东西；
- **当前进度和未完成事项**，下一步要做什么；
- **踩过的坑**：哪些方法试过了不行，为什么不行，避免压缩后重蹈覆辙；
- **关键的"指针"**：改过哪些文件、重要信息在哪里，而不是信息本身。

可以安全丢掉的通常是：已经被消化过的工具原始输出、探索过程中的试错细节、已经解决的问题的来龙去脉。

一个压缩提示词的骨架大概是这样：

```text
请总结到目前为止的工作，用于在新的上下文中继续任务。必须包含：
1. 用户的原始目标和所有明确的约束；
2. 已完成的工作，以及涉及的文件路径；
3. 做出的关键决策及其原因；
4. 尝试过但失败的方法，以及失败原因；
5. 当前状态和接下来的具体步骤。
不需要复述工具的原始输出，只保留结论和必要的引用。
```

压缩之后，通常还会把**最近的几条消息原样保留**，并重新读入几个最近操作过的关键文件，让模型"醒来"时手边有最直接的工作材料。

压缩有两个现实问题需要知道：

1. **它是有损的**。总结时被认为不重要的细节，可能恰好在后面变得关键。所以压缩前尽量让重要信息已经落到外部（文件、笔记）里，而不是只存在于对话历史中；
2. **触发时机很重要**。等到窗口快满才压缩，此时模型可能已经在一个很长、很嘈杂的上下文里工作了很久，效果已经打了折扣；太早压缩又会频繁丢失细节、破坏缓存。比较好的时机是**任务的自然断点**：一个子任务完成、一轮调研结束、准备换方向的时候。

## 手段四：外部记忆与结构化笔记

压缩是"被动地"在窗口满时抢救信息，**外部记忆**则是"主动地"让 Agent 在工作过程中把重要信息写到上下文之外。

最朴素也最好用的形式是**让 Agent 维护一份笔记文件**：

- 一个 `progress.md` 或 `TODO.md`，记录目标、已完成的步骤、下一步计划；
- 在关键决策、发现重要事实、完成阶段性工作时更新它；
- 新会话开始或压缩之后，先读这份文件恢复状态。

这样做有几个好处：笔记是 Agent 自己在"清醒时"写的，质量通常比事后压缩更高；它跨越会话，可以支持持续数天的任务；人类也能直接读、直接改，相当于一个可以审阅和纠偏的接口。

更长期的记忆（用户偏好、项目约定、过去的经验）也可以用同样的思路：一个目录里放几份 Markdown 文件，每份记一个主题，附带一行简短描述。Agent 在会话开始时只读一个**索引**，需要时再打开具体文件。这比把所有记忆一次性塞进上下文要节省得多，也比向量数据库更透明、更容易维护。

记忆系统要警惕的是**写入失控**：Agent 什么都往里记，最后记忆本身变成了噪音来源。几条实用的规则：

- 只记"下次会用到、且无法从其他地方轻易推出来"的东西。代码结构、提交历史这些仓库里已经有的，不用记；
- 优先更新已有条目，而不是不断追加新条目；
- 发现记忆过时或错误时，删掉它；
- 读到的记忆当作"当时的事实"，用之前先验证（比如记忆里提到的函数名现在还在不在）。

## 手段五：按需检索，而不是预先塞满

另一个方向是从源头控制**进入**上下文的信息：不在任务开始时把所有可能相关的资料都塞进去，而是给 Agent 工具，**让它在需要时自己去拿**。

早期的 RAG 系统多是"预先检索"：用户提问 → 向量检索出 Top-K 片段 → 一起塞进上下文。这对单轮问答很有效，但对 Agent 来说有两个问题：检索在任务开始时只做一次，而 Agent 的信息需求是随着工作推进不断变化的；Top-K 片段可能大量无关，又可能漏掉真正需要的东西。

**Agentic 检索**把检索变成了 Agent 循环的一部分：

- 给 Agent `grep`、`find`、读文件、搜索这类工具，让它像人一样边看边找；
- 上下文里只放轻量的"指针"：文件路径、文档标题、URL、表名，需要时再展开；
- 目录结构、文件命名、时间戳本身就是信号，模型能从 `tests/test_auth.py` 这个路径里推断出很多东西，而不需要先读它。

代价是更多的工具调用和更慢的速度，所以实践中常见的是**混合策略**：少量几乎每次都要用的信息（项目说明、核心约定）预先放进上下文，其余的按需检索。

同样的思路也可以用在**提示词和工具本身**上，这有时被称为**渐进式披露（Progressive Disclosure）**：

- **技能 / 说明文档**：上下文里只放每份文档的名字和一行描述，模型判断需要时再读取全文。几十份专项说明，平时只占几百 token；
- **工具定义**：工具很多的时候（比如接了好几个 MCP 服务），不必把上百个工具的完整 Schema 一直挂在上下文里，可以先只暴露一个"工具搜索"能力，模型需要时再加载具体工具的定义。

## 手段六：子 Agent，把探索放进隔离的上下文

前面的手段都是在"一个上下文"里做文章，**子 Agent** 则是换个思路：把会产生大量中间信息的工作，放到一个**独立的上下文**里去做。

典型场景是调研和探索。比如主 Agent 需要知道"这个代码库里鉴权是怎么做的"，如果它自己去找，可能要读十几个文件、几万 token，而最终需要的只是几段话的结论。交给子 Agent：

- 子 Agent 在一个全新的、干净的上下文里开始，只拿到任务描述；
- 它尽情地搜索、读文件、试错，这些过程都留在它自己的上下文里；
- 最后只把一份精炼的结论（比如一两千 token）返回给主 Agent。

<figure class="diagram">
<svg viewBox="0 0 640 270" role="img" aria-label="子 Agent 在独立上下文里探索，只把结论返回主 Agent">
<defs><marker id="ah4" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0 0 L10 5 L0 10 z"/></marker></defs>
<text class="t" x="20" y="22">主 Agent 上下文</text>
<rect class="c-gray" x="20" y="32" width="90" height="36" rx="4"/><text class="ts" x="65" y="55" text-anchor="middle">系统 + 工具</text>
<rect class="c-blue" x="114" y="32" width="150" height="36" rx="4"/><text class="ts" x="189" y="55" text-anchor="middle">之前的工作</text>
<rect class="c-purple" x="268" y="32" width="100" height="36" rx="4"/><text class="ts" x="318" y="55" text-anchor="middle">调用子 Agent</text>
<rect class="c-green" x="372" y="32" width="60" height="36" rx="4"/><text class="ts" x="402" y="55" text-anchor="middle">结论</text>
<rect class="c-blue dash" x="436" y="32" width="120" height="36" rx="4"/><text class="ts" x="496" y="55" text-anchor="middle">继续主线工作</text>
<path class="ln" d="M318 70 V100 H203 V150" marker-end="url(#ah4)"/><text class="ts" x="212" y="94">委派任务</text>
<path class="ln" d="M585 153 V100 H402 V72" marker-end="url(#ah4)"/><text class="ts" x="500" y="94">只返回结论</text>
<rect class="frame" x="150" y="120" width="480" height="135" rx="8"/>
<text class="t" x="165" y="240">子 Agent 独立上下文（用完即弃）</text>
<rect class="c-purple" x="165" y="155" width="76" height="34" rx="4"/><text class="ts" x="203" y="177" text-anchor="middle">任务描述</text>
<rect class="c-amber" x="245" y="155" width="44" height="34" rx="4"/><text class="ts" x="267" y="177" text-anchor="middle">搜索</text>
<rect class="c-amber" x="293" y="155" width="56" height="34" rx="4"/><text class="ts" x="321" y="177" text-anchor="middle">读文件</text>
<rect class="c-amber" x="353" y="155" width="56" height="34" rx="4"/><text class="ts" x="381" y="177" text-anchor="middle">读文件</text>
<rect class="c-amber" x="413" y="155" width="44" height="34" rx="4"/><text class="ts" x="435" y="177" text-anchor="middle">试错</text>
<rect class="c-amber" x="461" y="155" width="56" height="34" rx="4"/><text class="ts" x="489" y="177" text-anchor="middle">读文件</text>
<rect class="c-amber" x="521" y="155" width="30" height="34" rx="4"/><text class="ts" x="536" y="177" text-anchor="middle">…</text>
<rect class="c-green" x="555" y="155" width="60" height="34" rx="4"/><text class="ts" x="585" y="177" text-anchor="middle">结论</text>
<text class="ts" x="390" y="214" text-anchor="middle">几万 token 的探索过程留在这里，不进入主线</text>
</svg>
<figcaption>图 4：子 Agent 用一个干净的上下文去探索，主 Agent 只多了一次调用和一份结论。</figcaption>
</figure>

主 Agent 的上下文里只多了一次"调用子 Agent"和一份结论，而不是几万 token 的探索过程。这也是 [多 Agent](/posts/agent-basics/#多-agent什么时候值得) 最实在的价值之一：**与其说是"多个 Agent 分工协作"，不如说是"用上下文隔离换取主线的清爽"。**

用子 Agent 有几点要注意：

- **任务描述要自包含**。子 Agent 看不到主 Agent 的历史，你脑子里"显而易见"的背景，它一概不知。描述里要写清楚目标、范围、已知信息和期望的返回格式；
- **明确返回什么**。"帮我调研一下"会得到一篇冗长的报告；"返回涉及的文件路径和每个文件的一句话职责，不超过 20 行"才能真正节省主 Agent 的上下文；
- **它不是免费的**。子 Agent 要从零积累上下文，总 token 消耗往往比主 Agent 自己做更高，换来的是主上下文的质量和并行带来的速度；
- **不适合紧耦合的工作**。需要和主线频繁交换细节、或者需要所有部分保持高度一致的工作（比如同一个模块里互相依赖的修改），拆出去反而容易出错。

## 怎么组合这些手段

这些手段不是互斥的，一个成熟的 Agent 通常是分层使用的：

| 层次 | 手段 | 触发时机 | 代价 |
| --- | --- | --- | --- |
| 入口 | 工具输出截断、精简返回、结果落盘 | 每次工具调用 | 几乎没有 |
| 来源 | 按需检索、渐进式披露 | 设计时决定 | 更多工具调用 |
| 隔离 | 子 Agent | 遇到大块探索型任务 | 总 token 增加 |
| 清理 | 清除旧工具结果 | 超过软阈值 | 少量缓存失效 |
| 压缩 | 摘要替换历史 | 接近上限或任务断点 | 有损、缓存失效 |
| 持久 | 笔记文件、长期记忆 | 关键节点主动写入 | 需要好的写入规则 |

一个大致的优先级是：**先在入口把关，再考虑隔离和检索，清理和压缩作为兜底，外部记忆贯穿始终。** 越靠前的手段越便宜、越不会丢信息；越靠后的手段越像是在"抢救"。

<figure class="diagram">
<svg viewBox="0 0 640 300" role="img" aria-label="上下文管理各手段的分层关系总览">
<defs><marker id="ah5" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0 0 L10 5 L0 10 z"/></marker></defs>
<text class="ts" x="80" y="26" text-anchor="middle">信息来源</text>
<rect class="c-amber" x="20" y="40" width="120" height="36" rx="4"/><text class="t" x="80" y="63" text-anchor="middle">工具输出</text>
<rect class="c-gray" x="20" y="95" width="120" height="36" rx="4"/><text class="t" x="80" y="118" text-anchor="middle">代码与文档</text>
<rect class="c-purple" x="20" y="150" width="120" height="36" rx="4"/><text class="t" x="80" y="173" text-anchor="middle">技能与工具定义</text>
<path class="ln" d="M142 58 H228" marker-end="url(#ah5)"/>
<path class="ln" d="M142 113 H228" marker-end="url(#ah5)"/>
<path class="ln" d="M142 168 H228" marker-end="url(#ah5)"/>
<text class="ts" x="185" y="210" text-anchor="middle">入口把关：</text>
<text class="ts" x="185" y="226" text-anchor="middle">截断 · 精简</text>
<text class="ts" x="185" y="242" text-anchor="middle">按需加载</text>
<rect class="c-blue" x="230" y="34" width="200" height="158" rx="8"/>
<text class="t" x="330" y="56" text-anchor="middle">上下文窗口</text>
<rect class="c-gray" x="245" y="70" width="170" height="28" rx="4"/><text class="ts" x="330" y="89" text-anchor="middle">稳定前缀（利于缓存）</text>
<rect class="c-amber" x="245" y="105" width="170" height="40" rx="4"/><text class="ts" x="330" y="121" text-anchor="middle">历史</text><text class="ts" x="330" y="138" text-anchor="middle">定期清理旧结果 / 压缩</text>
<rect class="c-blue" x="245" y="152" width="170" height="28" rx="4"/><text class="ts" x="330" y="171" text-anchor="middle">当前步骤</text>
<rect class="c-green" x="500" y="60" width="120" height="70" rx="6"/><text class="t" x="560" y="90" text-anchor="middle">外部记忆</text><text class="ts" x="560" y="110" text-anchor="middle">笔记 · 记忆文件</text>
<path class="ln" d="M432 82 H498" marker-end="url(#ah5)"/><text class="ts" x="465" y="75" text-anchor="middle">写入</text>
<path class="ln" d="M498 110 H432" marker-end="url(#ah5)"/><text class="ts" x="465" y="127" text-anchor="middle">读回</text>
<rect class="c-purple" x="255" y="244" width="150" height="40" rx="6"/><text class="t" x="330" y="269" text-anchor="middle">子 Agent</text>
<path class="ln" d="M300 194 V242" marker-end="url(#ah5)"/><text class="ts" x="292" y="222" text-anchor="end">委派</text>
<path class="ln" d="M360 242 V194" marker-end="url(#ah5)"/><text class="ts" x="368" y="222">结论</text>
</svg>
<figcaption>图 5：入口把关控制什么进来，清理和压缩处理已经进来的，外部记忆和子 Agent 把信息放到窗口之外。</figcaption>
</figure>

另外别忘了**观测**。给每一步记录上下文的 token 构成（系统提示词、工具定义、历史、工具结果各占多少），你很可能会发现一两个"罪魁祸首"：某个工具总是返回巨量输出，某段系统提示词早就过时了却一直挂着。针对性地修掉它们，往往比引入一套复杂的压缩机制更有效。改动之后，用 [评估](/posts/agent-basics/#评估你怎么知道它变好了) 去验证效果有没有真的变好，而不是只看 token 数降了多少。

## 小结

1. **上下文是 Agent 最稀缺的资源**：它有上限、有成本，而且在装满之前效果就会开始变差；
2. **目标是让每一步的上下文只包含有用的信息**，而不只是"别超出窗口"；
3. **提示词缓存是一条贯穿始终的约束**：稳定内容在前，尽量只追加，改写要批量低频；
4. **最好的上下文管理发生在信息进入之前**：精简工具输出、按需检索、渐进式披露；
5. **清理和压缩是兜底**：工具结果清理更安全，压缩更彻底但有损，时机选在任务断点；
6. **外部记忆让 Agent 跨越窗口和会话**，难点是写什么、何时读；
7. **子 Agent 的核心价值是上下文隔离**，用更多的总 token 换主线的清爽。

模型的窗口还会继续变大，长上下文能力也会继续变强，但"信息越多注意力越分散"这件事大概不会彻底消失。就像人类的工作台再大，也需要定期收拾：把用完的东西放回去，把重要的事情写下来，把需要专注的活儿拿到一张干净的桌子上去做。
