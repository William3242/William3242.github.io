---
title: 向量数据库入门到实战：ANN 索引、相似度检索与高可用
description: 从"关键词检索为什么表达不了'意思相近'"讲起，梳理向量和 embedding 的概念、余弦/L2/内积三种距离度量，重点解释 HNSW、IVF、PQ 这些近似最近邻（ANN）索引为什么能在亿级向量上毫秒级查得又快又准，以及分片、副本、一致性这些让它"稳"的机制，最后对比 Milvus、Qdrant、Weaviate、pgvector 该怎么选，并给一个在 FastAPI 里用 Qdrant 做 RAG 检索的完整例子。
pubDate: 2026-11-27
tags: [向量数据库, RAG, 数据库, AI 基础设施]
---

前面写 [Redis](/posts/redis/) 和 [PostgreSQL](/posts/postgresql/) 的时候，都绕不开同一个话题：向量检索。Redis 8 把 Vector Set 加进了核心发行版，PostgreSQL 靠 pgvector 扩展也能做相似度搜索。两篇里我都只留了一句"数据量不大时可以不上专门的向量数据库"，没有往下展开。

这篇就把这个前提拆开：向量数据库到底解决什么问题，它为什么能查得又快又稳，以及什么情况下才真的需要单独引入一个。文中的命令和行为以各项目的官方文档为准，引用都放在文末。

## 为什么需要向量数据库

传统数据库擅长**精确匹配**：`WHERE user_id = 42`、`WHERE name LIKE '%官网%'`。但有一大类需求是"找出和这个**意思相近**的东西"：给你一段话，找文档里最相关的几段；给你一张图，找最相似的几张图；给你一个商品，找该推荐给用户的同类商品。

这类需求用关键词匹配很难表达。比如用户问"怎么给数据库做备份"，文档里写的是"数据恢复与容灾方案"——一个词都对不上，但它们说的是同一件事。问题的根源在于，语言和图片的"相似"不是字面上的相等，而是**语义上的接近**。

解决办法是 **embedding**：用一个模型把文本、图片、音频映射成一个固定长度的向量（比如 1024 维的浮点数组）。这个映射有一个关键性质——**语义相近的内容，向量在空间里也靠得近**。于是"找语义相近的东西"就变成了一个更具体的问题："给定一个向量，在一堆向量里找出离它最近的 K 个"。这就是向量数据库要解决的核心问题。

它听上去很简单，难的是规模。一个 RAG 系统的文档库可能有几百万个文本块，推荐系统可能有几亿个商品。要在这么多向量里，每次查询都在几毫秒内找到最近的 K 个，并且同时扛住高并发写入——这需要一套和传统数据库不一样的索引和存储设计。

## 向量、相似度和距离度量

在讲索引之前，先明确几件事。

**向量就是一组数。** embedding 把内容变成 d 维向量，比如 OpenAI 的 `text-embedding-3-large` 默认是 3072 维，Sentence-BERT 一类模型常用 768 维。维度越高，能表达的信息越丰富，但计算和存储也更贵。

**"最近"需要先定义距离。** 向量库里最常见的三种度量是<sup class="cite" id="cite-1"><a href="#ref-1" title="Metric Type (Milvus)">1</a></sup>：

| 度量 | 公式 | 越小越近？ | 常见用途 |
| --- | --- | --- | --- |
| 欧氏距离 L2 | √Σ(aᵢ − bᵢ)² | 是 | 低维向量、图像、地理 |
| 内积 / 点积 | Σ aᵢ·bᵢ | 否，越大越近 | 推荐系统、打分 |
| 余弦相似度 | a·b / (‖a‖·‖b‖) | 否，越大越近 | 文本 embedding |

几个要点：

- **余弦关注方向，忽略模长**。两个向量指向同一个方向，哪怕长短不同，余弦相似度也是 1。文本 embedding 大多用余弦，因为句子的长度不应该影响"意思像不像"的判断；
- **对已归一化的向量，余弦和点积是等价的**（模长都是 1，点积就等于余弦）。很多系统在写入前就把向量归一化，用点积来近似余弦，算得更快；
- **选错度量会得到奇怪的结果**。embedding 模型在训练时通常就隐含了该用什么度量，要跟着模型走。比如 Sentence-BERT 系列用余弦，CLIP 图像向量常用余弦或 L2。

还有一个绕不开的现象：**维度诅咒**。维度越高，距离越趋于均匀——在高维空间里，所有点看起来都差不多远。这意味着两类"精确"的最近邻索引（比如依赖空间划分的 KD-tree）在高维下会退化成接近线性扫描，这也是后面 ANN 成为主流的原因<sup class="cite" id="cite-2"><a href="#ref-2" title="Efficient and Robust Approximate Nearest Neighbor Search Using Hierarchical Navigable Small World Graphs">2</a></sup>。

## 快：为什么能做近似最近邻搜索

### 精确搜索的代价

精确的 K 近邻（KNN）只能做两件事：把查询向量和库里每个向量都比一遍（暴力扫描，O(N)），或者在高维空间里用树形索引剪枝——但维度一高，剪枝基本失效，还是接近 O(N)。

对一百万个 1024 维的向量，每次查询做一百万次浮点乘加，单次就要几十毫秒到上百毫秒；到一亿这个量级，精确搜索在交互场景里已经不可用了。

所以现代向量库几乎都用 **ANN（Approximate Nearest Neighbor，近似最近邻）**：**牺牲一点点召回率，换取几个数量级的速度**。核心思想是"先粗筛、再精算"，把搜索空间从 N 缩小到 log N 甚至更小。下面是几个主流的索引结构。

### Flat：不建索引，暴力扫

Flat 就是纯暴力：不建任何索引，查询时和每个向量都比一遍。它是**唯一召回率 100% 的"索引"**，也是所有 ANN 索引的基准。数据量小（几万以内）、或者需要绝对精确时用它就对了，很多库在数据量小于某个阈值时会自动回退到 Flat。

### IVF：先聚类，再只搜几个簇

IVF（Inverted File，倒排文件）的思路是"把空间划成块"<sup class="cite" id="cite-3"><a href="#ref-3" title="Billion-scale similarity search with GPUs">3</a></sup>：建索引时先用 k-means 把所有向量聚成 `nlist` 个簇，每个簇记一个质心；查询时先算查询向量到所有质心的距离，只进最近的 `nprobe` 个簇做精确搜索。

<figure class="diagram">
<svg viewBox="0 0 640 280" role="img" aria-label="IVF 索引：建索引时用 k-means 聚成多个簇，查询时先算查询到各质心的距离，只进入最近的 nprobe 个簇做精确搜索">
<defs><marker id="ivf1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0 0 L10 5 L0 10 z"/></marker></defs>
<circle class="c-blue dash" cx="140" cy="95" r="72"/>
<circle class="c-green dash" cx="360" cy="70" r="62"/>
<circle class="c-amber dash" cx="330" cy="190" r="66"/>
<circle class="c-purple dash" cx="520" cy="140" r="58"/>
<circle class="c-gray dash" cx="110" cy="215" r="56"/>
<circle class="c-red" cx="140" cy="95" r="6"/><text class="ts" x="140" y="82" text-anchor="middle">质心</text>
<circle class="c-red" cx="360" cy="70" r="6"/>
<circle class="c-red" cx="330" cy="190" r="6"/>
<circle class="c-red" cx="520" cy="140" r="6"/>
<circle class="c-red" cx="110" cy="215" r="6"/>
<path class="ln" d="M462 120 L500 132" marker-end="url(#ivf1)"/>
<text class="t" x="520" y="120" text-anchor="middle">查询点</text>
<circle class="c-red" cx="500" cy="140" r="5"/>
<path class="ln dash" d="M500 140 C460 80, 400 60, 360 70"/>
<path class="ln dash" d="M500 140 C420 210, 360 200, 330 190"/>
<text class="ts" x="560" y="235">只进最近的</text>
<text class="ts" x="560" y="253">nprobe 个簇</text>
</svg>
<figcaption>图 1：IVF 的剪枝思想。查询先和质心比一遍，只进最近的 nprobe 个簇，其余簇里的向量完全不碰。</figcaption>
</figure>

代价是召回率：如果真正的最近邻落在没被选中的簇里，就会漏掉。`nprobe` 越大，召回越高、越慢。复杂度从 O(N) 降到大约 O(nprobe × N/nlist)。

### PQ：乘积量化，压缩 + 查表加速

PQ（Product Quantization，乘积量化）解决的是另一个问题：**向量太多，内存放不下、算不过来**<sup class="cite" id="cite-4"><a href="#ref-4" title="Product Quantization for Nearest Neighbor Search">4</a></sup>。

它把每个 d 维向量切成 m 段（每段 d/m 维），对每一段分别用 k-means 训练一个码本（通常是 256 个质心）。于是原向量被编码成 m 个"码本索引"，每个索引只要 8 bit（log₂256 = 8）。一个 1024 维的 float32 向量原本占 4 KB，量化后可能只有 256 字节，压缩了一个数量级。

更妙的是距离计算可以用**查表**：先把查询向量的每一段到对应码本里所有质心的距离都算出来（一张小表），然后对每个库向量，查 m 次表、加起来，就得到了近似的距离。全程不需要恢复原始向量，也不需要逐维乘加。

IVF 和 PQ 经常组合成 **IVF-PQ**：IVF 负责剪掉大部分簇，PQ 负责在簇内压缩存储和加速距离计算。这是 Faiss 里处理十亿级向量的经典配方<sup class="cite"><a href="#ref-3" title="Billion-scale similarity search with GPUs">3</a></sup>。

### HNSW：分层图，从高速公路下到小路

HNSW（Hierarchical Navigable Small World，分层可导航小世界图）是目前综合表现最好的索引之一，也是 pgvector、Qdrant、Weaviate 等多个系统的默认或主力索引<sup class="cite"><a href="#ref-2" title="Efficient and Robust Approximate Nearest Neighbor Search Using Hierarchical Navigable Small World Graphs">2</a></sup>。

它的结构是一个**多层图**：顶层节点稀疏，边是"长距离"的，负责快速跳到大致正确的区域；越往下层节点越密，边越"短"，负责精细定位；最底层包含所有节点。

<figure class="diagram">
<svg viewBox="0 0 640 300" role="img" aria-label="HNSW 分层图：顶层节点稀疏、边长，负责快速定位；越往下层节点越密、边越短；搜索从顶层入口点开始，逐层贪心下降到最底层">
<defs><marker id="hn1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0 0 L10 5 L0 10 z"/></marker></defs>
<text class="ts" x="20" y="34">第 2 层（稀疏）</text>
<circle class="c-blue" cx="120" cy="56" r="6"/>
<circle class="c-blue" cx="300" cy="48" r="6"/>
<circle class="c-blue" cx="500" cy="56" r="6"/>
<line class="ln" x1="120" y1="56" x2="300" y2="48"/><line class="ln" x1="300" y1="48" x2="500" y2="56"/>
<text class="ts" x="20" y="112">第 1 层</text>
<circle class="c-blue" cx="80" cy="132" r="6"/>
<circle class="c-blue" cx="220" cy="126" r="6"/>
<circle class="c-blue" cx="380" cy="130" r="6"/>
<circle class="c-blue" cx="520" cy="126" r="6"/>
<line class="ln" x1="80" y1="132" x2="220" y2="126"/><line class="ln" x1="220" y1="126" x2="380" y2="130"/><line class="ln" x1="380" y1="130" x2="520" y2="126"/>
<text class="ts" x="20" y="196">第 0 层（最密，含全部节点）</text>
<circle class="c-blue" cx="60" cy="230" r="5"/><circle class="c-blue" cx="130" cy="250" r="5"/><circle class="c-blue" cx="210" cy="230" r="5"/>
<circle class="c-blue" cx="290" cy="252" r="5"/><circle class="c-blue" cx="370" cy="230" r="5"/><circle class="c-blue" cx="450" cy="250" r="5"/><circle class="c-blue" cx="540" cy="230" r="5"/>
<line class="ln" x1="60" y1="230" x2="130" y2="250"/><line class="ln" x1="130" y1="250" x2="210" y2="230"/><line class="ln" x1="210" y1="230" x2="290" y2="252"/>
<line class="ln" x1="290" y1="252" x2="370" y2="230"/><line class="ln" x1="370" y1="230" x2="450" y2="250"/><line class="ln" x1="450" y1="250" x2="540" y2="230"/>
<path class="sg" d="M300 48 C300 84, 240 96, 220 120" stroke-dasharray="4 3"/>
<path class="sg" d="M220 126 C210 168, 210 196, 210 224" stroke-dasharray="4 3"/>
<text class="ts" x="270" y="96" text-anchor="middle">贪心下降</text>
<text class="t" x="320" y="290" text-anchor="middle">入口点从顶层开始，逐层贪心地往离查询更近的节点走</text>
</svg>
<figcaption>图 2：HNSW 的多层结构。搜索从顶层入口点开始，每层贪心走到"离查询更近的局部最优"，再下降一层，直到第 0 层返回 top-k。</figcaption>
</figure>

搜索过程是：从顶层的一个入口点出发，贪心地往"离查询更近"的邻居跳，直到该层没有更近的了，就下降到下一层，重复，最后在最底层做一次更充分的搜索，返回 top-k。它本质上把"全局搜索"拆成了"逐层局部搜索"，复杂度是 O(log N) 级别。

HNSW 有三个关键参数：

- **M**：每个节点在每层最多连多少个邻居。M 越大，图越密，召回越高，但内存越大、构建越慢；
- **efConstruction**：构建索引时动态候选列表的大小，越大构建出的图质量越高，但构建越慢；
- **efSearch**：查询时动态候选列表的大小，越大召回越高、越慢。这是运行时最常调的一个旋钮。

HNSW 的代价是**内存大**——它要存整张图，原始向量通常也得留着。所以内存紧张时，会搭配量化（比如把原始向量压成 int8 的标量量化，得到 HNSW-SQ）来省内存。

### 三种索引怎么选

| 索引 | 召回 | 内存 | 构建 | 适合场景 |
| --- | --- | --- | --- | --- |
| Flat | 100% | 只存向量 | 无 | 数据量小、要精确 |
| IVF(+PQ) | 中高，可调 | 省（尤其带 PQ） | 中 | 十亿级、内存有限 |
| HNSW | 高 | 大（要存图） | 慢 | 中大规模、追求低延迟高召回 |

实际选型里，`nprobe`、`efSearch`、`M` 这些参数就是"召回率 vs 延迟"的旋钮：往召回方向拧，就慢一点；往速度方向拧，就漏一点。后面"坑"那节会再回到这一点。

### 工程加速：光有算法还不够

索引之外，工程层面也在拼命抠速度：

- **SIMD / GPU**：距离计算本质是向量乘加，天然适合单指令多数据和显卡并行。Faiss 最早就是靠 GPU 把十亿级相似度搜索压到可交互的延迟<sup class="cite"><a href="#ref-3" title="Billion-scale similarity search with GPUs">3</a></sup>；
- **量化**：float32 压成 int8（标量量化，压缩 4 倍）甚至二值，省带宽也省计算；
- **提前终止**：算到一半发现某个候选不可能进 top-k，就停手不继续算。

## 稳：分片、副本、一致性和存储

"快"讲的是单次查询，但生产环境还要求它在**写入不断、机器会挂、数据量大到单机放不下**的情况下，依然保持低延迟和不丢数据。这部分和传统分布式数据库的思路很像，各家实现略有差异。

### 分片与副本

数据超过单机内存或单机吞吐时，需要**分片**（sharding）：把向量按某种规则（通常是 ID 哈希）分布到多个分片上，查询并行发到所有分片，再合并结果<sup class="cite" id="cite-5"><a href="#ref-5" title="Horizontal Scaling (Qdrant)">5</a></sup>。每个分片还可以配**副本**（replica），查询打到任意副本都能返回，某台机器挂了不影响服务。

这里有一个向量库特有的代价：**向量检索的分片之间没有天然的裁剪条件**（不像按 `user_id` 分片，查某个用户只去一个分片）。查询向量和所有分片都"相关"，所以每次查询都要扇出到全部分片。这也意味着，分片越多，单次查询的扇出开销越大，需要在"单分片容量"和"扇出延迟"之间平衡。

### 一致性

多副本之间用什么保证读到的结果一致？多数现代向量库用 Raft 之类的共识协议管理副本状态和元数据。Qdrant 就要求至少 3 个节点组成 Raft 集群，副本数据通过一致性协议同步<sup class="cite"><a href="#ref-6" title="Distributed Deployment (Qdrant)">6</a></sup>。Milvus 则走"存算分离"路线：元数据放在 etcd（一个强一致的 KV 存储），向量数据和索引放在对象存储，查询节点、数据节点、索引节点各自独立扩展<sup class="cite" id="cite-7"><a href="#ref-7" title="Milvus Architecture Overview">7</a></sup>。

### 存储与增量索引

向量数据库的写入和查询通常是异步解耦的：

- **WAL（预写日志）**：写入先落日志再改内存，崩溃后能恢复；
- **段（segment）与合并**：新写入的数据先进"增长段"（growing segment），攒到一定量后封口变成"密封段"（sealed segment），后台再给密封段构建 ANN 索引。查询时，增长段用暴力扫描，密封段走索引，两者结果合并。这保证**写入不会阻塞查询，建索引也不会阻塞查询**；
- **冷热分层 + mmap**：热数据常驻内存，冷数据映射到磁盘文件（mmap），既省内存又不牺牲太多速度。

Milvus 把这套做得最彻底：对象存储是唯一数据源，所有 segment 和索引都落对象存储，worker 节点无状态、可以随时扩缩容<sup class="cite"><a href="#ref-7" title="Milvus Architecture Overview">7</a></sup>。代价是这套架构的运维复杂度也明显高于单二进制方案。

## 选型：专门的向量库，还是 pgvector / Redis

这是最常被问到的问题。我把选择分成三类：

**第一类：库，不是数据库。** [FAISS](https://github.com/facebookresearch/faiss)<sup class="cite" id="cite-8"><a href="#ref-8" title="FAISS: A library for efficient similarity search and clustering of dense vectors">8</a></sup>、[hnswlib](https://github.com/nmslib/hnswlib)<sup class="cite" id="cite-9"><a href="#ref-9" title="hnswlib: fast approximate nearest neighbor search">9</a></sup>、Annoy 都是进程内的向量检索库。它们只做"建索引 + 查询"，不管持久化、并发、网络和分布式。适合离线批量检索、实验，或者你已经有一套服务框架、只想在进程里嵌入一个索引。放进在线服务要自己解决存盘、副本、高可用这些事。

**第二类：专门的向量数据库。** 主流的几个：

- **Milvus**：开源里最完整的分布式方案，存算分离，目标场景是亿到十亿级、需要独立扩展的大规模系统，但也最重<sup class="cite"><a href="#ref-7" title="Milvus Architecture Overview">7</a></sup>；
- **Qdrant**：Rust 写的单二进制，性能好，最突出的是**丰富的元数据过滤**（向量检索 + 精确条件过滤的组合做得很好），部署简单，自带 Raft 高可用<sup class="cite" id="cite-10"><a href="#ref-10" title="Qdrant Documentation">10</a></sup>；
- **Weaviate**：多模态、GraphQL 接口，内置很多模块（比如直接挂 embedding 模型），适合想"开箱即用"多模态检索的场景<sup class="cite" id="cite-11"><a href="#ref-11" title="Weaviate Documentation">11</a></sup>；
- **Chroma**：轻量、嵌入式、Python 友好，适合原型和本地开发，大规模生产场景相对少见；
- **Pinecone**：全托管 SaaS，不想自己运维时用，代价是数据在别人手里、成本按量计。

**第三类：已有的数据库顺手加上向量能力。** 前面两篇都提过：

- **pgvector**：PostgreSQL 扩展，支持 HNSW 和 IVFFlat。最大的优势是**向量和业务数据、权限放在一个库里**，可以和普通 WHERE 条件、RLS 一起查，不用维护两份数据<sup class="cite" id="cite-12"><a href="#ref-12" title="pgvector: Open-source vector similarity search for Postgres">12</a></sup>。数据量千万级以内通常够用，具体例子见 [PostgreSQL 那篇](/posts/postgresql/)；
- **Redis Vector Set / 查询引擎**：Redis 8 内置，数据量不大、又已经在用 Redis 时，可以省一个系统，见 [Redis 那篇](/posts/redis/)。

**怎么选，我给一个实用的判断顺序：**

1. 数据量小（千万级以内）、图省事、已经在用 PostgreSQL → **pgvector**；
2. 数据量中等、已经在用 Redis 做缓存/会话 → **Redis 的向量能力**；
3. 数据量大（千万到亿级）、要独立扩展、要高吞吐向量服务 → **Milvus 或 Qdrant**（其中更看重过滤组合和运维简单选 Qdrant，更看重超大规模存算分离选 Milvus）；
4. 只是做实验、批量分析，不打算上服务 → **FAISS / hnswlib**。

一个更根本的原则：**向量数据库是你的"第二份数据"**。引入它，就意味着向量和原文（业务库）之间多了一层同步、一致性和运维成本。所以能不上就不上，量真的到了、或者过滤/扩展需求明确需要了，再上。

## 在 FastAPI 里用 Qdrant 做 RAG 检索

下面是基于 Qdrant Python SDK 1.x 的完整例子，演示"写入文档块"和"检索最相似的块"两条路径。embedding 用一个占位函数，实际中换成你的 embedding 服务即可。

```python
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from qdrant_client import AsyncQdrantClient
from qdrant_client.models import (
    Distance, Filter, FieldCondition, MatchValue, PointStruct, VectorParams,
)


async def embed(text: str) -> list[float]:
    # 占位：实际调用 embedding 模型，返回与集合维度一致的向量
    ...


EMBEDDING_DIM = 1024  # 必须和 embedding 模型输出一致


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.qdrant = AsyncQdrantClient(url="http://localhost:6333")
    await app.state.qdrant.create_collection(
        collection_name="chunks",
        vectors_config=VectorParams(size=EMBEDDING_DIM, distance=Distance.COSINE),
    )
    yield
    await app.state.qdrant.close()


app = FastAPI(lifespan=lifespan)


def get_qdrant(request: Request) -> AsyncQdrantClient:
    return request.app.state.qdrant


@app.post("/chunks/{chunk_id}")
async def add_chunk(chunk_id: int, body: dict, qdrant=Depends(get_qdrant)):
    vector = await embed(body["text"])
    await qdrant.upsert(
        collection_name="chunks",
        points=[
            PointStruct(
                id=chunk_id,
                vector=vector,
                payload={"doc_id": body["doc_id"], "text": body["text"]},
            )
        ],
    )
    return {"ok": True}


@app.get("/search")
async def search(q: str, doc_id: int | None = None, qdrant=Depends(get_qdrant)):
    vector = await embed(q)

    # 可选：只在一个文档范围内检索（元数据过滤）
    query_filter = None
    if doc_id is not None:
        query_filter = Filter(
            must=[FieldCondition(key="doc_id", match=MatchValue(value=doc_id))]
        )

    result = await qdrant.query_points(
        collection_name="chunks",
        query=vector,
        query_filter=query_filter,
        limit=5,
    )
    return [
        {"id": p.id, "score": p.score, "text": p.payload["text"]}
        for p in result.points
    ]
```

几点说明：

- **维度必须严格一致**。`VectorParams(size=...)` 里的维度和 `embed()` 返回的维度对不上，写入会直接报错；
- **距离度量要跟着 embedding 模型走**。这里用 `Distance.COSINE`，是文本 embedding 的常见选择；
- **`payload` 用来存向量之外的业务字段**（原文、文档 ID 等），过滤就基于它。Qdrant 会把这些字段一起索引，所以 `doc_id` 的过滤可以和向量检索同时进行；
- **`query_points` 是新版 API**，旧版的 `search` 已经标记废弃。返回的 `score` 大小和距离度量的方向有关，余弦下越接近 1 越相似。

一个完整可跑的 RAG，还要在前面拼一个"把问题和 top-k 文本一起塞进 prompt 给 LLM"的步骤，那部分见 [AI 应用开发](/posts/ai-app-development/) 里对 RAG 的讨论。

## 生产环境里最常见的坑

### 向量和模型必须严格一致

同一个集合里，所有向量必须由**同一个 embedding 模型、同一套预处理、同一个维度**产生。混用两个模型，哪怕它们都输出 1024 维，两个向量空间也互不相干，检索结果会变成垃圾。这一点在"先用旧模型建库、后换新模型"的时候最容易踩到。

### 过滤和 top-k 的顺序

"先向量检索 top-k，再按元数据过滤"是最常见的写法，但它有个坑：过滤条件很严时，top-k 里符合条件的可能不足 k 个。比如先召回 10 条，再按 `doc_id` 过滤，可能只剩 1 条。两种解决办法：一是把过滤条件作为**前置过滤**（pre-filter），在检索时就限定范围；二是**过取**（oversample），先取更多条再过滤。Qdrant 默认在查询时把过滤和向量检索合并执行，能缓解这个问题，但仍建议按实际过滤的"选择性"来评估。

### embedding 模型升级要重建索引

模型一旦升级，新向量和旧向量不可比，必须**全量重新 embedding + 重建索引**。这个过程在亿级数据上要花不少时间和算力。所以 embedding 模型的版本要和索引一样被当成"需要迁移的东西"来管理，最好能保留旧集合做灰度切换。

### 向量库和业务库的一致性

向量库是"第二份数据"：原文改了、删了，向量也要跟着改、删，否则会检索出已经过期的内容。这层同步要么靠应用自己维护，要么靠 CDC（变更数据捕获）。用 pgvector 的一个隐蔽好处就是它没有这个问题——向量和原文在同一张表里，一次事务就一致了。

### 召回不够时，上重排

向量检索是"粗排"，它擅长从百万条里快速捞出几十条候选，但精度有限。对答案质量要求高的场景，通常再接一个**重排模型**（reranker，比如 cross-encoder）：把向量召回的 top-N 逐条和问题拼起来精排，再取前几名喂给 LLM。代价是每次多一次模型调用、延迟更高，所以只在需要的时候用，并且 N 不要太大。

### 参数不是越大越好

把 `efSearch`、`nprobe` 调到很大，召回率会接近 100%，但延迟会明显上升，甚至逼近暴力扫描。上线前应该用**自己的数据和查询分布**做一次召回率-延迟的基准测试，找到业务能接受的平衡点，而不是直接抄默认值或社区"推荐值"。

## 小结

1. **向量数据库解决的是"语义相似检索"**：把内容变成向量，找离查询向量最近的 K 个；
2. **先选对距离度量**：文本 embedding 多用余弦，推荐系统常用内积，度量要跟着模型走；
3. **精确 KNN 在高维不可行**，所以用 ANN 牺牲一点召回换速度，核心是"先粗筛、再精算"；
4. **IVF 靠聚类剪枝**（nprobe 控制召回），**PQ 靠量化压缩和查表**（省内存、加速），**HNSW 靠分层图**（O(log N)、召回高但吃内存）；
5. **"稳"靠分片、副本、一致性和 WAL/段合并**：写入、建索引都不阻塞查询，机器挂了也不影响服务；
6. **选型先想清楚数据量和过滤需求**：量小用 pgvector/Redis，量大或要独立扩展再用 Milvus/Qdrant，实验用 FAISS；
7. **向量库是第二份数据**，注意维度一致、模型升级重建、与业务库的一致性，以及过滤和 top-k 的顺序。

向量数据库的"快"，本质是用 ANN 把 O(N) 降成 O(log N)；它的"稳"，本质是把分布式数据库那套分片、副本、WAL 的成熟做法搬过来。理解了这两点，剩下的选型和参数调优，都是在这两个坐标上做权衡。

## 参考文献

<section class="refs">
<ol>
<li id="ref-1"><span class="ref-n">[1]</span><span>Milvus. <a href="https://milvus.io/docs/metric.md">Metric Types</a>. <i>Milvus Docs</i>. <a class="ref-back" href="#cite-1" aria-label="回到正文">↩</a></span></li>
<li id="ref-2"><span class="ref-n">[2]</span><span>Malkov Y, Yashunin D. <a href="https://arxiv.org/abs/1603.09320">Efficient and Robust Approximate Nearest Neighbor Search Using Hierarchical Navigable Small World Graphs</a>. <i>IEEE TPAMI</i>, 2018. <a class="ref-back" href="#cite-2" aria-label="回到正文">↩</a></span></li>
<li id="ref-3"><span class="ref-n">[3]</span><span>Johnson J, Douze M, Jégou H. <a href="https://arxiv.org/abs/1702.08734">Billion-scale similarity search with GPUs</a>. <i>IEEE Transactions on Big Data</i>, 2019. <a class="ref-back" href="#cite-3" aria-label="回到正文">↩</a></span></li>
<li id="ref-4"><span class="ref-n">[4]</span><span>Jégou H, Douze M, Schmid C. <a href="https://ieeexplore.ieee.org/document/5432202">Product Quantization for Nearest Neighbor Search</a>. <i>IEEE TPAMI</i>, 2011. <a class="ref-back" href="#cite-4" aria-label="回到正文">↩</a></span></li>
<li id="ref-5"><span class="ref-n">[5]</span><span>Qdrant. <a href="https://qdrant.tech/documentation/scaling/horizontal-scaling/">Horizontal Scaling (Sharding)</a>. <i>Qdrant Docs</i>. <a class="ref-back" href="#cite-5" aria-label="回到正文">↩</a></span></li>
<li id="ref-6"><span class="ref-n">[6]</span><span>Qdrant. <a href="https://qdrant.tech/documentation/operations/distributed_deployment/">Distributed Deployment</a>. <i>Qdrant Docs</i>. <a class="ref-back" href="#cite-6" aria-label="回到正文">↩</a></span></li>
<li id="ref-7"><span class="ref-n">[7]</span><span>Milvus. <a href="https://milvus.io/docs/architecture_overview.md">Architecture Overview</a>. <i>Milvus Docs</i>. <a class="ref-back" href="#cite-7" aria-label="回到正文">↩</a></span></li>
<li id="ref-8"><span class="ref-n">[8]</span><span>Facebook AI Research. <a href="https://github.com/facebookresearch/faiss">FAISS: A library for efficient similarity search and clustering of dense vectors</a>. <i>GitHub</i>. <a class="ref-back" href="#cite-8" aria-label="回到正文">↩</a></span></li>
<li id="ref-9"><span class="ref-n">[9]</span><span>Malkov Y. <a href="https://github.com/nmslib/hnswlib">hnswlib: fast approximate nearest neighbor search</a>. <i>GitHub</i>. <a class="ref-back" href="#cite-9" aria-label="回到正文">↩</a></span></li>
<li id="ref-10"><span class="ref-n">[10]</span><span>Qdrant. <a href="https://qdrant.tech/documentation/">Documentation</a>. <i>Qdrant Docs</i>. <a class="ref-back" href="#cite-10" aria-label="回到正文">↩</a></span></li>
<li id="ref-11"><span class="ref-n">[11]</span><span>Weaviate. <a href="https://weaviate.io/developers/weaviate">Documentation</a>. <i>Weaviate Docs</i>. <a class="ref-back" href="#cite-11" aria-label="回到正文">↩</a></span></li>
<li id="ref-12"><span class="ref-n">[12]</span><span>pgvector. <a href="https://github.com/pgvector/pgvector">Open-source vector similarity search for Postgres</a>. <i>GitHub</i>. <a class="ref-back" href="#cite-12" aria-label="回到正文">↩</a></span></li>
</ol>
</section>
