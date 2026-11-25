---
title: KV Cache 与缓存命中：大模型推理为什么"第二次更便宜"
description: 同一段长提示词，第二次调用往往更快、更便宜，账单上还多出一行"缓存命中"。这篇从自回归生成讲起，把 KV Cache 的原理、显存怎么算、PagedAttention 和前缀缓存怎么管理它，一路讲到 API 侧 prompt caching 的命中规则、计费方式，以及怎样把命中率做上去。
pubDate: 2026-11-25
tags: [LLM, 推理, KV Cache, Prompt Caching, 性能优化]
---

用大模型 API 做过 Agent 的人，大概都在账单或 `usage` 字段里见过这样的东西：`cache_read_input_tokens`、`cached_tokens`、`prompt_cache_hit_tokens`。同一段几万 token 的系统提示词，第一次调用要等好几秒，第二次几乎秒回，价格还只有原来的零头。

这背后是两层东西：

- **KV Cache**：推理引擎内部的机制，单个请求生成时缓存每个 token 的 Key 和 Value，避免每生成一个词就把前文重算一遍；
- **前缀缓存 / Prompt Caching**：把 KV Cache 从"请求内"扩展到"请求之间"，不同请求只要开头一样，就直接复用之前算好的 KV，这就是所谓的**缓存命中**。

前者决定了大模型推理为什么吃显存，后者决定了你的账单。这篇按这个顺序讲：先把 KV Cache 讲透，再看引擎怎么管理它，最后落到 API 的命中规则和工程实践。

## 从自回归生成说起

大模型生成文本是**自回归**的：每次只预测下一个 token，把它拼回输入，再预测下一个。一次请求因此分成两个阶段：

- **Prefill（预填充）**：把整段提示词一次性喂进模型，所有位置并行计算，得到第一个输出 token。这一步是**计算密集**的，矩阵乘法能把 GPU 喂饱；
- **Decode（解码）**：之后每一步只新增一个 token，循环直到结束。每一步计算量很小，但要把模型权重和之前所有 token 的中间结果从显存里读一遍，是**访存密集**的<sup class="cite" id="cite-1"><a href="#ref-1" title="Efficiently Scaling Transformer Inference">1</a></sup>。

用户感受到的两个延迟指标正好对应这两个阶段：**TTFT**（首 token 延迟）主要是 prefill 的时间，随提示词长度增长；**TPOT**（每个输出 token 的间隔）是 decode 单步的时间。

<figure class="diagram">
<svg viewBox="0 0 680 210" role="img" aria-label="一次请求的时间线：先是一段较长的 prefill，并行处理全部提示词并产出第一个 token；之后是一串很短的 decode 步，每步产出一个 token">
<defs><marker id="kv1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0 0 L10 5 L0 10 z"/></marker></defs>
<text class="ts" x="20" y="28">时间 →</text>
<rect class="c-purple" x="20" y="60" width="300" height="56" rx="6"/>
<text class="t" x="170" y="84" text-anchor="middle">Prefill：整段提示词并行计算</text>
<text class="ts" x="170" y="104" text-anchor="middle">n 个 token 一次过完 · 计算密集</text>
<rect class="c-blue" x="328" y="60" width="34" height="56" rx="4"/><text class="t" x="345" y="93" text-anchor="middle">t₁</text>
<rect class="c-blue" x="366" y="60" width="34" height="56" rx="4"/><text class="t" x="383" y="93" text-anchor="middle">t₂</text>
<rect class="c-blue" x="404" y="60" width="34" height="56" rx="4"/><text class="t" x="421" y="93" text-anchor="middle">t₃</text>
<rect class="c-blue" x="442" y="60" width="34" height="56" rx="4"/><text class="t" x="459" y="93" text-anchor="middle">t₄</text>
<text class="t" x="500" y="93" text-anchor="middle">…</text>
<rect class="c-blue" x="524" y="60" width="34" height="56" rx="4"/><text class="t" x="541" y="93" text-anchor="middle">tₘ</text>
<text class="ts" x="610" y="84" text-anchor="middle">Decode</text>
<text class="ts" x="610" y="102" text-anchor="middle">逐个生成</text>
<path class="ln" d="M20 140 V150 H362 V140"/>
<text class="t" x="191" y="170" text-anchor="middle">TTFT（首 token 延迟）≈ prefill 时间</text>
<path class="ln" d="M366 140 V150 H400 V140"/>
<text class="ts" x="420" y="190" text-anchor="middle">TPOT：每步一个 token · 访存密集</text>
<path class="ln dash" d="M383 152 V176"/>
</svg>
<figcaption>图 1：一次请求分成 prefill 和 decode 两段。提示词越长，prefill 越久，首 token 等得越久。</figcaption>
</figure>

记住这张图，后面讲的两种缓存分别砍的是不同的部分：**KV Cache 让 decode 每一步不必重算前文，前缀缓存让 prefill 不必重算已经算过的开头。**

## KV Cache：只缓存 K 和 V

### 为什么能缓存

回忆自注意力（细节见 [Self-Attention 精读](/posts/self-attention/)）：每个 token 的隐藏向量经过三个投影矩阵，得到 Query、Key、Value。位置 t 的输出是用它的 Q 去和**所有 ≤ t 位置**的 K 做点积、softmax 之后，对这些位置的 V 加权求和<sup class="cite" id="cite-2"><a href="#ref-2" title="Attention Is All You Need">2</a></sup>。

在解码器里有因果掩码，每个位置只能看见自己和前面的 token。这带来一个关键性质：**一个 token 的 K 和 V 一旦算出来，后面再生成多少新 token，它都不会变。** 第 5 个 token 的 K、V 只取决于前 5 个 token，第 6 个 token 出现与否跟它无关。

于是 decode 的第 t 步只需要：

1. 对新 token 算出它自己的 q、k、v；
2. 把 k、v 追加到缓存里；
3. 用 q 和缓存里全部的 K、V 做一次注意力。

不缓存的话，每一步都要把前面 t−1 个 token 的 K、V 全部重算一遍，生成 m 个 token 的总计算量是 O(m²) 级别的重复劳动。缓存之后，每步只做一个 token 的投影，前文只需要"读"不需要"算"。

<figure class="diagram">
<svg viewBox="0 0 680 250" role="img" aria-label="解码第 6 步的对比：不使用 KV Cache 时，6 个 token 的 K 和 V 全部重新计算；使用 KV Cache 时，前 5 个 token 的 K 和 V 直接从缓存读取，只计算新 token 的 q、k、v">
<text class="t" x="170" y="24" text-anchor="middle">不用 KV Cache：每步重算全部</text>
<text class="t" x="510" y="24" text-anchor="middle">用 KV Cache：只算新 token</text>
<path class="ln dash" d="M340 14 V240"/>
<g>
<text class="ts" x="18" y="62">token</text>
<text class="ts" x="18" y="102">K</text>
<text class="ts" x="18" y="142">V</text>
<text class="ts" x="18" y="182">Q</text>
</g>
<g>
<text class="t" x="70" y="62" text-anchor="middle">我</text><text class="t" x="112" y="62" text-anchor="middle">爱</text><text class="t" x="154" y="62" text-anchor="middle">北</text><text class="t" x="196" y="62" text-anchor="middle">京</text><text class="t" x="238" y="62" text-anchor="middle">天</text><text class="t" x="280" y="62" text-anchor="middle">安</text>
<rect class="c-red" x="54" y="84" width="32" height="26" rx="4"/><rect class="c-red" x="96" y="84" width="32" height="26" rx="4"/><rect class="c-red" x="138" y="84" width="32" height="26" rx="4"/><rect class="c-red" x="180" y="84" width="32" height="26" rx="4"/><rect class="c-red" x="222" y="84" width="32" height="26" rx="4"/><rect class="c-blue" x="264" y="84" width="32" height="26" rx="4"/>
<rect class="c-red" x="54" y="124" width="32" height="26" rx="4"/><rect class="c-red" x="96" y="124" width="32" height="26" rx="4"/><rect class="c-red" x="138" y="124" width="32" height="26" rx="4"/><rect class="c-red" x="180" y="124" width="32" height="26" rx="4"/><rect class="c-red" x="222" y="124" width="32" height="26" rx="4"/><rect class="c-blue" x="264" y="124" width="32" height="26" rx="4"/>
<rect class="c-blue" x="264" y="164" width="32" height="26" rx="4"/>
<text class="ts" x="170" y="222" text-anchor="middle">红色：前文已经算过，却又算了一遍</text>
</g>
<g>
<text class="t" x="410" y="62" text-anchor="middle">我</text><text class="t" x="452" y="62" text-anchor="middle">爱</text><text class="t" x="494" y="62" text-anchor="middle">北</text><text class="t" x="536" y="62" text-anchor="middle">京</text><text class="t" x="578" y="62" text-anchor="middle">天</text><text class="t" x="620" y="62" text-anchor="middle">安</text>
<rect class="frame" x="388" y="78" width="212" height="78" rx="6"/>
<rect class="c-gray" x="394" y="84" width="32" height="26" rx="4"/><rect class="c-gray" x="436" y="84" width="32" height="26" rx="4"/><rect class="c-gray" x="478" y="84" width="32" height="26" rx="4"/><rect class="c-gray" x="520" y="84" width="32" height="26" rx="4"/><rect class="c-gray" x="562" y="84" width="32" height="26" rx="4"/><rect class="c-blue" x="604" y="84" width="32" height="26" rx="4"/>
<rect class="c-gray" x="394" y="124" width="32" height="26" rx="4"/><rect class="c-gray" x="436" y="124" width="32" height="26" rx="4"/><rect class="c-gray" x="478" y="124" width="32" height="26" rx="4"/><rect class="c-gray" x="520" y="124" width="32" height="26" rx="4"/><rect class="c-gray" x="562" y="124" width="32" height="26" rx="4"/><rect class="c-blue" x="604" y="124" width="32" height="26" rx="4"/>
<rect class="c-blue" x="604" y="164" width="32" height="26" rx="4"/>
<text class="ts" x="494" y="176" text-anchor="middle">KV Cache（只读）</text>
<text class="ts" x="510" y="222" text-anchor="middle">灰色：从缓存读　蓝色：本步新算并追加</text>
</g>
</svg>
<figcaption>图 2：解码第 6 步。Q 只需要新 token 的那一个，K、V 前文部分直接读缓存。</figcaption>
</figure>

### 为什么不缓存 Q

常有人问：既然 K、V 能缓存，Q 为什么不缓存？因为**用不上**。第 t 步的输出只需要第 t 个位置的 q，前面位置的 q 在它们各自那一步用完就没用了。前面位置的输出（隐藏状态）也一样，它们只通过 K、V 影响后续 token。所以叫 KV Cache，而不是 QKV Cache。

这里还有一个容易被忽略的推论：**KV Cache 是逐层存的。** 每一层注意力都有自己的 K、V，第 1 层的 K、V 由词向量算出，第 2 层的 K、V 由第 1 层的输出算出，以此类推。缓存必须把每一层都存下来，这正是它占显存的根源。

## KV Cache 有多大

每个 token 要缓存的数据量是：

```
每 token 的 KV Cache = 2（K 和 V）× 层数 × KV 头数 × 每头维度 × 每个数的字节数
```

一个请求的 KV Cache 再乘以序列长度，一张卡上的总量再乘以并发数。拿几个常见模型算一下（FP16/BF16，每个数 2 字节）：

| 模型 | 层数 | KV 头 × 维度 | 每 token | 8K 上下文 | 128K 上下文 |
|---|---|---|---|---|---|
| Llama 3 8B（GQA）<sup class="cite" id="cite-3"><a href="#ref-3" title="The Llama 3 Herd of Models">3</a></sup> | 32 | 8 × 128 | 128 KB | 1 GB | 16 GB |
| Llama 3 70B（GQA） | 80 | 8 × 128 | 320 KB | 2.5 GB | 40 GB |
| 假如 70B 用标准多头（64 头） | 80 | 64 × 128 | 2.5 MB | 20 GB | 320 GB |
| DeepSeek-V3（MLA）<sup class="cite" id="cite-4"><a href="#ref-4" title="DeepSeek-V3 Technical Report">4</a></sup> | 61 | 压缩隐向量 512 + 64 | 约 69 KB | 约 0.5 GB | 约 8.6 GB |

几个直观结论：

- **长上下文的 KV Cache 可以比模型本身还大。** Llama 3 70B 的 FP16 权重约 140 GB，一个 128K 的请求就要 40 GB 缓存；
- **GQA 是刚需。** 同样的 70B，如果每个查询头都配一组 K、V，缓存要大 8 倍，128K 上下文根本放不下<sup class="cite" id="cite-5"><a href="#ref-5" title="GQA: Training Generalized Multi-Query Transformer Models from Multi-Head Checkpoints">5</a></sup>；
- **MLA 换了个思路。** DeepSeek 不减头数，而是每层只缓存一个 512 维的压缩隐向量加 64 维的位置编码部分，用的时候再还原成多头的 K、V，缓存只有同规模 GQA 模型的几分之一。

放到一张卡上看就更清楚了。以 80 GB 的 H100 部署 Llama 3 8B 为例：

<figure class="diagram">
<svg viewBox="0 0 680 230" role="img" aria-label="80 GB 显存的分配：模型权重约 16 GB，运行时开销约 4 GB，剩下约 60 GB 留给 KV Cache，能容纳约 49 万个 token，相当于 120 个 4K 请求或 15 个 32K 请求">
<text class="t" x="20" y="30">一张 80 GB GPU 部署 Llama 3 8B（FP16）</text>
<rect class="c-purple" x="20" y="48" width="128" height="50" rx="4"/>
<text class="t" x="84" y="70" text-anchor="middle">权重</text><text class="ts" x="84" y="88" text-anchor="middle">≈ 16 GB</text>
<rect class="c-gray" x="148" y="48" width="32" height="50" rx="4"/>
<text class="ts" x="164" y="114" text-anchor="middle">激活等 ≈ 4 GB</text>
<rect class="c-blue" x="180" y="48" width="480" height="50" rx="4"/>
<text class="t" x="420" y="70" text-anchor="middle">KV Cache 可用空间</text><text class="ts" x="420" y="88" text-anchor="middle">≈ 60 GB ÷ 128 KB/token ≈ 49 万 token</text>
<text class="t" x="20" y="150">这 49 万 token 怎么分：</text>
<rect class="c-green" x="20" y="164" width="300" height="44" rx="5"/>
<text class="t" x="170" y="184" text-anchor="middle">120 个 4K 上下文的请求</text><text class="ts" x="170" y="200" text-anchor="middle">适合大量短对话</text>
<rect class="c-amber" x="340" y="164" width="320" height="44" rx="5"/>
<text class="t" x="500" y="184" text-anchor="middle">或者只有 15 个 32K 上下文的请求</text><text class="ts" x="500" y="200" text-anchor="middle">长上下文直接把并发压下来</text>
</svg>
<figcaption>图 3：权重是固定成本，KV Cache 是随"上下文长度 × 并发数"增长的可变成本。推理服务的吞吐上限，很大程度上由它决定。</figcaption>
</figure>

这就是为什么推理优化里几乎所有的显存技巧都围着 KV Cache 转：GQA/MLA 从模型结构上缩小它，KV Cache 量化（FP8、INT4）从数值精度上缩小它，PagedAttention 让它不浪费，前缀缓存让它被多个请求共享。

## 管好 KV Cache：PagedAttention

### 连续分配的浪费

早期的推理框架给每个请求预先分配一块**连续**的显存，大小按最大可能长度算。问题是请求最终会生成多少 token 事先不知道：

- 按最大长度预留，大部分请求用不完，剩下的就是**内部碎片**；
- 不同请求的块大小不一，释放之后留下大小不一的空洞，新请求塞不进去，这是**外部碎片**；
- 两个请求即使开头完全一样（比如同一个系统提示词），也各存一份，无法共享。

vLLM 团队测量过，当时的系统里 KV Cache 显存真正被有效利用的只有 20%~40%，其余 60%~80% 都浪费掉了<sup class="cite" id="cite-6"><a href="#ref-6" title="Efficient Memory Management for Large Language Model Serving with PagedAttention">6</a></sup>。

### 像操作系统一样分页

PagedAttention 的灵感直接来自操作系统的虚拟内存：把 KV Cache 切成固定大小的**块**（block，vLLM 默认每块 16 个 token），一个请求的逻辑序列由若干块组成，块在物理显存里不必连续，通过一张**块表**（block table）把逻辑块映射到物理块。

<figure class="diagram">
<svg viewBox="0 0 680 280" role="img" aria-label="连续分配与分页分配对比：左边每个请求预留一整段连续显存，未用部分浪费；右边请求的逻辑块通过块表映射到不连续的物理块，两个请求共享同一个系统提示词块">
<defs><marker id="kv4" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path class="ah" d="M0 0 L10 5 L0 10 z"/></marker></defs>
<text class="t" x="150" y="24" text-anchor="middle">连续预分配</text>
<text class="ts" x="20" y="58">请求 A</text>
<rect class="c-blue" x="70" y="44" width="90" height="22" rx="3"/><rect class="c-red dash" x="160" y="44" width="120" height="22" rx="3"/>
<text class="ts" x="20" y="94">请求 B</text>
<rect class="c-green" x="70" y="80" width="150" height="22" rx="3"/><rect class="c-red dash" x="220" y="80" width="60" height="22" rx="3"/>
<text class="ts" x="20" y="130">空洞</text>
<rect class="c-red dash" x="70" y="116" width="70" height="22" rx="3"/>
<text class="ts" x="150" y="166" text-anchor="middle">红色虚线：预留了但没用上</text>
<text class="ts" x="150" y="184" text-anchor="middle">同样的系统提示词，A 和 B 各存一份</text>
<path class="ln dash" d="M310 14 V270"/>
<text class="t" x="495" y="24" text-anchor="middle">分页（PagedAttention）</text>
<text class="ts" x="330" y="52">A 的逻辑块</text>
<rect class="c-amber" x="400" y="40" width="34" height="20" rx="3"/><text class="ts" x="417" y="54" text-anchor="middle">S</text>
<rect class="c-blue" x="438" y="40" width="34" height="20" rx="3"/><text class="ts" x="455" y="54" text-anchor="middle">A1</text>
<rect class="c-blue" x="476" y="40" width="34" height="20" rx="3"/><text class="ts" x="493" y="54" text-anchor="middle">A2</text>
<text class="ts" x="330" y="86">B 的逻辑块</text>
<rect class="c-amber" x="400" y="74" width="34" height="20" rx="3"/><text class="ts" x="417" y="88" text-anchor="middle">S</text>
<rect class="c-green" x="438" y="74" width="34" height="20" rx="3"/><text class="ts" x="455" y="88" text-anchor="middle">B1</text>
<text class="ts" x="560" y="70" text-anchor="middle">块表映射</text>
<path class="ln" d="M417 96 L428 180" marker-end="url(#kv4)"/>
<path class="ln" d="M400 50 C368 90 384 150 422 180" marker-end="url(#kv4)"/>
<path class="ln" d="M455 62 L550 180" marker-end="url(#kv4)"/>
<path class="ln" d="M493 62 L390 180" marker-end="url(#kv4)"/>
<path class="ln" d="M455 96 L590 180" marker-end="url(#kv4)"/>
<text class="ts" x="330" y="200">物理块</text>
<rect class="c-blue" x="372" y="184" width="34" height="22" rx="3"/>
<rect class="c-amber" x="412" y="184" width="34" height="22" rx="3"/>
<rect class="c-gray" x="452" y="184" width="34" height="22" rx="3"/>
<rect class="c-gray" x="492" y="184" width="34" height="22" rx="3"/>
<rect class="c-blue" x="532" y="184" width="34" height="22" rx="3"/>
<rect class="c-green" x="572" y="184" width="34" height="22" rx="3"/>
<rect class="c-gray" x="612" y="184" width="34" height="22" rx="3"/>
<text class="ts" x="508" y="234" text-anchor="middle">按需一块一块分配，只有最后一块可能没填满</text>
<text class="ts" x="508" y="252" text-anchor="middle">相同的前缀块 S 被 A、B 共享（引用计数）</text>
</svg>
<figcaption>图 4：分页之后，浪费只剩每个请求最后一个没填满的块；相同前缀的块可以被多个请求共享。</figcaption>
</figure>

这么做的效果：

- 浪费被压到每个请求最后一个块里，论文报告低于 4%；
- 同样的显存能塞下更多并发请求，吞吐比当时的 FasterTransformer、Orca 提高 2~4 倍；
- 块成了可以**共享**的单位：并行采样、beam search 的多个分支，或者开头相同的多个请求，可以指向同一批物理块，写入时再复制（copy-on-write）。

最后这一点，就是前缀缓存的起点。

## 跨请求复用：前缀缓存

### 前缀为什么能复用

KV Cache 的那个关键性质，放到请求之间同样成立：**位置 t 的 K、V 只取决于第 1 到第 t 个 token。** 所以两个请求只要前 n 个 token 一字不差，它们前 n 个位置每一层的 K、V 就完全一样。第二个请求的 prefill 可以跳过这 n 个 token，直接从第 n+1 个开始算。

这里的"一字不差"是字面意义上的：

- 必须是**前缀**，从第一个 token 开始连续相同。中间某段相同没用，因为那段的 K、V 还受它前面不同内容的影响；
- 必须是**同一个模型**、同一套权重。换模型、换 LoRA 适配器，KV 就不一样了；
- 只要前缀里有一个 token 变了，**它之后的所有内容**都要重新计算。

### vLLM：块哈希链

vLLM 的自动前缀缓存（Automatic Prefix Caching）建立在分页之上：每个填满的块计算一个哈希，哈希的输入是**父块的哈希 + 本块的 token**（再加上 LoRA ID、多模态输入的哈希等）<sup class="cite" id="cite-7"><a href="#ref-7" title="vLLM: Automatic Prefix Caching">7</a></sup>。因为把父块哈希串了进去，一个块的哈希实际上代表了"从开头到这个块为止的整个前缀"。

新请求到来时，引擎按块逐个算哈希、查表，查到就直接复用物理块，查不到就从这里开始正常 prefill。没人用的块不会立刻释放，而是留在一个 LRU 队列里，显存不够时再逐出最久没用的。

这个设计带来一个实际影响：**缓存粒度是块。** 一个请求最后不满 16 个 token 的那半块不会被缓存，两个请求在块中间开始分叉，那一整块也命不中。

### SGLang：基数树

SGLang 的 RadixAttention 用另一种数据结构组织同样的思想：把所有缓存过的 token 序列放进一棵**基数树**（radix tree），共享的前缀就是树上的公共路径，分叉的地方长出新的分支<sup class="cite" id="cite-8"><a href="#ref-8" title="SGLang: Efficient Execution of Structured Language Model Programs">8</a></sup>。

<figure class="diagram">
<svg viewBox="0 0 680 270" role="img" aria-label="基数树形式的前缀缓存：根节点下是系统提示词和工具定义，分出文档 A 和文档 B 两个分支，文档 A 下又有问题 1 和问题 2；新请求问题 2 沿路径命中系统提示词和文档 A，只需计算问题 2 本身">
<defs><marker id="kv5" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0 0 L10 5 L0 10 z"/></marker></defs>
<rect class="c-gray" x="290" y="14" width="100" height="30" rx="15"/><text class="t" x="340" y="34" text-anchor="middle">根</text>
<path class="sg" d="M340 46 V70" marker-end="url(#kv5)"/>
<rect class="c-amber" x="240" y="74" width="200" height="40" rx="6"/><text class="t" x="340" y="92" text-anchor="middle">系统提示词 + 工具定义</text><text class="ts" x="340" y="108" text-anchor="middle">所有请求共享 · 8K token</text>
<path class="sg" d="M300 116 L200 146" marker-end="url(#kv5)"/>
<path class="ln" d="M380 116 L480 146" marker-end="url(#kv5)"/>
<rect class="c-blue" x="110" y="150" width="180" height="40" rx="6"/><text class="t" x="200" y="168" text-anchor="middle">文档 A</text><text class="ts" x="200" y="184" text-anchor="middle">20K token</text>
<rect class="c-blue" x="390" y="150" width="180" height="40" rx="6"/><text class="t" x="480" y="168" text-anchor="middle">文档 B</text><text class="ts" x="480" y="184" text-anchor="middle">15K token</text>
<path class="ln" d="M160 192 L110 222" marker-end="url(#kv5)"/>
<path class="sg" d="M240 192 L290 222" marker-end="url(#kv5)"/>
<path class="ln" d="M480 192 V222" marker-end="url(#kv5)"/>
<rect class="c-gray" x="50" y="226" width="120" height="32" rx="6"/><text class="t" x="110" y="247" text-anchor="middle">问题 1</text>
<rect class="c-green" x="230" y="226" width="120" height="32" rx="6"/><text class="t" x="290" y="247" text-anchor="middle">问题 2（新）</text>
<rect class="c-gray" x="420" y="226" width="120" height="32" rx="6"/><text class="t" x="480" y="247" text-anchor="middle">问题 3</text>
<text class="ts" x="600" y="80" text-anchor="middle">绿色路径：</text>
<text class="ts" x="600" y="98" text-anchor="middle">新请求命中</text>
<text class="ts" x="600" y="116" text-anchor="middle">28K token</text>
<text class="ts" x="600" y="134" text-anchor="middle">只算问题本身</text>
</svg>
<figcaption>图 5：前缀缓存组织成一棵树。新请求沿着树往下走，走得越深，需要 prefill 的部分越少。</figcaption>
</figure>

基数树的好处是可以按 token 而不是按块匹配，并且天然支持"多轮对话 + 多个分支 + 少样本示例共享"这类复杂的复用模式。逐出策略同样是 LRU，只逐出叶子节点，保证留下来的始终是一条条完整的前缀。

### 显存装不下就往下放

GPU 显存毕竟有限，热门前缀可能被频繁逐出。于是有了**分层 KV Cache**：显存（HBM）放不下的块下放到 CPU 内存，再放不下就落到 SSD 甚至分布式存储，命中时再搬回来。从 SSD 读回一段 KV 往往仍比重新 prefill 快，尤其是对很长的前缀。

月之暗面的 Mooncake 把这个思路推到了架构层面：prefill 和 decode 拆到不同的机器上，中间用一个分布式的 KVCache 池连接，调度时优先把请求发到"已经缓存了它前缀"的节点<sup class="cite" id="cite-9"><a href="#ref-9" title="Mooncake: A KVCache-centric Disaggregated Architecture for LLM Serving">9</a></sup>。DeepSeek API 的"硬盘缓存"也属于这一类，缓存放在磁盘上，所以可以保留数小时到数天<sup class="cite" id="cite-10"><a href="#ref-10" title="DeepSeek API: Context Caching">10</a></sup>。

## 到了 API 这一层：Prompt Caching

商业 API 把前缀缓存包装成了一个计费功能，通常叫 **prompt caching** 或 **context caching**。原理和上面一样，区别在于你看不到引擎，只能通过请求的写法和返回的 `usage` 字段间接控制和观察它。

### 请求是怎么被"拼成一串"的

理解命中规则的前提是知道 API 把你的请求渲染成什么顺序。以 Anthropic 为例，顺序固定是 **tools → system → messages**<sup class="cite" id="cite-11"><a href="#ref-11" title="Anthropic: Prompt caching">11</a></sup>，其他厂商大同小异：工具定义和系统提示词在最前面，对话历史在后面，最新的用户消息在最后。

缓存按这个顺序做前缀匹配，于是任何一处的变化，都会让它**之后**的所有内容失效：

<figure class="diagram">
<svg viewBox="0 0 680 260" role="img" aria-label="三种请求的缓存命中情况：多轮对话追加消息时，之前的全部内容命中；系统提示词里插入当前时间时，从系统提示词开始全部未命中；修改工具列表时，从最开始全部未命中">
<text class="ts" x="128" y="24" text-anchor="middle">tools</text>
<text class="ts" x="262" y="24" text-anchor="middle">system</text>
<text class="ts" x="440" y="24" text-anchor="middle">messages（历史）</text>
<text class="ts" x="612" y="24" text-anchor="middle">新消息</text>
<text class="t" x="10" y="56">上一次</text>
<rect class="c-gray" x="80" y="38" width="96" height="26" rx="3"/><rect class="c-gray" x="180" y="38" width="164" height="26" rx="3"/><rect class="c-gray" x="348" y="38" width="184" height="26" rx="3"/>
<text class="t" x="10" y="106">①追加</text>
<rect class="c-green" x="80" y="88" width="96" height="26" rx="3"/><rect class="c-green" x="180" y="88" width="164" height="26" rx="3"/><rect class="c-green" x="348" y="88" width="184" height="26" rx="3"/><rect class="c-blue" x="536" y="88" width="130" height="26" rx="3"/>
<text class="ts" x="372" y="132" text-anchor="middle">之前的全部命中，只算新消息 ✓</text>
<text class="t" x="10" y="166">②改系统</text>
<rect class="c-green" x="80" y="148" width="96" height="26" rx="3"/><rect class="c-red" x="180" y="148" width="164" height="26" rx="3"/><rect class="c-red" x="348" y="148" width="184" height="26" rx="3"/><rect class="c-red" x="536" y="148" width="130" height="26" rx="3"/>
<text class="ts" x="262" y="166" text-anchor="middle">"当前时间 13:42"</text>
<text class="ts" x="372" y="192" text-anchor="middle">system 往后全部重算 ✗</text>
<text class="t" x="10" y="226">③改工具</text>
<rect class="c-red" x="80" y="208" width="96" height="26" rx="3"/><rect class="c-red" x="180" y="208" width="164" height="26" rx="3"/><rect class="c-red" x="348" y="208" width="184" height="26" rx="3"/><rect class="c-red" x="536" y="208" width="130" height="26" rx="3"/>
<text class="ts" x="372" y="252" text-anchor="middle">工具在最前面，一改就全军覆没 ✗</text>
</svg>
<figcaption>图 6：绿色命中、红色未命中、蓝色本来就是新内容。命中与否只看"从开头起有多长一段没变"。</figcaption>
</figure>

### 三家的做法对比

各家在"要不要手动标记""缓存多久""怎么收费"上做了不同的选择。下表是写作时（2026 年 11 月）各自文档的说法，倍率和最小长度会随模型代际调整，实际以官方定价页为准：

| | Anthropic Claude<sup class="cite" id="cite-11b"><a href="#ref-11" title="Anthropic: Prompt caching">11</a></sup> | OpenAI<sup class="cite" id="cite-12"><a href="#ref-12" title="OpenAI: Prompt caching">12</a></sup> | DeepSeek<sup class="cite" id="cite-10b"><a href="#ref-10" title="DeepSeek API: Context Caching">10</a></sup> |
|---|---|---|---|
| 是否需要标记 | 用 `cache_control` 标断点（最多 4 个），或在请求顶层开自动缓存 | 自动，无需改代码 | 自动，无需改代码 |
| 最小可缓存长度 | 随模型不同，新模型 512 token，部分旧模型 1024~4096 | 1024 token | 无明确下限，按存储单元匹配 |
| 缓存时长 | 默认 5 分钟，可选 1 小时；每次命中刷新计时 | 视模型和设置，几十分钟到 24 小时 | 不用后通常几小时到几天清除 |
| 写入价格 | 5 分钟档 1.25×，1 小时档 2× 输入价 | 旧模型不额外收；新模型开始对写入收费 | 不额外收 |
| 命中价格 | 约 0.1× 输入价，部分新模型更低 | 新模型约 0.1×，旧模型按各自缓存价 | 约为未命中价格的十分之一 |
| `usage` 里看哪里 | `cache_read_input_tokens` / `cache_creation_input_tokens` | `cached_tokens` | `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` |
| 路由提示 | — | `prompt_cache_key`，把相关请求路由到同一缓存 | — |

几个容易踩坑的细节：

- **显式断点意味着你要决定"缓存到哪"。** Anthropic 的 `cache_control` 放在哪个块上，缓存就写到哪里为止。放在每次都不一样的内容之后（比如本次的用户问题），就会每次都付写入费却永远读不回来；
- **断点只往回找有限的距离。** Anthropic 的每个断点最多往回查 20 个内容块去找上一次写入的缓存，一轮里追加了太多块，就会悄悄找不到；
- **缓存要等第一个请求"开始返回"才可读。** 同时并发发出 N 个前缀相同的请求，它们谁也读不到谁，全部按原价算。正确做法是先发一个，等它开始流式返回，再发其余的；
- **缓存按账号隔离。** 不同组织之间不共享，Anthropic 甚至在同一组织的不同 workspace 之间也不共享，跨部门"蹭"缓存是不行的；
- **命中是尽力而为的。** 尤其是自动缓存，请求可能被路由到没有这段缓存的机器上。DeepSeek 的文档直接写明不保证 100% 命中。

## 算一笔账

### 什么时候开始划算

以 Anthropic 的 5 分钟档为例：第一次写入付 1.25 倍，之后每次命中付 0.1 倍。同一段前缀用两次的成本是 1.25 + 0.1 = 1.35，不缓存是 2，**第二次就回本了**。1 小时档写入是 2 倍，用三次是 2 + 0.1 × 2 = 2.2，对比不缓存的 3，要三次才回本。

所以 TTL 的选法很简单：同一前缀的请求间隔在 5 分钟以内（比如 Agent 循环），用 5 分钟档，每次命中都会刷新计时，等于一直不过期；间隔在 5 分钟到 1 小时之间（比如用户隔一会儿才回复），才值得付 1 小时档的写入溢价。

### 一个 Agent 循环的例子

假设一个 Agent 的工具定义加系统提示词共 10K token，每轮对话（工具调用 + 结果 + 模型回复）给上下文追加 2K token，一共跑 20 轮。每一轮都要把完整上下文发一遍：

- **不缓存**：第 i 轮输入 10K + 2K × i，20 轮累计 620K token 按原价算；
- **缓存**：第 1 轮写入 12K（1.25×），之后每轮读取之前的全部（0.1×），只写入新增的 2K（1.25×）。折算成原价，累计约 120K token。

<figure class="diagram">
<svg viewBox="0 0 680 300" role="img" aria-label="20 轮 Agent 对话的累计输入成本：不缓存时成本随轮数二次增长，到第 20 轮累计 620K token 当量；缓存时几乎线性增长，到第 20 轮约 120K token 当量，节省约 81%">
<path class="ln" d="M80 250 H630"/>
<path class="ln" d="M80 250 V24"/>
<g class="ts">
<text x="72" y="254" text-anchor="end">0</text>
<text x="72" y="185" text-anchor="end">200K</text>
<text x="72" y="117" text-anchor="end">400K</text>
<text x="72" y="48" text-anchor="end">600K</text>
<text x="80" y="270" text-anchor="middle">1</text>
<text x="220" y="270" text-anchor="middle">6</text>
<text x="360" y="270" text-anchor="middle">11</text>
<text x="500" y="270" text-anchor="middle">16</text>
<text x="612" y="270" text-anchor="middle">20</text>
<text x="346" y="292" text-anchor="middle">对话轮数</text>
</g>
<path class="ln dash" d="M80 181.3 H630"/><path class="ln dash" d="M80 112.5 H630"/><path class="ln dash" d="M80 43.8 H630"/>
<polyline class="sr" points="80,245.9 108,241.1 136,235.6 164,229.4 192,222.5 220,214.9 248,206.7 276,197.8 304,188.1 332,177.8 360,166.8 388,155.1 416,142.8 444,129.7 472,115.9 500,101.5 528,86.4 556,70.6 584,54.1 612,36.9"/>
<polyline class="sg" points="80,244.8 108,243.6 136,242.2 164,240.8 192,239.3 220,237.8 248,236.2 276,234.5 304,232.7 332,230.9 360,229.0 388,227.1 416,225.0 444,222.9 472,220.8 500,218.5 528,216.2 556,213.9 584,211.4 612,208.9"/>
<circle cx="612" cy="36.9" r="3.5" fill="#f85149"/>
<circle cx="612" cy="208.9" r="3.5" fill="#3fb950"/>
<text class="t" x="604" y="30" text-anchor="end">不缓存：620K</text>
<text class="t" x="604" y="200" text-anchor="end">缓存：约 120K</text>
<text class="ts" x="260" y="60">累计输入成本（折合原价 token 数）</text>
<text class="ts" x="260" y="78">缓存节省约 81%</text>
</svg>
<figcaption>图 7：不缓存时每轮都要为整段历史付全价，累计成本随轮数二次增长；缓存后历史只付一折，曲线几乎是直线。</figcaption>
</figure>

省下的不只是钱。每一轮的 prefill 也从"处理整段上下文"变成"只处理新增的 2K"，首 token 延迟同样大幅下降。对长上下文的 Agent 来说，**缓存命中率几乎直接决定了它跑得起还是跑不起。**

## 怎样提高命中率

所有技巧都从一条规则推出来：**命中的长度 = 从开头起连续不变的长度。** 所以要做的就是让前缀尽量长、尽量稳。

### 1. 稳定的放前面，变化的放后面

按变化频率从低到高排：工具定义（几乎不变）→ 系统提示词（版本发布才变）→ 长文档、知识库片段（按任务变）→ 对话历史（每轮追加）→ 本次问题（每次都变）。缓存断点放在"共享部分"的末尾，而不是整个请求的末尾。

### 2. 揪出"隐形的变化"

最常见的缓存杀手往往不是有意改的，而是不小心带进前缀的：

| 写法 | 为什么破坏缓存 | 改法 |
|---|---|---|
| 系统提示词里写"当前时间：2026-11-25 13:42" | 每次请求前缀都不同 | 去掉，或放到最后一条用户消息里，精度降到日期 |
| 系统提示词里拼用户 ID、会话 ID | 每个用户一个前缀，无法跨用户共享 | 移到消息部分 |
| `json.dumps(d)` 不排序、遍历 `set` | 序列化顺序不确定，字节不同 | `sort_keys=True`，用有序结构 |
| 按用户权限动态拼工具列表 | 工具在最前面，一变全部失效 | 工具集固定，用权限在执行层拦截 |
| `if flag: system += "..."` | 每种开关组合都是一个独立前缀 | 把可变说明放到消息里 |

### 3. 只追加，不修改历史

多轮对话和 Agent 循环天然是"追加"的，缓存效果最好。一旦你回头修改历史，比如删掉旧的工具结果、截断最早的几轮、把历史压缩成摘要，从修改点往后就全部失效了。

这不是说不能做上下文管理（长对话总要压缩，见 [Agent 的上下文管理](/posts/agent-context-management/)），而是要意识到**每次压缩都是一次缓存重建**，应该攒到必要时一次性做，而不是每轮都小修小补。

### 4. 别中途换模型和关键参数

缓存是按模型隔离的，主循环里换模型等于从零开始。有些参数也会让部分缓存失效，比如 Anthropic 文档里列出的开关思考模式、修改 `tool_choice`、加减图片等。想用便宜模型处理子任务，更好的做法是开一个子 Agent 单独跑，而不是在主对话里来回切换。

### 5. 并发前先预热

批量处理同一份长文档的多个问题时，先发一个请求，等它开始返回再并发发其余的。有些 API 支持只写缓存不生成（比如 Anthropic 允许 `max_tokens: 0` 的预热请求），可以在流量高峰前把热门前缀先写进去。

### 6. 用 `usage` 字段持续监控

缓存失效不会报错，请求照样成功，只是账单悄悄变贵。唯一可靠的信号是返回里的缓存字段。在一个健康的多轮循环里，应该看到：

- **读取量**每轮增长，约等于之前的全部上下文；
- **写入量**很小，约等于上一轮新增的内容；
- 未缓存的输入只有最后一小段。

如果写入量每轮都接近整个上下文的大小，说明前缀在某处被改了。把相邻两次请求的完整请求体存下来做 diff，第一个不同的地方就是元凶。最好在集成测试里加一条断言："同样的请求发两次，第二次的缓存读取量必须大于 0"，防止以后的代码改动悄悄破坏它。

### 7. 自部署时：打开前缀缓存，做缓存感知的路由

自己用 vLLM、SGLang 部署时，前缀缓存通常需要确认已开启（新版本的 vLLM 默认开启，旧版本要加 `--enable-prefix-caching`）。多副本部署时，负载均衡要做**缓存感知路由**：同一会话、同一系统提示词的请求尽量发到同一个副本，否则每个副本各自冷启动，命中率会被副本数平均掉。这也正是 OpenAI 的 `prompt_cache_key` 想解决的问题。

## 小结

1. **KV Cache 的成立依据**是因果注意力：一个 token 的 K、V 只取决于它和它前面的 token，算出来就不会再变。所以只缓存 K、V，不缓存 Q；
2. **它的代价是显存**：每 token 的大小 = 2 × 层数 × KV 头数 × 每头维度 × 字节数，再乘上下文长度和并发数。长上下文时它比权重还大，GQA、MLA、量化都在压缩它；
3. **PagedAttention** 像虚拟内存一样分块管理 KV Cache，把浪费从六到八成压到几个百分点，也让块可以被多个请求共享；
4. **前缀缓存**把复用从请求内扩展到请求之间：前缀一字不差就能跳过 prefill。vLLM 用块哈希链，SGLang 用基数树，Mooncake 等系统把它扩展到内存和磁盘；
5. **API 的 prompt caching** 是同一件事的计费版：命中部分通常只付一折，Anthropic 需要标断点并对写入加价，OpenAI 和 DeepSeek 自动进行；
6. **提高命中率**只有一条原则：让前缀尽可能长、尽可能稳。稳定的放前面，消灭隐形变化，只追加不修改，不中途换模型，并用 `usage` 字段持续盯着。

归根结底，大模型推理的成本结构里，"算新的"很贵，"读旧的"很便宜。KV Cache 和前缀缓存做的都是同一件事：**尽量只算一次。** 写提示词和设计 Agent 时多想一步"哪些东西每次都一样"，往往就是成本和延迟上最便宜的一次优化。

<section class="refs">
<ol>
<li id="ref-1"><span class="ref-n">[1]</span><span>Pope R. et al. <a href="https://arxiv.org/abs/2211.05102">Efficiently Scaling Transformer Inference</a>. <i>MLSys</i>, 2023. <a class="ref-back" href="#cite-1" aria-label="回到正文">↩</a></span></li>
<li id="ref-2"><span class="ref-n">[2]</span><span>Vaswani A. et al. <a href="https://arxiv.org/abs/1706.03762">Attention Is All You Need</a>. <i>NeurIPS</i>, 2017. <a class="ref-back" href="#cite-2" aria-label="回到正文">↩</a></span></li>
<li id="ref-3"><span class="ref-n">[3]</span><span>Llama Team, AI @ Meta. <a href="https://arxiv.org/abs/2407.21783">The Llama 3 Herd of Models</a>. <i>arXiv:2407.21783</i>, 2024. <a class="ref-back" href="#cite-3" aria-label="回到正文">↩</a></span></li>
<li id="ref-4"><span class="ref-n">[4]</span><span>DeepSeek-AI. <a href="https://arxiv.org/abs/2412.19437">DeepSeek-V3 Technical Report</a>. <i>arXiv:2412.19437</i>, 2024. <a class="ref-back" href="#cite-4" aria-label="回到正文">↩</a></span></li>
<li id="ref-5"><span class="ref-n">[5]</span><span>Ainslie J. et al. <a href="https://arxiv.org/abs/2305.13245">GQA: Training Generalized Multi-Query Transformer Models from Multi-Head Checkpoints</a>. <i>EMNLP</i>, 2023. <a class="ref-back" href="#cite-5" aria-label="回到正文">↩</a></span></li>
<li id="ref-6"><span class="ref-n">[6]</span><span>Kwon W. et al. <a href="https://arxiv.org/abs/2309.06180">Efficient Memory Management for Large Language Model Serving with PagedAttention</a>. <i>SOSP</i>, 2023. <a class="ref-back" href="#cite-6" aria-label="回到正文">↩</a></span></li>
<li id="ref-7"><span class="ref-n">[7]</span><span>vLLM Project. <a href="https://docs.vllm.ai/en/latest/design/prefix_caching.html">Automatic Prefix Caching</a>. <i>vLLM Documentation</i>. <a class="ref-back" href="#cite-7" aria-label="回到正文">↩</a></span></li>
<li id="ref-8"><span class="ref-n">[8]</span><span>Zheng L. et al. <a href="https://arxiv.org/abs/2312.07104">SGLang: Efficient Execution of Structured Language Model Programs</a>. <i>NeurIPS</i>, 2024. <a class="ref-back" href="#cite-8" aria-label="回到正文">↩</a></span></li>
<li id="ref-9"><span class="ref-n">[9]</span><span>Qin R. et al. <a href="https://arxiv.org/abs/2407.00079">Mooncake: A KVCache-centric Disaggregated Architecture for LLM Serving</a>. <i>arXiv:2407.00079</i>, 2024. <a class="ref-back" href="#cite-9" aria-label="回到正文">↩</a></span></li>
<li id="ref-10"><span class="ref-n">[10]</span><span>DeepSeek. <a href="https://api-docs.deepseek.com/guides/kv_cache">Context Caching</a>. <i>DeepSeek API Docs</i>. <a class="ref-back" href="#cite-10" aria-label="回到正文">↩</a></span></li>
<li id="ref-11"><span class="ref-n">[11]</span><span>Anthropic. <a href="https://platform.claude.com/docs/en/build-with-claude/prompt-caching">Prompt caching</a>. <i>Claude Developer Platform Docs</i>. <a class="ref-back" href="#cite-11" aria-label="回到正文">↩</a></span></li>
<li id="ref-12"><span class="ref-n">[12]</span><span>OpenAI. <a href="https://developers.openai.com/docs/guides/prompt-caching">Prompt caching</a>. <i>OpenAI API Docs</i>. <a class="ref-back" href="#cite-12" aria-label="回到正文">↩</a></span></li>
</ol>
</section>
