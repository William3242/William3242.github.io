---
title: Agent 可观测性：看清一次运行里到底发生了什么
description: Agent 上线以后，最常见的故障不是报错，而是"请求成功了，答案却不对"，或者账单悄悄翻了一倍。这篇讲 LLM 和 Agent 应用的可观测性：怎么把一次运行建模成 trace 和 span，OpenTelemetry GenAI 语义约定规定了什么，token、成本、延迟、缓存命中率这些指标怎么算，提示词内容要不要记，Langfuse、LangSmith 这类工具怎么选，以及怎样把线上数据接回评测，形成闭环。
pubDate: 2026-11-25
tags: [Agent, LLM, 可观测性, OpenTelemetry]
---

一个 Agent 在本地跑得好好的，上线一周后开始收到反馈："它有时候会卡住很久"、"上次回答得挺好，这次完全答非所问"、"这个月的 API 账单怎么翻倍了"。打开日志一看，所有请求都是 HTTP 200，没有一条报错。

这就是 LLM 应用可观测性要解决的问题。传统服务出问题，通常会以异常、超时、5xx 的形式暴露出来；Agent 出问题，往往表现为**成功地做错了事**：模型多绕了十圈才完成任务、工具返回了错误但被模型"解释"过去了、上下文里的一个时间戳让缓存全部失效。不把每一步都记下来，这些问题既看不见，也复现不了。

这篇按这样的顺序讲：先说清楚 Agent 的可观测性和传统 APM 有什么不同，再讲怎么把一次运行建模成 trace，接着是 OpenTelemetry 的 GenAI 语义约定、该看的指标、内容记录的取舍、工具选型，最后落到线上评测和反馈闭环。

## 为什么 Agent 要单独谈可观测性

传统的可观测性有三根支柱：**日志、指标、链路追踪**。Google SRE 总结的"四个黄金信号"是延迟、流量、错误和饱和度<sup class="cite" id="cite-1"><a href="#ref-1" title="Site Reliability Engineering: Monitoring Distributed Systems">1</a></sup>。这些在 LLM 应用里依然有用，但不够，因为 Agent 有几个传统服务没有的特点：

- **非确定性**：同一个输入，两次运行可能走出完全不同的路径。线上出的问题，本地重跑一遍大概率复现不了，必须当时就把现场记下来；
- **错误是语义上的**：模型返回了一段格式正确、语气自信、内容错误的回答。HTTP 状态码、异常栈都帮不上忙，需要有人或者有模型去**判断质量**；
- **成本随每次请求剧烈波动**：一个简单问题花几千 token，一个复杂任务可能循环几十轮、花掉几百万 token。成本不再是按机器算的固定开销，而是每个请求的变量；
- **一次请求是一条长轨迹**：用户的一句话背后，是多轮模型调用、多次工具调用、可能还有子 Agent。只看入口和出口，中间发生的一切都是黑盒。

所以 LLM 应用的可观测性通常以 **trace（链路）为核心**，指标从 trace 里聚合出来，再在 trace 上挂**评分**（人工反馈、自动评估）来回答"做得对不对"。这最后一点，是它和传统 APM 最大的区别：除了"快不快、挂没挂"，还要回答"好不好"。

## 把一次运行建模成 trace

### trace 和 span

链路追踪的基本概念来自 Google 的 Dapper<sup class="cite" id="cite-2"><a href="#ref-2" title="Dapper, a Large-Scale Distributed Systems Tracing Infrastructure">2</a></sup>：一次完整的请求是一个 **trace**，它由一棵 **span** 树组成。每个 span 代表一个有起止时间的操作，带着自己的属性，并指向它的父 span。跨进程时，trace ID 和父 span ID 通过请求头传递，W3C Trace Context 规定了标准格式 `traceparent`<sup class="cite" id="cite-3"><a href="#ref-3" title="W3C Trace Context">3</a></sup>。

套到 Agent 上，映射非常自然。[Agent 循环](/posts/agent-basics/)本身就是一棵树：一次 Agent 调用是根 span，下面是一轮轮的模型调用和工具调用，工具里如果又调了子 Agent，就再往下长一层。

<figure class="diagram">
<svg viewBox="0 0 680 300" role="img" aria-label="一次 Agent 运行的瀑布图：根 span 是 invoke_agent，耗时 9.8 秒；下面依次是第一次模型调用、web_search 工具、第二次模型调用、read_file 工具、一次失败的 run_python 工具调用和重试、最后一次模型调用">
<text class="ts" x="20" y="26">span</text>
<text class="ts" x="240" y="26">0s</text><text class="ts" x="440" y="26" text-anchor="middle">5s</text><text class="ts" x="652" y="26" text-anchor="end">10s</text>
<path class="ln dash" d="M450 34 V262"/>
<text class="t" x="20" y="56">invoke_agent researcher</text>
<rect class="c-purple" x="240" y="42" width="411" height="20" rx="3"/>
<text class="ts" x="345" y="56" text-anchor="middle">9.8s · 3 次模型调用 · 4 次工具调用</text>
<text class="t" x="34" y="88">chat 第 1 轮</text>
<rect class="c-blue" x="240" y="74" width="67" height="20" rx="3"/>
<text class="ts" x="314" y="88">1.6s · 12.4K 入 / 180 出</text>
<text class="t" x="34" y="120">execute_tool web_search</text>
<rect class="c-green" x="307" y="106" width="76" height="20" rx="3"/>
<text class="ts" x="390" y="120">1.8s</text>
<text class="t" x="34" y="152">chat 第 2 轮</text>
<rect class="c-blue" x="383" y="138" width="67" height="20" rx="3"/>
<text class="ts" x="457" y="152">1.6s · 15.1K 入（缓存 12.4K）</text>
<text class="t" x="34" y="184">execute_tool read_file</text>
<rect class="c-green" x="450" y="170" width="13" height="20" rx="3"/>
<text class="ts" x="470" y="184">0.3s</text>
<text class="t" x="34" y="216">execute_tool run_python</text>
<rect class="c-red" x="463" y="202" width="40" height="20" rx="3"/>
<rect class="c-green" x="507" y="202" width="65" height="20" rx="3"/>
<text class="ts" x="578" y="216">超时后重试</text>
<text class="t" x="34" y="248">chat 第 3 轮</text>
<rect class="c-blue" x="572" y="234" width="80" height="20" rx="3"/>
<text class="ts" x="565" y="248" text-anchor="end">1.9s · 输出最终答案</text>
<text class="ts" x="20" y="286">紫：Agent　蓝：模型调用　绿：工具调用　红：失败（status = ERROR）</text>
</svg>
<figcaption>图 1：一次 Agent 运行的瀑布图。用户只感受到"等了快 10 秒"，trace 能告诉你时间花在哪、哪一步失败过、每轮读了多少缓存。</figcaption>
</figure>

这张图里能直接读出很多东西：一半的时间花在工具上而不是模型上；`run_python` 第一次超时了，重试才成功；第 2 轮的 15.1K 输入里有 12.4K 命中了缓存。没有 trace，这些只能靠猜。

### trace 之上还有一层：会话

一个 trace 通常对应用户的**一轮**输入。但多轮对话里，问题常常要放到整段会话里看：第 5 轮答错了，原因可能是第 2 轮的工具结果把上下文带偏了。所以几乎所有 LLM 可观测性工具都在 trace 之上加了一层**会话**（Langfuse 叫 session，LangSmith 叫 thread），用一个会话 ID 把多个 trace 串起来。

再加上评分，完整的数据模型是这样的：

<figure class="diagram">
<svg viewBox="0 0 680 250" role="img" aria-label="数据模型的层级：会话包含多个 trace，每个 trace 包含 Agent、模型调用、工具调用等 span；评分可以挂在会话、trace 或单个 span 上">
<rect class="frame" x="20" y="20" width="500" height="210" rx="8"/>
<text class="t" x="36" y="42">会话 Session / Thread（conversation.id）</text>
<rect class="c-gray" x="36" y="56" width="140" height="160" rx="6"/>
<text class="t" x="106" y="76" text-anchor="middle">Trace：第 1 轮</text>
<rect class="c-gray" x="196" y="56" width="308" height="160" rx="6"/>
<text class="t" x="350" y="76" text-anchor="middle">Trace：第 2 轮</text>
<rect class="c-purple" x="210" y="88" width="280" height="30" rx="4"/>
<text class="t" x="350" y="108" text-anchor="middle">invoke_agent</text>
<rect class="c-blue" x="224" y="128" width="80" height="30" rx="4"/>
<text class="t" x="264" y="148" text-anchor="middle">chat</text>
<rect class="c-green" x="312" y="128" width="80" height="30" rx="4"/>
<text class="t" x="352" y="148" text-anchor="middle">execute_tool</text>
<rect class="c-blue" x="400" y="128" width="80" height="30" rx="4"/>
<text class="t" x="440" y="148" text-anchor="middle">chat</text>
<rect class="c-purple" x="50" y="88" width="112" height="30" rx="4"/>
<text class="t" x="106" y="108" text-anchor="middle">invoke_agent</text>
<rect class="c-blue" x="64" y="128" width="84" height="30" rx="4"/>
<text class="t" x="106" y="148" text-anchor="middle">chat</text>
<text class="ts" x="350" y="196" text-anchor="middle">span 树：父子关系 + 起止时间 + 属性</text>
<rect class="c-amber" x="550" y="40" width="112" height="44" rx="6"/>
<text class="t" x="606" y="60" text-anchor="middle">会话级评分</text><text class="ts" x="606" y="76" text-anchor="middle">任务最终是否完成</text>
<rect class="c-amber" x="550" y="110" width="112" height="44" rx="6"/>
<text class="t" x="606" y="130" text-anchor="middle">trace 级评分</text><text class="ts" x="606" y="146" text-anchor="middle">用户点赞 / 点踩</text>
<rect class="c-amber" x="550" y="180" width="112" height="44" rx="6"/>
<text class="t" x="606" y="200" text-anchor="middle">span 级评分</text><text class="ts" x="606" y="216" text-anchor="middle">检索结果是否相关</text>
<path class="ln dash" d="M550 62 H520"/><path class="ln dash" d="M550 132 H504"/><path class="ln dash" d="M550 202 H480 V158"/>
</svg>
<figcaption>图 2：会话 ⊃ trace ⊃ span，评分可以挂在任意一层。"做得对不对"是挂上去的数据，不是从 span 里自动算出来的。</figcaption>
</figure>

### span 的粒度

span 切多细是一个取舍。太粗，问题定位不到具体哪一步；太细，trace 里全是噪声，存储成本也上去了。一般的建议是：

- **每一次模型调用**一个 span，这是成本和延迟的主要来源，必须有；
- **每一次工具调用**一个 span，工具是 Agent 最常出错的地方（见 [工具调用](/posts/agent-tools/)）；
- **每一次 Agent / 子 Agent 调用**一个 span，作为一棵子树的根（见 [子 Agent](/posts/agent-subagents/)）；
- 检索、重排、上下文压缩、护栏检查这类有独立语义、可能单独出问题的步骤，各自一个 span；
- 纯粹的字符串拼接、格式转换，不需要单独建 span。

## OpenTelemetry GenAI 语义约定

如果每个框架、每个平台都按自己的方式命名属性，那么换一个后端就得重写一遍埋点。OpenTelemetry 的 **GenAI 语义约定**就是为了解决这个问题：它规定了生成式 AI 相关的 span 叫什么名字、带哪些属性、属性叫什么<sup class="cite" id="cite-4"><a href="#ref-4" title="OpenTelemetry Semantic Conventions for Generative AI">4</a></sup>。

先说两件背景：

- 这套约定**目前还是 Development 状态**，所有 `gen_ai.*` 属性都还可能改名。之前就发生过一次比较大的改动：标识厂商的属性从 `gen_ai.system` 改成了 `gen_ai.provider.name`；
- 2026 年 6 月，GenAI 约定从 OpenTelemetry 的主语义约定仓库**拆到了独立仓库** `semantic-conventions-genai`，目的是让这个领域能比核心约定迭代得更快<sup class="cite" id="cite-5"><a href="#ref-5" title="OpenTelemetry GenAI Semantic Conventions Explained">5</a></sup>。实际使用时，建议锁定埋点库的版本，而不是去追规范的某个版本。

### 操作类型和 span 名

每个 span 用 `gen_ai.operation.name` 标明它是哪类操作。常用的几种：

| `gen_ai.operation.name` | 含义 | 推荐的 span 名 |
|---|---|---|
| `chat` / `text_completion` / `generate_content` | 一次模型推理 | `chat claude-sonnet-4-5` |
| `embeddings` | 向量化 | `embeddings text-embedding-3-small` |
| `invoke_agent` | 调用一个 Agent | `invoke_agent researcher` |
| `create_agent` | 创建 Agent（多见于托管 Agent 服务） | `create_agent researcher` |
| `execute_tool` | 执行一次工具调用 | `execute_tool web_search` |
| `retrieval` | 检索 | `retrieval {数据源 ID}` |

规范里还列了 `invoke_workflow`、`plan`，以及一组记忆操作（`search_memory`、`upsert_memory` 等），说明它正在从"单次模型调用"扩展到 Agent 运行时的方方面面。span 名的规律是**操作名 + 操作对象**：模型调用跟模型名，Agent 调用跟 Agent 名，工具调用跟工具名。这样在任何后端里按 span 名分组，就能直接得到"每个模型 / 每个工具的耗时分布"。

### 常用属性

| 类别 | 属性 | 说明 |
|---|---|---|
| 身份 | `gen_ai.provider.name` | 厂商，如 `anthropic`、`openai`、`aws.bedrock` |
| | `gen_ai.request.model` / `gen_ai.response.model` | 请求的模型和实际响应的模型（别名可能被解析成具体版本） |
| 用量 | `gen_ai.usage.input_tokens` / `gen_ai.usage.output_tokens` | 输入、输出 token 数 |
| | `gen_ai.usage.cache_read.input_tokens` | 命中缓存的输入 token 数 |
| 结果 | `gen_ai.response.finish_reasons` | 结束原因，如 `["stop"]`、`["length"]` |
| | `gen_ai.response.id` | 厂商返回的请求 ID，对账和找厂商排查时用 |
| 关联 | `gen_ai.conversation.id` | 会话 ID，把多个 trace 串成会话 |
| | `gen_ai.agent.name` / `gen_ai.agent.id` | Agent 的名字和 ID |
| | `gen_ai.tool.name` / `gen_ai.tool.call.id` | 工具名，以及模型给这次调用分配的 ID |
| 内容（需显式开启） | `gen_ai.system_instructions` | 系统提示词 |
| | `gen_ai.input.messages` / `gen_ai.output.messages` | 输入和输出的消息 |
| | `gen_ai.tool.definitions` | 工具定义 |

注意最后一组：**提示词和回答的内容默认不采集**。规范明确标注这些属性"很可能包含敏感信息，包括用户 / PII 数据"，要求用户显式开启。各个埋点库开启的方式不完全一样，常见的是一个环境变量，比如 `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT`。后面会专门讲这件事怎么取舍。

指标方面，规范也定义了一组直方图，比如客户端侧的 `gen_ai.client.token.usage`、`gen_ai.client.operation.duration`，服务端（自部署推理引擎）侧的 `gen_ai.server.time_to_first_token`、`gen_ai.server.time_per_output_token`。

### 手动埋一个 Agent 循环

大部分时候不需要手写：OpenLLMetry、OpenInference 这类库，以及 Langfuse、LangSmith 的 SDK，都能自动给主流的模型 SDK 和框架埋点<sup class="cite" id="cite-6"><a href="#ref-6" title="OpenLLMetry">6</a></sup>。但手写一遍有助于理解 trace 里每个字段是从哪来的。下面是一个用 OpenTelemetry Python API 给 Agent 循环埋点的骨架：

```python
from opentelemetry import trace
from opentelemetry.trace import SpanKind, Status, StatusCode

tracer = trace.get_tracer("my-agent")
MODEL = "claude-sonnet-4-5"

def run_agent(task: str, conversation_id: str) -> str:
    with tracer.start_as_current_span("invoke_agent researcher") as span:
        span.set_attribute("gen_ai.operation.name", "invoke_agent")
        span.set_attribute("gen_ai.agent.name", "researcher")
        span.set_attribute("gen_ai.conversation.id", conversation_id)

        messages = [{"role": "user", "content": task}]
        for step in range(MAX_STEPS):
            resp = call_llm(messages)              # 自动成为子 span
            if resp.stop_reason != "tool_use":
                span.set_attribute("agent.steps", step + 1)
                return resp.text
            messages += run_tools(resp.tool_calls)  # 每个工具一个子 span
        span.set_status(Status(StatusCode.ERROR, "max steps exceeded"))
        raise RuntimeError("agent did not finish")

def call_llm(messages):
    with tracer.start_as_current_span(f"chat {MODEL}", kind=SpanKind.CLIENT) as span:
        span.set_attribute("gen_ai.operation.name", "chat")
        span.set_attribute("gen_ai.provider.name", "anthropic")
        span.set_attribute("gen_ai.request.model", MODEL)
        resp = client.messages.create(model=MODEL, messages=messages, ...)
        u = resp.usage
        span.set_attribute("gen_ai.response.model", resp.model)
        span.set_attribute("gen_ai.response.id", resp.id)
        span.set_attribute("gen_ai.response.finish_reasons", [resp.stop_reason])
        span.set_attribute("gen_ai.usage.input_tokens",
            u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens)
        span.set_attribute("gen_ai.usage.output_tokens", u.output_tokens)
        span.set_attribute("gen_ai.usage.cache_read.input_tokens", u.cache_read_input_tokens)
        return resp
```

有一个细节值得单独拎出来：**各家对"输入 token"的口径不一样。** Anthropic 返回的 `input_tokens` 只是未命中缓存的那部分，缓存读取和写入另外列；OpenAI 返回的 `prompt_tokens` 则已经包含了 `cached_tokens`。如果埋点时不统一口径，同一个看板上两家的数字就没法比，算出来的缓存命中率也会错。上面的代码在写入时把 Anthropic 的三部分加了起来，让 `input_tokens` 表示"总输入"。

另外，`agent.steps` 这种规范里没有的属性，完全可以自己加。约定解决的是"大家都需要的字段叫什么"，业务相关的维度（用户等级、租户、功能开关、提示词版本）照样应该挂上去，它们往往是排查时最有用的过滤条件。

## 该看哪些指标

trace 回答"这一次发生了什么"，指标回答"整体怎么样、在变好还是变坏"。指标大多是从 span 属性里聚合出来的，下面按类别列一遍：

| 类别 | 指标 | 怎么算 | 为什么看 |
|---|---|---|---|
| 成本 | 每任务 token / 成本 | 按 trace 汇总各 span 的 token × 单价 | 成本是请求级变量，要看分布而不只是总和 |
| | 成本的 P95 / P99 | 每任务成本的分位数 | 少数"失控"的任务可能吃掉大半预算 |
| 延迟 | 端到端耗时 | 根 span 时长 | 用户实际等待的时间 |
| | TTFT | 流式输出时首个 token 到达的时间 | 决定"有没有反应"的体感 |
| | 模型 vs 工具时间占比 | 按 span 类型汇总时长 | 决定该优化模型调用还是工具 |
| 缓存 | 缓存命中率 | 缓存读取 token ÷ 总输入 token | 直接决定成本和 TTFT |
| 行为 | 每任务步数 | 根 span 下的模型调用次数 | 步数突然上升，常是提示词或工具出了问题 |
| | 达到步数上限的比例 | 带"max steps"错误的根 span 占比 | Agent 原地打转的信号 |
| | `length` 截断比例 | `finish_reasons` 含 `length` 的模型调用占比 | 输出被截断，后续解析多半会失败 |
| 错误 | 工具错误率 | 状态为 ERROR 的工具 span 占比，按工具分组 | 找出最不靠谱的工具 |
| | 限流 / 过载 | 429、529 等状态码计数 | 容量和重试策略 |
| 质量 | 在线评分、用户反馈 | 评分的均值和分布，按版本分组 | 唯一能回答"好不好"的指标 |

几个容易踩坑的地方：

**成本要按 trace 看，而不是按调用看。** 一次模型调用很便宜，但一个任务里可能有几十次。更重要的是看分布：一个 Agent 的平均成本可能只有几分钱，但 P99 的任务循环了五十轮、花了几块钱。这种长尾在平均值里根本看不出来。

**缓存命中率要按"每轮"来理解。** 在[上一篇讲 KV Cache 的文章](/posts/kv-cache-prompt-caching/)里说过，一个健康的多轮循环，每轮的缓存读取量应该约等于之前的全部上下文，写入量只有新增的那一小段。命中率突然跌下来，通常是有人往提示词开头加了个时间戳，或者改了工具定义的顺序。缓存失效不会报错，只有这个指标能发现它。

算成本时也要把缓存算进去。以 Anthropic 的计价方式为例，设基础输入单价为 p，缓存读取是 0.1p，5 分钟缓存的写入是 1.25p：

```
单次调用成本 = 未缓存输入 × p + 缓存写入 × 1.25p + 缓存读取 × 0.1p + 输出 × p_out
```

同样是 15K 输入，命中 12K 缓存和完全不命中，输入部分的成本能差三倍多。只按"总输入 token × 单价"估算，会把一个缓存做得好的 Agent 的成本高估好几倍。

**延迟要拆开看。** Agent 的端到端延迟是模型时间、工具时间、排队和重试时间的总和。图 1 那个例子，如果只看端到端的 9.8 秒，你可能会想去换一个更快的模型；拆开一看，`run_python` 超时重试就占了 2.6 秒，换模型根本解决不了。

## 提示词内容：记还是不记

这是 LLM 可观测性里最纠结的一个问题。只记元数据（模型、token、耗时、状态），很多问题根本没法排查：你知道第 3 轮输出被截断了，但不知道模型当时在写什么；你知道检索 span 很快，但不知道召回的文档对不对。可一旦记下完整内容，trace 存储里就有了用户的原始输入、上传的文档、工具读到的文件，它成了系统里**最敏感的数据库之一**。

常见的几种做法，可以组合使用：

- **按环境区分**：开发和测试环境全量记录内容；生产环境默认只记元数据，按需开启；
- **采样**：只对一部分 trace 记录内容。比较实用的是"尾部采样"：先把整条 trace 缓存在 Collector 里，等它结束后再决定保不保留，出错的、慢的、被点踩的全留，正常的按比例抽；
- **脱敏**：在应用内或 Collector 里先用规则或模型把手机号、邮箱、证件号、密钥这类东西替换掉，再发出去；
- **内容分开存**：span 里只放一个引用，内容本身放进权限更严、保留期更短的存储。GenAI 约定里也有类似的设计，允许用 `*_ref` 属性指向外部存储的内容；
- **多租户隔离**：SaaS 产品里，trace 必须带租户标识，查询时按租户隔离，思路和[用 RLS 做数据隔离](/posts/postgres-rls/)一样。

另外别忘了**保留期**。trace 数据量增长很快，内容尤其大。元数据和聚合指标可以留很久，原始内容一般只需要留够排查和抽样标注的时间。

## 数据怎么流：埋点、Collector 和后端

<figure class="diagram">
<svg viewBox="0 0 680 270" role="img" aria-label="可观测性数据的流向：应用通过自动埋点或 SDK 产生 span，经 OTLP 发给 OpenTelemetry Collector，Collector 负责采样、脱敏和路由，再分别发往 LLM 可观测性平台、通用指标和链路后端，以及内容存储。另一条路径是网关代理，在应用和模型 API 之间记录每次调用">
<defs><marker id="ob3" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0 0 L10 5 L0 10 z"/></marker></defs>
<rect class="c-blue" x="20" y="60" width="150" height="96" rx="8"/>
<text class="t" x="95" y="84" text-anchor="middle">Agent 应用</text>
<text class="ts" x="95" y="106" text-anchor="middle">自动埋点</text>
<text class="ts" x="95" y="124" text-anchor="middle">（OpenLLMetry 等）</text>
<text class="ts" x="95" y="142" text-anchor="middle">+ 手动业务属性</text>
<path class="ln" d="M170 108 H236" marker-end="url(#ob3)"/>
<text class="ts" x="203" y="100" text-anchor="middle">OTLP</text>
<rect class="c-purple" x="240" y="48" width="170" height="120" rx="8"/>
<text class="t" x="325" y="72" text-anchor="middle">OTel Collector</text>
<text class="ts" x="325" y="96" text-anchor="middle">尾部采样</text>
<text class="ts" x="325" y="114" text-anchor="middle">脱敏 / 删掉内容字段</text>
<text class="ts" x="325" y="132" text-anchor="middle">按目的地路由</text>
<text class="ts" x="325" y="150" text-anchor="middle">批量、重试</text>
<path class="ln" d="M410 70 H476" marker-end="url(#ob3)"/>
<path class="ln" d="M410 108 H476" marker-end="url(#ob3)"/>
<path class="ln" d="M410 146 H476" marker-end="url(#ob3)"/>
<rect class="c-amber" x="480" y="44" width="180" height="40" rx="6"/>
<text class="t" x="570" y="61" text-anchor="middle">LLM 可观测性平台</text>
<text class="ts" x="570" y="77" text-anchor="middle">Langfuse / LangSmith 等</text>
<rect class="c-green" x="480" y="90" width="180" height="40" rx="6"/>
<text class="t" x="570" y="107" text-anchor="middle">通用链路与指标</text>
<text class="ts" x="570" y="123" text-anchor="middle">Tempo / Prometheus 等</text>
<rect class="c-gray" x="480" y="136" width="180" height="40" rx="6"/>
<text class="t" x="570" y="153" text-anchor="middle">内容存储</text>
<text class="ts" x="570" y="169" text-anchor="middle">权限更严、保留更短</text>
<rect class="c-gray" x="20" y="200" width="150" height="48" rx="8"/>
<text class="t" x="95" y="220" text-anchor="middle">另一条路：网关代理</text>
<text class="ts" x="95" y="238" text-anchor="middle">改 base URL 即可接入</text>
<path class="ln dash" d="M95 156 V196" marker-end="url(#ob3)"/>
<path class="ln dash" d="M170 224 H476" marker-end="url(#ob3)"/>
<rect class="c-gray" x="480" y="204" width="180" height="40" rx="6"/>
<text class="t" x="570" y="229" text-anchor="middle">模型 API</text>
<text class="ts" x="320" y="216" text-anchor="middle">只看得到模型调用，看不到工具和 Agent 结构</text>
</svg>
<figcaption>图 3：埋点产生 span，Collector 负责"留什么、去哪里"，后端负责查和看。网关代理接入最省事，但只能看到模型调用这一层。</figcaption>
</figure>

接入方式大致有三种：

1. **网关 / 代理**：把模型 API 的 base URL 指向一个代理，由它记录每次请求和响应。几乎零代码，还能顺手做限流、故障转移、统一计费。缺点是它只看得到模型调用，工具调用、Agent 的父子结构它都不知道，一个 Agent 任务在它眼里只是一串互不相关的请求；
2. **SDK / 装饰器**：用可观测性平台自己的 SDK，给函数加装饰器或者用上下文管理器。能看到完整的树，接入成本中等，但会和某个平台绑定；
3. **OpenTelemetry 埋点**：用遵循 GenAI 约定的埋点库，数据以 OTLP 发出，后端可以随时换，也可以同时发给多个后端。现在主流的平台基本都能接收 OTLP，Langfuse 新版的 SDK 本身就构建在 OpenTelemetry 之上。

如果团队已经有一套 OpenTelemetry 体系，第三种是最自然的选择：Agent 的 span 和它调用的 HTTP 服务、数据库的 span 在同一条 trace 里，一个工具调用慢了，可以一路追到是哪条 SQL 慢。

## 工具怎么选

LLM 可观测性工具这两年非常多，下面挑几个有代表性的：

| | 定位 | 数据模型 | 特点 |
|---|---|---|---|
| Langfuse<sup class="cite" id="cite-7"><a href="#ref-7" title="Langfuse: Observation Types">7</a></sup> | 开源，可自托管 | trace → observation；会话、评分 | observation 分 span、generation、agent、tool、retriever、evaluator、guardrail 等类型；带提示词管理、数据集、LLM 评审 |
| LangSmith<sup class="cite" id="cite-8"><a href="#ref-8" title="LangSmith: Online evaluations">8</a></sup> | LangChain 出品，托管为主 | project → trace → run；thread | 和 [LangChain / LangGraph](/posts/langchain-langgraph/) 集成最深；在线评估、标注队列、数据集和实验 |
| Arize Phoenix<sup class="cite" id="cite-9"><a href="#ref-9" title="OpenInference Semantic Conventions">9</a></sup> | 开源，可本地跑 | 基于 OpenInference 约定的 span | span 分 LLM、TOOL、AGENT、RETRIEVER、EMBEDDING 等类型；评估和检索分析做得多 |
| 网关类（Helicone 等） | 代理接入 | 请求日志 | 接入最快，偏成本和请求层面 |
| 通用 APM（Datadog、Grafana 等） | 已有监控体系 | 标准 OTel span | 和其他服务放在一起看；LLM 专用视图在逐步补齐 |

选的时候可以问自己几个问题：

- **数据能不能出公司？** 不能就选能自托管的（Langfuse、Phoenix），或者让 Collector 把内容字段在出网前删掉；
- **用的什么框架？** 重度使用 LangGraph 的话，LangSmith 几乎零配置；自己写的循环或者混用多家 SDK，OpenTelemetry 路线更灵活；
- **要不要评估和数据集？** 只看链路的话很多工具都行；要把线上数据变成评测集、跑实验对比，就需要平台自带这部分能力；
- **已有的监控在哪？** 已经全面使用 OpenTelemetry 的团队，可以先让 Agent 的 span 进现有后端，再按需加一个 LLM 专用平台，Collector 双写即可。

工具本身不是最难的部分。真正决定可观测性做得好不好的，是 span 切得对不对、业务属性挂得全不全，以及团队有没有养成定期看 trace 的习惯。

## 线上评测：把"好不好"也变成数据

前面的指标能告诉你"快不快、贵不贵、错没错"，但回答不了最重要的那个问题：**答得好不好**。这需要在 trace 上挂评分。评分有三个来源：

- **用户反馈**：显式的点赞点踩、评分、文字反馈，以及隐式的信号：用户是否马上重新提问、是否复制了答案、是否撤销了 Agent 的改动、是否中途放弃。显式反馈很稀疏（大多数用户不会点），隐式信号量大但噪声也大；
- **在线自动评估**：对线上 trace 按比例抽样，用规则或者 LLM 评审自动打分。比如"回答是否基于检索到的文档"、"是否调用了不该调用的工具"、"有没有泄露系统提示词"。LangSmith、Langfuse 都支持配置这样的评估器，在新 trace 进来时自动运行，多轮对话还可以在整个 thread 结束后评一次；
- **人工标注**：把值得看的 trace 放进**标注队列**，让领域专家逐条打分、写下正确答案。成本最高，但质量也最高，而且是校准 LLM 评审的基准。

在线评估和离线评测（见 [Agent 评测](/posts/agent-evaluation/)）的区别在于：离线评测在固定的任务集上跑，有标准答案，适合回答"这次改动有没有让已知的事情变差"；在线评估跑在真实流量上，通常没有标准答案，只能评"有没有明显的问题"，但它能发现你没想到的失败。

### 反馈闭环

把这些拼在一起，就是 LLM 应用开发里最重要的一个循环：

<figure class="diagram">
<svg viewBox="0 0 680 300" role="img" aria-label="反馈闭环：线上 trace 经过在线评估和用户反馈打分，筛出失败和可疑的样本进入标注队列，人工确认后加入回归评测集，改动先在评测集上离线评测，通过后发布，发布后又产生新的线上 trace">
<defs><marker id="ob4" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0 0 L10 5 L0 10 z"/></marker></defs>
<rect class="c-blue" x="250" y="20" width="180" height="50" rx="8"/>
<text class="t" x="340" y="41" text-anchor="middle">① 线上 trace</text>
<text class="ts" x="340" y="59" text-anchor="middle">真实用户、真实输入</text>
<rect class="c-amber" x="470" y="100" width="190" height="50" rx="8"/>
<text class="t" x="565" y="121" text-anchor="middle">② 打分</text>
<text class="ts" x="565" y="139" text-anchor="middle">在线评估 + 用户反馈</text>
<rect class="c-red" x="470" y="200" width="190" height="50" rx="8"/>
<text class="t" x="565" y="221" text-anchor="middle">③ 筛出坏例</text>
<text class="ts" x="565" y="239" text-anchor="middle">低分、点踩、报错、超长</text>
<rect class="c-purple" x="250" y="240" width="180" height="50" rx="8"/>
<text class="t" x="340" y="261" text-anchor="middle">④ 人工标注</text>
<text class="ts" x="340" y="279" text-anchor="middle">确认问题，写下期望结果</text>
<rect class="c-green" x="20" y="200" width="190" height="50" rx="8"/>
<text class="t" x="115" y="221" text-anchor="middle">⑤ 加入回归评测集</text>
<text class="ts" x="115" y="239" text-anchor="middle">每个线上失败变成一条用例</text>
<rect class="c-gray" x="20" y="100" width="190" height="50" rx="8"/>
<text class="t" x="115" y="121" text-anchor="middle">⑥ 改动 → 离线评测 → 发布</text>
<text class="ts" x="115" y="139" text-anchor="middle">评测通过才上线</text>
<path class="ln" d="M430 50 C 500 50, 560 70, 563 96" marker-end="url(#ob4)"/>
<path class="ln" d="M565 150 V196" marker-end="url(#ob4)"/>
<path class="ln" d="M470 236 C 450 250, 445 262, 434 264" marker-end="url(#ob4)"/>
<path class="ln" d="M250 265 C 230 262, 220 250, 212 238" marker-end="url(#ob4)"/>
<path class="ln" d="M115 200 V154" marker-end="url(#ob4)"/>
<path class="ln" d="M115 100 C 118 70, 180 50, 246 46" marker-end="url(#ob4)"/>
<text class="ts" x="340" y="150" text-anchor="middle">可观测性提供原料</text>
<text class="ts" x="340" y="168" text-anchor="middle">评测把原料变成护栏</text>
</svg>
<figcaption>图 4：线上发现的每一个新失败，都应该变成离线评测集里的一条用例。可观测性和评测是同一个循环的两半。</figcaption>
</figure>

这个循环里，可观测性平台的价值不只是"看"，还在于让每一步的摩擦尽量小：在 trace 详情页一键把它加进数据集，把输入和当时的上下文原样带过去；评测跑完后，失败的用例能直接跳回对应的 trace。做到这一点，"线上出问题 → 评测集里多一条用例 → 下次改动自动拦住同类问题"才能真正转起来，而不是停在口号上。

还有一个容易被忽略的点：**trace 要记下"当时用的是哪个版本"**。提示词版本、模型版本、工具集版本、代码的 commit，都应该作为属性挂在根 span 上。否则看到质量下降，你不知道是哪次改动导致的；做 A/B 测试，也没法按版本把评分分开统计。

## 用 trace 排查的几个典型场景

最后看几个具体的问题，在 trace 里分别长什么样：

- **Agent 原地打转**：根 span 下有几十次 `chat` 和同一个工具交替出现，工具参数几乎一样。通常是工具返回的错误信息不够清楚，模型不知道换个做法。去看工具 span 的输出，改错误提示（参考 [Harness 工程](/posts/agent-harness/)里讲的反馈类控制）；
- **答案突然变差**：按提示词版本分组看在线评分，找到下降的那个版本；再对比新旧版本同类问题的 trace，看模型在哪一步开始走偏；
- **成本突然上涨**：先看是每任务步数涨了，还是每步 token 涨了。步数涨了看上一条；每步 token 涨了，看缓存命中率是不是跌了，再看是不是哪个工具返回了超大的结果，把上下文撑爆了（见 [上下文管理](/posts/agent-context-management/)）；
- **偶发的超长延迟**：按 span 类型拆分 P99 延迟，看是模型还是工具。如果是模型调用，看是不是撞上了限流重试；如果是某个工具，就和普通服务一样，沿着 trace 往下追；
- **输出解析失败**：看出错之前那次模型调用的 `finish_reasons`，如果是 `length`，就是 `max_tokens` 设小了，输出被截断。

这些场景有一个共同点：**光看一个数字解决不了问题，要能从指标下钻到 trace，再从 trace 下钻到具体的输入输出。** 指标告诉你哪里不对，trace 告诉你为什么。

## 动手时的几条建议

1. **从第一天就埋点**。trace 最大的价值在出事的那一刻，而那一刻往往没有预兆。等出了问题再加埋点，需要的现场已经没了；
2. **优先用 OpenTelemetry 和 GenAI 约定**，即使后端选的是某个专用平台。约定还在变，但至少字段名大体一致，以后迁移成本低得多；
3. **统一 token 口径**，在埋点层就把各家的缓存字段换算成统一的"总输入 / 缓存读取 / 缓存写入 / 输出"；
4. **在根 span 上挂版本和业务维度**：提示词版本、模型、代码版本、用户、租户、功能开关。排查时最常用的就是按这些维度筛选；
5. **想清楚内容记录策略**，再上生产。开发环境全记，生产环境采样加脱敏，内容单独存、短保留；
6. **给每个 Agent 设步数和成本上限**，并把触发上限作为一种错误记下来。它是最便宜的"失控"报警；
7. **定期读 trace**。看板只能告诉你已知的问题，没想到的问题只能靠人读出来。每周抽二十条线上 trace 从头读到尾，收获往往比看一个月的看板还多。

## 小结

1. **Agent 的故障常常是"成功地做错了事"**：没有异常、没有报错，只有绕远路、答错和账单变贵。可观测性要回答的不只是快不快、挂没挂，还有好不好；
2. **trace 是核心**：一次 Agent 运行是一棵 span 树，Agent、模型调用、工具调用各一个 span；trace 之上用会话串起多轮，任意一层都可以挂评分；
3. **OpenTelemetry GenAI 语义约定**统一了 span 名和属性：`gen_ai.operation.name` 标明操作类型，`gen_ai.usage.*` 记 token，`gen_ai.conversation.id` 串会话。它仍处于 Development 状态，2026 年拆到了独立仓库，用的时候锁定埋点库版本；
4. **指标要按任务看分布**：每任务成本的长尾、缓存命中率、每任务步数、截断比例、按工具分组的错误率，比平均延迟更能说明问题。成本计算要把缓存的折扣和写入加价都算进去；
5. **内容记录是隐私和可调试性的权衡**：默认不采集，按环境、采样、脱敏、分开存储来平衡；
6. **把线上数据接回评测**：在线评估和用户反馈筛出坏例，人工确认后进入回归评测集，下一次改动先过评测再上线。可观测性和评测，是同一个循环的两半。

<section class="refs">
<ol>
<li id="ref-1"><span class="ref-n">[1]</span><span>Beyer B. et al. (eds.). <a href="https://sre.google/sre-book/monitoring-distributed-systems/">Monitoring Distributed Systems</a>. In <i>Site Reliability Engineering</i>, O'Reilly, 2016. <a class="ref-back" href="#cite-1" aria-label="回到正文">↩</a></span></li>
<li id="ref-2"><span class="ref-n">[2]</span><span>Sigelman B. H. et al. <a href="https://research.google/pubs/dapper-a-large-scale-distributed-systems-tracing-infrastructure/">Dapper, a Large-Scale Distributed Systems Tracing Infrastructure</a>. <i>Google Technical Report</i>, 2010. <a class="ref-back" href="#cite-2" aria-label="回到正文">↩</a></span></li>
<li id="ref-3"><span class="ref-n">[3]</span><span>W3C. <a href="https://www.w3.org/TR/trace-context/">Trace Context</a>. <i>W3C Recommendation</i>. <a class="ref-back" href="#cite-3" aria-label="回到正文">↩</a></span></li>
<li id="ref-4"><span class="ref-n">[4]</span><span>OpenTelemetry. <a href="https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-spans.md">Semantic Conventions for Generative AI Spans</a>. <i>open-telemetry/semantic-conventions-genai</i>. <a class="ref-back" href="#cite-4" aria-label="回到正文">↩</a></span></li>
<li id="ref-5"><span class="ref-n">[5]</span><span>Dash0. <a href="https://www.dash0.com/knowledge/opentelemetry-genai-semantic-conventions-explained">OpenTelemetry GenAI Semantic Conventions Explained</a>. 2026. <a class="ref-back" href="#cite-5" aria-label="回到正文">↩</a></span></li>
<li id="ref-6"><span class="ref-n">[6]</span><span>Traceloop. <a href="https://github.com/traceloop/openllmetry">OpenLLMetry: Open-source observability for your LLM application, based on OpenTelemetry</a>. <i>GitHub</i>. <a class="ref-back" href="#cite-6" aria-label="回到正文">↩</a></span></li>
<li id="ref-7"><span class="ref-n">[7]</span><span>Langfuse. <a href="https://langfuse.com/docs/observability/features/observation-types">Observation Types</a>. <i>Langfuse Documentation</i>. <a class="ref-back" href="#cite-7" aria-label="回到正文">↩</a></span></li>
<li id="ref-8"><span class="ref-n">[8]</span><span>LangChain. <a href="https://docs.langchain.com/langsmith/online-evaluations">Online evaluations</a>. <i>LangSmith Documentation</i>. <a class="ref-back" href="#cite-8" aria-label="回到正文">↩</a></span></li>
<li id="ref-9"><span class="ref-n">[9]</span><span>Arize AI. <a href="https://github.com/Arize-ai/openinference/blob/main/spec/semantic_conventions.md">OpenInference Semantic Conventions</a>. <i>GitHub</i>. <a class="ref-back" href="#cite-9" aria-label="回到正文">↩</a></span></li>
</ol>
</section>
