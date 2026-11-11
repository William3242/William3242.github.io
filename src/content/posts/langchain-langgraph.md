---
title: LangChain 与 LangGraph：一个管搭积木，一个管怎么跑
description: LangChain 和 LangGraph 经常被混着说，但它们解决的是两层不同的问题。这篇从两者的关系讲起，先过一遍 LangChain 1.0 以后的基础积木、create_agent 和中间件，再拆开 LangGraph：状态和 reducer、超步执行模型、Command 和 Send、检查点和时间旅行、interrupt、流式、Functional API 和长期记忆，最后聊聊 Deep Agents，以及什么时候该用、什么时候不该用这套框架。
pubDate: 2026-11-11
tags: [Agent, LLM, 框架]
---

前面几篇讲 Agent，我一直刻意不绑定框架：[工具调用](/posts/agent-tools/) 用的是裸的 Messages API，[Harness](/posts/agent-harness/) 讲的是一套和框架无关的组件。原因很简单，框架换得比概念快，先把概念讲清楚，换什么框架都看得懂。

但真动手做项目，绕不开的一个问题就是"要不要用 LangChain"。这个名字的口碑很分裂：有人说它是 Agent 开发的事实标准，有人说它是"过度抽象"的代名词。更让人困惑的是，它后来又多出了一个 LangGraph，官方还说"LangChain 的 Agent 跑在 LangGraph 上"，两者到底是什么关系，很多人其实没理清。

这篇就专门把这两个东西讲清楚。内容以 2025 年 10 月发布的 1.0 为分界线<sup class="cite" id="cite-1"><a href="#ref-1" title="LangChain and LangGraph Agent Frameworks Reach v1.0 Milestones">1</a></sup>，代码基于现在的 1.x 版本（写这篇时 `langchain` 是 1.4，`langgraph` 是 1.2）。1.0 之前的写法（`LLMChain`、`AgentExecutor`、LCEL 的那一大堆管道）我只在讲历史时提一句，不再展开。

## 先说结论：两层东西

一句话版本：**LangChain 管"用什么搭"，LangGraph 管"怎么跑"。**

- **LangChain** 是一组积木和一个现成的 Agent：统一的模型接口、消息格式、工具定义、结构化输出，加上一个 `create_agent`，几行代码就能得到一个能调工具的 Agent。官方的说法是"构建 Agent 最快的方式"<sup class="cite"><a href="#ref-1" title="LangChain and LangGraph Agent Frameworks Reach v1.0 Milestones">1</a></sup>。
- **LangGraph** 是一个更底层的编排框架和运行时：你把流程画成一张图，它负责按图执行，并且把状态持久化、可中断、可恢复、可流式输出这些"生产环境才会遇到的问题"做成了一等公民<sup class="cite" id="cite-2"><a href="#ref-2" title="What's new in LangGraph v1">2</a></sup>。

两者的关系是叠起来的，而不是并列的：

<figure class="diagram">
<svg viewBox="0 0 640 300" role="img" aria-label="LangChain 生态的分层：最底层是 langchain-core 和集成包，上面是 LangGraph 运行时，再上面是 create_agent 或自己写的图，最上面是 Deep Agents，LangSmith 贯穿各层">
<rect class="c-purple" x="20" y="20" width="230" height="44" rx="4"/>
<text class="t" x="135" y="39" text-anchor="middle">Deep Agents</text>
<text class="ts" x="135" y="56" text-anchor="middle">规划 · 文件系统 · 子 Agent</text>
<rect class="c-blue" x="20" y="76" width="230" height="44" rx="4"/>
<text class="t" x="135" y="95" text-anchor="middle">langchain：create_agent</text>
<text class="ts" x="135" y="112" text-anchor="middle">现成的 Agent 循环 + 中间件</text>
<rect class="c-green" x="270" y="76" width="230" height="44" rx="4"/>
<text class="t" x="385" y="95" text-anchor="middle">自己写的图</text>
<text class="ts" x="385" y="112" text-anchor="middle">StateGraph · Functional API</text>
<rect class="c-amber" x="20" y="132" width="480" height="44" rx="4"/>
<text class="t" x="260" y="151" text-anchor="middle">LangGraph 运行时</text>
<text class="ts" x="260" y="168" text-anchor="middle">状态 · 超步调度 · 检查点 · 中断 · 流式</text>
<rect class="c-gray" x="20" y="188" width="480" height="44" rx="4"/>
<text class="t" x="260" y="207" text-anchor="middle">langchain-core</text>
<text class="ts" x="260" y="224" text-anchor="middle">消息 · 模型接口 · 工具 · Runnable</text>
<rect class="c-gray" x="20" y="244" width="480" height="44" rx="4"/>
<text class="t" x="260" y="263" text-anchor="middle">集成包</text>
<text class="ts" x="260" y="280" text-anchor="middle">langchain-openai · langchain-anthropic · …</text>
<rect class="c-gray" x="520" y="20" width="100" height="268" rx="4"/>
<text class="t" x="570" y="146" text-anchor="middle">LangSmith</text>
<text class="ts" x="570" y="166" text-anchor="middle">追踪 · 评测</text>
<text class="ts" x="570" y="184" text-anchor="middle">部署</text>
</svg>
<figcaption>图 1：create_agent 本身就是一张编译好的 LangGraph 图；需要更多控制时，往下一层自己画图。LangSmith 是可选的商业服务，不用它两个库照样能跑。</figcaption>
</figure>

这张图里最重要的一点是：**`create_agent` 返回的就是一张 LangGraph 图。** 所以它天然带着 LangGraph 的持久化、中断和流式；当它的结构不够用时，你不是换一个框架，而是往下走一层，自己画图。

## 为什么会长成这样

理解现在的结构，最好先知道它是怎么来的。

LangChain 诞生在 2022 年底，那时候模型还没有原生的工具调用，"Agent"基本靠 ReAct 风格的提示词加正则解析。LangChain 早期的价值在于**把各种东西串起来**：提示词模板、文档加载器、向量库、各种 Chain。名字里的 Chain 就是这个意思。后来为了让"串起来"更通用，又引入了 Runnable 接口和 LCEL（`prompt | model | parser` 这种管道写法）。

问题在于，Agent 天生不是一条链，而是一个**循环**：调模型，看要不要调工具，调完再回到模型。早期的 `AgentExecutor` 把这个循环藏在一个黑盒里，想在中间加一步审批、想换一种停止条件、想在第 3 步之后切换模型，都很难。很多"LangChain 太难改"的抱怨就来自这里。

2024 年初出现的 LangGraph 是对这个问题的回答：**与其把循环藏起来，不如让开发者自己画出来。** 它的设计受 Google 的 Pregel<sup class="cite" id="cite-3"><a href="#ref-3" title="Pregel: A System for Large-Scale Graph Processing">3</a></sup> 启发，用"超步"（super-step）的方式执行一张允许有环的图。LangGraph 的作者后来专门写文章解释过这个选择<sup class="cite" id="cite-4"><a href="#ref-4" title="Building LangGraph: Designing an Agent Runtime from first principles">4</a></sup>：DAG 框架不支持循环，Temporal 这类持久化执行引擎又在步骤之间加了太多延迟、也不支持流式，所以他们自己写了一个运行时，把**并行、流式、检查点、人工介入、追踪**作为要直接支持的能力。

到了 2025 年 10 月的 1.0<sup class="cite"><a href="#ref-1" title="LangChain and LangGraph Agent Frameworks Reach v1.0 Milestones">1</a></sup>，事情终于被理顺：

1. **LangChain 瘦身**：只保留和 Agent 相关的核心，老的 Chain、检索器、索引 API、hub 这些挪到了单独的 `langchain-classic` 包里<sup class="cite" id="cite-5"><a href="#ref-5" title="What's new in LangChain v1">5</a></sup>；
2. **Agent 统一到 `create_agent`**：它取代了原来 `langgraph.prebuilt` 里的 `create_react_agent`，并且底层就是 LangGraph<sup class="cite"><a href="#ref-2" title="What's new in LangGraph v1">2</a></sup>；
3. **加入中间件**：在 Agent 循环的固定位置提供钩子，解决"`AgentExecutor` 改不动"的老问题；
4. **LangGraph 1.0 是一次"稳定性发布"**：核心 API 和执行模型都没变，官方承诺 2.0 之前不再有破坏性改动<sup class="cite"><a href="#ref-2" title="What's new in LangGraph v1">2</a></sup>。

所以今天如果你看到的教程里有 `LLMChain`、`initialize_agent`、`AgentExecutor`，那基本是 1.0 之前的写法，可以直接跳过。

## LangChain 的基础积木

1.0 之后，LangChain 的命名空间被压缩成了几个模块<sup class="cite"><a href="#ref-5" title="What's new in LangChain v1">5</a></sup>：`langchain.agents`、`langchain.messages`、`langchain.tools`、`langchain.chat_models`、`langchain.embeddings`。日常用到的积木就这么几块。

### 模型：一个接口接所有厂商

```python
from langchain.chat_models import init_chat_model

model = init_chat_model("anthropic:claude-sonnet-4-6", temperature=0)
reply = model.invoke("用一句话解释什么是 reducer")
print(reply.content)
```

`"厂商:模型名"` 这种字符串会被解析成对应集成包里的类（这里是 `langchain-anthropic` 的 `ChatAnthropic`），所以要先装好对应的包。换成 `"openai:..."` 或 `"google_genai:..."`，下面的代码不用改。这是 LangChain 最实在的价值之一：**模型接口统一了，换模型就是换一个字符串。**

### 消息和标准内容块

不同厂商的响应结构差别不小：有的把推理过程放在单独的字段里，有的把工具调用和文本混在一个列表里。1.0 给消息加了一个 `content_blocks` 属性<sup class="cite"><a href="#ref-5" title="What's new in LangChain v1">5</a></sup>，把这些都整理成统一的块：

```python
for block in reply.content_blocks:
    print(block["type"])   # "reasoning" / "text" / "tool_call" ...
```

这件事看起来很小，但如果你的代码要同时支持几家模型，又要展示推理过程、处理工具调用，它能省掉一大堆 `if provider == ...`。

### 工具：一个带类型标注和文档字符串的函数

```python
from langchain.tools import tool

@tool
def get_weather(city: str) -> str:
    """查询某个城市当前的天气，返回天气状况、气温和降水概率。"""
    return f"{city}：小雨，18°C，降水概率 80%"

llm_with_tools = model.bind_tools([get_weather])
msg = llm_with_tools.invoke("北京现在出门要带伞吗？")
print(msg.tool_calls)
# [{'name': 'get_weather', 'args': {'city': '北京'}, 'id': 'toolu_...', 'type': 'tool_call'}]
```

`@tool` 做的事情，就是 [工具调用](/posts/agent-tools/#一次工具调用到底发生了什么) 那篇里手写的那段 JSON Schema：函数名变成工具名，文档字符串变成描述，类型标注变成参数的 schema。所以那篇讲的工具设计原则（描述要写清楚什么时候用、参数要有约束、返回值要短）在这里一条都不少。**框架帮你省掉的是格式，省不掉的是设计。**

注意 `bind_tools` 只是让模型"知道"有这些工具，`msg.tool_calls` 也只是模型的提议，并没有真的执行。把执行接上、把结果喂回去、循环到结束，这是下一节 `create_agent` 的事。

## create_agent：一个现成的 Agent 循环

```python
from langchain.agents import create_agent

agent = create_agent(
    model="anthropic:claude-sonnet-4-6",
    tools=[get_weather],
    system_prompt="你是一个简洁的出行助手。",
)

result = agent.invoke(
    {"messages": [{"role": "user", "content": "北京现在出门要带伞吗？"}]}
)
print(result["messages"][-1].content)
```

这十几行就是 [搭建 Agent 的基础知识](/posts/agent-basics/#最小的-agent-循环) 里那个最小循环：调模型，有工具调用就执行，结果追加到消息里，再调模型，直到模型不再请求工具。返回的 `result` 是整张图的最终状态，`messages` 里是完整的对话历史，包括中间的工具调用和结果。

### 结构化输出

很多时候 Agent 的最终产物不是一段话，而是一个要交给下游程序的对象。`create_agent` 用 `response_format` 处理这件事<sup class="cite" id="cite-6"><a href="#ref-6" title="Structured output">6</a></sup>：

```python
from pydantic import BaseModel
from langchain.agents.structured_output import ToolStrategy

class Advice(BaseModel):
    need_umbrella: bool
    reason: str

agent = create_agent(
    model="anthropic:claude-sonnet-4-6",
    tools=[get_weather],
    response_format=ToolStrategy(Advice),
)
result = agent.invoke({"messages": [{"role": "user", "content": "北京要带伞吗？"}]})
result["structured_response"]   # Advice(need_umbrella=True, reason='小雨，降水概率 80%')
```

这里有两种策略：

- **`ProviderStrategy`**：用厂商原生的结构化输出能力，由模型服务端保证格式；
- **`ToolStrategy`**：把 schema 包装成一个"假工具"，让模型通过调用它来交付结果，适用于所有支持工具调用的模型。校验失败时默认会把错误信息喂回去让模型重试（`handle_errors`）。

如果直接传一个 schema 类型，LangChain 会在模型支持原生结构化输出时自动选 `ProviderStrategy`，否则退回 `ToolStrategy`<sup class="cite"><a href="#ref-6" title="Structured output">6</a></sup>。另外值得一提的是，1.0 以后结构化输出是在主循环里生成的，不再像以前那样多打一次模型<sup class="cite"><a href="#ref-5" title="What's new in LangChain v1">5</a></sup>。

## 中间件：把钩子插进循环

`create_agent` 解决了"写一个循环"的问题，但真实项目里你总要在循环里加点东西：上下文太长了要压缩，某些工具要人工审批，模型挂了要切备用模型，工具报错要转成模型能读懂的提示。以前这些要么改不动，要么得自己重写整个循环。

1.0 的答案是中间件<sup class="cite" id="cite-7"><a href="#ref-7" title="Built-in middleware">7</a></sup>。它在 Agent 循环的几个固定位置开放钩子：

<figure class="diagram">
<svg viewBox="0 0 640 300" role="img" aria-label="create_agent 的循环和中间件钩子的位置：before_agent，然后每一轮依次是 before_model、被 wrap_model_call 包住的模型调用、after_model，有工具调用时执行被 wrap_tool_call 包住的工具，再回到 before_model，否则经过 after_agent 结束">
<defs><marker id="lg1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0 0 L10 5 L0 10 z"/></marker></defs>
<text class="ts" x="75" y="50" text-anchor="middle">输入 messages</text>
<rect class="c-gray" x="20" y="60" width="110" height="40" rx="4"/>
<text class="t" x="75" y="85" text-anchor="middle">before_agent</text>
<rect class="frame" x="150" y="28" width="470" height="192" rx="6"/>
<text class="ts" x="166" y="46">每一轮</text>
<rect class="c-gray" x="165" y="60" width="110" height="40" rx="4"/>
<text class="t" x="220" y="85" text-anchor="middle">before_model</text>
<text class="ts" x="370" y="52" text-anchor="middle">wrap_model_call 包住</text>
<rect class="c-blue" x="300" y="60" width="140" height="40" rx="4"/>
<text class="t" x="370" y="85" text-anchor="middle">调用模型</text>
<rect class="c-gray" x="465" y="60" width="120" height="40" rx="4"/>
<text class="t" x="525" y="85" text-anchor="middle">after_model</text>
<path class="ln" d="M130 80 H162" marker-end="url(#lg1)"/>
<path class="ln" d="M275 80 H297" marker-end="url(#lg1)"/>
<path class="ln" d="M440 80 H462" marker-end="url(#lg1)"/>
<rect class="c-amber" x="465" y="140" width="120" height="36" rx="4"/>
<text class="t" x="525" y="163" text-anchor="middle">有工具调用？</text>
<path class="ln" d="M525 100 V137" marker-end="url(#lg1)"/>
<rect class="c-green" x="300" y="140" width="140" height="36" rx="4"/>
<text class="t" x="370" y="163" text-anchor="middle">执行工具</text>
<text class="ts" x="370" y="194" text-anchor="middle">wrap_tool_call 包住</text>
<path class="ln" d="M465 158 H443" marker-end="url(#lg1)"/>
<text class="ts" x="453" y="152" text-anchor="middle">是</text>
<path class="ln" d="M300 158 H220 V103" marker-end="url(#lg1)"/>
<text class="ts" x="226" y="140">结果追加</text>
<rect class="c-gray" x="465" y="246" width="120" height="36" rx="4"/>
<text class="t" x="525" y="269" text-anchor="middle">after_agent</text>
<path class="ln" d="M525 176 V243" marker-end="url(#lg1)"/>
<text class="ts" x="535" y="236">否</text>
<rect class="c-gray" x="300" y="246" width="140" height="36" rx="4"/>
<text class="t" x="370" y="269" text-anchor="middle">返回最终状态</text>
<path class="ln" d="M465 264 H443" marker-end="url(#lg1)"/>
</svg>
<figcaption>图 2：中间件钩子在 create_agent 循环里的位置。before_* / after_* 在节点前后改状态，wrap_* 像装饰器一样包住一次调用，可以改请求、重试、甚至不调用。</figcaption>
</figure>

钩子分两类<sup class="cite"><a href="#ref-7" title="Built-in middleware">7</a></sup>：

- **节点式**：`before_agent`、`before_model`、`after_model`、`after_agent`。拿到当前状态，返回要更新的字段，或者返回 `{"jump_to": "end"}` 直接跳走；
- **包裹式**：`wrap_model_call`、`wrap_tool_call`。拿到请求和一个 `handler`，由你决定怎么调、调几次、要不要调。

如果你读过 [Harness](/posts/agent-harness/#钩子把确定性插进循环) 那篇，会发现这就是那里讲的钩子：**把确定性的逻辑插进不确定的循环里**。区别只是这里它变成了一套有固定接口的框架机制。

### 内置中间件

常见需求官方基本都做好了<sup class="cite"><a href="#ref-7" title="Built-in middleware">7</a></sup>，从 `langchain.agents.middleware` 导入即可。挑几个最常用的：

| 中间件 | 做什么 | 对应的问题 |
| --- | --- | --- |
| `SummarizationMiddleware` | 超过阈值时把早期消息压缩成摘要 | 上下文窗口 |
| `HumanInTheLoopMiddleware` | 指定的工具调用前暂停，等人批准、修改或拒绝 | 高风险操作 |
| `ModelCallLimitMiddleware` / `ToolCallLimitMiddleware` | 限制模型和工具的调用次数 | 死循环、成本 |
| `ModelFallbackMiddleware` | 主模型出错时切到备用模型 | 可用性 |
| `ModelRetryMiddleware` / `ToolRetryMiddleware` | 失败自动重试 | 网络抖动 |
| `PIIMiddleware` | 检测并脱敏邮箱、卡号等敏感信息 | 合规 |
| `TodoListMiddleware` | 给 Agent 一个 `write_todos` 工具来维护任务清单 | 长任务规划 |

比如压缩上下文：

```python
from langchain.agents.middleware import SummarizationMiddleware

agent = create_agent(
    model="anthropic:claude-sonnet-4-6",
    tools=[...],
    middleware=[
        SummarizationMiddleware(
            model="anthropic:claude-haiku-4-5",   # 用便宜的模型写摘要
            trigger=("tokens", 80_000),          # 超过 8 万 token 触发
            keep=("messages", 20),               # 保留最近 20 条原样不动
        ),
    ],
)
```

这正好对应 [上下文管理](/posts/agent-context-management/) 里讲的"压缩"策略。中间件的好处是，这些策略不再和业务代码搅在一起，可以按需叠加、单独测试。

### 自己写一个

简单的用装饰器，复杂的继承 `AgentMiddleware`。下面两个例子分别对应两种最常见的定制：

```python
from langchain.agents.middleware import wrap_model_call, wrap_tool_call, ModelRequest
from langchain.chat_models import init_chat_model
from langchain.messages import ToolMessage

big_model = init_chat_model("anthropic:claude-opus-4-6")

@wrap_model_call
def upgrade_when_long(request: ModelRequest, handler):
    # 对话变长、任务变复杂时，换一个更强的模型
    if len(request.messages) > 30:
        request = request.override(model=big_model)
    return handler(request)

@wrap_tool_call
def errors_as_feedback(request, handler):
    # 工具抛异常时，不让整个 Agent 崩掉，而是把错误变成模型能读懂的提示
    try:
        return handler(request)
    except Exception as e:
        return ToolMessage(
            content=f"工具执行失败：{e}。请检查参数后重试，或换一种方法。",
            tool_call_id=request.tool_call["id"],
        )

agent = create_agent(
    model="anthropic:claude-sonnet-4-6",
    tools=[...],
    middleware=[upgrade_when_long, errors_as_feedback],
)
```

第二个例子就是 [工具](/posts/agent-tools/) 那篇里说的"报错信息要告诉模型怎么改"。（这个需求太常见，新版本里官方也出了一个 `ToolErrorMiddleware`。）

多个中间件的执行顺序也值得记一下：`before_*` 按列表顺序执行，`after_*` 按相反顺序执行，`wrap_*` 则是第一个包在最外层，像洋葱一样。

### 人工审批

`HumanInTheLoopMiddleware` 值得单独说，因为它第一次让我们碰到 LangGraph 的能力：

```python
from langchain.agents.middleware import HumanInTheLoopMiddleware
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

agent = create_agent(
    model="anthropic:claude-sonnet-4-6",
    tools=[search_orders, issue_refund],
    middleware=[
        HumanInTheLoopMiddleware(interrupt_on={
            "issue_refund": {"allowed_decisions": ["approve", "edit", "reject"]},
            "search_orders": False,      # 只读工具不用审批
        }),
    ],
    checkpointer=InMemorySaver(),        # 暂停需要把状态存下来
)

config = {"configurable": {"thread_id": "ticket-1024"}}
result = agent.invoke({"messages": [{"role": "user", "content": "订单 A17 退款"}]}, config)
# 此时 Agent 停在 issue_refund 之前，result["__interrupt__"] 里是待审批的调用

# ……几分钟或几天后，审批人点了"同意"
agent.invoke(Command(resume={"decisions": [{"type": "approve"}]}), config)
```

注意两点：一是必须传一个 `checkpointer`，二是两次调用用的是**同一个 `thread_id`**<sup class="cite" id="cite-8"><a href="#ref-8" title="Human-in-the-loop">8</a></sup>。这就是 LangGraph 的持久化：第一次调用停下来时，整张图的状态被存进检查点；第二次调用不是重新开始，而是从断点接着跑。这个机制下面会细讲。

## 什么时候 create_agent 不够用

`create_agent` 的结构是固定的：一个模型节点，一个工具节点，中间一个循环。中间件可以在这个结构上加很多东西，但改不了结构本身。

Anthropic 那篇 Building effective agents<sup class="cite" id="cite-9"><a href="#ref-9" title="Building effective agents">9</a></sup> 把 LLM 应用分成了两类：**工作流**（流程由代码预先写好，LLM 在固定的步骤里干活）和 **Agent**（由 LLM 自己决定下一步做什么）。`create_agent` 是后一类。当你需要的是前一类，或者两者的混合，就该往下走一层了。典型的信号：

- **流程有明确的分支**：先分类，再按类别走完全不同的处理；
- **要并行**：同时检索几个来源，或者把一批文档分发出去各自总结，再汇总；
- **有多个角色**：写作者、审稿人、修订者，各自有不同的提示词和工具；
- **有些步骤根本不需要 LLM**：校验、格式转换、调一个确定的 API；
- **想精确控制状态**：除了消息以外，还要维护计数器、草稿版本、审批状态这些结构化字段。

这些都是 LangGraph 的地盘。

## LangGraph：把流程画成一张图

LangGraph 的心智模型只有三样东西<sup class="cite" id="cite-10"><a href="#ref-10" title="Graph API overview">10</a></sup>：**State**（共享的状态）、**Node**（读状态、返回更新的函数）、**Edge**（决定下一步去哪）。

先看一个不用 LLM 的小例子，一个客服工单的分流流程：

```python
import operator
from typing import Annotated, Literal, TypedDict
from langgraph.graph import StateGraph, START, END

class State(TypedDict):
    question: str
    category: str
    answer: str
    log: Annotated[list[str], operator.add]   # 这个字段的更新是"追加"而不是"覆盖"

def classify(state: State) -> dict:
    category = "billing" if "退款" in state["question"] else "tech"
    return {"category": category, "log": [f"分类：{category}"]}

def billing(state: State) -> dict:
    return {"answer": "已为你提交退款申请。", "log": ["走退款流程"]}

def tech(state: State) -> dict:
    return {"answer": "请先尝试重启应用。", "log": ["走技术支持"]}

def route(state: State) -> Literal["billing", "tech"]:
    return state["category"]

builder = StateGraph(State)
builder.add_node("classify", classify)
builder.add_node("billing", billing)
builder.add_node("tech", tech)
builder.add_edge(START, "classify")
builder.add_conditional_edges("classify", route)
builder.add_edge("billing", END)
builder.add_edge("tech", END)

graph = builder.compile()
print(graph.invoke({"question": "我想申请退款"}))
# {'question': '我想申请退款', 'category': 'billing',
#  'answer': '已为你提交退款申请。', 'log': ['分类：billing', '走退款流程']}
```

几个要点：

1. **节点只返回它要改的字段**，不用返回整个状态。LangGraph 负责把更新合并回去；
2. **条件边是一个普通函数**，返回下一个节点的名字。返回类型写成 `Literal[...]`，LangGraph 能据此推断出所有可能的去向，画图时也用得上；
3. **一定要 `compile()`**。编译时会检查图的结构（比如有没有孤立节点），检查点和中断也在这时候挂上去。

### Reducer：状态是怎么合并的

上面 `log` 字段用 `Annotated[list[str], operator.add]` 标注，意思是"这个字段的新值和旧值相加"。这个函数叫 **reducer**。没有标注 reducer 的字段，默认行为是**覆盖**<sup class="cite"><a href="#ref-10" title="Graph API overview">10</a></sup>。

为什么需要 reducer？因为图里的节点可能**并行**执行。如果两个并行节点都往 `log` 里写，覆盖语义下必然有一个丢失；有了"追加"的 reducer，两个更新都能保留，而且合并的顺序是确定的。

最常用的 reducer 是 `add_messages`。它是专门给消息列表设计的：新消息追加，ID 相同的消息则替换。LangGraph 内置的 `MessagesState` 就是一个只有 `messages: Annotated[list, add_messages]` 字段的状态。

用 `MessagesState`，我们可以不借助 `create_agent`，自己把 Agent 循环画出来：

```python
from typing import Literal
from langgraph.graph import StateGraph, MessagesState, START, END
from langchain.messages import ToolMessage

tools = [get_weather]
tools_by_name = {t.name: t for t in tools}
llm = model.bind_tools(tools)

def call_model(state: MessagesState):
    return {"messages": [llm.invoke(state["messages"])]}

def run_tools(state: MessagesState):
    results = []
    for call in state["messages"][-1].tool_calls:
        output = tools_by_name[call["name"]].invoke(call["args"])
        results.append(ToolMessage(content=str(output), tool_call_id=call["id"]))
    return {"messages": results}

def should_continue(state: MessagesState) -> Literal["tools", "__end__"]:
    return "tools" if state["messages"][-1].tool_calls else END

builder = StateGraph(MessagesState)
builder.add_node("model", call_model)
builder.add_node("tools", run_tools)
builder.add_edge(START, "model")
builder.add_conditional_edges("model", should_continue)
builder.add_edge("tools", "model")      # 一条回到 model 的边，就是"循环"
agent = builder.compile()
```

这就是 `create_agent` 内部的骨架（真实实现多了中间件、结构化输出、并行工具调用等细节）。一旦它变成了你自己的图，你就可以随便改：在 `tools` 和 `model` 之间加一个校验节点，给 `model` 节点换成按条件路由到两个不同的模型，或者在某个分支上直接 `END`。

### 执行模型：超步

LangGraph 不是简单地"顺着边一个个跑节点"，而是按 Pregel 的 BSP（Bulk Synchronous Parallel）模型<sup class="cite"><a href="#ref-3" title="Pregel: A System for Large-Scale Graph Processing">3</a></sup><sup class="cite"><a href="#ref-4" title="Building LangGraph: Designing an Agent Runtime from first principles">4</a></sup>，一轮一轮地执行。每一轮叫一个**超步**：

<figure class="diagram">
<svg viewBox="0 0 640 230" role="img" aria-label="三个超步：第一步运行 classify，第二步并行运行 search_docs 和 search_web，第三步运行 answer；每两步之间用 reducer 合并更新并存一个检查点">
<defs><marker id="lg2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0 0 L10 5 L0 10 z"/></marker></defs>
<text class="ts" x="110" y="24" text-anchor="middle">超步 1</text>
<text class="ts" x="320" y="24" text-anchor="middle">超步 2</text>
<text class="ts" x="530" y="24" text-anchor="middle">超步 3</text>
<rect class="c-blue" x="50" y="70" width="120" height="36" rx="4"/>
<text class="t" x="110" y="93" text-anchor="middle">classify</text>
<rect class="c-blue" x="260" y="40" width="120" height="36" rx="4"/>
<text class="t" x="320" y="63" text-anchor="middle">search_docs</text>
<rect class="c-blue" x="260" y="100" width="120" height="36" rx="4"/>
<text class="t" x="320" y="123" text-anchor="middle">search_web</text>
<rect class="c-blue" x="470" y="70" width="120" height="36" rx="4"/>
<text class="t" x="530" y="93" text-anchor="middle">answer</text>
<path class="ln" d="M170 82 L257 60" marker-end="url(#lg2)"/>
<path class="ln" d="M170 94 L257 116" marker-end="url(#lg2)"/>
<path class="ln" d="M380 60 L467 82" marker-end="url(#lg2)"/>
<path class="ln" d="M380 116 L467 94" marker-end="url(#lg2)"/>
<path class="frame" d="M215 34 V160"/>
<path class="frame" d="M425 34 V160"/>
<text class="ts" x="215" y="176" text-anchor="middle">合并 + 检查点</text>
<text class="ts" x="425" y="176" text-anchor="middle">合并 + 检查点</text>
<rect class="c-amber" x="20" y="192" width="180" height="28" rx="4"/>
<text class="ts" x="110" y="211" text-anchor="middle">状态 v1</text>
<rect class="c-amber" x="230" y="192" width="180" height="28" rx="4"/>
<text class="ts" x="320" y="211" text-anchor="middle">状态 v2：两个结果都在</text>
<rect class="c-amber" x="440" y="192" width="180" height="28" rx="4"/>
<text class="ts" x="530" y="211" text-anchor="middle">状态 v3</text>
</svg>
<figcaption>图 3：同一个超步里的节点读的是同一份状态快照，彼此看不到对方的写入；超步结束时，所有更新用 reducer 合并，再存一个检查点，然后才开始下一步。</figcaption>
</figure>

每一个超步里：

1. 找出这一步要执行的节点（上一步有边指向它们的）；
2. 这些节点**并行**执行，每个都拿到同一份状态快照的副本；
3. 所有节点都结束后，按确定的顺序用 reducer 把它们的更新合并进状态；
4. 存一个检查点，进入下一个超步。

这个模型带来了几个很实际的性质<sup class="cite"><a href="#ref-4" title="Building LangGraph: Designing an Agent Runtime from first principles">4</a></sup>：

- **并行是免费的**：一个节点有多条出边，后面的节点自然就在同一个超步里并行跑；
- **结果是确定的**：并行节点之间不共享可变状态，合并顺序固定，不会出现"这次跑和上次跑结果不一样"的竞态；
- **每一步都能停**：检查点落在超步之间，所以任何一步之后都可以暂停、恢复、回放。

还有一点要知道：**超步是事务性的**。同一步里只要有一个节点失败，这一步所有节点的更新都不会合并进状态。挂了 checkpointer 时，已经成功的节点的输出会作为"待写入"单独存下来，恢复时不会重跑它们<sup class="cite" id="cite-11"><a href="#ref-11" title="Persistence">11</a></sup>；没挂的话，重试就是整步重来。所以调外部 API 这类有副作用的节点，最好还是做成幂等的。

### Command 和 Send：更灵活的路由

条件边是在"节点之外"决定去向。有时候在节点里一边更新状态一边决定去向更自然，这时候可以返回一个 `Command`：

```python
from typing import Literal
from langgraph.types import Command

def review(state: State) -> Command[Literal["revise", "publish"]]:
    if score(state["draft"]) >= 8:
        return Command(update={"status": "approved"}, goto="publish")
    return Command(update={"feedback": critique(state["draft"])}, goto="revise")
```

返回类型里的 `Literal` 告诉 LangGraph 这个节点可能去哪些地方。官方文档特别提醒，同一个节点不要既有普通出边又用 `Command` 路由，否则两条路都会走。

`Send` 解决的是另一个问题：**并行的数量在运行时才知道**。比如要把一批文档分别总结，文档有几篇就要并行几个任务：

```python
from langgraph.types import Send

class State(TypedDict):
    docs: list[str]
    summaries: Annotated[list[str], operator.add]

def fan_out(state: State):
    # 每篇文档发一个 Send，各自带着自己的输入
    return [Send("summarize", {"doc": d}) for d in state["docs"]]

def summarize(item: dict):
    return {"summaries": [llm.invoke(f"用一句话总结：{item['doc']}").content]}

builder.add_conditional_edges("load_docs", fan_out, ["summarize"])
builder.add_edge("summarize", "combine")
```

这就是 map-reduce：`Send` 负责 map，`summaries` 上的 `operator.add` 负责 reduce。这里收到 `Send` 的节点拿到的是 `Send` 里带的那份输入，而不是全局状态。[子 Agent](/posts/agent-subagents/) 那篇讲的"把任务拆开分发给多个子 Agent 并行做"，在 LangGraph 里基本就是这个写法。

## 检查点：LangGraph 真正的核心

前面几次提到检查点，现在正式讲它。我个人觉得，**检查点是 LangGraph 和"自己写个 while 循环"之间最本质的区别**。画图本身并不难，难的是让一个可能跑几十分钟、中间要等人、随时可能崩的流程能停下来、能接着跑。

用法很简单，编译时传一个 checkpointer，调用时带一个 `thread_id`<sup class="cite"><a href="#ref-11" title="Persistence">11</a></sup>：

```python
from langgraph.checkpoint.memory import InMemorySaver

graph = builder.compile(checkpointer=InMemorySaver())
config = {"configurable": {"thread_id": "user-42"}}

graph.invoke({"messages": [{"role": "user", "content": "我叫小王"}]}, config)
graph.invoke({"messages": [{"role": "user", "content": "我叫什么？"}]}, config)
# 第二次调用能看到第一次的消息：同一个 thread_id，就是同一段对话
```

`thread_id` 就是一条持久化的游标：同一个 ID 接着之前的状态，换一个 ID 就是全新的开始。这其实就是 [记忆](/posts/agent-memory/) 那篇里的"短期记忆"：一段会话内的完整状态。

`InMemorySaver` 只适合开发，进程一重启就没了。生产环境换成持久化的实现，接口完全一样<sup class="cite"><a href="#ref-11" title="Persistence">11</a></sup>：

| Checkpointer | 安装 | 适合 |
| --- | --- | --- |
| `InMemorySaver` | 内置 | 开发、测试 |
| `SqliteSaver` / `AsyncSqliteSaver` | `langgraph-checkpoint-sqlite` | 单机、本地应用 |
| `PostgresSaver` / `AsyncPostgresSaver` | `langgraph-checkpoint-postgres` | 生产环境 |

```python
from langgraph.checkpoint.postgres import PostgresSaver

with PostgresSaver.from_conn_string("postgresql://...") as checkpointer:
    checkpointer.setup()     # 第一次使用时建表
    graph = builder.compile(checkpointer=checkpointer)
```

### 持久化的代价：durability

每个超步都写一次数据库，对短流程是可以接受的开销，对一个几百步的 Agent 就未必了。所以 LangGraph 允许按调用选择持久化的强度<sup class="cite"><a href="#ref-11" title="Persistence">11</a></sup>：

- `"exit"`：只在整张图结束（成功、出错或中断）时写，最快，但中途崩溃会丢掉中间进度；
- `"async"`：每步异步写，下一步不等写完就开始，是性能和安全之间的折中；
- `"sync"`：每步同步写完再继续，最安全。

```python
graph.invoke(inputs, config, durability="sync")
```

我的建议是：有副作用、跑得久、要等人的流程用 `"sync"`；纯计算、几秒钟就跑完的流程用 `"exit"` 就够了。

### 时间旅行：回放和分叉

既然每一步都存了检查点，自然就可以回到过去<sup class="cite" id="cite-12"><a href="#ref-12" title="Use time travel">12</a></sup>：

```python
history = list(graph.get_state_history(config))   # 从新到旧
for snap in history:
    print(snap.config["configurable"]["checkpoint_id"], snap.next)

# 找到某一步之前的检查点
before = next(s for s in history if s.next == ("billing",))

# 回放：从这个检查点接着往后跑
graph.invoke(None, before.config)

# 分叉：改一下状态，再从这里跑出一条新的分支
fork_config = graph.update_state(before.config, values={"category": "tech"})
graph.invoke(None, fork_config)
```

<figure class="diagram">
<svg viewBox="0 0 640 200" role="img" aria-label="一条线程的检查点序列：输入、分类后、等待审批、结束；从分类后的检查点用 update_state 分叉出一条新分支">
<defs><marker id="lg3" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0 0 L10 5 L0 10 z"/></marker></defs>
<rect class="c-amber" x="20" y="40" width="120" height="36" rx="4"/>
<text class="t" x="80" y="63" text-anchor="middle">cp0 · 输入</text>
<rect class="c-amber" x="175" y="40" width="120" height="36" rx="4"/>
<text class="t" x="235" y="63" text-anchor="middle">cp1 · 分类后</text>
<rect class="c-amber" x="330" y="40" width="130" height="36" rx="4"/>
<text class="t" x="395" y="63" text-anchor="middle">cp2 · 等审批 ⏸</text>
<rect class="c-amber" x="495" y="40" width="125" height="36" rx="4"/>
<text class="t" x="557" y="63" text-anchor="middle">cp3 · 结束</text>
<path class="ln" d="M140 58 H172" marker-end="url(#lg3)"/>
<path class="ln" d="M295 58 H327" marker-end="url(#lg3)"/>
<path class="ln" d="M460 58 H492" marker-end="url(#lg3)"/>
<text class="ts" x="395" y="96" text-anchor="middle">interrupt() 暂停</text>
<text class="ts" x="557" y="96" text-anchor="middle">Command(resume) 继续</text>
<path class="ln dash" d="M235 76 V158 H327" marker-end="url(#lg3)"/>
<text class="ts" x="245" y="130">update_state 分叉</text>
<rect class="c-purple" x="330" y="140" width="130" height="36" rx="4"/>
<text class="t" x="395" y="163" text-anchor="middle">cp2′ · 改了分类</text>
<rect class="c-purple" x="495" y="140" width="125" height="36" rx="4"/>
<text class="t" x="557" y="163" text-anchor="middle">cp3′ · 结束</text>
<path class="ln" d="M460 158 H492" marker-end="url(#lg3)"/>
</svg>
<figcaption>图 4：一条线程上的检查点。update_state 不会改写历史，而是从某个检查点长出一条新分支，原来的那条还在。</figcaption>
</figure>

这个能力在调试 Agent 时特别有用：一个跑了 40 步的任务在第 31 步做了个错误决定，你不必从头再跑，直接回到第 30 步，改一下状态（或者换个提示词），从那里重新跑。[评测](/posts/agent-evaluation/) 那篇里说的"复现失败的轨迹"，在这里是一行代码的事。

## interrupt：让图停下来等人

前面 `HumanInTheLoopMiddleware` 用的就是这个机制。在自己的图里，你可以在任何节点中调用 `interrupt()`<sup class="cite" id="cite-13"><a href="#ref-13" title="Interrupts">13</a></sup>：

```python
from langgraph.types import interrupt, Command

def approve_refund(state: State):
    decision = interrupt({
        "question": f"确认给订单 {state['order_id']} 退款 {state['amount']} 元？"
    })
    if decision == "yes":
        return {"status": "refunded"}
    return {"status": "rejected"}

graph = builder.compile(checkpointer=InMemorySaver())
config = {"configurable": {"thread_id": "refund-7"}}

result = graph.invoke({"order_id": "A17", "amount": 199}, config)
print(result["__interrupt__"])   # 里面是传给 interrupt() 的那个 dict

# 人工确认后，用同一个 thread_id 恢复；resume 的值就是 interrupt() 的返回值
graph.invoke(Command(resume="yes"), config)
```

`interrupt()` 第一次执行时会抛出一个特殊的信号，图停下来，状态存进检查点，传给它的内容交给调用方展示给人看。恢复时，`Command(resume=...)` 里的值会变成 `interrupt()` 的返回值。

这里有一个**非常反直觉、也非常容易出错**的地方：**恢复时，这个节点是从头重新执行的**，而不是从 `interrupt()` 那一行接着跑<sup class="cite"><a href="#ref-13" title="Interrupts">13</a></sup>。LangGraph 不能保存 Python 的调用栈，它只能重新调用这个函数，等执行到 `interrupt()` 时直接返回之前保存的恢复值。由此引出几条规则：

1. **`interrupt()` 之前的副作用必须是幂等的**。如果你在 `interrupt()` 前面先发了一封邮件，恢复时邮件会再发一次；
2. **不要用裸的 `try/except` 包住 `interrupt()`**，它靠抛异常实现暂停，你一捕获它就停不下来了；
3. **不要在节点里写 `while True: interrupt(...)` 循环**来实现"反复确认"，用条件边回到这个节点；
4. **传给 `interrupt()` 的内容要能 JSON 序列化**，它要存进检查点。

最稳妥的写法是：让 `interrupt()` 尽量出现在节点的开头，把有副作用的操作放到 `interrupt()` 之后，或者干脆拆到下一个节点里。

## 流式：让用户看到 Agent 在干什么

Agent 一跑就是几十秒，如果界面上什么都不显示，用户会以为它卡死了。LangGraph 的流式支持好几种模式<sup class="cite" id="cite-14"><a href="#ref-14" title="Streaming">14</a></sup>，可以同时开：

```python
# updates：每个节点执行完，推一次它返回的更新
for chunk in graph.stream(inputs, config, stream_mode="updates"):
    print(chunk)    # {'classify': {'category': 'billing', ...}}

# messages：LLM 生成时逐 token 推送，附带是哪个节点产生的
for token, meta in graph.stream(inputs, config, stream_mode="messages"):
    print(token.content, end="", flush=True)
```

- `values`：每步之后的完整状态；
- `updates`：每步之后各节点的增量更新，适合做"正在搜索… / 正在总结…"这种进度展示；
- `messages`：LLM 的 token 流，适合做打字机效果；
- `custom`：节点里用 `get_stream_writer()` 推送任意自定义数据，比如"已处理 3/10 篇文档"；
- 另外还有 `checkpoints`、`tasks`、`debug` 等调试用的模式。

传一个列表就能同时订阅多种：`stream_mode=["updates", "messages"]`。新版本里还加了统一格式的 `version="v2"` 输出和更高层的 `stream_events(..., version="v3")` 接口<sup class="cite"><a href="#ref-14" title="Streaming">14</a></sup>，后者对子图、子 Agent 的事件做了更好的归类，新项目可以直接用它。这些接口还在演进，具体以你所用版本的文档为准。

## Functional API：不想画图的时候

不是所有流程都适合画成图。有些逻辑写成普通的 Python 控制流更自然：for 循环、if 判断、递归。LangGraph 为此提供了 Functional API<sup class="cite" id="cite-15"><a href="#ref-15" title="Functional API overview">15</a></sup>，用两个装饰器就能拿到检查点、中断和流式：

```python
from langgraph.func import entrypoint, task
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import interrupt

@task
def write_section(topic: str) -> str:
    return llm.invoke(f"写一段关于 {topic} 的介绍").content

@entrypoint(checkpointer=InMemorySaver())
def write_report(topics: list[str]) -> str:
    futures = [write_section(t) for t in topics]   # task 调用立即返回 future，可以并行
    sections = [f.result() for f in futures]
    draft = "\n\n".join(sections)
    feedback = interrupt({"draft": draft})          # 一样可以停下来等人
    return llm.invoke(f"根据意见修改：{feedback}\n\n{draft}").content

config = {"configurable": {"thread_id": "report-1"}}
write_report.invoke(["检查点", "中断", "流式"], config)
```

`@task` 的结果会被存进检查点。恢复时，已经完成的 task 不会重跑，直接用存下来的结果，这正好缓解了上一节说的"节点重跑"问题：把有副作用、耗时长的操作包成 task，就不怕恢复时再执行一次。

Graph API 和 Functional API 跑在同一个运行时上<sup class="cite"><a href="#ref-4" title="Building LangGraph: Designing an Agent Runtime from first principles">4</a></sup>，可以混用：图的节点里可以调 task，entrypoint 里也可以调用编译好的图。我的经验是：**流程的形状本身值得被看见时用图，流程主要是控制逻辑时用函数。**

## 长期记忆：Store

检查点是按 `thread_id` 隔离的，一段新对话看不到上一段对话的状态。要让 Agent 跨会话记住用户的偏好，需要另一个东西：**Store**<sup class="cite" id="cite-16"><a href="#ref-16" title="Stores">16</a></sup>。

```python
from dataclasses import dataclass
from langgraph.store.memory import InMemoryStore
from langgraph.runtime import Runtime

@dataclass
class Context:
    user_id: str

def remember(state: MessagesState, runtime: Runtime[Context]):
    ns = ("users", runtime.context.user_id, "prefs")
    runtime.store.put(ns, "language", {"value": "中文，回答尽量简短"})
    return {}

def recall(state: MessagesState, runtime: Runtime[Context]):
    ns = ("users", runtime.context.user_id, "prefs")
    prefs = [item.value for item in runtime.store.search(ns)]
    ...

builder = StateGraph(MessagesState, context_schema=Context)
# ... add_node / add_edge ...
graph = builder.compile(checkpointer=checkpointer, store=InMemoryStore())
graph.invoke(inputs, config, context=Context(user_id="u-42"))
```

Store 是一个按命名空间（一个元组）组织的键值存储，`search` 按命名空间前缀匹配。给 `InMemoryStore` 配上 embedding 模型，`search` 还能按语义检索<sup class="cite"><a href="#ref-16" title="Stores">16</a></sup>。生产环境同样有 Postgres 等持久化实现。

两者的分工很清楚：

| | Checkpointer | Store |
| --- | --- | --- |
| 隔离单位 | `thread_id`（一段会话） | 你定的命名空间（比如一个用户） |
| 存什么 | 图的完整状态，每一步一份 | 你主动写入的条目 |
| 谁来写 | 运行时自动 | 你的节点代码 |
| 对应 | 短期记忆、断点续跑 | 长期记忆 |

[记忆](/posts/agent-memory/) 那篇讲的"什么时候写、写什么、怎么取"这些问题，Store 都不替你回答，它只提供存储。**记忆的难点从来不在存，而在决定存什么。**

## 往上一层：Deep Agents

`create_agent` 给的是一个"最小"的 Agent 循环。但如果你用过 Claude Code 这类编程 Agent，会发现能干长活的 Agent 还需要一整套 Harness：规划工具、文件系统、子 Agent、上下文压缩。LangChain 把这一套打包成了 **Deep Agents**，官方直接称它为"一个 Agent Harness"<sup class="cite" id="cite-17"><a href="#ref-17" title="Deep Agents overview">17</a></sup>。

```python
from deepagents import create_deep_agent

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    tools=[internet_search],
    system_prompt="你是一名研究员，负责调研并写出带引用的报告。",
)
result = agent.invoke({"messages": [{"role": "user", "content": "调研一下 2026 年开源 Agent 框架的格局"}]})
```

它在 `create_agent` 的基础上，通过一组中间件预装了<sup class="cite"><a href="#ref-17" title="Deep Agents overview">17</a></sup>：

- **文件系统工具**：`ls`、`read_file`、`write_file`、`edit_file`、`glob`、`grep`，让 Agent 把中间结果写进文件，而不是全塞在上下文里。文件可以放在图的状态里、本地磁盘上或 Store 里，由可替换的 backend 决定；
- **子 Agent**：一个 `task` 工具，把子任务交给一个上下文独立的子 Agent；
- **规划**：可选的 `TodoListMiddleware` 提供 `write_todos` 工具；
- **上下文管理**：自动压缩，大的工具输出落到文件里。

把它和 [Harness](/posts/agent-harness/) 那篇对照着看会很有意思：LangChain 那篇"Agent = 模型 + Harness"的文章<sup class="cite" id="cite-18"><a href="#ref-18" title="The Anatomy of an Agent Harness">18</a></sup>，基本就是 Deep Agents 的设计说明。今年 5 月的 0.6 版本又加入了代码解释器、按模型调优的"harness profile"等功能<sup class="cite" id="cite-19"><a href="#ref-19" title="New in Deep Agents v0.6">19</a></sup>，迭代速度相当快。

从分层上看：**LangGraph 是运行时，`create_agent` 是一个最小的 Agent，Deep Agents 是一个带全套 Harness 的 Agent。** 你的任务越像"开放式的长活"，越应该从上层开始；越像"固定流程"，越应该从下层开始。

## 什么时候用，什么时候不用

说完了能力，也要说说代价。LangChain 一直被批评的几点，1.0 以后有所改善，但没有完全消失：

- **抽象的成本**：出问题时，你要在自己的代码、中间件、LangGraph 运行时、集成包之间来回定位。一个 provider 的参数没透传，可能要读集成包的源码才能发现；
- **版本节奏快**：1.0 之后承诺了 API 稳定，但小版本几乎每周都在发，新功能（比如流式的 v2、v3）还在演进，教程很快就会过时；
- **你未必需要它**：如果你只用一家模型、Agent 结构也简单，直接用厂商的 SDK 写一个循环，代码量不会多多少，可控性反而更好。

我的选择标准大致是这样：

| 场景 | 建议 |
| --- | --- |
| 单一模型、简单的工具调用 | 厂商 SDK 直接写，或者 `create_agent` |
| 标准的 Agent 循环，要压缩、审批、限流这些常见功能 | `create_agent` + 内置中间件 |
| 有明确分支、并行、多角色的流程 | LangGraph 的 Graph API |
| 主要是控制逻辑，但需要断点续跑和人工介入 | LangGraph 的 Functional API |
| 开放式的长任务：调研、编码、写报告 | Deep Agents，或者参考它自己搭 |
| 要跨多家模型切换 | 至少用 `init_chat_model` 和标准消息格式 |

还有一个经常被低估的点：**LangGraph 的价值主要不在"画图"，而在运行时**。如果你的流程不需要持久化、不需要中断、不需要流式，那画成图带来的好处其实不多。反过来，一旦你需要"停下来等人审批，三天后接着跑"，自己实现一遍检查点和恢复逻辑的成本远高于学一遍 LangGraph。

## 动手时的几条建议

1. **从 `create_agent` 开始**，等它的固定结构真的不够用了再下沉到 LangGraph。大部分需求用中间件就能解决；
2. **开发时就挂上 checkpointer**，哪怕是 `InMemorySaver`。不然等到要加人工审批、要调试一个 40 步的轨迹时，你会后悔没早点用上；
3. **状态设计先于节点设计**：想清楚哪些字段要追加、哪些要覆盖，并行写入的字段一定要有 reducer；
4. **有副作用的操作要幂等**，或者放在 `interrupt()` 之后、单独的节点或 `@task` 里，因为节点可能被重跑；
5. **工具设计、提示词、评测，框架一样都不替你做**。`@tool` 只是省掉了写 JSON Schema 的工夫，工具好不好用还是取决于你；
6. **锁定版本**：在 `requirements.txt` 里写死 `langchain` 和 `langgraph` 的版本，升级前看 release notes；
7. **用得上就接 LangSmith，用不上也别勉强**：追踪一个多步 Agent 确实需要好的可观测性工具，但它不是必须的，Langfuse 这类开源方案也能接。

## 小结

1. **LangChain 和 LangGraph 是两层**：LangChain 提供统一的模型接口、消息、工具和一个现成的 `create_agent`；LangGraph 是底层的编排框架和运行时，`create_agent` 本身就是一张 LangGraph 图；
2. **1.0 是一次大扫除**：老的 Chain 进了 `langchain-classic`，Agent 统一到 `create_agent`，LangGraph 承诺 2.0 之前不再有破坏性改动；
3. **中间件是 `create_agent` 的扩展点**：`before_*`、`after_*` 改状态，`wrap_*` 包住一次调用；压缩、审批、重试、限流、降级都有现成的；
4. **LangGraph 的三要素是状态、节点和边**：节点返回增量更新，reducer 决定怎么合并，条件边、`Command` 和 `Send` 负责路由和动态并行；
5. **执行按超步进行**：同一步里的节点并行、看同一份快照，步与步之间合并状态、存检查点，所以结果确定、随时可停；
6. **检查点是真正的核心**：`thread_id` 隔离会话，生产环境用 Postgres，`durability` 平衡性能和安全，时间旅行可以回放和分叉；
7. **`interrupt()` 让图停下来等人**，但恢复时节点会从头重跑，副作用要幂等；
8. **Functional API 适合控制逻辑为主的流程，Store 负责跨会话的长期记忆**；
9. **Deep Agents 是再往上一层的 Harness**：文件系统、子 Agent、规划、压缩都预装好了。

最后回到标题。**LangChain 回答的是"Agent 由什么组成"，LangGraph 回答的是"一个会循环、会并行、会停下来等人、会崩溃的流程，要怎么可靠地跑完"。** 前一个问题，看完几篇文章你自己就能回答；后一个问题，才是真正值得交给框架的部分。

## 参考文献

<section class="refs">
<ol>
<li id="ref-1"><span class="ref-n">[1]</span><span>LangChain Team <a href="https://www.langchain.com/blog/langchain-langgraph-1dot0">LangChain and LangGraph Agent Frameworks Reach v1.0 Milestones</a>. <i>LangChain Blog</i>, 2025. <a class="ref-back" href="#cite-1" aria-label="回到正文">↩</a></span></li>
<li id="ref-2"><span class="ref-n">[2]</span><span>LangChain <a href="https://docs.langchain.com/oss/python/releases/langgraph-v1">What's new in LangGraph v1</a>. <i>LangChain Documentation</i>. <a class="ref-back" href="#cite-2" aria-label="回到正文">↩</a></span></li>
<li id="ref-3"><span class="ref-n">[3]</span><span>Malewicz G. et al. <a href="https://dl.acm.org/doi/10.1145/1807167.1807184">Pregel: A System for Large-Scale Graph Processing</a>. <i>SIGMOD</i>, 2010. <a class="ref-back" href="#cite-3" aria-label="回到正文">↩</a></span></li>
<li id="ref-4"><span class="ref-n">[4]</span><span>Campos N. <a href="https://www.langchain.com/blog/building-langgraph">Building LangGraph: Designing an Agent Runtime from first principles</a>. <i>LangChain Blog</i>, 2025. <a class="ref-back" href="#cite-4" aria-label="回到正文">↩</a></span></li>
<li id="ref-5"><span class="ref-n">[5]</span><span>LangChain <a href="https://docs.langchain.com/oss/python/releases/langchain-v1">What's new in LangChain v1</a>. <i>LangChain Documentation</i>. <a class="ref-back" href="#cite-5" aria-label="回到正文">↩</a></span></li>
<li id="ref-6"><span class="ref-n">[6]</span><span>LangChain <a href="https://docs.langchain.com/oss/python/langchain/structured-output">Structured output</a>. <i>LangChain Documentation</i>. <a class="ref-back" href="#cite-6" aria-label="回到正文">↩</a></span></li>
<li id="ref-7"><span class="ref-n">[7]</span><span>LangChain <a href="https://docs.langchain.com/oss/python/langchain/middleware/built-in">Built-in middleware</a>. <i>LangChain Documentation</i>. <a class="ref-back" href="#cite-7" aria-label="回到正文">↩</a></span></li>
<li id="ref-8"><span class="ref-n">[8]</span><span>LangChain <a href="https://docs.langchain.com/oss/python/langchain/human-in-the-loop">Human-in-the-loop</a>. <i>LangChain Documentation</i>. <a class="ref-back" href="#cite-8" aria-label="回到正文">↩</a></span></li>
<li id="ref-9"><span class="ref-n">[9]</span><span>Schluntz E., Zhang B. <a href="https://www.anthropic.com/engineering/building-effective-agents">Building effective agents</a>. <i>Anthropic Engineering Blog</i>, 2024. <a class="ref-back" href="#cite-9" aria-label="回到正文">↩</a></span></li>
<li id="ref-10"><span class="ref-n">[10]</span><span>LangChain <a href="https://docs.langchain.com/oss/python/langgraph/graph-api">Graph API overview</a>. <i>LangGraph Documentation</i>. <a class="ref-back" href="#cite-10" aria-label="回到正文">↩</a></span></li>
<li id="ref-11"><span class="ref-n">[11]</span><span>LangChain <a href="https://docs.langchain.com/oss/python/langgraph/persistence">Persistence</a>. <i>LangGraph Documentation</i>. <a class="ref-back" href="#cite-11" aria-label="回到正文">↩</a></span></li>
<li id="ref-12"><span class="ref-n">[12]</span><span>LangChain <a href="https://docs.langchain.com/oss/python/langgraph/use-time-travel">Use time travel</a>. <i>LangGraph Documentation</i>. <a class="ref-back" href="#cite-12" aria-label="回到正文">↩</a></span></li>
<li id="ref-13"><span class="ref-n">[13]</span><span>LangChain <a href="https://docs.langchain.com/oss/python/langgraph/interrupts">Interrupts</a>. <i>LangGraph Documentation</i>. <a class="ref-back" href="#cite-13" aria-label="回到正文">↩</a></span></li>
<li id="ref-14"><span class="ref-n">[14]</span><span>LangChain <a href="https://docs.langchain.com/oss/python/langgraph/streaming">Streaming</a>. <i>LangGraph Documentation</i>. <a class="ref-back" href="#cite-14" aria-label="回到正文">↩</a></span></li>
<li id="ref-15"><span class="ref-n">[15]</span><span>LangChain <a href="https://docs.langchain.com/oss/python/langgraph/functional-api">Functional API overview</a>. <i>LangGraph Documentation</i>. <a class="ref-back" href="#cite-15" aria-label="回到正文">↩</a></span></li>
<li id="ref-16"><span class="ref-n">[16]</span><span>LangChain <a href="https://docs.langchain.com/oss/python/langgraph/stores">Stores</a>. <i>LangGraph Documentation</i>. <a class="ref-back" href="#cite-16" aria-label="回到正文">↩</a></span></li>
<li id="ref-17"><span class="ref-n">[17]</span><span>LangChain <a href="https://docs.langchain.com/oss/python/deepagents/overview">Deep Agents overview</a>. <i>LangChain Documentation</i>. <a class="ref-back" href="#cite-17" aria-label="回到正文">↩</a></span></li>
<li id="ref-18"><span class="ref-n">[18]</span><span>Trivedy V. <a href="https://www.langchain.com/blog/the-anatomy-of-an-agent-harness">The Anatomy of an Agent Harness</a>. <i>LangChain Blog</i>, 2026. <a class="ref-back" href="#cite-18" aria-label="回到正文">↩</a></span></li>
<li id="ref-19"><span class="ref-n">[19]</span><span>LangChain Team <a href="https://www.langchain.com/blog/deep-agents-0-6">New in Deep Agents v0.6</a>. <i>LangChain Blog</i>, 2026. <a class="ref-back" href="#cite-19" aria-label="回到正文">↩</a></span></li>
</ol>
</section>
