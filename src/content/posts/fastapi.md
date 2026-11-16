---
title: FastAPI：用类型注解写 Web API
description: FastAPI 把 Python 的类型注解当成接口契约，一份声明同时拿来做参数解析、数据校验、序列化和 OpenAPI 文档。这篇从一次请求的完整流程讲起，把依赖注入、async 与线程池、lifespan、流式响应、内置 OpenTelemetry、测试和部署挨个过一遍，最后说说它不适合的场景。
pubDate: 2026-11-15
tags: [FastAPI, Python, 后端]
---

最近几篇写的都是 Agent 和大模型，但真要把一个模型能力做成服务，最后总得落到一个 Web API 上。在 Python 这一侧，这几年最常见的选择就是 FastAPI：模型推理服务、RAG 后端、MCP 服务器，很多项目的第一行代码都是 `app = FastAPI()`。

这篇是后端基础设施系列的第一篇，后面两篇会分别讲 [PostgreSQL](/posts/postgresql/) 和 [Redis](/posts/redis/)（PostgreSQL 的行级安全另有[单独一篇](/posts/postgres-rls/)）。三篇放在一起，基本就是一个小型后端服务最常见的骨架：FastAPI 接请求，PostgreSQL 存数据，Redis 做缓存、限流和队列。

FastAPI 的官方文档写得非常好，教程部分本身就是很好的入门材料<sup class="cite" id="cite-1"><a href="#ref-1" title="FastAPI">1</a></sup>。所以这篇不打算复述教程，而是想讲清楚三件事：它**是怎么工作的**，几个**最容易用错的地方**，以及**新版本里值得知道的变化**。文中的代码都在 FastAPI 0.163、Pydantic 2.14、Python 3.13 上跑过。

## FastAPI 到底是什么

FastAPI 本身其实很"薄"。它的官方定位是"高性能、易学、写得快、可用于生产"的 Web 框架<sup class="cite" id="cite-1b"><a href="#ref-1" title="FastAPI">1</a></sup>，但真正干重活的是它下面的两个库：

- **Starlette** 负责 Web 的部分：ASGI 应用、路由、中间件、请求和响应对象、WebSocket<sup class="cite" id="cite-2"><a href="#ref-2" title="Starlette">2</a></sup>。FastAPI 的 `FastAPI` 类就是继承自 Starlette 的应用类；
- **Pydantic** 负责数据的部分：根据类型声明校验输入、转换类型、把对象序列化成 JSON。Pydantic v2 的核心校验逻辑是用 Rust 写的<sup class="cite" id="cite-3"><a href="#ref-3" title="Pydantic Validation">3</a></sup>，这也是 FastAPI 在 0.100 升级到 Pydantic v2 之后，校验和序列化快了不少的原因。

FastAPI 自己做的事情，是把这两者用 Python 的类型注解"缝"在一起。你写一个普通函数，参数和返回值都标好类型，FastAPI 在启动时读取这些注解，推出每个参数该从哪里取（路径、查询串、请求头、请求体）、该怎么校验、返回值该怎么序列化，再顺手生成一份 OpenAPI 描述。作者在文档里也坦白说，FastAPI 几乎没有发明新东西，而是把之前各个工具里最好的想法拿过来组合在一起<sup class="cite" id="cite-4"><a href="#ref-4" title="Alternatives, Inspiration and Comparisons">4</a></sup>。

它跑在 **ASGI** 之上。ASGI 是 WSGI 的异步继任者，定义了 Python 异步 Web 服务器（比如 Uvicorn）和应用之间怎么通信<sup class="cite" id="cite-5"><a href="#ref-5" title="ASGI (Asynchronous Server Gateway Interface) Specification">5</a></sup>。WSGI 的模型是"一个请求调用一次函数，返回一个响应"，ASGI 则是一个异步的事件收发接口，所以天然支持长连接、WebSocket 和流式响应。这一点后面讲 SSE 时会用到。

把这些拼起来，FastAPI 的核心能力大概是下面几块：

- <span class="term-ic"><svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /> <path d="M14 2v4a2 2 0 0 0 2 2h4" /> <path d="M10 9H8" /> <path d="M16 13H8" /> <path d="M16 17H8" /></svg></span>**类型即契约**：参数、请求体、返回值都用类型注解声明，一份声明同时用于解析、校验、序列化和文档；
- <span class="term-ic"><svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /> <path d="m9 12 2 2 4-4" /></svg></span>**自动校验**：输入不合法时直接返回 422 和逐字段的错误信息，你的函数根本不会被调用；
- <span class="term-ic"><svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22v-5" /> <path d="M9 8V2" /> <path d="M15 8V2" /> <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" /></svg></span>**依赖注入**：用 `Depends` 声明"这个接口需要一个数据库会话 / 当前用户"，由框架负责创建、缓存和清理；
- <span class="term-ic"><svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="19" r="3" /> <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" /> <circle cx="18" cy="5" r="3" /></svg></span>**自动文档**：启动后访问 `/docs` 就是 Swagger UI，`/redoc` 是另一套界面，都来自同一份 OpenAPI；
- <span class="term-ic"><svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9" /> <path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5" /> <circle cx="12" cy="12" r="2" /> <path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5" /> <path d="M19.1 4.9C23 8.8 23 15.1 19.1 19" /></svg></span>**流式响应**：新版本内置了 JSON Lines 和 Server-Sent Events，对大模型应用很友好；
- <span class="term-ic"><svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" /></svg></span>**内置可观测性**：新版本默认就接上了 OpenTelemetry 的 trace、metrics 和日志。

## 一次请求走过哪些地方

理解 FastAPI 最快的办法，是跟着一个请求走一遍。

<figure class="diagram">
<svg viewBox="0 0 640 250" role="img" aria-label="一次请求在 FastAPI 中经过的环节：服务器、中间件、路由、依赖与校验、路径操作函数、响应序列化">
<defs><marker id="fa1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0 0 L10 5 L0 10 z"/></marker></defs>
<rect class="c-gray" x="8" y="70" width="88" height="60" rx="6"/><text class="t" x="52" y="96" text-anchor="middle">客户端</text><text class="ts" x="52" y="115" text-anchor="middle">HTTP 请求</text>
<rect class="c-amber" x="114" y="70" width="88" height="60" rx="6"/><text class="t" x="158" y="96" text-anchor="middle">Uvicorn</text><text class="ts" x="158" y="115" text-anchor="middle">ASGI 服务器</text>
<rect class="c-blue" x="220" y="70" width="88" height="60" rx="6"/><text class="t" x="264" y="96" text-anchor="middle">中间件</text><text class="ts" x="264" y="115" text-anchor="middle">CORS · 日志</text>
<rect class="c-purple" x="326" y="70" width="88" height="60" rx="6"/><text class="t" x="370" y="96" text-anchor="middle">路由 + 依赖</text><text class="ts" x="370" y="115" text-anchor="middle">解析 · 校验</text>
<rect class="c-green" x="432" y="70" width="88" height="60" rx="6"/><text class="t" x="476" y="96" text-anchor="middle">你的函数</text><text class="ts" x="476" y="115" text-anchor="middle">业务逻辑</text>
<rect class="c-purple" x="538" y="70" width="94" height="60" rx="6"/><text class="t" x="585" y="96" text-anchor="middle">序列化</text><text class="ts" x="585" y="115" text-anchor="middle">按返回类型过滤</text>
<path class="ln" d="M98 100 H112" marker-end="url(#fa1)"/><path class="ln" d="M204 100 H218" marker-end="url(#fa1)"/><path class="ln" d="M310 100 H324" marker-end="url(#fa1)"/><path class="ln" d="M416 100 H430" marker-end="url(#fa1)"/><path class="ln" d="M522 100 H536" marker-end="url(#fa1)"/>
<path class="sr dash" d="M370 68 V36 H52 V66" marker-end="url(#fa1)"/>
<text class="ts" x="211" y="28" text-anchor="middle">校验失败：直接返回 422，函数不会被调用</text>
<rect class="c-blue" x="220" y="160" width="300" height="26" rx="4"/><text class="ts" x="370" y="178" text-anchor="middle">Starlette：ASGI 应用、中间件、路由、请求与响应对象</text>
<rect class="c-purple" x="326" y="196" width="88" height="26" rx="4"/><text class="ts" x="370" y="214" text-anchor="middle">Pydantic</text>
<rect class="c-purple" x="538" y="196" width="94" height="26" rx="4"/><text class="ts" x="585" y="214" text-anchor="middle">Pydantic</text>
<text class="ts" x="476" y="240" text-anchor="middle">FastAPI 把这些按你的类型注解串起来</text>
</svg>
<figcaption>图 1：一次请求的流水线。FastAPI 自己主要负责紫色的两格：进来时解析校验，出去时按返回类型序列化。</figcaption>
</figure>

具体来说：

1. **Uvicorn** 接收 TCP 连接，解析 HTTP，把请求转成 ASGI 事件交给应用；
2. **中间件**按注册顺序一层层包住应用，CORS、GZip、请求日志都在这一层；
3. **路由**根据路径和方法找到对应的"路径操作函数"（FastAPI 文档里的叫法，就是你写的那个被 `@app.get` 装饰的函数）；
4. **依赖解析和校验**：FastAPI 在启动时已经根据函数签名建好了一棵依赖树，这时按树把路径参数、查询参数、请求体、依赖项一个个取出来并交给 Pydantic 校验。**任何一个不合法，就直接返回 422，你的函数不会被调用**；
5. 调用你的函数；
6. 把返回值按声明的**返回类型**（或 `response_model`）校验、过滤、序列化成 JSON，再交回给 Starlette 发出去。

第 4 步和第 6 步是 FastAPI 的价值所在，也是它和 Flask 这类框架感觉最不一样的地方：你几乎不用写"从 request 里取值、判断类型、拼 JSON"的代码。

## 先写一个能跑的服务

下面是一个待办事项的小服务，后面几节都基于它来展开：

```python
from typing import Annotated

from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field

app = FastAPI(title="Todo API")


class TodoIn(BaseModel):
    title: str = Field(min_length=1, max_length=100)
    done: bool = False


class TodoOut(TodoIn):
    id: int


DB: dict[int, TodoOut] = {}


@app.post("/todos", status_code=201)
async def create_todo(todo: TodoIn) -> TodoOut:
    new = TodoOut(id=len(DB) + 1, **todo.model_dump())
    DB[new.id] = new
    return new


@app.get("/todos/{todo_id}")
async def read_todo(todo_id: int) -> TodoOut:
    if todo_id not in DB:
        raise HTTPException(status_code=404, detail="Todo not found")
    return DB[todo_id]


@app.get("/todos")
async def list_todos(
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    done: bool | None = None,
) -> list[TodoOut]:
    items = [t for t in DB.values() if done is None or t.done == done]
    return items[:limit]
```

保存成 `main.py`，用官方 CLI 启动<sup class="cite" id="cite-6"><a href="#ref-6" title="FastAPI CLI">6</a></sup>：

```bash
pip install "fastapi[standard]"
fastapi dev main.py     # 开发模式，带自动重载
```

打开 `http://127.0.0.1:8000/docs` 就能看到三个接口的交互式文档，可以直接在页面上发请求试。

FastAPI 是怎么知道每个参数从哪来的？规则其实很简单：

- 名字出现在路径模板里（`{todo_id}`）的，是**路径参数**；
- 类型是 Pydantic 模型的（`todo: TodoIn`），是**请求体**；
- 其余的简单类型（`limit`、`done`），是**查询参数**；有默认值就是可选的。

需要更细的控制时，用 `Annotated[类型, Query(...)]`、`Path(...)`、`Header(...)`、`Body(...)` 这样的写法补充约束。`Annotated` 是现在官方推荐的风格：类型信息和 FastAPI 的元数据放在一起，函数的默认值还是普通的 Python 默认值，这个函数在 FastAPI 之外被直接调用时也不会出错。

发一个不合法的请求看看：

```bash
curl -X POST localhost:8000/todos -H 'content-type: application/json' -d '{"title": ""}'
```

```json
{
  "detail": [{
    "type": "string_too_short",
    "loc": ["body", "title"],
    "msg": "String should have at least 1 character",
    "input": "",
    "ctx": {"min_length": 1}
  }]
}
```

错误信息里有类型、位置（`loc` 指出是请求体里的 `title` 字段）和原因，前端可以直接拿来提示用户。`/todos?limit=0` 同样会因为 `ge=1` 的约束返回 422。

### 返回类型不只是文档

返回类型注解（`-> TodoOut`）在 FastAPI 里有实际作用：返回值会**按这个类型再校验和过滤一遍**<sup class="cite" id="cite-7"><a href="#ref-7" title="Response Model - Return Type">7</a></sup>。最典型的用途是防止把不该返回的字段漏出去：

```python
class UserIn(BaseModel):
    name: str
    password: str

class UserOut(BaseModel):
    name: str

@app.post("/users", response_model=UserOut)
async def create_user(user: UserIn):
    return user          # 响应里只有 name，password 被过滤掉了
```

这里用的是 `response_model` 参数而不是返回类型注解，因为函数实际返回的是 `UserIn`，标成 `-> UserOut` 会让类型检查器报错。两者同时存在时，`response_model` 优先。

这个机制我觉得是 FastAPI 最被低估的功能之一。手写 JSON 的框架里，"忘了把密码哈希从响应里去掉"是很常见的事故；在 FastAPI 里，只要输出模型写对了，多出来的字段根本出不去。

## 依赖注入：FastAPI 的真正核心

如果只能挑一个 FastAPI 的功能来深入理解，我会选依赖注入。数据库会话、当前用户、权限检查、分页参数、配置，几乎所有"横切"的东西都通过它来做<sup class="cite" id="cite-8"><a href="#ref-8" title="Dependencies">8</a></sup>。

依赖就是一个普通函数（或者可调用对象），它的参数也按和路径操作函数一样的规则解析：

```python
from typing import Annotated
from fastapi import Depends, Header, HTTPException

async def get_current_user(authorization: Annotated[str, Header()]) -> User:
    user = await verify_token(authorization)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid token")
    return user

CurrentUser = Annotated[User, Depends(get_current_user)]

@app.get("/me")
async def read_me(user: CurrentUser) -> UserOut:
    return user
```

几个值得知道的细节：

- **依赖可以嵌套**。`get_current_user` 自己也可以依赖 `get_session`，FastAPI 会解析出整棵树；
- **同一请求内默认缓存**。一个请求里多个地方都依赖 `get_session`，它只会被调用一次，大家拿到的是同一个会话。不想要缓存时写 `Depends(f, use_cache=False)`；
- **类型别名很好用**。像上面的 `CurrentUser = Annotated[User, Depends(...)]`，定义一次，到处复用，函数签名也干净很多；
- **依赖里的参数也会出现在 OpenAPI 里**。比如 `get_current_user` 需要的 `Authorization` 头，会自动出现在所有用到它的接口文档上。

### 带 yield 的依赖：资源的获取与释放

数据库会话这类东西需要"用完关掉"。FastAPI 的做法是让依赖写成生成器，`yield` 之前是获取，之后是释放<sup class="cite" id="cite-9"><a href="#ref-9" title="Dependencies with yield">9</a></sup>：

```python
from fastapi import Request

def get_session(request: Request):
    session = Session(request.app.state.pool)
    try:
        yield session
    finally:
        session.close()

SessionDep = Annotated[Session, Depends(get_session)]
```

这里有一个以前经常让人困惑的问题：`finally` 里的清理到底在什么时候执行？在响应发出之前，还是之后？新版本用一个 `scope` 参数把这件事说清楚了：

<figure class="diagram">
<svg viewBox="0 0 640 200" role="img" aria-label="带 yield 的依赖在两种 scope 下的退出时机对比">
<defs><marker id="fa3" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0 0 L10 5 L0 10 z"/></marker></defs>
<path class="ln" d="M20 40 H620" marker-end="url(#fa3)"/>
<text class="ts" x="60" y="28" text-anchor="middle">请求进来</text>
<text class="ts" x="170" y="28" text-anchor="middle">yield 之前</text>
<text class="ts" x="300" y="28" text-anchor="middle">你的函数</text>
<text class="ts" x="430" y="28" text-anchor="middle">序列化</text>
<text class="ts" x="550" y="28" text-anchor="middle">响应发完</text>
<rect class="c-green" x="225" y="50" width="150" height="26" rx="4"/><text class="ts" x="300" y="68" text-anchor="middle">路径操作函数</text>
<text class="t" x="20" y="108">scope="function"</text>
<rect class="c-blue" x="140" y="94" width="250" height="22" rx="4"/>
<text class="ts" x="265" y="110" text-anchor="middle">依赖存活：函数返回后、响应发出前退出</text>
<text class="t" x="20" y="152">scope="request"</text>
<text class="ts" x="20" y="170">（默认）</text>
<rect class="c-purple" x="140" y="138" width="440" height="22" rx="4"/>
<text class="ts" x="360" y="154" text-anchor="middle">依赖存活：一直到响应发送完毕才退出</text>
<text class="ts" x="320" y="192" text-anchor="middle">流式响应要在生成过程中用数据库会话，就需要 request 范围</text>
</svg>
<figcaption>图 2：带 yield 的依赖有两种退出时机。默认是 request，覆盖整个请求和响应周期。</figcaption>
</figure>

- `scope="function"`：依赖在函数返回之后、响应发出之前退出；
- `scope="request"`：依赖一直活到响应发送完毕才退出。**带 yield 的依赖默认就是这个范围**，而且声明为 request 范围的依赖，它的子依赖也必须是 request 范围<sup class="cite" id="cite-9b"><a href="#ref-9" title="Dependencies with yield">9</a></sup>。

```python
# 普通接口：函数一返回就把连接还回池子，可以更早释放资源
SessionDep = Annotated[Session, Depends(get_session, scope="function")]
```

怎么选？如果是流式响应（下面会讲），生成器在函数返回之后才开始真正产出数据，这时会话必须还活着，只能用默认的 request 范围。如果是普通的 JSON 接口，用 function 范围可以让数据库连接早一点还回池子，在高并发下能少占一些连接。

### 依赖注入让测试变简单

依赖注入的另一个好处在测试时体现：可以把任意依赖替换成假的实现<sup class="cite" id="cite-10"><a href="#ref-10" title="Testing Dependencies with Overrides">10</a></sup>。

```python
from fastapi.testclient import TestClient
from main import app, get_session

def fake_session():
    yield FakeSession()

app.dependency_overrides[get_session] = fake_session

def test_create_todo():
    with TestClient(app) as client:
        r = client.post("/todos", json={"title": "写 FastAPI 文章"})
        assert r.status_code == 201
        assert r.json()["id"] == 1
```

`TestClient` 在进程内直接调用 ASGI 应用，不需要真正起服务器，测试跑得很快。用 `with` 包起来，lifespan 里的启动和关闭逻辑也会执行。认证依赖也可以用同样的方式换成一个固定返回测试用户的函数，不用在测试里真去签发 token。

## async def 还是 def：最常见的坑

FastAPI 同时支持 `async def` 和普通的 `def` 来写路径操作函数和依赖，但两者的执行方式完全不同，选错了会出严重的性能问题<sup class="cite" id="cite-11"><a href="#ref-11" title="Concurrency and async / await">11</a></sup>。

- **`async def`** 的函数直接在事件循环里运行。事件循环是单线程的，它能同时处理很多请求，前提是每个请求在等 IO 时都通过 `await` 主动让出；
- **普通 `def`** 的函数会被放到一个**外部线程池**里运行，再由事件循环等待结果。FastAPI 底层用的是 AnyIO，它的默认线程限制是 **40 个**<sup class="cite" id="cite-12"><a href="#ref-12" title="Working with threads">12</a></sup>。

<figure class="diagram">
<svg viewBox="0 0 640 270" role="img" aria-label="三种情况下的并发对比：async def 正确使用 await、def 放入线程池、async def 中调用阻塞函数">
<text class="t" x="20" y="22">async def + await：等 IO 时让出，单线程交替处理</text>
<text class="ts" x="20" y="50">事件循环</text>
<rect class="c-blue" x="100" y="36" width="40" height="22" rx="3"/><text class="ts" x="120" y="52" text-anchor="middle">A</text>
<rect class="c-green" x="144" y="36" width="40" height="22" rx="3"/><text class="ts" x="164" y="52" text-anchor="middle">B</text>
<rect class="c-amber" x="188" y="36" width="40" height="22" rx="3"/><text class="ts" x="208" y="52" text-anchor="middle">C</text>
<rect class="c-blue" x="232" y="36" width="40" height="22" rx="3"/><text class="ts" x="252" y="52" text-anchor="middle">A</text>
<rect class="c-green" x="276" y="36" width="40" height="22" rx="3"/><text class="ts" x="296" y="52" text-anchor="middle">B</text>
<rect class="c-amber" x="320" y="36" width="40" height="22" rx="3"/><text class="ts" x="340" y="52" text-anchor="middle">C</text>
<text class="ts" x="380" y="52">三个请求都在推进</text>
<text class="t" x="20" y="98">def：每个请求占一个线程池线程（默认最多 40 个）</text>
<text class="ts" x="20" y="126">线程 1</text><rect class="c-blue" x="100" y="112" width="200" height="20" rx="3"/><text class="ts" x="200" y="127" text-anchor="middle">A：同步数据库调用</text>
<text class="ts" x="20" y="150">线程 2</text><rect class="c-green" x="100" y="136" width="160" height="20" rx="3"/><text class="ts" x="180" y="151" text-anchor="middle">B</text>
<text class="ts" x="20" y="174">线程 3</text><rect class="c-amber" x="100" y="160" width="230" height="20" rx="3"/><text class="ts" x="215" y="175" text-anchor="middle">C</text>
<text class="ts" x="350" y="151">并发上限受线程数约束</text>
<text class="t" x="20" y="214">async def 里写阻塞调用：整个事件循环被卡住</text>
<text class="ts" x="20" y="242">事件循环</text>
<rect class="c-red" x="100" y="228" width="260" height="22" rx="3"/><text class="ts" x="230" y="244" text-anchor="middle">A：time.sleep(2) / requests.get()</text>
<rect class="c-green" x="364" y="228" width="40" height="22" rx="3"/><text class="ts" x="384" y="244" text-anchor="middle">B</text>
<rect class="c-amber" x="408" y="228" width="40" height="22" rx="3"/><text class="ts" x="428" y="244" text-anchor="middle">C</text>
<text class="ts" x="460" y="244">B、C 只能干等</text>
</svg>
<figcaption>图 3：async def 和 def 的执行方式。最糟的是第三种：函数标了 async，里面却调用了阻塞函数。</figcaption>
</figure>

最危险的是第三种情况：函数写成了 `async def`，里面却调用了同步阻塞的库，比如 `requests.get()`、`time.sleep()`、同步的数据库驱动，或者一次耗时几百毫秒的 CPU 计算。这时整个事件循环都被卡住，**这个进程里所有其他请求都得等着**。压测时表现为 QPS 很低、延迟忽高忽低，而 CPU 并不忙。

判断规则可以简化成：

| 函数里用的库 | 用什么定义 |
| --- | --- |
| 支持 `await` 的异步库（httpx.AsyncClient、asyncpg、redis.asyncio） | `async def` |
| 同步阻塞的库（requests、psycopg2、大多数 SDK） | 普通 `def` |
| 拿不准 | 普通 `def`，官方文档的建议也是这样 |
| 必须在 `async def` 里调一个同步函数 | `await run_in_threadpool(fn, ...)` |

`run_in_threadpool` 来自 `fastapi.concurrency`，它会把同步函数放到同一个线程池里执行。至于真正吃 CPU 的计算（比如在 API 进程里直接跑模型推理），线程池也帮不上忙，因为 Python 的 GIL 会让这些线程互相抢；这类任务应该放到独立的进程、独立的推理服务，或者任务队列里去做。

这里还有一个容易忽略的点：线程池的 40 个线程是**整个进程共享的**，同步的依赖和同步的路径函数都在里面排队。如果同步接口很多又都很慢，线程池会先成为瓶颈。

## lifespan：管理整个应用的资源

数据库连接池、Redis 客户端、HTTP 客户端、加载到内存里的模型，这些东西应该在应用启动时创建一次，在关闭时清理，而不是每个请求都建一次。FastAPI 现在推荐用 `lifespan` 参数来做这件事<sup class="cite" id="cite-13"><a href="#ref-13" title="Lifespan Events">13</a></sup>：

```python
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    app.state.http = httpx.AsyncClient(timeout=10)
    app.state.pool = await create_db_pool()
    yield                              # 应用在这里开始处理请求
    await app.state.pool.close()
    await app.state.http.aclose()


app = FastAPI(lifespan=lifespan)


@app.get("/proxy")
async def proxy(request: Request):
    r = await request.app.state.http.get("https://example.com")
    return {"status": r.status_code}
```

它和上一节"带 yield 的依赖"是同一个思路，只不过范围是整个应用而不是单个请求。以前常见的 `@app.on_event("startup")` 和 `@app.on_event("shutdown")` 已经被标为弃用；而且只要传了 `lifespan`，旧的 startup 和 shutdown 处理函数就不会再被调用了，两种写法不要混用。

一个实际的建议：**HTTP 客户端一定要复用**。在每个请求里 `async with httpx.AsyncClient()` 意味着每次都要重新建立 TCP 和 TLS 连接，调用外部的大模型 API 时尤其浪费。放到 lifespan 里创建一个共享的客户端，连接池就能被复用。

## 流式响应：JSON Lines 和 SSE

大模型应用的一个典型需求是"边生成边返回"。以前在 FastAPI 里要用 `StreamingResponse` 自己拼格式，新版本把两种最常用的流式格式做成了一等公民。

**JSON Lines**：路径操作函数写成异步生成器，返回类型标成 `AsyncIterable[模型]`，FastAPI 就会把每个产出的对象序列化成一行 JSON，`Content-Type` 是 `application/jsonl`<sup class="cite" id="cite-14"><a href="#ref-14" title="Stream JSON Lines">14</a></sup>。这个功能是在 0.134.0 加入的：

```python
from collections.abc import AsyncIterable

@app.get("/todos/export")
async def export_todos() -> AsyncIterable[TodoOut]:
    for todo in DB.values():
        yield todo
```

**Server-Sent Events**：把 `response_class` 设成 `EventSourceResponse`，就能按 SSE 的格式输出事件，可以带事件名、ID 和重连间隔<sup class="cite" id="cite-15"><a href="#ref-15" title="Server-Sent Events (SSE)">15</a></sup>。这个功能是在 0.135.0 加入的：

```python
from collections.abc import AsyncIterable
from fastapi.sse import EventSourceResponse, ServerSentEvent

@app.post("/chat", response_class=EventSourceResponse)
async def chat(req: ChatRequest) -> AsyncIterable[ServerSentEvent]:
    async for token in llm.stream(req.messages):
        yield ServerSentEvent(data={"token": token}, event="token")
    yield ServerSentEvent(data={"done": True}, event="done")
```

`EventSourceResponse` 对任何 HTTP 方法都有效，不限于 GET。这一点很实用，因为聊天接口通常要用 POST 传一大段消息历史，MCP 的 Streamable HTTP 传输也是用 POST 来承载 SSE 流的。

用流式响应时有两件事要注意：

1. **前面的反向代理不要缓冲**。Nginx 默认会缓冲上游的响应，结果是前端要等整个流结束才一次性收到。需要在对应的 location 里关掉 `proxy_buffering`，或者让应用返回 `X-Accel-Buffering: no` 头；
2. **依赖的生命周期**。生成器里要用数据库会话时，会话依赖必须是 request 范围（也就是默认值），否则函数一返回会话就被关掉了，生成器再去用就会出错。这就是前面图 2 下面那句话的意思。

## 可观测性：内置 OpenTelemetry

新版本的 FastAPI 有一个不太显眼但很实用的变化：**默认就提供 OpenTelemetry 支持**，包括 HTTP 请求的 trace、metrics 和日志，WebSocket 连接也有 trace 和日志<sup class="cite" id="cite-16"><a href="#ref-16" title="OpenTelemetry">16</a></sup>。你不用改一行业务代码。

需要搞清楚的是"支持"和"导出"的区别。FastAPI 默认只是使用已经配置好的 provider，**不会自己添加 exporter**，所以如果什么都不配，这些数据不会被发到任何地方。想把数据发到 Jaeger、Grafana Tempo 或者云厂商的 APM，有两种方式：

- 设置环境变量 `FASTAPI_OTEL_AUTO_CONFIGURE=true`，再配上 OTLP 的 endpoint，让 FastAPI 自动配置 exporter；
- 在代码里自己创建 `TracerProvider` 等对象，通过 `FastAPI(telemetry={...})` 传进去。

```bash
FASTAPI_OTEL_AUTO_CONFIGURE=true \
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
OTEL_SERVICE_NAME=todo-api \
fastapi run main.py
```

我觉得这个变化的意义在于降低了门槛。以前要接 OpenTelemetry，得另外装 instrumentation 包、在启动时手动埋点，很多小项目就干脆不做了。现在默认就有，一个慢请求到底慢在哪个依赖、哪次数据库查询，就比较容易查清楚了。

## 项目大了以后怎么组织

所有接口都写在一个 `main.py` 里，到几十个接口就很难维护了。FastAPI 用 `APIRouter` 来拆分<sup class="cite" id="cite-17"><a href="#ref-17" title="Bigger Applications - Multiple Files">17</a></sup>，一个比较常见的结构是这样的：

```text
app/
├── main.py            # 创建 FastAPI 实例、lifespan、挂载路由
├── config.py          # pydantic-settings 读取环境变量
├── deps.py            # 公共依赖：get_session、get_current_user
├── routers/
│   ├── todos.py       # router = APIRouter(prefix="/todos", tags=["todos"])
│   └── users.py
├── schemas/           # Pydantic 模型：请求和响应
├── models/            # 数据库模型（ORM）
└── services/          # 业务逻辑，不依赖 FastAPI
```

```python
# app/main.py
from fastapi import Depends, FastAPI
from app.routers import todos, users

app = FastAPI(lifespan=lifespan)
app.include_router(todos.router)
app.include_router(users.router, dependencies=[Depends(require_login)])
```

`include_router` 可以给整组路由统一加前缀、标签和依赖，比如整个 `/admin` 下的接口都要求管理员权限，就不用在每个函数上重复写。

我自己比较在意的一点是：**把 schemas 和 models 分开，把业务逻辑放到 services 里**。Pydantic 模型描述的是"接口长什么样"，ORM 模型描述的是"数据库里存的是什么"，两者经常不一样，比如数据库里有密码哈希，接口里绝对不能有。而 services 不依赖 FastAPI，就可以单独测试，以后要从命令行脚本或者任务队列里调用也方便。

## 部署

开发时用 `fastapi dev`，生产环境用 `fastapi run`，后者默认关闭自动重载，并监听 `0.0.0.0`<sup class="cite" id="cite-6b"><a href="#ref-6" title="FastAPI CLI">6</a></sup>。它底层就是 Uvicorn，常用的几个选项：

```bash
fastapi run app/main.py --workers 4 --proxy-headers
```

- `--workers`：起多个进程。因为 GIL 的存在，一个 Python 进程只能用满一个 CPU 核，多核机器上要靠多进程来扩展<sup class="cite" id="cite-18"><a href="#ref-18" title="Server Workers - Uvicorn with Workers">18</a></sup>。如果是在 Kubernetes 里跑，更常见的做法是每个容器只跑一个进程，靠副本数来扩展，这样资源分配和健康检查都更清楚；
- `--proxy-headers`：放在 Nginx 等反向代理后面时，读取 `X-Forwarded-For`、`X-Forwarded-Proto` 这些头，这样应用里拿到的客户端 IP 和协议才是对的<sup class="cite" id="cite-19"><a href="#ref-19" title="Behind a Proxy">19</a></sup>。

多进程有一个容易踩的坑：**每个 worker 都是独立的进程，内存不共享**。上面例子里的 `DB` 字典、进程内的缓存、限流计数器，在 4 个 worker 下其实是 4 份互不相干的数据。用户第一次请求落在 worker 1 上创建了数据，第二次落在 worker 2 上就查不到了。所以生产环境里，需要跨请求共享的状态都应该放到外部：持久数据放 PostgreSQL，缓存、会话、限流计数放 Redis。这也是这个系列接下来两篇要讲的内容。

还有一个相关的提醒：FastAPI 自带的 `BackgroundTasks` 是在响应发出之后、**在同一个进程里**执行的<sup class="cite" id="cite-20"><a href="#ref-20" title="Background Tasks">20</a></sup>。它适合发封邮件、写条日志这种又快又丢得起的小事；进程重启时，还没执行完的任务就丢了。耗时长或者不能丢的任务，应该用真正的任务队列。

## 什么时候不选 FastAPI

FastAPI 很好用，但不是什么场景都适合：

- **需要完整的后台管理、模板渲染、内置 ORM 和迁移的传统网站**。Django 一套全带，FastAPI 这些都得自己组装。如果产品的主要形态是服务端渲染的页面加一个管理后台，Django 会省很多事；
- **团队对 async 不熟，依赖的库又基本都是同步的**。这时 FastAPI 的异步优势发挥不出来，反而多了一个"async 里误调阻塞函数"的坑。全部用 `def` 写当然可以，但那样和 Flask 的差别就主要只剩下类型校验和自动文档了；
- **对极致性能有要求的场景**。FastAPI 在 Python 框架里算快的，但瓶颈通常不在框架本身，而在 Python 解释器、序列化和业务逻辑上。真正的热点路径，用 Go 或 Rust 写会更合适；
- **只是一个简单的内部脚本服务**。几个接口、没有复杂的输入，用 FastAPI 也完全没问题，只是它的很多能力用不上。

反过来说，下面这些场景 FastAPI 几乎是首选：给前端或者移动端提供 JSON API，需要一份准确的 OpenAPI 文档让别人对接，大量调用外部 HTTP 服务（比如各家大模型 API），需要流式返回生成结果。

## 小结

回头看，FastAPI 的设计可以浓缩成一句话：**把类型注解当作唯一的事实来源**。一份声明同时决定了参数从哪取、怎么校验、返回什么、文档长什么样，所以代码、校验和文档不会互相"对不上"。

用好它，我觉得关键在下面几点：

1. **理解请求流水线**：校验发生在你的函数之前，序列化发生在之后。返回类型和 `response_model` 不只是文档，它会过滤字段；
2. **把依赖注入用起来**：会话、认证、权限都写成依赖，测试时用 `dependency_overrides` 替换。带 yield 的依赖要分清 function 和 request 两种退出时机；
3. **分清 `async def` 和 `def`**：async 函数里绝不调用阻塞的库，拿不准就用 `def`；
4. **应用级的资源放 lifespan**：连接池、HTTP 客户端都只创建一次；
5. **利用新版本的能力**：JSON Lines 和 SSE 让流式接口变得很简单，内置的 OpenTelemetry 让排查性能问题容易了很多；
6. **多进程部署时，共享状态放到外部**：这正好引出下一篇要讲的 PostgreSQL 和 Redis。

## 参考文献

<section class="refs">
<ol>
<li id="ref-1"><span class="ref-n">[1]</span><span>Ramírez S. <a href="https://fastapi.tiangolo.com/">FastAPI</a>. <i>FastAPI Documentation</i>, 2026. <a class="ref-back" href="#cite-1" aria-label="回到正文">↩</a></span></li>
<li id="ref-2"><span class="ref-n">[2]</span><span>Starlette <a href="https://www.starlette.io/">Starlette</a>. <i>starlette.io</i>, 2026. <a class="ref-back" href="#cite-2" aria-label="回到正文">↩</a></span></li>
<li id="ref-3"><span class="ref-n">[3]</span><span>Pydantic <a href="https://pydantic.dev/docs/validation/latest/get-started/">Pydantic Validation</a>. <i>Pydantic Docs</i>, 2026. <a class="ref-back" href="#cite-3" aria-label="回到正文">↩</a></span></li>
<li id="ref-4"><span class="ref-n">[4]</span><span>Ramírez S. <a href="https://fastapi.tiangolo.com/alternatives/">Alternatives, Inspiration and Comparisons</a>. <i>FastAPI Documentation</i>, 2026. <a class="ref-back" href="#cite-4" aria-label="回到正文">↩</a></span></li>
<li id="ref-5"><span class="ref-n">[5]</span><span>ASGI Team <a href="https://asgi.readthedocs.io/en/latest/specs/main.html">ASGI (Asynchronous Server Gateway Interface) Specification</a>. <i>ASGI 3.0 Documentation</i>, 2026. <a class="ref-back" href="#cite-5" aria-label="回到正文">↩</a></span></li>
<li id="ref-6"><span class="ref-n">[6]</span><span>Ramírez S. <a href="https://fastapi.tiangolo.com/fastapi-cli/">FastAPI CLI</a>. <i>FastAPI Documentation</i>, 2026. <a class="ref-back" href="#cite-6" aria-label="回到正文">↩</a></span></li>
<li id="ref-7"><span class="ref-n">[7]</span><span>Ramírez S. <a href="https://fastapi.tiangolo.com/tutorial/response-model/">Response Model - Return Type</a>. <i>FastAPI Documentation</i>, 2026. <a class="ref-back" href="#cite-7" aria-label="回到正文">↩</a></span></li>
<li id="ref-8"><span class="ref-n">[8]</span><span>Ramírez S. <a href="https://fastapi.tiangolo.com/tutorial/dependencies/">Dependencies</a>. <i>FastAPI Documentation</i>, 2026. <a class="ref-back" href="#cite-8" aria-label="回到正文">↩</a></span></li>
<li id="ref-9"><span class="ref-n">[9]</span><span>Ramírez S. <a href="https://fastapi.tiangolo.com/tutorial/dependencies/dependencies-with-yield/">Dependencies with yield</a>. <i>FastAPI Documentation</i>, 2026. <a class="ref-back" href="#cite-9" aria-label="回到正文">↩</a></span></li>
<li id="ref-10"><span class="ref-n">[10]</span><span>Ramírez S. <a href="https://fastapi.tiangolo.com/advanced/testing-dependencies/">Testing Dependencies with Overrides</a>. <i>FastAPI Documentation</i>, 2026. <a class="ref-back" href="#cite-10" aria-label="回到正文">↩</a></span></li>
<li id="ref-11"><span class="ref-n">[11]</span><span>Ramírez S. <a href="https://fastapi.tiangolo.com/async/">Concurrency and async / await</a>. <i>FastAPI Documentation</i>, 2026. <a class="ref-back" href="#cite-11" aria-label="回到正文">↩</a></span></li>
<li id="ref-12"><span class="ref-n">[12]</span><span>AnyIO <a href="https://anyio.readthedocs.io/en/stable/threads.html">Working with threads</a>. <i>AnyIO Documentation</i>, 2026. <a class="ref-back" href="#cite-12" aria-label="回到正文">↩</a></span></li>
<li id="ref-13"><span class="ref-n">[13]</span><span>Ramírez S. <a href="https://fastapi.tiangolo.com/advanced/events/">Lifespan Events</a>. <i>FastAPI Documentation</i>, 2026. <a class="ref-back" href="#cite-13" aria-label="回到正文">↩</a></span></li>
<li id="ref-14"><span class="ref-n">[14]</span><span>Ramírez S. <a href="https://fastapi.tiangolo.com/tutorial/stream-json-lines/">Stream JSON Lines</a>. <i>FastAPI Documentation</i>, 2026. <a class="ref-back" href="#cite-14" aria-label="回到正文">↩</a></span></li>
<li id="ref-15"><span class="ref-n">[15]</span><span>Ramírez S. <a href="https://fastapi.tiangolo.com/tutorial/server-sent-events/">Server-Sent Events (SSE)</a>. <i>FastAPI Documentation</i>, 2026. <a class="ref-back" href="#cite-15" aria-label="回到正文">↩</a></span></li>
<li id="ref-16"><span class="ref-n">[16]</span><span>Ramírez S. <a href="https://fastapi.tiangolo.com/advanced/opentelemetry/">OpenTelemetry</a>. <i>FastAPI Documentation</i>, 2026. <a class="ref-back" href="#cite-16" aria-label="回到正文">↩</a></span></li>
<li id="ref-17"><span class="ref-n">[17]</span><span>Ramírez S. <a href="https://fastapi.tiangolo.com/tutorial/bigger-applications/">Bigger Applications - Multiple Files</a>. <i>FastAPI Documentation</i>, 2026. <a class="ref-back" href="#cite-17" aria-label="回到正文">↩</a></span></li>
<li id="ref-18"><span class="ref-n">[18]</span><span>Ramírez S. <a href="https://fastapi.tiangolo.com/deployment/server-workers/">Server Workers - Uvicorn with Workers</a>. <i>FastAPI Documentation</i>, 2026. <a class="ref-back" href="#cite-18" aria-label="回到正文">↩</a></span></li>
<li id="ref-19"><span class="ref-n">[19]</span><span>Ramírez S. <a href="https://fastapi.tiangolo.com/advanced/behind-a-proxy/">Behind a Proxy</a>. <i>FastAPI Documentation</i>, 2026. <a class="ref-back" href="#cite-19" aria-label="回到正文">↩</a></span></li>
<li id="ref-20"><span class="ref-n">[20]</span><span>Ramírez S. <a href="https://fastapi.tiangolo.com/tutorial/background-tasks/">Background Tasks</a>. <i>FastAPI Documentation</i>, 2026. <a class="ref-back" href="#cite-20" aria-label="回到正文">↩</a></span></li>
</ol>
</section>
