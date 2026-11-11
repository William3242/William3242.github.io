---
title: Self-Attention 精读：Transformer 里那一行公式
description: Transformer 的核心是一行注意力公式。这篇把它拆到矩阵形状和具体数字：Q、K、V 从哪来，为什么要除以 √d，掩码和多头怎么实现，注意力头学到了什么，以及 KV Cache、GQA、FlashAttention 这些改进各自在解决什么问题。
pubDate: 2026-11-11
tags: [Transformer, LLM, 深度学习, 基础]
---

之前写过一篇 [Transformer 入门](/posts/transformer-intro/)，从词元化一路讲到推理，自注意力只占其中一节。但 Transformer 区别于以往网络的地方几乎全在这一节里，值得单独拿出来细看。

这篇只讲注意力：先把公式拆到矩阵形状和具体数字，再看多头、掩码的实现，然后聊聊训练好的注意力头在干什么，最后看它的代价，以及这几年围绕代价做的改进。

## 从"查表"说起

注意力最好的类比是**查表**。普通的字典查找是"硬"的：拿一个键去比，完全匹配就取出对应的值，否则什么也拿不到。

注意力做的是**软查找**：拿一个查询（Query）去和**所有**键（Key）比相似度，相似度经过 softmax 变成一组加起来为 1 的权重，再按权重把**所有**值（Value）混合起来。没有"命中"或"未命中"，只有"更像"和"不太像"。而且整个过程处处可导，权重怎么分配可以由梯度下降去学。

这个想法不是 Transformer 发明的。2014 年 Bahdanau 等人就在 RNN 翻译模型上加了注意力，让解码器每生成一个词都回头"看"一遍源句子<sup class="cite" id="cite-1"><a href="#ref-1" title="Neural Machine Translation by Jointly Learning to Align and Translate">1</a></sup>。Transformer 的激进之处在于：**把 RNN 整个扔掉，只留注意力**，并且让一个序列对**自己**做注意力，这就是"自"注意力<sup class="cite" id="cite-2"><a href="#ref-2" title="Attention Is All You Need">2</a></sup>。

## 一行公式，按形状拆开

论文里的公式是：

```
Attention(Q, K, V) = softmax(Q Kᵀ / √d_k) V
```

光看公式容易糊涂，跟着矩阵形状走一遍就清楚了。设序列有 n 个 token，每个 token 是 d 维向量，整个输入是一个 n × d 的矩阵 X。

<figure class="diagram">
<svg viewBox="0 0 640 250" role="img" aria-label="自注意力的矩阵形状：输入 X 是 n 乘 d，分别乘三个权重矩阵得到 n 乘 d_k 的 Q、K 和 n 乘 d_v 的 V；Q 乘 K 转置得到 n 乘 n 的分数矩阵，除以根号 d_k 后按行 softmax 得到注意力权重 A，A 乘 V 得到 n 乘 d_v 的输出">
<defs><marker id="sa1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0 0 L10 5 L0 10 z"/></marker></defs>
<rect class="c-gray" x="20" y="95" width="70" height="60" rx="4"/>
<text class="t" x="55" y="122" text-anchor="middle">X</text>
<text class="ts" x="55" y="140" text-anchor="middle">n × d</text>
<rect class="c-blue" x="150" y="20" width="80" height="44" rx="4"/>
<text class="t" x="190" y="39" text-anchor="middle">Q = X W_Q</text>
<text class="ts" x="190" y="56" text-anchor="middle">n × d_k</text>
<rect class="c-amber" x="150" y="103" width="80" height="44" rx="4"/>
<text class="t" x="190" y="122" text-anchor="middle">K = X W_K</text>
<text class="ts" x="190" y="139" text-anchor="middle">n × d_k</text>
<rect class="c-green" x="150" y="186" width="80" height="44" rx="4"/>
<text class="t" x="190" y="205" text-anchor="middle">V = X W_V</text>
<text class="ts" x="190" y="222" text-anchor="middle">n × d_v</text>
<path class="ln" d="M90 115 L148 45" marker-end="url(#sa1)"/>
<path class="ln" d="M90 125 H148" marker-end="url(#sa1)"/>
<path class="ln" d="M90 135 L148 205" marker-end="url(#sa1)"/>
<rect class="c-purple" x="290" y="55" width="110" height="56" rx="4"/>
<text class="t" x="345" y="77" text-anchor="middle">分数 Q Kᵀ / √d_k</text>
<text class="ts" x="345" y="96" text-anchor="middle">n × n</text>
<path class="ln" d="M230 42 L288 72" marker-end="url(#sa1)"/>
<path class="ln" d="M230 125 L288 95" marker-end="url(#sa1)"/>
<rect class="c-purple" x="440" y="55" width="80" height="56" rx="4"/>
<text class="t" x="480" y="77" text-anchor="middle">A = softmax</text>
<text class="ts" x="480" y="96" text-anchor="middle">按行 · n × n</text>
<path class="ln" d="M400 83 H438" marker-end="url(#sa1)"/>
<rect class="c-gray" x="550" y="140" width="70" height="60" rx="4"/>
<text class="t" x="585" y="166" text-anchor="middle">A V</text>
<text class="ts" x="585" y="184" text-anchor="middle">n × d_v</text>
<path class="ln" d="M480 111 L565 138" marker-end="url(#sa1)"/>
<path class="ln" d="M230 208 H520 L560 202" marker-end="url(#sa1)"/>
</svg>
<figcaption>图 1：三个投影各自独立；n × n 的分数矩阵是唯一让 token 之间发生交互的地方，第 i 行就是第 i 个 token 对所有 token 的打分。</figcaption>
</figure>

四步：

1. **投影**：X 分别乘三个可学习矩阵 W_Q、W_K、W_V，得到 Q、K、V。同一个 token 被投影成三种"角色"：我要找什么（Q）、我能被怎样找到（K）、被找到时我交出什么（V）；
2. **打分**：Q Kᵀ 是一个 n × n 矩阵，第 i 行第 j 列是 token i 的查询和 token j 的键的点积；
3. **归一化**：除以 √d_k，再**对每一行**做 softmax，得到注意力权重 A，每行加起来为 1；
4. **混合**：A V 的第 i 行，就是用第 i 行的权重对所有 V 做加权平均，作为 token i 的新表示。

注意第 1 步和第 4 步都是"逐 token"的，只有第 2、3 步的 n × n 矩阵把不同位置连了起来。这一点后面讲代价时很关键。

为什么要分出三个矩阵，而不是直接拿 X 和 X 做点积？因为"相关"不一定对称：代词"她"需要找名词，名词却不必找代词。分开 Q 和 K 让关系可以有方向；分开 V 则让"用什么来匹配"和"匹配上之后传递什么"互不牵制。

## 手算一个例子

数字比公式更有说服力。取 3 个 token，d_k = 2，为了好算，让 Q 和 K 都等于下面这个矩阵（相当于 W_Q = W_K = 单位矩阵），V 单独给定：

```
        Q = K            V
t1   [1, 0]        [1.0, 0.0]
t2   [0, 1]        [0.0, 1.0]
t3   [1, 1]        [0.5, 0.5]
```

**打分**。Q Kᵀ 的每个元素就是两行的点积，再除以 √2 ≈ 1.41：

```
          t1     t2     t3                    t1     t2     t3
t1   [   1      0      1  ]      / √2   [ 0.71   0      0.71 ]
t2   [   0      1      1  ]     ────►   [ 0      0.71   0.71 ]
t3   [   1      1      2  ]             [ 0.71   0.71   1.41 ]
```

**softmax**（逐行）：

```
          t1     t2     t3
t1   [ 0.40   0.20   0.40 ]
t2   [ 0.20   0.40   0.40 ]
t3   [ 0.25   0.25   0.50 ]
```

**混合**。以 t1 为例：0.40 × [1, 0] + 0.20 × [0, 1] + 0.40 × [0.5, 0.5] = [0.6, 0.4]。三行算完：

```
t1 → [0.6, 0.4]     t2 → [0.4, 0.6]     t3 → [0.5, 0.5]
```

t1 原本的值是 [1, 0]，经过注意力变成了 [0.6, 0.4]：它保留了自己的大部分信息，又从和它相似的 t3 那里吸收了一些。**这就是自注意力的全部作用：每个 token 根据"谁和我相关"，把别人的信息混进自己的表示里。** 堆几十层之后，"她"的向量里会混进"小红"的信息，"苹果"的向量会根据上下文偏向水果或公司。

## 为什么要除以 √d_k

这个缩放因子看起来不起眼，去掉它模型基本训不动。

假设 q 和 k 的每一维都是均值 0、方差 1 的独立随机数，它们的点积是 d_k 项乘积之和，方差就是 d_k。d_k = 64 时，点积的标准差是 8；随机采样十万对 64 维向量验证一下，实测标准差约 7.99。

分数的尺度这么大，softmax 会变得非常"尖"：

```
softmax([1, 2, 3])    = [0.09, 0.24, 0.67]
softmax([8, 16, 24])  = [0.00, 0.0003, 0.9997]
```

第二种情况几乎是 one-hot，除了最大那项，其他位置的梯度都趋近于 0，训练就卡住了。除以 √d_k 正好把方差拉回 1，让 softmax 停留在梯度健康的区间<sup class="cite"><a href="#ref-2" title="Attention Is All You Need">2</a></sup>。

## 掩码：同一套计算，三种用法

公式不变，改变的只是 Q、K、V 从哪来、哪些分数被屏蔽：

- **双向自注意力**（BERT 这类编码器）：Q、K、V 都来自同一个序列，每个 token 能看到所有 token；
- **因果自注意力**（GPT、Claude、Llama 这类解码器）：同样来自同一个序列，但 token i 只能看到位置 ≤ i 的 token；
- **交叉注意力**（原始 Transformer 的解码器、很多多模态模型）：Q 来自一个序列，K、V 来自另一个，比如翻译时目标语言去查源语言，或者文字去查图像特征。

因果约束的实现非常朴素：在 softmax **之前**，把分数矩阵的上三角（j > i 的位置）设成 −∞，e^(−∞) = 0，这些位置的权重就是 0。

<figure class="diagram">
<svg viewBox="0 0 640 220" role="img" aria-label="4 个 token 的因果掩码：分数矩阵的下三角和对角线保留，上三角被设为负无穷；每一行做 softmax 后，被屏蔽的位置权重为 0">
<text class="ts" x="150" y="18" text-anchor="middle">分数矩阵（加掩码后）</text>
<text class="ts" x="80" y="50" text-anchor="end">我</text>
<text class="ts" x="80" y="90" text-anchor="end">喜欢</text>
<text class="ts" x="80" y="130" text-anchor="end">吃</text>
<text class="ts" x="80" y="170" text-anchor="end">苹果</text>
<text class="ts" x="110" y="205" text-anchor="middle">我</text>
<text class="ts" x="150" y="205" text-anchor="middle">喜欢</text>
<text class="ts" x="190" y="205" text-anchor="middle">吃</text>
<text class="ts" x="230" y="205" text-anchor="middle">苹果</text>
<rect class="c-blue" x="90" y="30" width="40" height="40"/>
<rect class="c-red" x="130" y="30" width="40" height="40"/>
<rect class="c-red" x="170" y="30" width="40" height="40"/>
<rect class="c-red" x="210" y="30" width="40" height="40"/>
<rect class="c-blue" x="90" y="70" width="40" height="40"/>
<rect class="c-blue" x="130" y="70" width="40" height="40"/>
<rect class="c-red" x="170" y="70" width="40" height="40"/>
<rect class="c-red" x="210" y="70" width="40" height="40"/>
<rect class="c-blue" x="90" y="110" width="40" height="40"/>
<rect class="c-blue" x="130" y="110" width="40" height="40"/>
<rect class="c-blue" x="170" y="110" width="40" height="40"/>
<rect class="c-red" x="210" y="110" width="40" height="40"/>
<rect class="c-blue" x="90" y="150" width="40" height="40"/>
<rect class="c-blue" x="130" y="150" width="40" height="40"/>
<rect class="c-blue" x="170" y="150" width="40" height="40"/>
<rect class="c-blue" x="210" y="150" width="40" height="40"/>
<text class="ts" x="150" y="55" text-anchor="middle">−∞</text>
<text class="ts" x="190" y="55" text-anchor="middle">−∞</text>
<text class="ts" x="230" y="55" text-anchor="middle">−∞</text>
<text class="ts" x="190" y="95" text-anchor="middle">−∞</text>
<text class="ts" x="230" y="95" text-anchor="middle">−∞</text>
<text class="ts" x="230" y="135" text-anchor="middle">−∞</text>
<rect class="c-blue" x="300" y="60" width="18" height="18"/>
<text class="t" x="328" y="74">保留：可以看到的位置</text>
<rect class="c-red" x="300" y="94" width="18" height="18"/>
<text class="t" x="328" y="108">屏蔽：未来的位置，softmax 后权重为 0</text>
<text class="ts" x="300" y="145">每一行只在自己和之前的 token 之间分配注意力，</text>
<text class="ts" x="300" y="165">所以一次前向就能同时训练 n 个"预测下一个词"的任务。</text>
</svg>
<figcaption>图 2：因果掩码。"吃"这一行只能在"我、喜欢、吃"之间分配权重，看不到"苹果"。</figcaption>
</figure>

这个掩码带来一个经常被忽略的好处：训练时一整段文本只需要**一次**前向传播，每个位置都在同时练习"根据前文预测下一个 token"，n 个训练信号一起拿到。这是解码器模型训练效率高的重要原因。

## 多头：把维度切开，各看各的

单个注意力有一个硬限制：每一行的权重加起来为 1，一个 token 很难同时"重点关注"好几个不同的东西。比如"它"这个位置可能既要找指代的名词，又要看前一个词确定语法。

**多头注意力**的做法是把 d 维切成 h 份，每份 d/h 维，各自独立做一次注意力，最后拼回 d 维再乘一个输出矩阵 W_O。总计算量和一个 d 维的大头差不多，参数量也一样，但现在有 h 个相互独立的 softmax，可以同时关注 h 个不同的地方<sup class="cite"><a href="#ref-2" title="Attention Is All You Need">2</a></sup>。

实现上，"多头"其实只是一次 reshape。下面是一个完整的因果多头注意力，去掉注释不到 20 行：

```python
import torch
import torch.nn as nn
import torch.nn.functional as F

class CausalSelfAttention(nn.Module):
    def __init__(self, d_model: int, n_heads: int):
        super().__init__()
        assert d_model % n_heads == 0
        self.h, self.d_head = n_heads, d_model // n_heads
        self.qkv = nn.Linear(d_model, 3 * d_model, bias=False)  # W_Q, W_K, W_V 合成一个
        self.out = nn.Linear(d_model, d_model, bias=False)      # W_O

    def forward(self, x):                        # x: (batch, n, d_model)
        B, n, d = x.shape
        q, k, v = self.qkv(x).split(d, dim=-1)   # 各 (B, n, d)
        # 切头：(B, n, d) -> (B, h, n, d_head)
        q, k, v = (t.view(B, n, self.h, self.d_head).transpose(1, 2) for t in (q, k, v))

        scores = q @ k.transpose(-2, -1) / self.d_head ** 0.5       # (B, h, n, n)
        mask = torch.ones(n, n, dtype=torch.bool, device=x.device).triu(1)
        scores = scores.masked_fill(mask, float("-inf"))             # 屏蔽未来
        y = F.softmax(scores, dim=-1) @ v                            # (B, h, n, d_head)

        y = y.transpose(1, 2).reshape(B, n, d)   # 拼回 (B, n, d)
        return self.out(y)
```

中间三行（打分、掩码、softmax 加权）在实际项目里会换成一行 `F.scaled_dot_product_attention(q, k, v, is_causal=True)`，PyTorch 会自动选择 FlashAttention 等高效实现<sup class="cite" id="cite-3"><a href="#ref-3" title="torch.nn.functional.scaled_dot_product_attention">3</a></sup>，数学结果一样。

## 注意力头在学什么

训练完的模型里，不同的头确实会分化出不同的"工作"。对 BERT 的分析发现，有的头专门看下一个或前一个词，有的头关注句号和 [SEP] 这类分隔符，有的头对应特定的句法关系，比如动词指向宾语<sup class="cite" id="cite-4"><a href="#ref-4" title="What Does BERT Look At? An Analysis of BERT's Attention">4</a></sup>。

最有名的发现是 **归纳头（Induction Head）**。Anthropic 的可解释性研究把每个头看成"从别的位置读信息、写进当前位置"的独立通道<sup class="cite" id="cite-5"><a href="#ref-5" title="A Mathematical Framework for Transformer Circuits">5</a></sup>，在此基础上找到了一种由两层注意力配合完成的电路：

1. 前一层有个"前一 token 头"，把每个位置前一个 token 的信息写进当前位置；
2. 后一层的归纳头拿当前 token 去找："前文哪个位置的前一个 token 和我一样？"找到后，把那个位置的内容复制过来作为预测。

效果就是：前文出现过 "… 哈利 波特 …"，后面再遇到"哈利"，模型就倾向于预测"波特"。这是一种最朴素的**上下文学习**。研究发现，归纳头在训练中某个时刻集中出现，同一时刻模型的上下文学习能力也突然跃升<sup class="cite" id="cite-6"><a href="#ref-6" title="In-context Learning and Induction Heads">6</a></sup>。

另一个有意思的现象是 **注意力汇聚（Attention Sink）**：很多头会把大量权重分给序列的第一个 token，不管它内容是什么。原因在于 softmax 必须把权重分完，当一个头"没什么可看"时，就需要一个地方安放多余的权重，开头的 token 对所有位置都可见，自然成了垃圾桶。StreamingLLM 利用这一点，在滑动窗口里始终保留开头几个 token，让模型能稳定处理远超训练长度的流式输入<sup class="cite" id="cite-7"><a href="#ref-7" title="Efficient Streaming Language Models with Attention Sinks">7</a></sup>。

也要看到另一面：很多头是冗余的。在训练好的翻译模型和 BERT 上，测试时剪掉相当比例的头，性能几乎不掉<sup class="cite" id="cite-8"><a href="#ref-8" title="Are Sixteen Heads Really Better than One?">8</a></sup>。"每个头都有清晰分工"是理想化的说法，可解释的头只是少数。

## 位置：注意力本身是"无序"的

回到手算的例子，如果把 t1、t2、t3 的顺序打乱，每个 token 算出来的输出完全不变，只是行的顺序跟着换了。数学上这叫**置换等变**：注意力把输入当成一个集合，而不是序列。

所以位置信息必须另外注入。[入门篇](/posts/transformer-intro/)介绍过几种方案，这里只补充 RoPE 为什么好用：它把位置 m 的 q 和位置 n 的 k 各自旋转 mθ 和 nθ 的角度，两个向量旋转后再做点积，结果只取决于角度差 (m − n)θ<sup class="cite" id="cite-9"><a href="#ref-9" title="RoFormer: Enhanced Transformer with Rotary Position Embedding">9</a></sup>。也就是说，**相对位置被直接写进了打分这一步**，不需要额外参数，也不改动 V。这正好落在图 1 里唯一发生 token 交互的地方。

## 代价：n × n 和 KV Cache

注意力的代价也集中在那个 n × n 矩阵上：

- **计算**：Q Kᵀ 和 A V 各约 n² · d 次乘加，序列长度翻倍，注意力计算量翻四倍；
- **显存**：朴素实现要把 n × n 的分数矩阵完整存下来。n = 32K 时，单个头、单层就是 10 亿个元素。

推理时还有另一个更现实的问题。自回归生成时每一步只新增一个 token，它的 Q 要和**之前所有** token 的 K、V 做注意力。之前的 K、V 不会变，所以缓存起来避免重算，这就是 **KV Cache**。它的大小是：

```
每个 token 的 KV Cache = 2（K 和 V）× 层数 × KV 头数 × 每头维度 × 每个数的字节数
```

以 Llama 3 8B 为例：32 层、8 个 KV 头、每头 128 维<sup class="cite" id="cite-10"><a href="#ref-10" title="The Llama 3 Herd of Models">10</a></sup>，用 FP16 存储，每个 token 约 2 × 32 × 8 × 128 × 2 字节 = 128 KB。一个 8K 长度的请求就要 1 GB，并发 16 个请求就是 16 GB，比模型权重本身还大。

这里的"8 个 KV 头"本身就是一个优化：如果按标准多头注意力，32 个查询头各配一组 K、V，KV Cache 还要再大 4 倍。

## 围绕代价的改进

这几年对注意力的改进，基本可以按"它省的是什么"来分类。

**省 KV Cache：让多个查询头共享 K、V。** **MQA** 走到极端，所有查询头共用一组 K、V<sup class="cite" id="cite-11"><a href="#ref-11" title="Fast Transformer Decoding: One Write-Head is All You Need">11</a></sup>，缓存缩小 h 倍，但质量有损失。**GQA** 取折中，把查询头分成几组，每组共享一组 K、V<sup class="cite" id="cite-12"><a href="#ref-12" title="GQA: Training Generalized Multi-Query Transformer Models from Multi-Head Checkpoints">12</a></sup>，质量接近标准多头、速度接近 MQA，是今天开源模型的主流选择。DeepSeek 的 **MLA** 换了个思路：不减少头数，而是把 K、V 压缩成一个低维的隐向量来缓存，用的时候再还原<sup class="cite" id="cite-13"><a href="#ref-13" title="DeepSeek-V2: A Strong, Economical, and Efficient Mixture-of-Experts Language Model">13</a></sup>。

<figure class="diagram">
<svg viewBox="0 0 640 200" role="img" aria-label="三种注意力的 K V 共享方式：多头注意力 MHA 中 8 个查询头各有一组 K V；分组查询注意力 GQA 中每 4 个查询头共享一组 K V，共 2 组；多查询注意力 MQA 中 8 个查询头共享唯一一组 K V">
<text class="t" x="105" y="20" text-anchor="middle">MHA：8 组 KV</text>
<text class="t" x="320" y="20" text-anchor="middle">GQA：2 组 KV</text>
<text class="t" x="535" y="20" text-anchor="middle">MQA：1 组 KV</text>
<g>
<rect class="c-blue" x="20" y="40" width="18" height="30" rx="3"/><rect class="c-blue" x="42" y="40" width="18" height="30" rx="3"/><rect class="c-blue" x="64" y="40" width="18" height="30" rx="3"/><rect class="c-blue" x="86" y="40" width="18" height="30" rx="3"/><rect class="c-blue" x="108" y="40" width="18" height="30" rx="3"/><rect class="c-blue" x="130" y="40" width="18" height="30" rx="3"/><rect class="c-blue" x="152" y="40" width="18" height="30" rx="3"/><rect class="c-blue" x="174" y="40" width="18" height="30" rx="3"/>
<rect class="c-amber" x="20" y="120" width="18" height="30" rx="3"/><rect class="c-amber" x="42" y="120" width="18" height="30" rx="3"/><rect class="c-amber" x="64" y="120" width="18" height="30" rx="3"/><rect class="c-amber" x="86" y="120" width="18" height="30" rx="3"/><rect class="c-amber" x="108" y="120" width="18" height="30" rx="3"/><rect class="c-amber" x="130" y="120" width="18" height="30" rx="3"/><rect class="c-amber" x="152" y="120" width="18" height="30" rx="3"/><rect class="c-amber" x="174" y="120" width="18" height="30" rx="3"/>
<path class="ln" d="M29 70 V118"/><path class="ln" d="M51 70 V118"/><path class="ln" d="M73 70 V118"/><path class="ln" d="M95 70 V118"/><path class="ln" d="M117 70 V118"/><path class="ln" d="M139 70 V118"/><path class="ln" d="M161 70 V118"/><path class="ln" d="M183 70 V118"/>
</g>
<g>
<rect class="c-blue" x="235" y="40" width="18" height="30" rx="3"/><rect class="c-blue" x="257" y="40" width="18" height="30" rx="3"/><rect class="c-blue" x="279" y="40" width="18" height="30" rx="3"/><rect class="c-blue" x="301" y="40" width="18" height="30" rx="3"/><rect class="c-blue" x="323" y="40" width="18" height="30" rx="3"/><rect class="c-blue" x="345" y="40" width="18" height="30" rx="3"/><rect class="c-blue" x="367" y="40" width="18" height="30" rx="3"/><rect class="c-blue" x="389" y="40" width="18" height="30" rx="3"/>
<rect class="c-amber" x="268" y="120" width="18" height="30" rx="3"/><rect class="c-amber" x="356" y="120" width="18" height="30" rx="3"/>
<path class="ln" d="M244 70 L277 118"/><path class="ln" d="M266 70 L277 118"/><path class="ln" d="M288 70 L277 118"/><path class="ln" d="M310 70 L277 118"/>
<path class="ln" d="M332 70 L365 118"/><path class="ln" d="M354 70 L365 118"/><path class="ln" d="M376 70 L365 118"/><path class="ln" d="M398 70 L365 118"/>
</g>
<g>
<rect class="c-blue" x="450" y="40" width="18" height="30" rx="3"/><rect class="c-blue" x="472" y="40" width="18" height="30" rx="3"/><rect class="c-blue" x="494" y="40" width="18" height="30" rx="3"/><rect class="c-blue" x="516" y="40" width="18" height="30" rx="3"/><rect class="c-blue" x="538" y="40" width="18" height="30" rx="3"/><rect class="c-blue" x="560" y="40" width="18" height="30" rx="3"/><rect class="c-blue" x="582" y="40" width="18" height="30" rx="3"/><rect class="c-blue" x="604" y="40" width="18" height="30" rx="3"/>
<rect class="c-amber" x="527" y="120" width="18" height="30" rx="3"/>
<path class="ln" d="M459 70 L536 118"/><path class="ln" d="M481 70 L536 118"/><path class="ln" d="M503 70 L536 118"/><path class="ln" d="M525 70 L536 118"/><path class="ln" d="M547 70 L536 118"/><path class="ln" d="M569 70 L536 118"/><path class="ln" d="M591 70 L536 118"/><path class="ln" d="M613 70 L536 118"/>
</g>
<rect class="c-blue" x="200" y="172" width="14" height="14" rx="2"/>
<text class="ts" x="220" y="184">查询头 Q</text>
<rect class="c-amber" x="320" y="172" width="14" height="14" rx="2"/>
<text class="ts" x="340" y="184">缓存的 K、V</text>
</svg>
<figcaption>图 3：查询头数量不变，KV 头越少，KV Cache 越小。Llama 3 8B 是 32 个查询头配 8 组 KV，属于 GQA。</figcaption>
</figure>

**省显存读写：不改数学，改算法。** **FlashAttention** 的出发点是：注意力在 GPU 上慢，主要不是算得慢，而是 n × n 矩阵在显存（HBM）和片上缓存（SRAM）之间来回搬运得慢。它把 Q、K、V 切成小块，在片上缓存里边算边用"在线 softmax"累加结果，**从不把完整的 n × n 矩阵写回显存**<sup class="cite" id="cite-14"><a href="#ref-14" title="FlashAttention: Fast and Memory-Efficient Exact Attention with IO-Awareness">14</a></sup>。结果和标准注意力完全一致，显存占用从平方降到线性，速度也快了好几倍。它没有降低 n² 的计算量，但让长上下文在实际中可行了。

**省计算：不让每个 token 看所有 token。** **滑动窗口注意力**让每个 token 只看最近的 w 个 token，复杂度降到 n · w；Longformer 在此基础上给少数 token 开"全局视野"<sup class="cite" id="cite-15"><a href="#ref-15" title="Longformer: The Long-Document Transformer">15</a></sup>。很多模型的做法是窗口层和全局层交替排布，既控制成本，又保住远距离信息的通路。

**换掉 softmax：线性注意力。** 如果把 softmax(q · k) 换成某种可以拆开的核函数 φ(q) · φ(k)，就能利用矩阵乘法结合律，先算 φ(K)ᵀ V（一个 d × d 的小矩阵），再和 φ(Q) 相乘，复杂度变成线性。有意思的是，这样写出来的注意力在因果情况下可以改写成一个 RNN：维护一个固定大小的状态，每来一个 token 更新一次<sup class="cite" id="cite-16"><a href="#ref-16" title="Transformers are RNNs: Fast Autoregressive Transformers with Linear Attention">16</a></sup>。代价是固定大小的状态装不下精确的历史，"从前文精确复制某段内容"这类任务明显变弱。这也解释了为什么 Mamba 等线性复杂度的架构，往往要和少量标准注意力层混合使用。

把这几类放在一起看会发现一个规律：**真正被保留下来的改进，大多没有动注意力"每个位置都能精确查到任意位置"的能力**。GQA、MLA 压缩的是缓存，FlashAttention 优化的是读写，窗口注意力通常配着全局层。一旦彻底放弃这种能力，就要在别处补回来。

## 总结

1. **注意力是可学习的软查表**：用 Query 和所有 Key 比相似度，softmax 成权重，再加权混合所有 Value；
2. **跟着形状读公式**：投影和输出都是逐 token 的，唯一让 token 交互的是 n × n 的分数矩阵；
3. **Q、K、V 分开是为了让关系有方向**，"用什么匹配"和"传递什么"可以各自学习；
4. **除以 √d_k 是为了让点积方差回到 1**，否则 softmax 饱和，梯度消失；
5. **掩码决定了注意力的用法**：双向、因果、交叉三种场景是同一套计算；因果掩码让一次前向同时训练 n 个预测任务；
6. **多头 = 切维度 + 独立 softmax**，在不增加计算量的前提下同时关注多个位置；有的头学会了可解释的功能，比如归纳头，但很多头是冗余的；
7. **注意力本身不知道顺序**，RoPE 把相对位置直接写进打分这一步；
8. **代价集中在 n²**：训练时是计算量和显存，推理时是随长度线性增长的 KV Cache；GQA / MLA 压缩缓存，FlashAttention 优化读写，窗口和线性注意力减少计算。

**归根结底，自注意力的价值在于：任意两个位置之间都能一步、精确、按内容地传递信息。** 它的代价来自这里，各种改进也都在权衡保留多少这种能力。理解了这一点，再看上下文长度、推理价格、长文本"中间遗忘"这些问题，大多能从结构上找到原因。

## 参考文献

<section class="refs">
<ol>
<li id="ref-1"><span class="ref-n">[1]</span><span>Bahdanau D., Cho K., Bengio Y. <a href="https://arxiv.org/abs/1409.0473">Neural Machine Translation by Jointly Learning to Align and Translate</a>. <i>ICLR</i>, 2015. <a class="ref-back" href="#cite-1" aria-label="回到正文">↩</a></span></li>
<li id="ref-2"><span class="ref-n">[2]</span><span>Vaswani A. et al. <a href="https://arxiv.org/abs/1706.03762">Attention Is All You Need</a>. <i>NeurIPS</i>, 2017. <a class="ref-back" href="#cite-2" aria-label="回到正文">↩</a></span></li>
<li id="ref-3"><span class="ref-n">[3]</span><span>PyTorch <a href="https://pytorch.org/docs/stable/generated/torch.nn.functional.scaled_dot_product_attention.html">torch.nn.functional.scaled_dot_product_attention</a>. <i>PyTorch Documentation</i>. <a class="ref-back" href="#cite-3" aria-label="回到正文">↩</a></span></li>
<li id="ref-4"><span class="ref-n">[4]</span><span>Clark K. et al. <a href="https://arxiv.org/abs/1906.04341">What Does BERT Look At? An Analysis of BERT's Attention</a>. <i>BlackboxNLP</i>, 2019. <a class="ref-back" href="#cite-4" aria-label="回到正文">↩</a></span></li>
<li id="ref-5"><span class="ref-n">[5]</span><span>Elhage N. et al. <a href="https://transformer-circuits.pub/2021/framework/index.html">A Mathematical Framework for Transformer Circuits</a>. <i>Transformer Circuits Thread</i>, 2021. <a class="ref-back" href="#cite-5" aria-label="回到正文">↩</a></span></li>
<li id="ref-6"><span class="ref-n">[6]</span><span>Olsson C. et al. <a href="https://transformer-circuits.pub/2022/in-context-learning-and-induction-heads/index.html">In-context Learning and Induction Heads</a>. <i>Transformer Circuits Thread</i>, 2022. <a class="ref-back" href="#cite-6" aria-label="回到正文">↩</a></span></li>
<li id="ref-7"><span class="ref-n">[7]</span><span>Xiao G. et al. <a href="https://arxiv.org/abs/2309.17453">Efficient Streaming Language Models with Attention Sinks</a>. <i>ICLR</i>, 2024. <a class="ref-back" href="#cite-7" aria-label="回到正文">↩</a></span></li>
<li id="ref-8"><span class="ref-n">[8]</span><span>Michel P., Levy O., Neubig G. <a href="https://arxiv.org/abs/1905.10650">Are Sixteen Heads Really Better than One?</a> <i>NeurIPS</i>, 2019. <a class="ref-back" href="#cite-8" aria-label="回到正文">↩</a></span></li>
<li id="ref-9"><span class="ref-n">[9]</span><span>Su J. et al. <a href="https://arxiv.org/abs/2104.09864">RoFormer: Enhanced Transformer with Rotary Position Embedding</a>. <i>arXiv</i>, 2021. <a class="ref-back" href="#cite-9" aria-label="回到正文">↩</a></span></li>
<li id="ref-10"><span class="ref-n">[10]</span><span>Llama Team, AI @ Meta. <a href="https://arxiv.org/abs/2407.21783">The Llama 3 Herd of Models</a>. <i>arXiv</i>, 2024. <a class="ref-back" href="#cite-10" aria-label="回到正文">↩</a></span></li>
<li id="ref-11"><span class="ref-n">[11]</span><span>Shazeer N. <a href="https://arxiv.org/abs/1911.02150">Fast Transformer Decoding: One Write-Head is All You Need</a>. <i>arXiv</i>, 2019. <a class="ref-back" href="#cite-11" aria-label="回到正文">↩</a></span></li>
<li id="ref-12"><span class="ref-n">[12]</span><span>Ainslie J. et al. <a href="https://arxiv.org/abs/2305.13245">GQA: Training Generalized Multi-Query Transformer Models from Multi-Head Checkpoints</a>. <i>EMNLP</i>, 2023. <a class="ref-back" href="#cite-12" aria-label="回到正文">↩</a></span></li>
<li id="ref-13"><span class="ref-n">[13]</span><span>DeepSeek-AI. <a href="https://arxiv.org/abs/2405.04434">DeepSeek-V2: A Strong, Economical, and Efficient Mixture-of-Experts Language Model</a>. <i>arXiv</i>, 2024. <a class="ref-back" href="#cite-13" aria-label="回到正文">↩</a></span></li>
<li id="ref-14"><span class="ref-n">[14]</span><span>Dao T. et al. <a href="https://arxiv.org/abs/2205.14135">FlashAttention: Fast and Memory-Efficient Exact Attention with IO-Awareness</a>. <i>NeurIPS</i>, 2022. <a class="ref-back" href="#cite-14" aria-label="回到正文">↩</a></span></li>
<li id="ref-15"><span class="ref-n">[15]</span><span>Beltagy I., Peters M. E., Cohan A. <a href="https://arxiv.org/abs/2004.05150">Longformer: The Long-Document Transformer</a>. <i>arXiv</i>, 2020. <a class="ref-back" href="#cite-15" aria-label="回到正文">↩</a></span></li>
<li id="ref-16"><span class="ref-n">[16]</span><span>Katharopoulos A. et al. <a href="https://arxiv.org/abs/2006.16236">Transformers are RNNs: Fast Autoregressive Transformers with Linear Attention</a>. <i>ICML</i>, 2020. <a class="ref-back" href="#cite-16" aria-label="回到正文">↩</a></span></li>
</ol>
</section>
