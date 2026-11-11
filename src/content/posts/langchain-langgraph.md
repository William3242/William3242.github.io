---
title: LangChain 与 LangGraph：一个管搭积木，一个管怎么跑
description: LangChain 和 LangGraph 经常被混着说，其实是两层东西。这篇讲清两者的关系，过一遍 LangChain 1.x 的 create_agent 和中间件，再拆开 LangGraph 的状态、超步、检查点、interrupt 和流式，最后聊聊 Deep Agents 和怎么选。
pubDate: 2026-11-11
tags: [Agent, LLM, 框架]
---

前面几篇讲 Agent 时我一直不绑定框架，但真动手做项目，绕不开"要不要用 LangChain"这个问题。更让人困惑的是它还有个 LangGraph，两者到底什么关系？这篇就讲这个。代码基于 2025 年 10 月 1.0 之后的版本<sup class="cite" id="cite-1"><a href="#ref-1" title="LangChain and LangGraph Agent Frameworks Reach v1.0 Milestones">1</a></sup>（写这篇时 `langchain` 1.4、`langgraph` 1.2），1.0 之前的 `LLMChain`、`AgentExecutor` 那一套不再展开。

## 两层东西

一句话：**LangChain 管"用什么搭"，LangGraph 管"怎么跑"。**

- **LangChain**：统一的模型接口、消息、工具、结构化输出，加一个现成的 `create_agent`；
- **LangGraph**：底层的编排框架和运行时，把流程画成图来执行，并把持久化、中断、流式做成一等公民<sup class="cite" id="cite-2"><a href="#ref-2" title="What's new in LangGraph v1">2</a></sup>。

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

关键在于：**`create_agent` 返回的就是一张 LangGraph 图。** 它天然带着 LangGraph 的能力；不够用时不用换框架，往下走一层自己画图就行。

这个结构是演化出来的。早期 LangChain 擅长把提示词、检索、模型"串成链"，但 Agent 是个循环，`AgentExecutor` 把循环藏进黑盒，想加审批、换停止条件都很难。2024 年的 LangGraph 干脆让开发者把循环画出来<sup class="cite" id="cite-3"><a href="#ref-3" title="Building LangGraph: Designing an Agent Runtime from first principles">3</a></sup>。1.0 把事情理顺了：老代码挪进 `langchain-classic`<sup class="cite" id="cite-4"><a href="#ref-4" title="What's new in LangChain v1">4</a></sup>，Agent 统一到 `create_agent`（取代 `create_react_agent`），新增中间件，LangGraph 承诺 2.0 前不再有破坏性改动<sup class="cite"><a href="#ref-2" title="What's new in LangGraph v1">2</a></sup>。

## LangChain：积木和 create_agent

```python
from langchain.chat_models import init_chat_model
from langchain.tools import tool
from langchain.agents import create_agent

model = init_chat_model("anthropic:claude-sonnet-4-6")   # 换厂商只换字符串

@tool
def get_weather(city: str) -> str:
    """查询某个城市当前的天气，返回天气状况、气温和降水概率。"""
    return f"{city}：小雨，18°C，降水概率 80%"

agent = create_agent(model=model, tools=[get_weather], system_prompt="你是简洁的出行助手。")
result = agent.invoke({"messages": [{"role": "user", "content": "北京出门要带伞吗？"}]})
print(result["messages"][-1].content)
```

- `init_chat_model` 统一了各家模型的接口，消息上的 `content_blocks` 把推理、文本、工具调用整理成统一格式<sup class="cite"><a href="#ref-4" title="What's new in LangChain v1">4</a></sup>；
- `@tool` 把函数名、文档字符串、类型标注变成工具定义。它省掉的是 JSON Schema，[工具设计](/posts/agent-tools/) 的功夫一点都省不掉；
- `create_agent` 就是 [最小的 Agent 循环](/posts/agent-basics/#最小的-agent-循环)：调模型、执行工具、追加结果，直到模型不再请求工具。

要结构化结果，加一个 `response_format`，结果在 `result["structured_response"]` 里<sup class="cite" id="cite-5"><a href="#ref-5" title="Structured output">5</a></sup>。模型支持原生结构化输出时用 `ProviderStrategy`，否则用 `ToolStrategy`（把 schema 包装成一个工具），直接传 schema 类型会自动选。

### 中间件

真实项目总要在循环里加东西：压缩上下文、审批危险操作、失败重试、切备用模型。1.0 用中间件在固定位置开放钩子<sup class="cite" id="cite-6"><a href="#ref-6" title="Built-in middleware">6</a></sup>：

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

常见需求都有现成的：`SummarizationMiddleware`（压缩）、`HumanInTheLoopMiddleware`（审批）、`ModelCallLimitMiddleware` / `ToolCallLimitMiddleware`（限流）、`ModelFallbackMiddleware`（降级）、`ToolRetryMiddleware`（重试）、`PIIMiddleware`（脱敏）。自己写也很简单，比如把工具异常变成模型能读懂的提示：

```python
from langchain.agents.middleware import wrap_tool_call
from langchain.messages import ToolMessage

@wrap_tool_call
def errors_as_feedback(request, handler):
    try:
        return handler(request)
    except Exception as e:
        return ToolMessage(content=f"工具失败：{e}。请检查参数后重试。",
                           tool_call_id=request.tool_call["id"])

agent = create_agent(model=model, tools=[...], middleware=[errors_as_feedback])
```

这就是 [Harness](/posts/agent-harness/#钩子把确定性插进循环) 那篇讲的钩子：把确定性的逻辑插进不确定的循环。

人工审批值得单独看一眼，因为它用到了 LangGraph 的持久化<sup class="cite" id="cite-7"><a href="#ref-7" title="Human-in-the-loop">7</a></sup>：

```python
from langchain.agents.middleware import HumanInTheLoopMiddleware
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

agent = create_agent(
    model=model, tools=[search_orders, issue_refund],
    middleware=[HumanInTheLoopMiddleware(interrupt_on={"issue_refund": True})],
    checkpointer=InMemorySaver(),
)
config = {"configurable": {"thread_id": "ticket-1024"}}
agent.invoke({"messages": [{"role": "user", "content": "订单 A17 退款"}]}, config)
# 停在 issue_refund 之前……审批人同意后，用同一个 thread_id 接着跑：
agent.invoke(Command(resume={"decisions": [{"type": "approve"}]}), config)
```

## LangGraph：把流程画成图

`create_agent` 的结构是固定的：一个模型节点、一个工具节点、一个循环。流程有明确分支、要并行、有多个角色、有些步骤根本不需要 LLM 时，就该下沉到 LangGraph 了。用 Anthropic 的话说<sup class="cite" id="cite-8"><a href="#ref-8" title="Building effective agents">8</a></sup>，这时你要的是"工作流"而不是"Agent"，或者两者的混合。

LangGraph 只有三个概念<sup class="cite" id="cite-9"><a href="#ref-9" title="Graph API overview">9</a></sup>：**State**（共享状态）、**Node**（读状态、返回更新的函数）、**Edge**（决定下一步）。

```python
import operator
from typing import Annotated, Literal, TypedDict
from langgraph.graph import StateGraph, START, END

class State(TypedDict):
    question: str
    category: str
    answer: str
    log: Annotated[list[str], operator.add]   # reducer：追加而不是覆盖

def classify(state: State):
    c = "billing" if "退款" in state["question"] else "tech"
    return {"category": c, "log": [f"分类：{c}"]}

def billing(state: State): return {"answer": "已提交退款申请。", "log": ["退款流程"]}
def tech(state: State):    return {"answer": "请先重启应用。", "log": ["技术支持"]}

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
```

节点只返回要改的字段；没标 reducer 的字段默认覆盖，标了的按 reducer 合并。消息列表用的是内置的 `add_messages`（追加新消息、按 ID 替换旧消息），`MessagesState` 就是只有这一个字段的状态。

### 超步：为什么需要 reducer

LangGraph 按 Pregel<sup class="cite" id="cite-10"><a href="#ref-10" title="Pregel: A System for Large-Scale Graph Processing">10</a></sup> 的 BSP 模型一轮一轮执行，每轮叫一个**超步**<sup class="cite"><a href="#ref-3" title="Building LangGraph: Designing an Agent Runtime from first principles">3</a></sup>：

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

同一超步里的节点并行执行、读同一份快照；全部结束后用 reducer 按固定顺序合并，再存检查点。所以**并行是免费的**（多条出边就并行），**结果是确定的**（没有竞态），**每一步都能停**（检查点在步与步之间）。并行节点写同一个字段时，没有 reducer 就会丢数据。

运行时才知道要并行几份时，用 `Send` 做 map-reduce；想在节点里一边更新状态一边决定去向，返回 `Command(update=..., goto=...)`：

```python
from langgraph.types import Send

def fan_out(state):   # 每篇文档发一个 Send，summaries 字段用 operator.add 汇总
    return [Send("summarize", {"doc": d}) for d in state["docs"]]

builder.add_conditional_edges("load_docs", fan_out, ["summarize"])
```

这基本就是 [子 Agent](/posts/agent-subagents/) 那篇说的"拆开分发、并行去做"。

## 检查点：真正的核心

画图不难，难的是让一个要跑几十分钟、要等人、随时会崩的流程能停、能续。这才是 LangGraph 和"自己写个 while 循环"的本质区别。编译时传 checkpointer，调用时带 `thread_id`<sup class="cite" id="cite-11"><a href="#ref-11" title="Persistence">11</a></sup>：

```python
from langgraph.checkpoint.memory import InMemorySaver

graph = builder.compile(checkpointer=InMemorySaver())
config = {"configurable": {"thread_id": "user-42"}}   # 同一个 ID 就是同一段会话
graph.invoke(inputs, config)
```

开发用 `InMemorySaver`，生产换 `SqliteSaver` 或 `PostgresSaver`，接口一样。写入频率用 `durability` 控制：`"exit"` 只在结束时写，`"async"` 异步写，`"sync"` 每步写完再继续。

有了每一步的检查点，就能**时间旅行**<sup class="cite" id="cite-12"><a href="#ref-12" title="Use time travel">12</a></sup>：

```python
history = list(graph.get_state_history(config))            # 从新到旧
before = next(s for s in history if s.next == ("billing",))
graph.invoke(None, before.config)                           # 从这里回放
fork = graph.update_state(before.config, {"category": "tech"})
graph.invoke(None, fork)                                    # 改了状态，分叉出一条新分支
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

调试 40 步的 Agent 时，不用从头重跑，回到出错前那一步改了再跑就行。

### interrupt：停下来等人

```python
from langgraph.types import interrupt, Command

def approve_refund(state):
    ok = interrupt({"question": f"确认退款 {state['amount']} 元？"})
    return {"status": "refunded" if ok == "yes" else "rejected"}

graph.invoke({"amount": 199}, config)          # 停下，result["__interrupt__"] 里是问题
graph.invoke(Command(resume="yes"), config)    # resume 的值就是 interrupt() 的返回值
```

有一个反直觉的坑：**恢复时节点从头重新执行**，而不是从 `interrupt()` 那行接着跑<sup class="cite" id="cite-13"><a href="#ref-13" title="Interrupts">13</a></sup>。所以 `interrupt()` 之前的副作用必须幂等（否则邮件会发两遍），不要用 `try/except` 包住它，传的内容要能 JSON 序列化。最稳妥的做法是把 `interrupt()` 放在节点开头。

### 流式和其他

- **流式**<sup class="cite" id="cite-14"><a href="#ref-14" title="Streaming">14</a></sup>：`stream_mode="updates"` 推每个节点的更新，适合做进度；`"messages"` 推 LLM 的 token，适合打字机效果；`"custom"` 推自定义进度。
- **Functional API**<sup class="cite" id="cite-15"><a href="#ref-15" title="Functional API overview">15</a></sup>：不想画图时，用 `@entrypoint` 和 `@task` 写普通的 Python 控制流，一样有检查点和中断；完成的 `@task` 恢复时不会重跑。
- **Store**<sup class="cite" id="cite-16"><a href="#ref-16" title="Stores">16</a></sup>：检查点按 `thread_id` 隔离，跨会话的 [长期记忆](/posts/agent-memory/) 要用 Store，按命名空间存取（`store.put` / `store.search`），节点里通过 `runtime.store` 访问。

## 再往上一层：Deep Agents

能干长活的 Agent 需要一整套 Harness：规划、文件系统、子 Agent、上下文压缩。LangChain 把这套打包成了 Deep Agents，官方直接叫它"Agent Harness"<sup class="cite" id="cite-17"><a href="#ref-17" title="Deep Agents overview">17</a></sup>：

```python
from deepagents import create_deep_agent

agent = create_deep_agent(model=model, tools=[internet_search],
                          system_prompt="你是一名研究员，负责写带引用的调研报告。")
```

它在 `create_agent` 之上用中间件预装了文件工具（`read_file`、`write_file`、`edit_file`、`grep` 等）、派发子 Agent 的 `task` 工具和上下文压缩，可以对照 [Harness](/posts/agent-harness/) 那篇来看。

## 怎么选

| 场景 | 建议 |
| --- | --- |
| 单一模型、简单工具调用 | 厂商 SDK 直接写，或 `create_agent` |
| 标准 Agent 循环 + 压缩、审批、限流 | `create_agent` + 内置中间件 |
| 分支、并行、多角色的流程 | LangGraph Graph API |
| 控制逻辑为主，但要断点续跑 | LangGraph Functional API |
| 开放式长任务：调研、编码 | Deep Agents |

也要知道代价：出问题时要在多层抽象间定位，小版本发得很勤（记得锁版本），简单场景直接用 SDK 反而更可控。**LangGraph 的价值主要不在画图，而在运行时**：不需要持久化、中断、流式的话，画成图好处不多；一旦需要"停下来等人审批，三天后接着跑"，自己实现的成本远高于学一遍 LangGraph。

## 小结

1. LangChain 提供积木和 `create_agent`，LangGraph 是底下的运行时，`create_agent` 本身就是一张图；
2. 中间件是 `create_agent` 的扩展点，常见需求都有现成的；
3. LangGraph = 状态 + 节点 + 边，按超步执行，reducer 让并行结果确定；
4. 检查点是核心：会话、断点续跑、时间旅行、人工介入都靠它；`interrupt()` 恢复时节点会重跑；
5. 从 `create_agent` 开始，结构不够用再下沉到 LangGraph，长任务看 Deep Agents。

**LangChain 回答"Agent 由什么组成"，LangGraph 回答"一个会循环、会并行、会停下等人、会崩溃的流程怎么可靠地跑完"。** 后一个问题，才是真正值得交给框架的部分。

## 参考文献

<section class="refs">
<ol>
<li id="ref-1"><span class="ref-n">[1]</span><span>LangChain Team <a href="https://www.langchain.com/blog/langchain-langgraph-1dot0">LangChain and LangGraph Agent Frameworks Reach v1.0 Milestones</a>. <i>LangChain Blog</i>, 2025. <a class="ref-back" href="#cite-1" aria-label="回到正文">↩</a></span></li>
<li id="ref-2"><span class="ref-n">[2]</span><span>LangChain <a href="https://docs.langchain.com/oss/python/releases/langgraph-v1">What's new in LangGraph v1</a>. <i>LangChain Documentation</i>. <a class="ref-back" href="#cite-2" aria-label="回到正文">↩</a></span></li>
<li id="ref-3"><span class="ref-n">[3]</span><span>Campos N. <a href="https://www.langchain.com/blog/building-langgraph">Building LangGraph: Designing an Agent Runtime from first principles</a>. <i>LangChain Blog</i>, 2025. <a class="ref-back" href="#cite-3" aria-label="回到正文">↩</a></span></li>
<li id="ref-4"><span class="ref-n">[4]</span><span>LangChain <a href="https://docs.langchain.com/oss/python/releases/langchain-v1">What's new in LangChain v1</a>. <i>LangChain Documentation</i>. <a class="ref-back" href="#cite-4" aria-label="回到正文">↩</a></span></li>
<li id="ref-5"><span class="ref-n">[5]</span><span>LangChain <a href="https://docs.langchain.com/oss/python/langchain/structured-output">Structured output</a>. <i>LangChain Documentation</i>. <a class="ref-back" href="#cite-5" aria-label="回到正文">↩</a></span></li>
<li id="ref-6"><span class="ref-n">[6]</span><span>LangChain <a href="https://docs.langchain.com/oss/python/langchain/middleware/built-in">Built-in middleware</a>. <i>LangChain Documentation</i>. <a class="ref-back" href="#cite-6" aria-label="回到正文">↩</a></span></li>
<li id="ref-7"><span class="ref-n">[7]</span><span>LangChain <a href="https://docs.langchain.com/oss/python/langchain/human-in-the-loop">Human-in-the-loop</a>. <i>LangChain Documentation</i>. <a class="ref-back" href="#cite-7" aria-label="回到正文">↩</a></span></li>
<li id="ref-8"><span class="ref-n">[8]</span><span>Schluntz E., Zhang B. <a href="https://www.anthropic.com/engineering/building-effective-agents">Building effective agents</a>. <i>Anthropic Engineering Blog</i>, 2024. <a class="ref-back" href="#cite-8" aria-label="回到正文">↩</a></span></li>
<li id="ref-9"><span class="ref-n">[9]</span><span>LangChain <a href="https://docs.langchain.com/oss/python/langgraph/graph-api">Graph API overview</a>. <i>LangGraph Documentation</i>. <a class="ref-back" href="#cite-9" aria-label="回到正文">↩</a></span></li>
<li id="ref-10"><span class="ref-n">[10]</span><span>Malewicz G. et al. <a href="https://dl.acm.org/doi/10.1145/1807167.1807184">Pregel: A System for Large-Scale Graph Processing</a>. <i>SIGMOD</i>, 2010. <a class="ref-back" href="#cite-10" aria-label="回到正文">↩</a></span></li>
<li id="ref-11"><span class="ref-n">[11]</span><span>LangChain <a href="https://docs.langchain.com/oss/python/langgraph/persistence">Persistence</a>. <i>LangGraph Documentation</i>. <a class="ref-back" href="#cite-11" aria-label="回到正文">↩</a></span></li>
<li id="ref-12"><span class="ref-n">[12]</span><span>LangChain <a href="https://docs.langchain.com/oss/python/langgraph/use-time-travel">Use time travel</a>. <i>LangGraph Documentation</i>. <a class="ref-back" href="#cite-12" aria-label="回到正文">↩</a></span></li>
<li id="ref-13"><span class="ref-n">[13]</span><span>LangChain <a href="https://docs.langchain.com/oss/python/langgraph/interrupts">Interrupts</a>. <i>LangGraph Documentation</i>. <a class="ref-back" href="#cite-13" aria-label="回到正文">↩</a></span></li>
<li id="ref-14"><span class="ref-n">[14]</span><span>LangChain <a href="https://docs.langchain.com/oss/python/langgraph/streaming">Streaming</a>. <i>LangGraph Documentation</i>. <a class="ref-back" href="#cite-14" aria-label="回到正文">↩</a></span></li>
<li id="ref-15"><span class="ref-n">[15]</span><span>LangChain <a href="https://docs.langchain.com/oss/python/langgraph/functional-api">Functional API overview</a>. <i>LangGraph Documentation</i>. <a class="ref-back" href="#cite-15" aria-label="回到正文">↩</a></span></li>
<li id="ref-16"><span class="ref-n">[16]</span><span>LangChain <a href="https://docs.langchain.com/oss/python/langgraph/stores">Stores</a>. <i>LangGraph Documentation</i>. <a class="ref-back" href="#cite-16" aria-label="回到正文">↩</a></span></li>
<li id="ref-17"><span class="ref-n">[17]</span><span>LangChain <a href="https://docs.langchain.com/oss/python/deepagents/overview">Deep Agents overview</a>. <i>LangChain Documentation</i>. <a class="ref-back" href="#cite-17" aria-label="回到正文">↩</a></span></li>
</ol>
</section>
