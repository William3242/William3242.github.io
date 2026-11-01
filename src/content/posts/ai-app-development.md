---
title: AI 应用开发：从一个能跑的 Demo 到一个靠谱的产品
description: 接一个大模型 API，一个下午就能做出惊艳的 Demo，但把它变成每天有人用、出了错有人兜底的产品，往往要几个月。这篇讲 AI 应用和传统软件的差别，以及提示词、结构化输出、RAG、延迟、成本、可靠性、护栏、可观测性和产品设计这些从 Demo 走到上线时绕不开的工程问题。
pubDate: 2026-11-01
tags: [LLM, AI 应用, RAG, 工程化]
draft: false
---

做 AI 应用有一个很普遍的体验：**Demo 一个下午，上线三个月。**

接上模型 API，写一段提示词，挑几个好看的例子跑一跑，效果常常好得让人兴奋。可一旦真的给用户用，问题就一个接一个地冒出来：同一个问题今天答对、明天答错；返回的 JSON 偶尔少一个括号，下游直接报错；文档问答一本正经地编了一个不存在的条款；高峰期接口限流，页面转了二十秒；月底账单比预期多了一个数量级。

这个博客前面的 Agent 系列，从 [循环](/posts/agent-basics/)、[工具](/posts/agent-tools/)、[上下文](/posts/agent-context-management/) 讲到 [Harness](/posts/agent-harness/)，关心的都是 Agent 内部怎么运转。这篇退一步，讲包在模型外面的那一层"应用"。现实里大多数 AI 应用其实并不是 Agent：客服问答、文档总结、合同信息抽取、写作助手、搜索里的 AI 摘要，它们大多是一次或几次模型调用，加上大量普通的工程。这篇想讲清楚的就是这些普通工程：**从一个能跑的 Demo 到一个靠谱的产品，中间到底要补哪些东西。**

## AI 应用和传统软件哪里不一样

先说清楚差别在哪，后面所有的工程手段都是在回应这几点。

**第一，输出是概率性的。** 传统函数给定输入，输出是确定的；模型给定同样的输入，输出可能每次都不一样。更麻烦的是，**模型出错的时候不会报错**。一段幻觉出来的回答和一段正确的回答，在格式、语气、自信程度上看起来一模一样。传统软件的错误大多会以异常、崩溃、500 的形式暴露出来，AI 应用的错误常常安静地流到用户面前。

**第二，一部分逻辑写在自然语言里。** 提示词决定了系统的行为，改一个词就可能改变输出分布。它就是代码，只是这种代码没有编译器，没有类型检查，也很难做单元测试。

**第三，核心组件不在你手里。** 模型是一个外部服务：它会限流、会超时、会过载；供应商会更新模型、调整价格、下线旧版本。你的产品质量，有一大块取决于一个你看不见内部、也改不了的东西。

**第四，质量是一个分布，而不是一个布尔值。** 传统功能要么对要么错，测试用例过了就是过了。AI 功能的质量只能说"在这类输入上，大概九成是好的"，而且这个数字会随着输入分布、提示词、模型版本一起漂移。

所以 AI 应用开发的重心会发生一次转移：**从"把逻辑写对"，转向"约束它、验证它、观测它"。** 约束，是让模型的输出落在你能处理的范围里；验证，是在输出到达用户之前尽量发现错误；观测，是上线以后知道它在真实流量上表现怎么样，并且有办法让它变好。

## 先选形态：能不用模型的地方别用

在写第一行提示词之前，值得先问一个问题：这件事需要多少"智能"？

[搭建 Agent 的基础知识](/posts/agent-basics/#workflow-和-agent) 里讲过一条光谱：一次模型调用、按固定路径编排的 Workflow、由模型自己决定流程的 Agent。对应用开发来说，这条光谱的最左边还应该再加一格：**根本不用模型**。日期解析、金额计算、权限判断、格式校验，这些事情规则和代码做得又快又准，交给模型反而引入了不确定性。

判断一个环节该放在光谱的哪里，我习惯问三个问题：

1. **错了代价多大？** 写一封邮件的草稿错了，用户改一改就好；给客户报一个错误的退款金额，就是事故。
2. **结果能不能验证？** 代码能跑测试，抽取的字段能和原文比对，SQL 能先在只读库上执行；一段"分析报告"的好坏就很难自动判断。
3. **用户在不在环里？** 用户会看一眼再点确认的场景，可以容忍更多错误；全自动、没人看的场景，要求高得多。

代价低、能验证、有人看的环节，可以大胆地让模型多做一点；代价高、难验证、没人看的环节，模型最好只做建议，决定权留给规则或人。几类常见应用大致是这样落位的：

| 应用 | 典型形态 | 关键工程点 |
| --- | --- | --- |
| 信息抽取、分类、打标签 | 单次调用 + 结构化输出 | Schema 设计、校验、批处理成本 |
| 文档问答、知识库助手 | RAG | 解析、检索质量、引用出处 |
| 写作、翻译、改写助手 | 单次调用 + 人在环里 | 流式输出、可编辑、风格控制 |
| 客服、工单处理 | Workflow + 转人工 | 意图路由、护栏、兜底 |
| 编码、调研、数据分析 | Agent | 工具、沙箱、长任务（见 Agent 系列） |

这篇主要讲前四类会遇到的问题，第五类可以去翻 Agent 系列。

## 一次请求的完整链路

一个上线的 AI 功能，用户点一下按钮背后，大致会经过这样一条链路：

<figure class="diagram">
<svg viewBox="0 0 640 290" role="img" aria-label="一次 AI 应用请求从输入检查、上下文组装、模型网关到输出校验的完整链路，每一步都写入追踪日志">
<defs><marker id="aa1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0 0 L10 5 L0 10 z"/></marker></defs>
<rect class="c-gray" x="12" y="40" width="86" height="44" rx="4"/><text class="t" x="55" y="67" text-anchor="middle">用户请求</text>
<rect class="c-red" x="118" y="40" width="86" height="44" rx="4"/><text class="t" x="161" y="67" text-anchor="middle">输入检查</text>
<rect class="c-blue" x="224" y="40" width="86" height="44" rx="4"/><text class="t" x="267" y="67" text-anchor="middle">上下文组装</text>
<rect class="c-purple" x="330" y="40" width="86" height="44" rx="4"/><text class="t" x="373" y="67" text-anchor="middle">模型网关</text>
<rect class="c-red" x="436" y="40" width="86" height="44" rx="4"/><text class="t" x="479" y="67" text-anchor="middle">输出校验</text>
<rect class="c-gray" x="542" y="40" width="86" height="44" rx="4"/><text class="t" x="585" y="67" text-anchor="middle">返回 / 流式</text>
<path class="ln" d="M98 62 H116" marker-end="url(#aa1)"/>
<path class="ln" d="M204 62 H222" marker-end="url(#aa1)"/>
<path class="ln" d="M310 62 H328" marker-end="url(#aa1)"/>
<path class="ln" d="M416 62 H434" marker-end="url(#aa1)"/>
<path class="ln" d="M522 62 H540" marker-end="url(#aa1)"/>
<text class="ts" x="161" y="106" text-anchor="middle">长度 · 频率</text>
<text class="ts" x="161" y="124" text-anchor="middle">敏感信息</text>
<text class="ts" x="161" y="142" text-anchor="middle">权限</text>
<text class="ts" x="267" y="106" text-anchor="middle">提示词模板</text>
<text class="ts" x="267" y="124" text-anchor="middle">检索结果</text>
<text class="ts" x="267" y="142" text-anchor="middle">会话历史</text>
<text class="ts" x="373" y="106" text-anchor="middle">路由 · 缓存</text>
<text class="ts" x="373" y="124" text-anchor="middle">超时 · 重试</text>
<text class="ts" x="373" y="142" text-anchor="middle">降级 · 记账</text>
<text class="ts" x="479" y="106" text-anchor="middle">Schema</text>
<text class="ts" x="479" y="124" text-anchor="middle">业务规则</text>
<text class="ts" x="479" y="142" text-anchor="middle">引用 · 内容策略</text>
<path class="ln dash" d="M161 152 V206"/><path class="ln dash" d="M267 152 V206"/><path class="ln dash" d="M373 152 V206"/><path class="ln dash" d="M479 152 V206"/>
<rect class="c-green" x="118" y="208" width="404" height="36" rx="4"/><text class="t" x="320" y="231" text-anchor="middle">追踪日志：输入、输出、版本、耗时、token、用户反馈</text>
<path class="ln" d="M522 226 H560 V252" marker-end="url(#aa1)"/>
<rect class="c-amber" x="510" y="254" width="118" height="30" rx="4"/><text class="t" x="569" y="274" text-anchor="middle">评测集</text>
</svg>
<figcaption>图 1：模型调用只是链路里的一格。前后的检查、组装、校验和追踪，才是从 Demo 到产品要补的大部分工作。</figcaption>
</figure>

Demo 通常只有中间那一格：把用户输入拼进提示词，调模型，把结果显示出来。产品要把其余几格都补上。下面按这条链路，一段一段地讲。

## 提示词就是代码

既然提示词决定系统行为，就应该像对待代码一样对待它。

**放进版本控制，和代码分开存放。** 提示词写成单独的模板文件，跟着代码一起提交、一起评审。不要散落在业务代码的字符串拼接里，更不要只存在某个人的后台配置中。每次模型调用都记录下用的是哪个版本的提示词，这样线上出了问题，能准确还原当时模型看到的是什么。

```python
from hashlib import sha256
from pathlib import Path
from string import Template

def load_prompt(name: str) -> tuple[Template, str]:
    text = Path(f"prompts/{name}.md").read_text(encoding="utf-8")
    version = sha256(text.encode()).hexdigest()[:8]   # 内容哈希当版本号
    return Template(text), version

tmpl, prompt_version = load_prompt("contract_extract")
prompt = tmpl.substitute(document=doc_text)
# 调用模型时，把 prompt_version 和模型名一起写进日志
```

**结构清楚，指令和数据分开。** 一份好用的提示词通常有固定的骨架：任务是什么、背景资料、规则和约束、示例、输出格式。用户输入和检索到的文档用标签包起来（比如 `<document>...</document>`），既让模型分清哪些是要处理的数据、哪些是给它的指令，也方便你在日志里一眼看出每部分有多长。

**示例比形容词有用。** 写十句"请简洁、专业、准确"，不如给两三个真实的输入输出例子。例子要少而多样，覆盖几种典型情况，尤其要有一个"信息不足时应该怎么回答"的例子，否则模型会默认每个问题都必须给出答案。

**不要对着一个失败用例改提示词。** 用户反馈了一个错误，最自然的反应是在提示词里加一句针对它的规则。这样加上几十次，提示词就会变成一堆互相打架的补丁。更好的做法是把这个用例加进评测集，改完提示词之后在整个评测集上跑一遍，确认修好了它，也没有弄坏别的。评测的细节后面会讲。

## 结构化输出：让下游代码接得住

只要模型的输出不是直接给人看，而是要被代码处理，就需要结构化输出。这件事的可靠性大致有三个层次：

1. **在提示词里要求输出 JSON**。大多数时候能用，但偶尔会多一句"好的，这是你要的 JSON："，或者少一个引号；
2. **JSON 模式**。API 保证输出是合法的 JSON，但不保证字段和类型符合你的预期；
3. **Schema 约束解码**。你提供 JSON Schema，推理时只允许生成符合 Schema 的 token，从机制上保证格式正确。各家 API 都已经提供了这一层，名字叫 Structured Outputs，或者通过工具调用的参数 Schema 实现（原理在 [Agent 的工具](/posts/agent-tools/#从-token-到-json) 里讲过）。

第三层带来的提升是实打实的。OpenAI 在 2024 年推出 Structured Outputs 时给过一组数字：在复杂 Schema 的评测上，打开约束解码后的模型得分 100%，而早期模型只靠提示词时不到 40%<sup class="cite" id="cite-1"><a href="#ref-1" title="Introducing Structured Outputs in the API">1</a></sup>。**能用约束解码就用约束解码**，不要再自己写正则去抠模型回答里的 JSON。

但格式正确不等于内容正确。一个 `amount` 字段永远是数字，不代表这个数字是对的。所以拿到结构化输出之后，还需要一层**语义校验**：

```python
from pydantic import BaseModel, Field, ValidationError, field_validator

class Invoice(BaseModel):
    vendor: str
    amount: float = Field(ge=0)
    currency: str
    due_date: str | None        # 原文没有就是 None，不要逼模型编一个

    @field_validator("currency")
    @classmethod
    def known_currency(cls, v: str) -> str:
        if v not in {"CNY", "USD", "EUR"}:
            raise ValueError(f"currency 只能是 CNY/USD/EUR，收到的是 {v}")
        return v

def extract(doc: str, max_attempts: int = 2) -> Invoice:
    messages = [{"role": "user", "content": render_prompt(doc)}]
    for _ in range(max_attempts):
        raw = llm.structured(messages, schema=Invoice.model_json_schema())
        try:
            inv = Invoice.model_validate_json(raw)
            if inv.vendor not in doc:          # 业务规则：供应商名必须出现在原文里
                raise ValueError(f"vendor '{inv.vendor}' 不在原文中，请照原文抄写")
            return inv
        except (ValidationError, ValueError) as e:
            # 把具体错误喂回去，让模型自己改，通常一次就够
            messages += [{"role": "assistant", "content": raw},
                         {"role": "user", "content": f"输出有问题：{e}。请修正后重新输出。"}]
    raise ExtractionFailed(doc)   # 交给人工队列，而不是硬塞一个结果
```

这段代码里有几个值得单独拎出来说的设计：

- **给"不知道"留位置。** 字段允许为空，或者枚举里带一个 `unknown`。如果 Schema 要求每个字段都必须有值，模型在原文没有信息时就只能编；
- **校验错误要可操作。** 和 [工具的错误信息](/posts/agent-tools/#错误信息告诉它怎么改) 是一个道理，"currency 只能是 CNY/USD/EUR，收到的是 RMB"能让模型一次改对；
- **重试要有上限，失败要有去处。** 重试一两次还不对，就说明这条输入本身有问题，送进人工队列，比无限重试或者硬塞一个默认值好得多；
- **字段顺序有影响。** 模型是按顺序生成的，如果需要它先分析再下结论，就把 `reasoning` 字段放在 `answer` 前面；如果把结论放在最前面，后面的"分析"就只是在为已经生成的结论找理由；
- **能用枚举就别用自由文本。** `priority: "high" | "medium" | "low"` 比 `priority: string` 好处理得多，也更容易统计和评测。

## RAG：大多数 AI 应用的核心

只要应用需要回答"模型训练时不知道的东西"，比如公司的内部文档、产品手册、用户自己的数据，就绕不开 **RAG（检索增强生成）**：先把相关资料找出来，再连同问题一起交给模型。这个思路来自 2020 年的一篇论文<sup class="cite" id="cite-2"><a href="#ref-2" title="Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks">2</a></sup>，现在几乎成了 AI 应用的标准组件。

### 先问：真的需要检索吗

上下文窗口已经很大了。如果你的全部资料加起来不超过二十万 token 左右，Anthropic 的建议是直接把它们整个放进提示词，配合提示词缓存，就能把重复部分的成本和延迟降下来<sup class="cite" id="cite-3"><a href="#ref-3" title="Introducing Contextual Retrieval">3</a></sup>。这样省掉了整条检索链路，也就省掉了"没检索到"这一大类错误。

资料再多、或者会持续增长、或者不同用户能看的资料不同，才需要真正的检索。另外，如果你在做的是 Agent，检索可以做成一个工具，让模型自己决定什么时候查、查什么，这在 [上下文管理](/posts/agent-context-management/#手段五按需检索而不是预先塞满) 里讲过。下面讲的是应用里更常见的形态：由代码来决定检索什么，结果放进提示词。

### 一条完整的 RAG 链路

<figure class="diagram">
<svg viewBox="0 0 640 300" role="img" aria-label="RAG 链路：离线把文档解析、切块并建立向量索引和关键词索引；在线对问题改写后做混合检索、融合和重排序，再生成带引用的回答">
<defs><marker id="ab1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0 0 L10 5 L0 10 z"/></marker></defs>
<rect class="frame" x="10" y="18" width="620" height="84" rx="6"/>
<text class="ts" x="22" y="36">离线：建索引</text>
<rect class="c-gray" x="30" y="50" width="90" height="34" rx="4"/><text class="t" x="75" y="72" text-anchor="middle">原始文档</text>
<rect class="c-gray" x="150" y="50" width="100" height="34" rx="4"/><text class="t" x="200" y="72" text-anchor="middle">解析 · 清洗</text>
<rect class="c-blue" x="280" y="50" width="120" height="34" rx="4"/><text class="t" x="340" y="72" text-anchor="middle">切块 · 补上下文</text>
<rect class="c-purple" x="440" y="50" width="80" height="34" rx="4"/><text class="t" x="480" y="72" text-anchor="middle">向量索引</text>
<rect class="c-amber" x="535" y="50" width="80" height="34" rx="4"/><text class="t" x="575" y="72" text-anchor="middle">BM25 索引</text>
<path class="ln" d="M120 67 H148" marker-end="url(#ab1)"/>
<path class="ln" d="M250 67 H278" marker-end="url(#ab1)"/>
<path class="ln" d="M400 67 H438" marker-end="url(#ab1)"/>
<path class="ln" d="M340 50 V42 H575 V48" marker-end="url(#ab1)"/>
<rect class="frame" x="10" y="122" width="620" height="170" rx="6"/>
<text class="ts" x="22" y="140">在线：回答问题</text>
<rect class="c-gray" x="30" y="158" width="90" height="34" rx="4"/><text class="t" x="75" y="180" text-anchor="middle">用户问题</text>
<rect class="c-blue" x="150" y="158" width="100" height="34" rx="4"/><text class="t" x="200" y="180" text-anchor="middle">查询改写</text>
<rect class="c-purple" x="440" y="158" width="80" height="34" rx="4"/><text class="t" x="480" y="180" text-anchor="middle">向量检索</text>
<rect class="c-amber" x="535" y="158" width="80" height="34" rx="4"/><text class="t" x="575" y="180" text-anchor="middle">关键词检索</text>
<path class="ln dash" d="M480 84 V156"/><path class="ln dash" d="M575 84 V156"/>
<path class="ln" d="M120 175 H148" marker-end="url(#ab1)"/>
<path class="ln" d="M250 175 H438" marker-end="url(#ab1)"/>
<path class="ln" d="M200 192 V204 H575 V194" marker-end="url(#ab1)"/>
<rect class="c-green" x="440" y="236" width="175" height="34" rx="4"/><text class="t" x="527" y="258" text-anchor="middle">RRF 融合 → 重排序</text>
<path class="ln" d="M480 192 V198"/><path class="ln" d="M480 210 V234" marker-end="url(#ab1)"/>
<path class="ln" d="M575 210 V234" marker-end="url(#ab1)"/>
<rect class="c-blue" x="250" y="236" width="150" height="34" rx="4"/><text class="t" x="325" y="258" text-anchor="middle">Top-K → 生成</text>
<path class="ln" d="M440 253 H402" marker-end="url(#ab1)"/>
<rect class="c-gray" x="60" y="236" width="150" height="34" rx="4"/><text class="t" x="135" y="258" text-anchor="middle">回答 + 出处</text>
<path class="ln" d="M250 253 H212" marker-end="url(#ab1)"/>
</svg>
<figcaption>图 2：离线建两套索引，在线做混合检索。每一格都会影响最终回答，而最常被忽视的是最左边的"解析"。</figcaption>
</figure>

### 解析比检索算法更重要

讨论 RAG 时大家喜欢聊向量模型和检索算法，但真实项目里，最大的质量损失常常发生在第一步：**把原始文档变成干净的文本**。PDF 里的表格被拍成一行乱序的数字，双栏排版被从左到右横着读，每一页的页眉页脚混进正文，扫描件压根没有文字层。这些问题后面任何算法都救不回来。

所以建 RAG 的第一件事，是随机抽几十份文档，**亲眼看看解析出来的文本长什么样**。表格转成 Markdown 表格或者逐行的"列名：值"，标题层级保留下来，图片至少留下说明文字。这一步很枯燥，但投入产出比最高。

### 切块：别让一块文字失去上下文

文档要切成小块才能检索。按固定字数硬切最简单，也最容易出问题：一个表格被拦腰切断，一段话的主语在上一块、谓语在下一块。更好的做法是**按文档结构切**，以标题、段落、列表项为边界，再控制每块的大小，相邻块之间留一点重叠。

即使切得很干净，单独的一块也常常缺少上下文。Anthropic 举过一个例子：一块文字写着"公司收入比上一季度增长了 3%"，单看这一块，既不知道是哪家公司，也不知道是哪个季度，检索时自然很难被"ACME 公司 2023 年第二季度的收入增长"这个问题找到<sup class="cite"><a href="#ref-3" title="Introducing Contextual Retrieval">3</a></sup>。

他们的解法叫 **Contextual Retrieval**：在建索引之前，让一个便宜的模型读完整篇文档，为每一块生成一两句说明它在全文中位置的话，拼在块的前面，再去做向量化和关键词索引。在他们的测试里，这个做法把检索失败率降低了 49%，再加上重排序，降低了 67%<sup class="cite"><a href="#ref-3" title="Introducing Contextual Retrieval">3</a></sup>。代价是建索引时每一块都要调用一次模型，好在整篇文档是重复的前缀，可以靠提示词缓存省下大部分费用。即使不用模型，最朴素的版本也很有用：把文档标题和章节路径拼在每一块前面。

### 混合检索：向量和关键词各有所长

向量检索擅长语义匹配，用户问"怎么退货"，它能找到写着"商品退换流程"的段落。但它不擅长**精确匹配**：产品型号、错误码、人名、合同编号这类字符串，语义上没什么含义，向量很可能找不准。用户搜 `ERR-4031`，向量检索可能给你一堆讲其他错误码的段落。

这正是老牌的关键词检索 BM25 擅长的。所以实用的做法是两路一起查，再把结果融合。最常用的融合方法是 **RRF（Reciprocal Rank Fusion）**<sup class="cite" id="cite-4"><a href="#ref-4" title="Reciprocal Rank Fusion outperforms Condorcet and individual rank learning methods">4</a></sup>，它只看排名、不看分数，所以不用操心两路检索的分数尺度不一样：

```python
def rrf(rankings: list[list[str]], k: int = 60) -> list[str]:
    """rankings 是几路检索各自返回的文档 id 列表，按相关度从高到低排好。"""
    scores: dict[str, float] = {}
    for ranking in rankings:
        for rank, doc_id in enumerate(ranking, start=1):
            scores[doc_id] = scores.get(doc_id, 0.0) + 1.0 / (k + rank)
    return sorted(scores, key=scores.get, reverse=True)

candidates = rrf([vector_search(q, top=50), bm25_search(q, top=50)])
```

### 重排序：先多召回，再精挑

向量检索为了快，问题和文档是分开编码的，彼此看不见，所以排序比较粗。**重排序模型（Reranker）** 会把问题和每个候选块放在一起读，给出更准的相关度。代价是慢，所以通常的做法是：混合检索先召回五十个候选，重排序挑出最相关的五到十个，再放进提示词。

### 生成：让模型能说"资料里没有"

检索到的资料放进提示词以后，还有几件事要做对：

- **要求引用出处。** 让模型在每个论断后面标出依据的是哪一块资料，前端把它渲染成可点击的来源。这既方便用户核对，也给了你一个自动检查的抓手：引用的块是否真的存在，块里是否真的有相关内容；
- **允许说不知道。** 在提示词里明确写上"如果资料里没有答案，就直接说没有找到"，并且在示例里演示一次。否则模型会用自己的知识去补，这正是 RAG 想避免的幻觉；
- **别塞太多。** 研究发现，模型对长上下文中间部分的信息利用得最差，放在开头和结尾的信息更容易被用上<sup class="cite" id="cite-5"><a href="#ref-5" title="Lost in the Middle: How Language Models Use Long Contexts">5</a></sup>。新模型在这方面好了很多，但"多塞几块总没坏处"仍然不成立，无关的块会分散注意力，也会被错误地引用。

### 两件常被忽略的事

**检索和生成要分开评测。** RAG 回答错了，可能是没检索到，也可能是检索到了但模型没用好，两种问题的修法完全不同。准备一份"问题 → 应该命中哪些文档"的标注集，单独算检索的召回率（比如前十个结果里命中了几个应命中的文档）。召回率低就去改解析、切块和检索；召回率高但回答仍然错，再去改提示词和模型。

**权限要在检索层做。** 企业知识库里，不同人能看的文档不一样。权限过滤必须在检索时就做掉，只把当前用户有权看的块交给模型。不要指望在提示词里写"不要透露机密文档的内容"，只要它进了上下文，就有办法被问出来。

## 延迟：用户感受到的才算

模型生成是慢的。一个几百字的回答，生成完可能要五到十秒，这在传统的 Web 应用里是不可接受的。延迟优化要先分清**用户到底在等什么**。

几个最有用的指标：

- **首字时间（TTFT，Time To First Token）**：从发出请求到看到第一个字的时间，决定了用户觉得"它有没有在响应"；
- **总时长**：生成完整结果的时间，对需要等全部结果才能继续的场景（比如结构化抽取）才是关键；
- **看 p95，不要只看平均值。** 模型 API 的延迟长尾很明显，平均三秒的接口，最慢的那 5% 可能要二十秒，而用户记住的恰恰是那二十秒。

### 流式输出：最便宜的体验优化

对面向人的文本输出，**流式输出**几乎是必选项。总时长一秒没变，但用户在不到一秒的时候就看到字开始出现，体感完全不同：

<figure class="diagram">
<svg viewBox="0 0 640 200" role="img" aria-label="非流式和流式输出的时间线对比：总时长相同，但流式在不到一秒时就开始显示内容">
<text class="t" x="20" y="52">非流式</text>
<rect class="c-gray" x="100" y="36" width="420" height="24" rx="3"/>
<text class="ts" x="310" y="52" text-anchor="middle">空白等待</text>
<rect class="c-green" x="520" y="36" width="12" height="24" rx="2"/>
<text class="ts" x="540" y="52">一次性出现</text>
<text class="t" x="20" y="112">流式</text>
<rect class="c-gray" x="100" y="96" width="30" height="24" rx="3"/>
<rect class="c-green" x="130" y="96" width="402" height="24" rx="3"/>
<text class="ts" x="330" y="112" text-anchor="middle">内容逐步出现，用户已经在读</text>
<path class="ln" d="M130 126 V138"/><text class="ts" x="130" y="152" text-anchor="middle">首字 ≈ 0.6s</text>
<path class="ln" d="M100 176 H532"/>
<path class="ln" d="M100 171 V181"/><text class="ts" x="100" y="196" text-anchor="middle">0s</text>
<path class="ln" d="M532 171 V181"/><text class="ts" x="532" y="196" text-anchor="middle">≈ 8s</text>
<path class="ln dash" d="M532 30 V170"/>
</svg>
<figcaption>图 3：两种方式的总时长一样，但流式把"等待"变成了"阅读"。</figcaption>
</figure>

流式输出和结构化输出之间有点冲突：JSON 没生成完就没法解析。常见的处理方式有两种：一是用能解析不完整 JSON 的库，边生成边渲染已经完整的字段；二是把任务拆开，先流式输出给人看的文字，再单独生成需要机器处理的结构化部分。

### 其他几个手段

- **减少输出 token。** 模型处理输入很快，生成输出是一个 token 一个 token 地来，总时长基本由输出长度决定。让模型只输出需要的内容，不要复述问题、不要客套话、不要在 JSON 里输出用不到的字段，常常比换一个更快的模型效果还明显；
- **并行。** 互相不依赖的调用并发发出去。比如同时生成摘要和提取关键词，而不是一个接一个；
- **提示词缓存。** 前缀命中缓存时首字时间会明显缩短，长系统提示词和大段参考资料的场景尤其有用，原理在 [上下文管理](/posts/agent-context-management/#一个容易被忽略的约束缓存) 里讲过；
- **小模型做简单的事。** 意图分类、查询改写这类前置步骤，用小而快的模型就够了；
- **产品上接受"慢"。** 有些任务本来就要几十秒，那就做成后台任务：显示进度，允许用户离开页面，完成后通知。比让用户盯着一个转圈强。

## 成本：按 token 算账

传统服务的成本主要看机器，AI 应用的成本主要看 token，而且是随着用量线性增长的。很多团队是在收到第一张大账单之后，才开始认真算这笔账。

### 先算一笔账

假设一个文档问答功能，每次请求的输入是 6000 token（系统提示词、检索到的资料、问题），输出 500 token。按输入每百万 token 3 美元、输出每百万 token 15 美元的价格（这是假设的价格，量级接近目前的中档模型，实际以各家的价格表为准）：

- 每次请求：6000 × 3 / 10⁶ + 500 × 15 / 10⁶ ≈ 0.018 + 0.0075 = **0.0255 美元**；
- 每天一万次请求，一个月大约 **7600 美元**。

注意两件事。第一，**输出 token 的单价通常是输入的好几倍**，但在这个例子里，输入因为量大，反而占了成本的大头。第二，这 6000 token 的输入里，系统提示词和固定说明可能占了 5000，每次都一样。如果这 5000 token 命中了提示词缓存，按缓存读取约为原价一成的常见定价，输入成本就从 0.018 降到 0.0045 美元左右，**总成本直接少了一半**。

### 几个主要的省钱手段

- **提示词缓存。** 如上所述，前缀稳定、重复度高的场景收益最大。代价是要按缓存的规则组织提示词：稳定的内容放前面，会变的内容放后面；
- **模型分级。** 不是每个请求都需要最强的模型。可以用一个路由器（规则或小模型）按难度分流，也可以做**级联**：先让便宜的模型试，校验不过再交给贵的模型；
- **批处理接口。** 不需要实时返回的任务，比如夜间给全部工单打标签、离线生成摘要，用各家的 Batch API，价格通常是实时调用的一半左右；
- **压缩输入。** 检索结果只放真正相关的几块，对话历史太长时做摘要，删掉提示词里没人记得为什么要加的那几段；
- **限制输出长度。** 设好 `max_tokens`，并在提示词里明确要求的长度。

<figure class="diagram">
<svg viewBox="0 0 640 200" role="img" aria-label="模型级联：请求先交给小模型，校验通过直接返回，不通过再交给大模型">
<defs><marker id="ac1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0 0 L10 5 L0 10 z"/></marker></defs>
<rect class="c-gray" x="20" y="60" width="90" height="40" rx="4"/><text class="t" x="65" y="85" text-anchor="middle">请求</text>
<rect class="c-blue" x="150" y="60" width="110" height="40" rx="4"/><text class="t" x="205" y="85" text-anchor="middle">小模型</text>
<rect class="c-red" x="300" y="60" width="100" height="40" rx="4"/><text class="t" x="350" y="85" text-anchor="middle">校验</text>
<rect class="c-green" x="500" y="60" width="110" height="40" rx="4"/><text class="t" x="555" y="85" text-anchor="middle">返回</text>
<rect class="c-purple" x="300" y="145" width="100" height="40" rx="4"/><text class="t" x="350" y="170" text-anchor="middle">大模型</text>
<path class="ln" d="M110 80 H148" marker-end="url(#ac1)"/>
<path class="ln" d="M260 80 H298" marker-end="url(#ac1)"/>
<path class="sg" d="M400 80 H496" marker-end="url(#ac1)"/>
<text class="ts" x="448" y="72" text-anchor="middle">通过（多数）</text>
<path class="sr" d="M350 100 V141" marker-end="url(#ac1)"/>
<text class="ts" x="360" y="125">不通过</text>
<path class="ln" d="M400 165 H555 V104" marker-end="url(#ac1)"/>
<text class="ts" x="205" y="45" text-anchor="middle">便宜、快</text>
<text class="ts" x="250" y="170" text-anchor="end">贵、慢、只处理难例</text>
</svg>
<figcaption>图 4：级联的前提是"校验"这一格足够可靠，比如 Schema 校验、规则检查或置信度阈值。校验不可靠时，级联只会让错误更便宜地流出去。</figcaption>
</figure>

最后，**成本要能按功能、按用户拆开看**。给每次调用打上功能名和用户 ID 的标签，你才知道钱花在了哪里；给每个用户设用量上限，才不会被一个写脚本刷接口的人在一夜之间烧掉一个月的预算。

## 可靠性：把模型当成一个不太稳定的外部服务

从工程角度看，模型 API 就是一个外部依赖，而且是一个延迟高、偶尔过载、会被限流的依赖。对付它的手段，和对付任何不稳定的外部服务没有本质区别，只是更需要认真做。

- **超时。** 流式请求要设两种超时：等首字的超时，和两个 token 之间的空闲超时。只设一个总超时，长回答会被误杀，卡住的连接又会挂很久；
- **重试。** 只重试可以重试的错误：限流（429）、服务端错误（5xx）、过载。请求本身有问题（400）重试多少次都没用。重试用指数退避加随机抖动，避免一群客户端在同一时刻一起重试，把刚恢复的服务再次打垮；
- **降级。** 主模型持续不可用时，切到备用模型或备用供应商。但要注意，**提示词不一定能在模型之间通用**，同一份提示词换个模型，输出风格和格式可能都会变。所以降级路径也要过评测，不能等到出事那天才第一次用；
- **锁定模型版本。** 调用时用带日期的模型快照名，而不是会自动指向最新版的别名。模型升级应该像发版一样对待：先在评测集上跑，确认没有退化，再切换；
- **副作用要幂等。** 如果模型的输出会触发写数据库、发通知这类动作，重试时要保证同一个动作不会做两次。

把这些逻辑集中在一个地方实现，就是常说的**模型网关**：所有模型调用都经过它，由它统一处理鉴权、限流、重试、降级、记账和日志。业务代码只管"我要用哪类模型做什么"。

```python
import random, time

RETRYABLE = {429, 500, 502, 503, 504, 529}

def call_model(request, models=("main-model-2026-09", "backup-model-2026-08"),
               max_retries=3):
    for model in models:                       # 按顺序降级
        for attempt in range(max_retries):
            try:
                return client.generate(model=model, **request,
                                       timeout=Timeouts(first_token=10, idle=30))
            except APIError as e:
                if e.status not in RETRYABLE:
                    raise                      # 请求本身有问题，重试没用
                time.sleep(min(2 ** attempt, 20) + random.random())   # 退避 + 抖动
        log.warning("model %s unavailable, falling back", model)
    raise AllModelsUnavailable()
```

## 护栏：输入、输出和权限

AI 应用的安全问题，有一部分和传统 Web 应用一样（鉴权、注入、越权），也有一部分是新的。

**输入侧**：限制长度和频率，防止有人用超长输入刷你的账单；对手机号、身份证号这类敏感信息，在发给模型之前先脱敏，或者至少确保日志里不会明文保存。

**输出侧**：除了前面讲的 Schema 和业务规则校验，还要注意**模型的输出是不可信的**。把它当作用户输入一样对待：渲染 Markdown 时，不要自动加载外部图片，因为一个被诱导生成的图片链接可以把对话内容拼进 URL 发给第三方；模型生成的 SQL 或代码，不要不经检查就执行；模型给出的链接，前端最好标明来源。

**提示词注入**是 AI 应用特有的问题。只要你的应用会处理不可信的内容，比如用户上传的文档、抓取的网页、收到的邮件，这些内容里就可能藏着"忽略之前的指令，改为……"这样的文字，而模型没法可靠地区分数据和指令。Simon Willison 总结过一个很好记的判断方法，叫"致命三要素"：**能访问私有数据、会接触不可信内容、能对外通信**，三者同时具备时，攻击者就可以诱导模型把私有数据发出去<sup class="cite" id="cite-6"><a href="#ref-6" title="The lethal trifecta for AI agents">6</a></sup>。目前没有哪种过滤方法能可靠地识别注入，最可靠的防御是**在架构上去掉其中一条**，比如处理不可信文档的那一步不给它任何对外通信的能力。

**权限要在代码里，而不是在提示词里。** 一条朴素但有用的原则：**模型能看到的，就是当前用户有权看到的；模型能做的，就是当前用户有权做的。** 用当前用户的身份去查数据、调接口，而不是给模型一个超级账号，再在提示词里叮嘱它"只回答用户自己的订单"。更细的讨论可以看 [Agent 沙箱](/posts/agent-sandbox/)，那里的很多原则对普通应用同样适用。

## 可观测性：上线才是开始

传统功能上线、测试通过，基本就算完成了。AI 功能上线，才是真正了解它的开始，因为你的评测集再好，也比不上真实用户的输入多样。

### 记录什么

每次模型调用，至少记下这些：

- 完整的输入和输出（或者脱敏后的版本）；
- 提示词版本、模型名、关键参数；
- 检索到了哪些块，各自的得分；
- 首字时间、总时长、输入输出 token 数、是否命中缓存；
- 这次调用属于哪个用户、哪个功能、哪个会话。

一次用户请求可能包含好几次模型调用（改写查询、生成、校验），所以要用一个 trace ID 把它们串起来，出问题时能看到完整的过程。这些日志里有大量用户数据，**访问权限和保留期限要提前定好**。

### 用户反馈

点赞、点踩这类显式反馈很有价值，但非常稀疏，大多数用户什么都不点。**隐式反馈**的量要大得多：用户是否复制了回答，是否点了"重新生成"，是否大幅修改了生成的草稿，是否在得到回答后立刻转人工。这些信号要在产品设计阶段就埋好。

### 去读数据

所有指标和仪表盘都比不上**亲自读一读真实的输入和输出**。Hamel Husain 在一篇很受欢迎的文章里反复强调这一点：大部分成功的 AI 产品团队，都有固定的习惯去看原始数据，而不是只看汇总指标<sup class="cite" id="cite-7"><a href="#ref-7" title="Your AI Product Needs Evals">7</a></sup>。每周抽五十条真实对话读一遍，给失败的案例分分类，你会发现很多仪表盘永远告诉不了你的问题：用户其实在问一类你没想到的问题，某类文档的解析一直是坏的，模型在某种措辞下总是答非所问。

### 数据飞轮

把上面这些连起来，就是 AI 应用持续变好的方式：

<figure class="diagram">
<svg viewBox="0 0 640 290" role="img" aria-label="数据飞轮：上线后采集轨迹与反馈，读数据找到失败，沉淀为评测用例，修改提示词、检索或模型，离线回归评测通过后再上线">
<defs><marker id="ad1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0 0 L10 5 L0 10 z"/></marker></defs>
<rect class="c-green" x="250" y="16" width="140" height="36" rx="4"/><text class="t" x="320" y="39" text-anchor="middle">上线</text>
<rect class="c-gray" x="460" y="80" width="160" height="36" rx="4"/><text class="t" x="540" y="103" text-anchor="middle">采集轨迹与反馈</text>
<rect class="c-blue" x="460" y="174" width="160" height="36" rx="4"/><text class="t" x="540" y="197" text-anchor="middle">读数据 · 找失败</text>
<rect class="c-amber" x="250" y="238" width="140" height="36" rx="4"/><text class="t" x="320" y="261" text-anchor="middle">沉淀为评测用例</text>
<rect class="c-purple" x="20" y="174" width="160" height="36" rx="4"/><text class="t" x="100" y="197" text-anchor="middle">改提示词 · 检索 · 模型</text>
<rect class="c-red" x="20" y="80" width="160" height="36" rx="4"/><text class="t" x="100" y="103" text-anchor="middle">离线回归评测</text>
<path class="ln" d="M390 34 H540 V78" marker-end="url(#ad1)"/>
<path class="ln" d="M540 116 V172" marker-end="url(#ad1)"/>
<path class="ln" d="M540 210 V256 H392" marker-end="url(#ad1)"/>
<path class="ln" d="M250 256 H100 V212" marker-end="url(#ad1)"/>
<path class="ln" d="M100 174 V118" marker-end="url(#ad1)"/>
<path class="ln" d="M100 80 V34 H248" marker-end="url(#ad1)"/>
<text class="ts" x="320" y="138" text-anchor="middle">每转一圈</text>
<text class="ts" x="320" y="158" text-anchor="middle">评测集就更像真实流量一点</text>
</svg>
<figcaption>图 5：评测集不是一次性写好的，而是从线上失败里一条一条长出来的。</figcaption>
</figure>

这个循环里，评测集是关键的一环：它把"线上发现的问题"变成"以后每次改动都会自动检查的用例"。没有它，你修好一个问题的同时，可能悄悄弄坏了另外两个。评测本身怎么设计，任务怎么写、评分器怎么选、非确定性怎么处理，我在 [Agent 评测](/posts/agent-evaluation/) 里写得比较详细，那些方法对普通 AI 应用同样适用，而且因为应用的路径更短、更固定，做起来通常更简单。

## 产品设计：为"会出错"而设计

最后说一点产品层面的事。工程能把错误率压低，但压不到零。一个好的 AI 产品，不是假装自己不会出错，而是**让出错的代价变低**。

- **设定合理的预期。** 告诉用户这是什么、能做什么、不擅长什么，比在角落里放一行"AI 生成内容仅供参考"有用得多；
- **展示依据。** 回答附上出处，抽取结果高亮原文的位置，让用户花两秒就能核对；
- **让修改便宜。** 把输出做成可以直接编辑的草稿，而不是一个只能整体接受或拒绝的结果。用户改一个词比重新生成一次快得多，而用户修改的内容本身也是很好的反馈；
- **给失败留出口。** 回答不了时转人工、提供搜索、给出相关文档，而不是硬编一个答案；
- **自动化程度循序渐进。** 先做"建议"，让用户确认后执行；数据证明准确率足够高之后，再升级为"一键确认"，最后才是"自动执行"。每升一级，都要有数据支撑。

## 动手时的几条建议

1. **先选形态**。能用规则的别用模型，能一次调用的别做 Workflow，能 Workflow 的别上 Agent；
2. **提示词进版本控制**，每次调用记录提示词版本和模型快照名；
3. **结构化输出用约束解码**，再加一层语义校验，失败了把错误喂回去重试一次，还不行就转人工；
4. **做 RAG 先看解析结果**，再按结构切块、补上下文、混合检索加重排序；检索和生成分开评测，权限在检索层做；
5. **面向人的输出一律流式**，盯首字时间和 p95，砍掉不必要的输出 token；
6. **上线前算一遍成本**，按缓存的规则组织提示词，非实时任务走批处理，按功能和用户拆账、设上限；
7. **模型调用都走网关**：超时、只重试可重试的错误、降级路径也要过评测；
8. **把模型输出当不可信输入**，权限写在代码里，警惕"私有数据 + 不可信内容 + 对外通信"同时出现；
9. **上线后每周读真实数据**，把失败沉淀成评测用例，让每次改动都过一遍回归。

## 小结

1. **AI 应用和传统软件的根本差别**，在于输出是概率性的、出错时不会报错、核心组件不在自己手里，所以工程重心从"写对逻辑"转向"约束、验证、观测"；
2. **模型调用只是链路里的一格**：前面有输入检查和上下文组装，后面有输出校验，旁边有网关和追踪；
3. **提示词是代码，结构化输出是契约**：前者要版本化、靠评测改，后者要约束解码加语义校验，并且给"不知道"留位置；
4. **RAG 的质量大多在检索之前就决定了**：解析、切块和上下文，比换一个向量模型重要得多；
5. **延迟看用户感受，成本按 token 算账**：流式、缓存、模型分级和批处理，是最常用的几把扳手；
6. **可靠性和安全靠架构，不靠提示词**：网关负责重试和降级，权限写在代码里，不可信内容和对外能力不放在一起；
7. **上线才是开始**：读真实数据，把失败变成评测用例，让应用在一圈圈的循环里变好。

回头看，AI 应用开发里真正新的东西其实不多：概率性的输出、写在自然语言里的逻辑、一个会自己"发挥"的外部依赖。其余大部分，比如版本管理、超时重试、权限、日志、测试，都是软件工程里早就有的老办法。**难的不是学会新东西，而是在一个看起来很聪明的组件面前，依然坚持把这些老办法做完。**

## 参考文献

<section class="refs">
<ol>
<li id="ref-1"><span class="ref-n">[1]</span><span>OpenAI. <a href="https://openai.com/index/introducing-structured-outputs-in-the-api/">Introducing Structured Outputs in the API</a>. <i>OpenAI Blog</i>, 2024. <a class="ref-back" href="#cite-1" aria-label="回到正文">↩</a></span></li>
<li id="ref-2"><span class="ref-n">[2]</span><span>Lewis P. et al. <a href="https://arxiv.org/abs/2005.11401">Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks</a>. <i>NeurIPS</i>, 2020. <a class="ref-back" href="#cite-2" aria-label="回到正文">↩</a></span></li>
<li id="ref-3"><span class="ref-n">[3]</span><span>Anthropic. <a href="https://www.anthropic.com/news/contextual-retrieval">Introducing Contextual Retrieval</a>. <i>Anthropic News</i>, 2024. <a class="ref-back" href="#cite-3" aria-label="回到正文">↩</a></span></li>
<li id="ref-4"><span class="ref-n">[4]</span><span>Cormack G. V., Clarke C. L. A., Büttcher S. <a href="https://dl.acm.org/doi/10.1145/1571941.1572114">Reciprocal Rank Fusion outperforms Condorcet and individual rank learning methods</a>. <i>SIGIR</i>, 2009. <a class="ref-back" href="#cite-4" aria-label="回到正文">↩</a></span></li>
<li id="ref-5"><span class="ref-n">[5]</span><span>Liu N. F. et al. <a href="https://arxiv.org/abs/2307.03172">Lost in the Middle: How Language Models Use Long Contexts</a>. <i>TACL</i>, 2024. <a class="ref-back" href="#cite-5" aria-label="回到正文">↩</a></span></li>
<li id="ref-6"><span class="ref-n">[6]</span><span>Willison S. <a href="https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/">The lethal trifecta for AI agents: private data, untrusted content, and external communication</a>. <i>simonwillison.net</i>, 2025. <a class="ref-back" href="#cite-6" aria-label="回到正文">↩</a></span></li>
<li id="ref-7"><span class="ref-n">[7]</span><span>Husain H. <a href="https://hamel.dev/blog/posts/evals/">Your AI Product Needs Evals</a>. <i>hamel.dev</i>, 2024. <a class="ref-back" href="#cite-7" aria-label="回到正文">↩</a></span></li>
</ol>
</section>
