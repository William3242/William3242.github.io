---
title: AI for 生物信息学：Agent 怎么参与药物发现和科学发现
description: AlphaFold 证明了模型能解决生物学里的具体问题，而 Agent 想做的是更进一步：读文献、提假设、写分析代码、调用计算工具，甚至操控实验室。这篇梳理 Agent 在药物发现和科学发现里的位置、几个有代表性的系统，并专门聊聊单细胞与空间多组学方向的 Agent，文末附参考文献和值得一试的项目。
pubDate: 2026-10-29
tags: [Agent, LLM, AI for Science, 生物信息学]
---

2024 年的诺贝尔化学奖，一半颁给了 David Baker 的计算蛋白质设计，另一半颁给了 DeepMind 的 Demis Hassabis 和 John Jumper，理由是 AlphaFold 对蛋白质结构的预测。这大概是"AI for Science"第一次被这样正式地承认。

但 AlphaFold 做的是一件边界非常清楚的事：给它一条氨基酸序列，它给你一个三维结构。问题是人提的，结果是人解读的，下一步做什么也是人决定的。它是一个极其强大的**工具**，而不是一个会自己做研究的东西。

过去两三年，另一条路线越来越热闹：让大语言模型以 Agent 的形式参与研究本身。它读文献、提出假设、查数据库、写分析代码、调用 AlphaFold 这样的专用模型，有的还能把实验方案发给自动化实验室去执行，再根据结果决定下一步。这篇就来聊聊这件事：Agent 在药物发现和科学发现里到底在做什么，有哪些值得一看的系统，以及它们离"AI 科学家"还有多远。后半部分会专门用一章讲单细胞和空间多组学里的 Agent。

这个系列前面几篇讲的都是通用的 Agent 构造，比如 [循环](/posts/agent-basics/)、[工具](/posts/agent-tools/)、[上下文](/posts/agent-context-management/)、[子 Agent](/posts/agent-subagents/) 和 [评测](/posts/agent-evaluation/)。这篇换个角度，看看这些部件放进一个具体领域之后会变成什么样子。

## 从"预测一个东西"到"做一段研究"

AI 参与生命科学研究，大致可以分成三个层次。

**第一层是专用模型。** AlphaFold 预测结构，ESM 这样的蛋白质语言模型学习序列的表示，各种分子生成模型设计新的化合物，ADMET 模型预测一个分子的吸收、代谢和毒性。它们在各自的任务上往往远超人类，但每个模型只回答一种问题，输入输出格式固定，不会自己决定下一步。

**第二层是对话式的大模型助手。** 你问它某个基因的功能，让它解释一段 R 代码，或者帮你总结一篇论文。它知道的东西很广，但只是"知道"：它不去查最新的数据库，不跑你的数据，回答完一个问题就停下来。

**第三层是 Agent。** 它用大模型做决策，但手里有工具：文献检索、数据库查询、代码执行、专用模型，甚至实验室的机器人。它在一个循环里工作，每一步看到上一步的结果，再决定接下来做什么，直到完成一个比较大的目标。

这三层不是替代关系。Agent 恰恰是把第一层的专用模型当成工具来用的，AlphaFold 在 Agent 眼里就是一个 `predict_structure` 函数。Agent 补上的是专用模型之间那些原本由人完成的部分：决定该用哪个模型、怎么准备输入、怎么解读输出、结果不对的时候换什么思路。

<figure class="diagram">
<svg viewBox="0 0 640 300" role="img" aria-label="AI 参与生命科学的三个层次：专用模型、对话助手和 Agent，Agent 把专用模型当作工具调用">
<defs><marker id="bio4" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0 0 L10 5 L0 10 z"/></marker></defs>
<rect class="c-purple" x="20" y="16" width="600" height="84" rx="8"/>
<text class="t" x="100" y="54" text-anchor="middle">第三层：Agent</text>
<text class="ts" x="100" y="74" text-anchor="middle">多步、有工具、会决策</text>
<rect class="c-gray" x="190" y="38" width="70" height="40" rx="4"/><text class="ts" x="225" y="63" text-anchor="middle">目标</text>
<rect class="c-gray" x="300" y="38" width="90" height="40" rx="4"/><text class="ts" x="345" y="63" text-anchor="middle">模型思考</text>
<rect class="c-gray" x="430" y="38" width="90" height="40" rx="4"/><text class="ts" x="475" y="63" text-anchor="middle">调用工具</text>
<rect class="c-gray" x="550" y="38" width="60" height="40" rx="4"/><text class="ts" x="580" y="63" text-anchor="middle">结论</text>
<path class="ln" d="M260 58 H298" marker-end="url(#bio4)"/>
<path class="ln" d="M390 50 H428" marker-end="url(#bio4)"/>
<path class="ln" d="M428 66 H392" marker-end="url(#bio4)"/>
<path class="ln" d="M520 58 H548" marker-end="url(#bio4)"/>
<rect class="c-blue" x="20" y="116" width="600" height="64" rx="8"/>
<text class="t" x="100" y="144" text-anchor="middle">第二层：对话助手</text>
<text class="ts" x="100" y="164" text-anchor="middle">一问一答，只靠"知道"</text>
<rect class="c-gray" x="190" y="130" width="90" height="36" rx="4"/><text class="ts" x="235" y="153" text-anchor="middle">问题</text>
<rect class="c-gray" x="340" y="130" width="90" height="36" rx="4"/><text class="ts" x="385" y="153" text-anchor="middle">回答</text>
<path class="ln" d="M280 148 H338" marker-end="url(#bio4)"/>
<rect class="c-amber" x="20" y="196" width="600" height="88" rx="8"/>
<text class="t" x="100" y="236" text-anchor="middle">第一层：专用模型</text>
<text class="ts" x="100" y="256" text-anchor="middle">一个模型，一种问题</text>
<rect class="c-gray" x="190" y="222" width="95" height="36" rx="4"/><text class="ts" x="237" y="245" text-anchor="middle">AlphaFold</text>
<rect class="c-gray" x="295" y="222" width="95" height="36" rx="4"/><text class="ts" x="342" y="245" text-anchor="middle">ESM</text>
<rect class="c-gray" x="400" y="222" width="95" height="36" rx="4"/><text class="ts" x="447" y="245" text-anchor="middle">分子生成</text>
<rect class="c-gray" x="505" y="222" width="105" height="36" rx="4"/><text class="ts" x="557" y="245" text-anchor="middle">ADMET 预测</text>
<path class="ln dash" d="M475 80 V140 H500 V220" marker-end="url(#bio4)"/>
<text class="ts" x="510" y="153">当成工具调用</text>
</svg>
<figcaption>图 1：三个层次不是替代关系，Agent 把下面一层的专用模型当成自己的工具。</figcaption>
</figure>

为什么这件事在科学研究里特别自然？因为科学研究本身就是一个循环。

<figure class="diagram">
<svg viewBox="0 0 640 300" role="img" aria-label="科学研究的循环：提出假设、设计实验、执行实验、分析结果，每一步对应 Agent 循环中的一个环节">
<defs><marker id="bio1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0 0 L10 5 L0 10 z"/></marker></defs>
<rect class="c-purple" x="200" y="20" width="240" height="56" rx="6"/>
<text class="t" x="320" y="44" text-anchor="middle">提出假设</text>
<text class="ts" x="320" y="64" text-anchor="middle">模型推理 + 文献检索</text>
<rect class="c-blue" x="420" y="122" width="200" height="56" rx="6"/>
<text class="t" x="520" y="146" text-anchor="middle">设计实验</text>
<text class="ts" x="520" y="166" text-anchor="middle">选工具、写代码、定方案</text>
<rect class="c-amber" x="200" y="224" width="240" height="56" rx="6"/>
<text class="t" x="320" y="248" text-anchor="middle">执行实验</text>
<text class="ts" x="320" y="268" text-anchor="middle">计算工具 / 自动化实验室 / 人</text>
<rect class="c-green" x="20" y="122" width="200" height="56" rx="6"/>
<text class="t" x="120" y="146" text-anchor="middle">分析结果</text>
<text class="ts" x="120" y="166" text-anchor="middle">工具结果回到上下文</text>
<path class="ln" d="M440 56 C 500 60, 520 90, 520 120" marker-end="url(#bio1)"/>
<path class="ln" d="M520 180 C 520 220, 500 248, 442 252" marker-end="url(#bio1)"/>
<path class="ln" d="M198 252 C 140 248, 120 220, 120 180" marker-end="url(#bio1)"/>
<path class="ln" d="M120 120 C 120 90, 140 60, 198 56" marker-end="url(#bio1)"/>
<text class="ts" x="320" y="146" text-anchor="middle">科学方法</text>
<text class="ts" x="320" y="166" text-anchor="middle">≈ 一个很慢的 Agent 循环</text>
</svg>
<figcaption>图 2：假设、实验、分析、更新，科学方法和 Agent 循环的形状几乎一样，区别在于"执行"这一步可能要花几周。</figcaption>
</figure>

把这张图和 [最小的 Agent 循环](/posts/agent-basics/#最小的-agent-循环) 放在一起看会很有意思。模型思考对应提出假设，工具调用对应做实验，工具结果对应实验数据。唯一的、也是最要命的区别是：Agent 循环里的一次工具调用通常只要几秒钟，而一次湿实验可能要几天到几个月，花的钱也不是一个数量级。后面讲到的很多设计，都是在围绕这个差别做文章。

## 为什么生物信息学特别适合 Agent

在所有科学领域里，生物信息学可能是最早、也最适合让 Agent 进来的一个。原因有几个。

**工具多而碎。** 做一次常规的转录组分析，你可能要用到 FastQC 做质控，STAR 或 HISAT2 做比对，featureCounts 计数，DESeq2 做差异表达，clusterProfiler 做富集分析，中间还要在 Bash、Python 和 R 之间来回切换。单细胞、宏基因组、结构生物学，每个方向都有自己的一整套工具链。这些工具大多有命令行接口和文档，恰好是 Agent 最擅长调用的形态。

**数据库多而分散。** UniProt、PDB、Ensembl、NCBI Gene、GEO、TCGA、ChEMBL、PubChem、DrugBank、Reactome，每个都有自己的 API 和 ID 体系。研究中相当一部分时间花在"把这个基因在那个数据库里查出来、对上 ID、再拿去另一个数据库里查"上。这种工作单调、规则明确、可以验证，很适合交出去。

**文献多到读不完。** PubMed 收录的文献已经超过三千万篇，每年还在新增上百万篇。一个研究者能精读的只是自己方向上很小的一角，而很多新想法恰恰来自把两个不相干领域的结论连起来。

**大量结果可以用代码验证。** 一段分析代码跑没跑通、统计结果是否显著、预测的结构置信度高不高，很多中间结论不需要湿实验就能检查。这给 Agent 提供了一个快速的反馈信号，让它可以在计算层面先迭代很多轮，再把最有希望的那几个想法交给实验去验证。

当然，同一份清单也暗示了难点。工具多意味着环境配置复杂，数据库多意味着 ID 映射容易出错，文献多意味着模型更容易"记错"或"编造"，而最终能说明问题的，往往还是那个又慢又贵的湿实验。

## Agent 在药物发现流程里的位置

药物发现是一条很长的流水线。一个新药从立项到上市通常要十年以上，花费以十亿美元计，而进入临床的候选药物绝大多数最后都会失败。AI 能参与的环节很多，图 3 是一个粗略的地图。

<figure class="diagram">
<svg viewBox="0 0 640 220" role="img" aria-label="药物发现的五个阶段以及每个阶段中 Agent 可以承担的任务">
<defs><marker id="bio2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0 0 L10 5 L0 10 z"/></marker></defs>
<rect class="c-purple" x="10" y="20" width="112" height="44" rx="6"/><text class="t" x="66" y="47" text-anchor="middle">靶点发现</text>
<rect class="c-blue" x="138" y="20" width="112" height="44" rx="6"/><text class="t" x="194" y="47" text-anchor="middle">苗头化合物</text>
<rect class="c-blue" x="266" y="20" width="112" height="44" rx="6"/><text class="t" x="322" y="47" text-anchor="middle">先导优化</text>
<rect class="c-amber" x="394" y="20" width="112" height="44" rx="6"/><text class="t" x="450" y="47" text-anchor="middle">临床前</text>
<rect class="c-green" x="522" y="20" width="108" height="44" rx="6"/><text class="t" x="576" y="47" text-anchor="middle">临床试验</text>
<path class="ln" d="M122 42 H136" marker-end="url(#bio2)"/>
<path class="ln" d="M250 42 H264" marker-end="url(#bio2)"/>
<path class="ln" d="M378 42 H392" marker-end="url(#bio2)"/>
<path class="ln" d="M506 42 H520" marker-end="url(#bio2)"/>
<rect class="frame" x="10" y="80" width="112" height="106" rx="6"/>
<text class="ts" x="66" y="104" text-anchor="middle">文献与知识图谱</text>
<text class="ts" x="66" y="126" text-anchor="middle">组学数据分析</text>
<text class="ts" x="66" y="148" text-anchor="middle">提出靶点假设</text>
<text class="ts" x="66" y="170" text-anchor="middle">老药新用</text>
<rect class="frame" x="138" y="80" width="112" height="106" rx="6"/>
<text class="ts" x="194" y="104" text-anchor="middle">虚拟筛选</text>
<text class="ts" x="194" y="126" text-anchor="middle">分子对接</text>
<text class="ts" x="194" y="148" text-anchor="middle">结构预测</text>
<text class="ts" x="194" y="170" text-anchor="middle">抗体/蛋白设计</text>
<rect class="frame" x="266" y="80" width="112" height="106" rx="6"/>
<text class="ts" x="322" y="104" text-anchor="middle">分子生成与打分</text>
<text class="ts" x="322" y="126" text-anchor="middle">构效关系分析</text>
<text class="ts" x="322" y="148" text-anchor="middle">合成路线规划</text>
<text class="ts" x="322" y="170" text-anchor="middle">自动化合成</text>
<rect class="frame" x="394" y="80" width="112" height="106" rx="6"/>
<text class="ts" x="450" y="104" text-anchor="middle">ADMET 预测</text>
<text class="ts" x="450" y="126" text-anchor="middle">毒性文献检索</text>
<text class="ts" x="450" y="148" text-anchor="middle">实验方案设计</text>
<text class="ts" x="450" y="170" text-anchor="middle">实验数据分析</text>
<rect class="frame" x="522" y="80" width="108" height="106" rx="6"/>
<text class="ts" x="576" y="104" text-anchor="middle">试验方案设计</text>
<text class="ts" x="576" y="126" text-anchor="middle">患者招募匹配</text>
<text class="ts" x="576" y="148" text-anchor="middle">文档与申报</text>
<text class="ts" x="576" y="170" text-anchor="middle">安全信号监测</text>
<text class="ts" x="320" y="210" text-anchor="middle">越往左，越适合让 Agent 自主探索；越往右，越需要人和监管把关</text>
</svg>
<figcaption>图 3：药物发现的主要阶段，以及 Agent 在每个阶段里可以承担的工作。</figcaption>
</figure>

几个阶段分开说一下。

**靶点发现**是最"开放"的一段，也是 Agent 目前最活跃的地方。要回答的问题是"干预哪个基因或蛋白，可能治疗这个病"。这需要把文献、遗传学证据、表达数据、通路知识拼在一起推理，正好是大模型擅长、而传统专用模型不擅长的事。老药新用（drug repurposing）也属于这一类：在已经批准上市的药物里，找一个可能对新适应症有效的，好处是安全性数据现成，能大大缩短后面的路。

**苗头化合物和先导优化**是传统计算化学的主场，虚拟筛选、分子对接、分子生成模型都已经发展了很多年。Agent 在这里扮演的更多是"调度者"：决定生成哪类分子、用什么打分、怎么在活性、选择性、可合成性之间做权衡，再把结果整理成化学家能看懂的报告。合成路线规划（逆合成）和自动化合成，则把 Agent 和真实的化学实验连了起来。

**临床前和临床阶段**，Agent 更多是一个效率工具：读毒理文献、设计实验方案、匹配临床试验的入组条件、起草申报文档。这些环节结果的代价很高，监管要求很严，所以通常是人主导、Agent 辅助。

值得一提的是，"AI 发现的药"已经不只是概念。Insilico Medicine 用生成式 AI 发现靶点并设计分子的 [rentosertib](https://pubmed.ncbi.nlm.nih.gov/40461817/)<sup class="cite" id="cite-1"><a href="#ref-1" title="rentosertib">1</a></sup>（一个 TNIK 抑制剂），2025 年在 *Nature Medicine* 上发表了针对特发性肺纤维化的 2a 期临床结果。它用的主要是专用的生成模型和打分模型，而不是今天说的 LLM Agent，但它说明了一件事：计算方法产出的分子，是可以一路走进临床的。

## 几个有代表性的系统

这几年冒出来的科研 Agent 很多，下面挑几个在设计上各有代表性的说一说。它们大致按"自主程度"从低到高排列。

### ChemCrow：给模型配上化学家的工具箱

[ChemCrow](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11116106/)<sup class="cite" id="cite-2"><a href="#ref-2" title="ChemCrow">2</a></sup> 是 2023 年 EPFL 和 Rochester 的团队做的化学 Agent，后来发表在 *Nature Machine Intelligence* 上。它的结构很朴素：GPT-4 加上 18 个化学专家设计的工具，用 ReAct 的方式在"思考、调用工具、观察结果"之间循环。工具包括分子量计算、SMILES 和名称的互转、文献检索、反应预测、逆合成规划、安全性检查，以及连接 IBM 的云端自动化化学平台 RoboRXN 的接口。

它最有意思的地方不是做出了什么，而是它清楚地展示了 **为什么化学需要工具**。大模型对化学有很多"知识"，但让它直接算一个分子的分子量、判断一个 SMILES 字符串是否合法，它很容易出错，而且错得很自信。把这些事交给 RDKit 这样的确定性工具，模型只负责决定"该算什么"，可靠性就上来了。这正是 [工具](/posts/agent-tools/) 那篇里说的：工具不是给模型添功能，而是把模型不擅长的事交出去。

ChemCrow 还留下了一个关于评测的教训。作者让化学家和 GPT-4 分别给 ChemCrow 和不带工具的 GPT-4 的回答打分。化学家明显更认可 ChemCrow，因为它的答案在化学上更正确；而 GPT-4 作为评审，却给两者打出了差不多的分，甚至更偏向不带工具的那个，因为它的回答读起来更流畅、更完整。**模型评审分辨不出"听起来对"和"真的对"**，这在专业领域尤其明显，也是 [评测](/posts/agent-evaluation/#用好模型评审) 那篇反复强调要让模型评审和人对齐的原因。

### Coscientist：从屏幕走进实验室

同一年，卡内基梅隆大学 Gomes 组的 [Coscientist](https://pmc.ncbi.nlm.nih.gov/articles/PMC10733136)<sup class="cite" id="cite-3"><a href="#ref-3" title="Coscientist">3</a></sup> 发表在 *Nature* 上。它的结构是一个规划者（Planner）加上几个模块：网页搜索、文档检索、代码执行，以及实验自动化接口。

它做的事情比 ChemCrow 更进一步：给一个目标，比如"做一个 Suzuki 偶联反应"，它会自己上网查反应条件，读液体处理机器人的 API 文档，写出控制机器人的代码，在真实的实验室硬件上执行，然后读回实验数据。论文里它成功完成了钯催化的 Suzuki 和 Sonogashira 偶联反应，还在一个反应条件优化任务上表现出了根据结果调整下一轮实验的能力。

Coscientist 的意义在于它把 [Agent 循环](/posts/agent-basics/#最小的-agent-循环) 的"环境"从计算机扩展到了物理世界。这也带来了全新的风险：代码写错了可以重跑，试剂加错了可能就是一次事故。所以这类系统往往会在执行前加上严格的检查，把能做的操作限制在一个很小的、预先定义好的集合里，思路和 [沙箱](/posts/agent-sandbox/) 是一样的：边界要放在模型之外。

### AI co-scientist：用多 Agent 生成和打磨假设

2025 年初，Google 发布了 [AI co-scientist](https://arxiv.org/abs/2502.18864)<sup class="cite" id="cite-4"><a href="#ref-4" title="AI co-scientist">4</a></sup>。它的目标不是执行实验，而是做研究中最"像科学家"的那部分：**提出新的、可检验的假设**。

它是一个典型的多 Agent 系统，基于 Gemini 2.0。一个监督者（Supervisor）分配任务，下面有几个角色各司其职：

- **生成**（Generation）Agent 读文献、做"头脑风暴"，提出初始假设；
- **反思**（Reflection）Agent 像同行评审一样检查假设的正确性、新颖性和可检验性；
- **排名**（Ranking）Agent 让假设两两"辩论"，用类似国际象棋的 Elo 分数做锦标赛排序；
- **进化**（Evolution）Agent 把排名靠前的假设组合、简化、改进，产生新一代；
- **近似度**（Proximity）Agent 给假设聚类，避免重复；
- **元评审**（Meta-review）Agent 总结整轮评审中反复出现的问题，反馈给其他 Agent。


<figure class="diagram">
<svg viewBox="0 0 640 300" role="img" aria-label="AI co-scientist 的多 Agent 结构：生成、反思、排名、进化形成循环，元评审和近似度 Agent 提供反馈">
<defs><marker id="bio5" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0 0 L10 5 L0 10 z"/></marker></defs>
<rect class="c-green" x="20" y="14" width="170" height="44" rx="6"/><text class="t" x="105" y="41" text-anchor="middle">研究目标 + 科学家反馈</text>
<rect class="c-purple" x="240" y="14" width="160" height="44" rx="6"/><text class="t" x="320" y="41" text-anchor="middle">监督者：分配任务与算力</text>
<path class="ln" d="M190 36 H238" marker-end="url(#bio5)"/>
<path class="ln" d="M320 58 V84" marker-end="url(#bio5)"/>
<rect class="frame" x="10" y="86" width="620" height="206" rx="8"/>
<rect class="c-blue" x="20" y="130" width="120" height="50" rx="6"/><text class="t" x="80" y="152" text-anchor="middle">生成</text><text class="ts" x="80" y="170" text-anchor="middle">读文献、提假设</text>
<rect class="c-blue" x="180" y="130" width="120" height="50" rx="6"/><text class="t" x="240" y="152" text-anchor="middle">反思</text><text class="ts" x="240" y="170" text-anchor="middle">像同行评审一样挑错</text>
<rect class="c-blue" x="340" y="130" width="120" height="50" rx="6"/><text class="t" x="400" y="152" text-anchor="middle">排名</text><text class="ts" x="400" y="170" text-anchor="middle">两两辩论，Elo 排序</text>
<rect class="c-blue" x="500" y="130" width="120" height="50" rx="6"/><text class="t" x="560" y="152" text-anchor="middle">进化</text><text class="ts" x="560" y="170" text-anchor="middle">组合、改进、简化</text>
<path class="ln" d="M140 155 H178" marker-end="url(#bio5)"/>
<path class="ln" d="M300 155 H338" marker-end="url(#bio5)"/>
<path class="ln" d="M460 155 H498" marker-end="url(#bio5)"/>
<path class="ln" d="M560 128 V106 H240 V128" marker-end="url(#bio5)"/>
<text class="ts" x="400" y="101" text-anchor="middle">新一代假设，再评审、再比赛</text>
<rect class="c-amber" x="20" y="226" width="200" height="50" rx="6"/><text class="t" x="120" y="248" text-anchor="middle">元评审</text><text class="ts" x="120" y="266" text-anchor="middle">总结反复出现的问题</text>
<rect class="c-gray" x="340" y="226" width="120" height="50" rx="6"/><text class="t" x="400" y="248" text-anchor="middle">近似度</text><text class="ts" x="400" y="266" text-anchor="middle">聚类、去重</text>
<rect class="c-green" x="500" y="226" width="120" height="50" rx="6"/><text class="t" x="560" y="248" text-anchor="middle">输出</text><text class="ts" x="560" y="266" text-anchor="middle">排名靠前的假设</text>
<path class="ln dash" d="M80 224 V182" marker-end="url(#bio5)"/>
<path class="ln dash" d="M200 224 L235 182" marker-end="url(#bio5)"/>
<path class="ln dash" d="M370 182 L222 236" marker-end="url(#bio5)"/>
<path class="ln dash" d="M400 224 V182" marker-end="url(#bio5)"/>
<path class="ln" d="M440 182 L520 224" marker-end="url(#bio5)"/>
</svg>
<figcaption>图 4：AI co-scientist 的结构。实线是假设的流向，虚线是评审意见和辅助信息的流向。</figcaption>
</figure>

这个设计本质上是把 [评测](/posts/agent-evaluation/) 和 [子 Agent](/posts/agent-subagents/) 的思路搬进了生成过程本身：不是生成一个答案就交差，而是生成很多个，让它们互相竞争，再把评审意见喂回去。论文里一个重要观察是，给系统更多的计算时间，假设的质量（用 Elo 衡量）会持续上升，这就是所谓的"测试时计算扩展"。

更重要的是，它的几个假设经过了湿实验验证：在急性髓系白血病上提出的老药新用候选，有几个在细胞实验中显示出抑制效果；在肝纤维化上提出的新靶点，在人类肝脏类器官里得到了支持；最引人注目的是，在一个关于细菌耐药基因如何跨物种传播的问题上，它独立提出的机制假设，和伦敦帝国理工学院的团队花了多年实验得到、但当时尚未发表的结论一致。

### Virtual Lab：一个由 Agent 组成的课题组

斯坦福 James Zou 组的 [Virtual Lab](https://www.biorxiv.org/content/10.1101/2024.11.11.623004)<sup class="cite" id="cite-5"><a href="#ref-5" title="Virtual Lab">5</a></sup>（2025 年发表在 *Nature*）走得更"拟人"一些。它模仿的是一个真实课题组的工作方式：一个扮演 PI（课题组长）的 Agent，带着几个不同专业背景的"科学家" Agent，比如免疫学家、计算生物学家、机器学习专家，外加一个专门挑毛病的批评者 Agent。

它们通过"组会"推进研究。在团队会议上，PI 提出议题，各个专家轮流发言，批评者指出问题，PI 汇总并做决定；在单独会议上，某个专家 Agent 负责把决定落实成代码。人类研究者只在关键节点给出很少的指导。

论文里的任务是为新出现的新冠病毒变体设计纳米抗体。Virtual Lab 自己决定了技术路线：从已有的、针对早期毒株的纳米抗体出发做突变，而不是从头设计；然后把 ESM 蛋白质语言模型、AlphaFold-Multimer 和 Rosetta 串成一条计算流水线来打分筛选。最后设计出的 92 个纳米抗体经过实验验证，其中有两个对新变体的结合能力明显提升，同时保留了对原始毒株的结合。


<figure class="diagram">
<svg viewBox="0 0 640 290" role="img" aria-label="Virtual Lab 的工作方式：团队会议做决定，个人会议写代码，最终得到一条计算流水线和一批候选纳米抗体">
<defs><marker id="bio6" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0 0 L10 5 L0 10 z"/></marker></defs>
<rect class="frame" x="10" y="14" width="300" height="176" rx="8"/>
<text class="t" x="160" y="34" text-anchor="middle">团队会议：讨论与决策</text>
<rect class="c-purple" x="110" y="46" width="100" height="34" rx="4"/><text class="ts" x="160" y="68" text-anchor="middle">PI Agent</text>
<rect class="c-blue" x="16" y="100" width="88" height="34" rx="4"/><text class="ts" x="60" y="122" text-anchor="middle">免疫学家</text>
<rect class="c-blue" x="116" y="100" width="88" height="34" rx="4"/><text class="ts" x="160" y="122" text-anchor="middle">计算生物学家</text>
<rect class="c-blue" x="216" y="100" width="88" height="34" rx="4"/><text class="ts" x="260" y="122" text-anchor="middle">机器学习专家</text>
<rect class="c-red" x="110" y="146" width="100" height="34" rx="4"/><text class="ts" x="160" y="168" text-anchor="middle">批评者</text>
<path class="ln" d="M140 80 L70 98"/><path class="ln" d="M160 80 V98"/><path class="ln" d="M180 80 L250 98"/>
<path class="ln dash" d="M130 146 L80 136"/><path class="ln dash" d="M160 146 V136"/><path class="ln dash" d="M190 146 L240 136"/>
<path class="ln" d="M312 102 H338" marker-end="url(#bio6)"/>
<rect class="frame" x="340" y="14" width="290" height="176" rx="8"/>
<text class="t" x="485" y="34" text-anchor="middle">个人会议：把决定落实成代码</text>
<rect class="c-blue" x="360" y="48" width="250" height="34" rx="4"/><text class="ts" x="485" y="70" text-anchor="middle">专家 Agent 编写代码</text>
<rect class="c-red" x="360" y="96" width="250" height="34" rx="4"/><text class="ts" x="485" y="118" text-anchor="middle">批评者审查</text>
<rect class="c-gray" x="360" y="144" width="250" height="34" rx="4"/><text class="ts" x="485" y="166" text-anchor="middle">修改后执行</text>
<path class="ln" d="M485 82 V94" marker-end="url(#bio6)"/><path class="ln" d="M485 130 V142" marker-end="url(#bio6)"/>
<rect class="c-amber" x="20" y="214" width="100" height="40" rx="4"/><text class="ts" x="70" y="238" text-anchor="middle">ESM 打分</text>
<rect class="c-amber" x="140" y="214" width="150" height="40" rx="4"/><text class="ts" x="215" y="238" text-anchor="middle">AlphaFold-Multimer</text>
<rect class="c-amber" x="310" y="214" width="90" height="40" rx="4"/><text class="ts" x="355" y="238" text-anchor="middle">Rosetta</text>
<rect class="c-green" x="420" y="214" width="100" height="40" rx="4"/><text class="ts" x="470" y="238" text-anchor="middle">92 个候选</text>
<rect class="c-green" x="540" y="214" width="90" height="40" rx="4"/><text class="ts" x="585" y="238" text-anchor="middle">湿实验验证</text>
<path class="ln" d="M120 234 H138" marker-end="url(#bio6)"/><path class="ln" d="M290 234 H308" marker-end="url(#bio6)"/><path class="ln" d="M400 234 H418" marker-end="url(#bio6)"/><path class="ln" d="M520 234 H538" marker-end="url(#bio6)"/>
<text class="ts" x="320" y="278" text-anchor="middle">最终产出：一条由 Agent 自己选定工具、自己编写的计算流水线</text>
</svg>
<figcaption>图 5：Virtual Lab 用"组会"推进研究。批评者既参加讨论，也审查代码。</figcaption>
</figure>

Virtual Lab 有两点值得注意。一是它说明"角色扮演"式的多 Agent 不只是噱头：不同角色带来的视角差异，加上一个专职的批评者，确实能让方案更周全。二是它的产出是一条**可执行的计算流水线**加一批**可以拿去做实验的序列**，而不是一段文字结论，这让它的结果可以被检验。

### Biomni：一个通用的生物医学 Agent

前面几个系统都是为某一类任务量身定做的。斯坦福 Leskovec 组等团队在 2025 年推出的 [Biomni](https://www.biorxiv.org/content/10.1101/2025.05.30.656746v1)<sup class="cite" id="cite-6"><a href="#ref-6" title="Biomni">6</a></sup>，想做的是一个**通用**的生物医学 Agent。

它的做法很有意思。为了确定 Agent 需要什么工具，作者先让模型从大量生物医学论文里挖掘"研究者实际做了哪些操作、用了哪些工具和数据库"，再据此构建了一个统一的环境：一百多个专门工具、几十个数据库、上百个常用软件包。Agent 的行动方式不是一次调用一个固定的函数，而是**直接写代码**，在这个环境里自由组合工具，这和 [工具](/posts/agent-tools/) 那篇里讲的"代码即行动"是同一个思路。

它在一系列差异很大的任务上做了测试，比如基因优先级排序、罕见病诊断、单细胞数据分析、实验方案设计，展示了一个 Agent 不用为每个任务单独改造，也能处理相当广的生物医学问题。

### 走向"AI 科学家"：Robin 和更自主的系统

再往前一步，就是试图把整个研究循环自动化的系统。

FutureHouse 在 2025 年展示的 [Robin](https://arxiv.org/abs/2505.13400)<sup class="cite" id="cite-7"><a href="#ref-7" title="Robin">7</a></sup> 是一个多 Agent 系统，它把文献 Agent 和数据分析 Agent 串起来，目标是干性年龄相关性黄斑变性（干性 AMD）的治疗。它先从文献里提出机制假设和候选药物，人类在实验室做完实验后，它再分析实验数据、提出下一轮假设。最后它提出了 ripasudil，一个已经在日本获批用于青光眼的 ROCK 抑制剂，作为干性 AMD 的候选药物，并通过后续的 RNA 测序分析提出了可能的作用机制。论文里几乎所有的假设、实验设计和数据分析都出自 Agent，人类负责的是动手做实验。

同一类工作还有很多：做 CRISPR 基因编辑实验设计的 [CRISPR-GPT](https://pmc.ncbi.nlm.nih.gov/articles/PMC12920143)<sup class="cite" id="cite-8"><a href="#ref-8" title="CRISPR-GPT">8</a></sup>，设计基因扰动实验的 [BioDiscoveryAgent](https://arxiv.org/abs/2405.17631)<sup class="cite" id="cite-9"><a href="#ref-9" title="BioDiscoveryAgent">9</a></sup>，把两百多个生物医学工具整合进来做治疗推理的 [TxAgent](https://arxiv.org/abs/2503.10970)<sup class="cite" id="cite-10"><a href="#ref-10" title="TxAgent">10</a></sup>，以及在机器学习领域尝试从选题到写论文全流程自动化的 [Sakana AI Scientist](https://arxiv.org/abs/2408.06292)<sup class="cite" id="cite-11"><a href="#ref-11" title="AI Scientist">11</a></sup>。FutureHouse 后来分拆出的 Edison Scientific 在 2025 年底推出的 [Kosmos](https://arxiv.org/abs/2511.02824)<sup class="cite" id="cite-12"><a href="#ref-12" title="Kosmos">12</a></sup> 则把时间尺度拉得更长：一次运行最长 12 小时，并行跑文献 Agent 和数据分析 Agent，用一个共享的"世界模型"串起几百轮工作，平均每次读约 1500 篇论文、执行约四万行代码，报告里的每个论断都链接到代码或原始文献。独立评估中，大约八成的论断被判断为准确，但"综合推断"类的论断准确率只有不到六成，这个落差本身就很说明问题。

它们的共同趋势是：**Agent 负责的环节越来越多，人越来越像一个审批者和实验执行者。**

把这几个系统放在一起看：

| 系统 | 主要形态 | 做了什么 | 结论怎么验证 |
|---|---|---|---|
| ChemCrow | 单 Agent + 化学工具 | 化学问答、合成规划，连接云端合成平台 | 化学家评审 + 实际合成 |
| Coscientist | 规划者 + 功能模块 | 查资料、写机器人代码、执行偶联反应 | 真实实验室执行 |
| AI co-scientist | 多 Agent 锦标赛 | 生成和排序研究假设 | 湿实验验证部分假设 |
| Virtual Lab | 多 Agent 组会 | 设计纳米抗体及计算流水线 | 湿实验验证结合能力 |
| Biomni | 单 Agent + 代码执行 | 通用生物医学分析任务 | 基准测试 + 案例研究 |
| Robin | 多 Agent 流水线 | 提出干性 AMD 候选药物和机制 | 人类执行实验，Agent 分析 |

## 拆开看：一个科研 Agent 由什么组成

把这些系统拆开，会发现它们的部件和这个系列前面讲的通用 Agent 没有本质区别，只是每个部件都带上了领域的特点。

<figure class="diagram">
<svg viewBox="0 0 640 320" role="img" aria-label="科研 Agent 的组成：模型和 Harness 位于中心，周围是文献、数据库、计算工具、代码沙箱、实验室接口和人类科学家">
<defs><marker id="bio3" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0 0 L10 5 L0 10 z"/></marker></defs>
<rect class="c-purple" x="220" y="125" width="200" height="70" rx="8"/>
<text class="t" x="320" y="155" text-anchor="middle">模型 + Harness</text>
<text class="ts" x="320" y="176" text-anchor="middle">推理、规划、记录</text>
<rect class="c-blue" x="20" y="20" width="170" height="56" rx="6"/>
<text class="t" x="105" y="44" text-anchor="middle">文献检索</text>
<text class="ts" x="105" y="64" text-anchor="middle">PubMed、预印本、全文</text>
<rect class="c-blue" x="235" y="20" width="170" height="56" rx="6"/>
<text class="t" x="320" y="44" text-anchor="middle">数据库</text>
<text class="ts" x="320" y="64" text-anchor="middle">UniProt、PDB、ChEMBL</text>
<rect class="c-blue" x="450" y="20" width="170" height="56" rx="6"/>
<text class="t" x="535" y="44" text-anchor="middle">专用模型</text>
<text class="ts" x="535" y="64" text-anchor="middle">结构预测、对接、ADMET</text>
<rect class="c-amber" x="20" y="244" width="170" height="56" rx="6"/>
<text class="t" x="105" y="268" text-anchor="middle">代码沙箱</text>
<text class="ts" x="105" y="288" text-anchor="middle">Python、R、生信软件</text>
<rect class="c-red" x="235" y="244" width="170" height="56" rx="6"/>
<text class="t" x="320" y="268" text-anchor="middle">实验室接口</text>
<text class="ts" x="320" y="288" text-anchor="middle">机器人、云实验室</text>
<rect class="c-green" x="450" y="244" width="170" height="56" rx="6"/>
<text class="t" x="535" y="268" text-anchor="middle">人类科学家</text>
<text class="ts" x="535" y="288" text-anchor="middle">审批、实验、判断</text>
<rect class="c-gray" x="20" y="132" width="150" height="56" rx="6"/>
<text class="t" x="95" y="156" text-anchor="middle">研究记录</text>
<text class="ts" x="95" y="176" text-anchor="middle">假设、结果、负面结果</text>
<rect class="c-gray" x="470" y="132" width="150" height="56" rx="6"/>
<text class="t" x="545" y="156" text-anchor="middle">数据文件</text>
<text class="ts" x="545" y="176" text-anchor="middle">FASTQ、BAM、表达矩阵</text>
<path class="ln" d="M150 78 L250 123" marker-end="url(#bio3)" marker-start="url(#bio3)"/>
<path class="ln" d="M320 78 V123" marker-end="url(#bio3)" marker-start="url(#bio3)"/>
<path class="ln" d="M490 78 L390 123" marker-end="url(#bio3)" marker-start="url(#bio3)"/>
<path class="ln" d="M150 242 L250 197" marker-end="url(#bio3)" marker-start="url(#bio3)"/>
<path class="ln dash" d="M320 242 V197" marker-end="url(#bio3)" marker-start="url(#bio3)"/>
<path class="ln" d="M490 242 L390 197" marker-end="url(#bio3)" marker-start="url(#bio3)"/>
<path class="ln" d="M172 160 H218" marker-end="url(#bio3)" marker-start="url(#bio3)"/>
<path class="ln" d="M468 160 H422" marker-end="url(#bio3)" marker-start="url(#bio3)"/>
</svg>
<figcaption>图 6：科研 Agent 的典型组成。虚线表示通往物理世界的那条路，通常要经过人类审批。</figcaption>
</figure>

**工具**是最重的一部分。生物医学的工具链又长又杂，把它们包装成 Agent 好用的接口，本身就是一项大工程。Biomni 和 TxAgent 背后的 ToolUniverse 都在做这件事，越来越多的生物数据库和软件也开始提供 MCP 接口。[工具](/posts/agent-tools/) 那篇里说的原则在这里同样成立，甚至更重要：返回值要精简，错误信息要可操作，ID 体系要说清楚，否则模型会在"Ensembl ID 和基因符号怎么对应"这种事上反复绊倒。

**代码执行和沙箱**几乎是必需的。真实的生信分析没法只靠调用几个固定函数完成，Agent 需要写代码来清洗数据、串联工具、画图、做统计。这就需要一个隔离的、预装好常用软件的执行环境。生信环境的特别之处在于它很"重"：动辄几十 GB 的参考基因组和索引，需要 GPU 的结构预测，跑几个小时的比对任务。[沙箱](/posts/agent-sandbox/) 不仅要安全，还要能挂载大文件、支持长任务。

**上下文管理**面对的是另一种规模的数据。一个 FASTQ 文件可能有几千万条测序读段，一个单细胞表达矩阵有几万个基因乘以几十万个细胞，这些东西不可能也不应该放进模型的上下文。Agent 必须学会"通过代码看数据"：把数据留在文件系统里，只把统计摘要、图表和关键结果读回来，和 [上下文管理](/posts/agent-context-management/) 里讲的"让数据留在外面"是一回事。

**记忆和研究记录**在科研场景里格外重要。一个研究项目可能持续几个月，跨越很多次会话。哪些假设试过了、结果是什么、哪些路走不通，这些都需要被记下来。科研里有一个特别容易丢的东西叫**负面结果**：失败的实验通常不会发表，但对下一步决策至关重要。一个好的科研 Agent 应该像一个认真的研究生一样记实验记录，参见 [记忆](/posts/agent-memory/) 那篇。

**多 Agent** 在这个领域用得比在编程领域更多，原因是科研天然需要"多个视角"和"互相质疑"。AI co-scientist 的锦标赛、Virtual Lab 的批评者，本质上都是在用一个 Agent 去检查另一个 Agent 的推理，弥补单个模型容易一条路走到黑的问题。

**人在回路**是最后、也是最关键的一个部件。几乎所有走到湿实验验证的系统，都有人在某个环节把关：选哪些假设去验证，实验方案是否安全可行，结果是否可信。这不只是因为技术还不够成熟，也是因为实验的成本和风险决定了，"执行"这一步不能完全交给模型。

## 专题：单细胞与空间多组学里的 Agent

前面讲的系统大多面向"药物"或"通用科研"。这一节换一个更具体的方向：单细胞和空间多组学。它可能是目前 Agent 在生物信息学里落地最密集的地方，也最能说明 Agent 到底在帮什么忙。

### 为什么偏偏是这里

单细胞测序把"一块组织的平均表达"拆成了"每个细胞的表达"，空间组学又把细胞放回它在组织里的位置。数据维度一下子多了好几层：几万个基因、几十万到上百万个细胞、空间坐标，往往还有一张高分辨率的组织图像。

分析流程本身已经相当标准化，Scanpy、Seurat、Squidpy 这些工具把常用步骤都封装好了。但"标准化"不等于"自动化"，每一步都有很多需要判断的地方：

<figure class="diagram">
<svg viewBox="0 0 640 262" role="img" aria-label="单细胞和空间组学的标准分析流程，按步骤区分规则明确的部分和需要生物学知识的部分">
<defs><marker id="bio8" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0 0 L10 5 L0 10 z"/></marker></defs>
<rect class="c-purple" x="20" y="30" width="135" height="56" rx="6"/><text class="t" x="87" y="53" text-anchor="middle">面板设计</text><text class="ts" x="87" y="73" text-anchor="middle">靶向空间平台选基因</text>
<rect class="c-amber" x="175" y="30" width="135" height="56" rx="6"/><text class="t" x="242" y="53" text-anchor="middle">质控与过滤</text><text class="ts" x="242" y="73" text-anchor="middle">去双细胞、低质量</text>
<rect class="c-amber" x="330" y="30" width="135" height="56" rx="6"/><text class="t" x="397" y="53" text-anchor="middle">归一化与整合</text><text class="ts" x="397" y="73" text-anchor="middle">批次校正、scVI</text>
<rect class="c-amber" x="485" y="30" width="135" height="56" rx="6"/><text class="t" x="552" y="53" text-anchor="middle">降维与聚类</text><text class="ts" x="552" y="73" text-anchor="middle">PCA、Leiden、分辨率</text>
<path class="ln" d="M155 58 H173" marker-end="url(#bio8)"/><path class="ln" d="M310 58 H328" marker-end="url(#bio8)"/><path class="ln" d="M465 58 H483" marker-end="url(#bio8)"/>
<path class="ln" d="M552 86 V112 H87 V138" marker-end="url(#bio8)"/>
<rect class="c-purple" x="20" y="140" width="135" height="56" rx="6"/><text class="t" x="87" y="163" text-anchor="middle">细胞类型注释</text><text class="ts" x="87" y="183" text-anchor="middle">marker 基因 + 文献</text>
<rect class="c-amber" x="175" y="140" width="135" height="56" rx="6"/><text class="t" x="242" y="163" text-anchor="middle">差异与通路</text><text class="ts" x="242" y="183" text-anchor="middle">DE、富集分析</text>
<rect class="c-purple" x="330" y="140" width="135" height="56" rx="6"/><text class="t" x="397" y="163" text-anchor="middle">通讯与生态位</text><text class="ts" x="397" y="183" text-anchor="middle">配体受体、空间邻域</text>
<rect class="c-green" x="485" y="140" width="135" height="56" rx="6"/><text class="t" x="552" y="163" text-anchor="middle">假设与报告</text><text class="ts" x="552" y="183" text-anchor="middle">新发现 + 证据</text>
<path class="ln" d="M155 168 H173" marker-end="url(#bio8)"/><path class="ln" d="M310 168 H328" marker-end="url(#bio8)"/><path class="ln" d="M465 168 H483" marker-end="url(#bio8)"/>
<rect class="c-amber" x="120" y="222" width="14" height="14" rx="2"/><text class="ts" x="140" y="234">规则明确：Agent 选参数、写代码</text>
<rect class="c-purple" x="350" y="222" width="14" height="14" rx="2"/><text class="ts" x="370" y="234">需要知识：Agent 查文献、做判断</text>
</svg>
<figcaption>图 7：单细胞与空间组学的典型分析流程。紫色的步骤最依赖生物学知识，也是大模型最能帮上忙的地方。</figcaption>
</figure>

琥珀色的步骤有成熟的工具和惯例，难点在于选参数：过滤阈值定多少，用哪种批次校正，聚类分辨率调到多大。这些选择没有唯一正确答案，但会实实在在地改变下游结果，正适合让 Agent 去尝试、比较、记录。

紫色的步骤则依赖生物学知识。给一个聚类的前几个 marker 基因，判断它是什么细胞，靠的是对文献和数据库的熟悉；看两群细胞之间的配体受体信号，判断哪个在生物学上说得通，同样如此。这恰恰是大模型"读过的东西多"能派上用场的地方。

空间组学还多了两件事。一是**实验前的面板设计**：Xenium、MERFISH、CosMx 这类靶向平台一次只能测几百到几千个基因，选哪些基因直接决定了能看到什么，这是一个典型的实验设计问题。二是**图像**：组织切片的 H&E 或免疫荧光图像里有大量形态学信息，需要多模态模型才能读懂。

### 从一个注释工具到一个完整的分析者

这个方向的演进路线很清楚，正好是从"模型"走向"Agent"的缩影。

**第一步是证明大模型懂细胞。** [GPTCelltype](https://www.biorxiv.org/content/10.1101/2023.04.16.537094)<sup class="cite" id="cite-13"><a href="#ref-13" title="GPTCelltype">13</a></sup> 的工作（Hou 和 Ji，2024 年发表在 *Nature Methods*）做了一件很简单的事：把每个聚类的差异基因列表交给 GPT-4，让它说出细胞类型。结果在大量组织和细胞类型上，它的注释和人工注释高度一致。这还不是 Agent，只是一次调用，但它说明了紫色那一步可以交给模型。

**第二步是把整条流程交出去。** [CellAgent](https://arxiv.org/abs/2407.09811)<sup class="cite" id="cite-14"><a href="#ref-14" title="CellAgent">14</a></sup>（后发表于 ICLR 2026）用了一个规划者、执行者、评估者的三角色结构：规划者把"分析这份数据"拆成质控、整合、聚类、注释等步骤；执行者为每一步选工具、写代码；评估者检查结果，不满意就让执行者换个工具或参数重来。这个"自我迭代"正对应琥珀色步骤里那些选参数的问题：与其让人一遍遍试，不如让 Agent 试，并用一个评估标准来选。

**第三步是走进空间。** 2025 年出现了好几个专门面向空间组学的 Agent，各有侧重：

- [SpatialAgent](https://www.biorxiv.org/content/10.1101/2025.04.03.646459v1)<sup class="cite" id="cite-15"><a href="#ref-15" title="SpatialAgent">15</a></sup> 来自 Genentech 的团队，结构是记忆、规划、行动三个模块，配有十几个专门工具和预先写好的分析模板。它覆盖了从实验设计到假设生成的完整流程：在人类前额叶皮层的面板设计任务上，它设计的基因面板在细胞类型预测上超过了大约九成人类专家的设计，而且人和 Agent 合作设计的面板通常比任何一方单独设计的更好；在发育中的人类心脏数据上，它的细胞和生态位注释超过了 GPTCelltype 和 CellTypist，接近最好的人类专家；在小鼠结肠炎数据上，它给出的细胞通讯分析既复现了原论文的结论，也补充了原文没有强调的信号通路。它还同时支持全自动和"共驾"两种模式，后者允许研究者中途追问和修改目标。
- [STAgent](https://www.biorxiv.org/content/10.1101/2025.04.01.646731)<sup class="cite" id="cite-16"><a href="#ref-16" title="STAgent">16</a></sup> 来自哈佛的 Liu 组，强调多模态：它用多模态大模型直接"看"分析生成的图和组织图像，再结合检索到的文献写出带引用的研究报告。论文里它被用来分析人多能干细胞分化的胰岛移植物在小鼠体内不同时间点的空间转录组数据，刻画了胰岛样结构逐步成熟的过程。
- [OmicsNavigator](https://www.biorxiv.org/content/10.1101/2025.07.21.665821)<sup class="cite" id="cite-17"><a href="#ref-17" title="OmicsNavigator">17</a></sup> 面向的是 CODEX、成像质谱这类空间蛋白组数据。它把图像形态和分子表达分给两个 Agent 分别解读，再由第三个 Agent 融合，实验表明融合比只看任何一种模态都好。它最值得一提的设计是**预注册的假设验证**：研究者先写下假设，Agent 再去数据里检验，并如实报告"不支持"。论文里确实有一个假设被它否定了。
- [PhenoGraph](https://www.biorxiv.org/content/10.1101/2025.06.06.658341)<sup class="cite" id="cite-18"><a href="#ref-18" title="PhenoGraph">18</a></sup> 换了个角度：从 TCGA 的大规模临床和表达数据出发，找出空间切片上和某个表型（比如生存期）相关的区域，再用生物医学知识图谱解释这些区域里的关键基因和疾病、通路、药物之间的联系。

<figure class="diagram">
<svg viewBox="0 0 640 300" role="img" aria-label="多模态空间组学 Agent：输入表达矩阵、空间坐标、组织图像和文献，经过规划、代码执行、读图和文献检索，输出注释、细胞通讯、面板设计和报告">
<defs><marker id="bio9" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0 0 L10 5 L0 10 z"/></marker></defs>
<text class="t" x="95" y="24" text-anchor="middle">输入</text>
<text class="t" x="320" y="24" text-anchor="middle">Agent</text>
<text class="t" x="545" y="24" text-anchor="middle">输出</text>
<rect class="c-blue" x="20" y="40" width="150" height="44" rx="6"/><text class="ts" x="95" y="67" text-anchor="middle">表达矩阵（细胞 × 基因）</text>
<rect class="c-blue" x="20" y="100" width="150" height="44" rx="6"/><text class="ts" x="95" y="127" text-anchor="middle">空间坐标</text>
<rect class="c-blue" x="20" y="160" width="150" height="44" rx="6"/><text class="ts" x="95" y="187" text-anchor="middle">组织图像（H&amp;E / 荧光）</text>
<rect class="c-blue" x="20" y="220" width="150" height="44" rx="6"/><text class="ts" x="95" y="247" text-anchor="middle">论文、数据库、图谱</text>
<rect class="c-purple" x="220" y="40" width="200" height="224" rx="8"/>
<rect class="c-gray" x="240" y="56" width="160" height="38" rx="4"/><text class="ts" x="320" y="80" text-anchor="middle">按模板规划、记忆上下文</text>
<rect class="c-gray" x="240" y="106" width="160" height="38" rx="4"/><text class="ts" x="320" y="130" text-anchor="middle">写代码：Scanpy、Squidpy</text>
<rect class="c-gray" x="240" y="156" width="160" height="38" rx="4"/><text class="ts" x="320" y="180" text-anchor="middle">多模态模型读图</text>
<rect class="c-gray" x="240" y="206" width="160" height="38" rx="4"/><text class="ts" x="320" y="230" text-anchor="middle">检索文献、核对知识</text>
<rect class="c-green" x="470" y="40" width="150" height="44" rx="6"/><text class="ts" x="545" y="67" text-anchor="middle">细胞与生态位注释</text>
<rect class="c-green" x="470" y="100" width="150" height="44" rx="6"/><text class="ts" x="545" y="127" text-anchor="middle">细胞通讯与空间模式</text>
<rect class="c-green" x="470" y="160" width="150" height="44" rx="6"/><text class="ts" x="545" y="187" text-anchor="middle">下一轮实验的面板设计</text>
<rect class="c-green" x="470" y="220" width="150" height="44" rx="6"/><text class="ts" x="545" y="247" text-anchor="middle">带引用的报告与假设</text>
<path class="ln" d="M170 62 H218" marker-end="url(#bio9)"/><path class="ln" d="M170 122 H218" marker-end="url(#bio9)"/><path class="ln" d="M170 182 H218" marker-end="url(#bio9)"/><path class="ln" d="M170 242 H218" marker-end="url(#bio9)"/>
<path class="ln" d="M420 62 H468" marker-end="url(#bio9)"/><path class="ln" d="M420 122 H468" marker-end="url(#bio9)"/><path class="ln" d="M420 182 H468" marker-end="url(#bio9)"/><path class="ln" d="M420 242 H468" marker-end="url(#bio9)"/>
<text class="ts" x="320" y="290" text-anchor="middle">共驾模式：研究者随时追问、修改目标，Agent 更新记忆后重新规划</text>
</svg>
<figcaption>图 8：一个多模态空间组学 Agent 的大致形状，综合了 SpatialAgent、STAgent 和 OmicsNavigator 的共同设计。</figcaption>
</figure>

**第四步是让 Agent 自己提问题。** 斯坦福 Zou 组的 [CellVoyager](https://www.biorxiv.org/content/10.1101/2025.06.03.657517)<sup class="cite" id="cite-19"><a href="#ref-19" title="CellVoyager">19</a></sup> 做的不是"按要求分析"，而是**重新分析已发表的数据**：它读一篇单细胞论文和对应的数据，弄清原作者做了哪些分析，然后提出原文没做过的假设，在一个类似 Jupyter 的环境里写代码检验，遇到报错自己修，用视觉模型看图来决定下一步，最后写出报告。作者用它重新分析了几个已发表的数据集，得到了一些新的观察，比如新冠患者的 CD8 T 细胞可能更容易发生细胞焦亡，原论文作者评估后认为其中不少假设是合理且有意思的。

这条路线和 Biomni 这样的通用 Agent 也在汇合：单细胞分析本来就是 Biomni 测试的任务之一。可以预见，以后"专用 Agent"和"通用 Agent 加专用工具"的界线会越来越模糊。

### 这个方向特有的坑

单细胞和空间组学有自己的一套陷阱，Agent 不但不会自动避开，有时还会放大它们。

**注释没有标准答案。** 细胞类型注释依赖聚类分辨率，而分辨率本身就是主观选择；同一群细胞，不同的参考图谱可能给出不同的名字。大模型还有一个特别的倾向：它更容易把细胞归到"教科书里有的"类型上，对于罕见细胞、过渡状态或者真正的新细胞类型，反而不如一个保持怀疑的人类专家敏感。SpatialAgent 在心脏数据上也是在心外膜细胞亚型这类细分类型上表现最弱。所以让 Agent 注释时，最好要求它同时给出支持每个判断的 marker 基因和置信度，人再对照 dotplot 去核对。

**"先聚类再找差异基因"的统计陷阱。** 用同一份数据先聚类、再在聚类之间做差异表达检验，p 值会被系统性地低估，这个问题在单细胞领域讨论了很多年，常被称为 double dipping。人类研究者常常忽略它，Agent 更不会主动想到。如果你的评测只看"找到了多少显著基因"，Agent 会很乐意给你一长串。

**批次效应和整合选择。** 多个样本、多个批次的数据合在一起时，整合方法和参数的选择会直接影响生物学结论：校正不够，批次差异被当成生物学差异；校正过度，真实的生物学信号被抹掉。这类问题很难用一个自动指标判断好坏，需要在 Agent 的流程里留出人工检查的节点。

**规模和成本。** 一个空间组学数据集动辄上百万个细胞、几十 GB 的图像，必须严格遵守"数据留在文件里，Agent 通过代码看数据"的原则。即便如此，多模态 Agent 的 token 开销也不小：OmicsNavigator 的作者提到，分析一个肾病队列的约一千个感兴趣区域，就用了大约三百万个输出 token。

**真正的"多组学"联合分析还很少。** 现在的 Agent 大多处理单一模态，或者在转录组加图像这样的组合上做文章。同时测 RNA 和染色质可及性的 multiome、同时测 RNA 和表面蛋白的 CITE-seq、以及越来越多的空间多组学平台，要求 Agent 理解不同模态之间的对应关系和各自的噪声特点。OmicsNavigator 的作者也把"跨组学层的联合分析"列为尚未支持的方向。这是一个很明显的空白，也是一个很好的研究机会。

### 如果你在做这个方向

结合上面的系统，有几点比较实际的经验：

1. **从注释和报告这类"知识密集"的步骤开始**，让 Agent 先当一个会查文献的助手，再逐步把参数选择也交给它；
2. **把你实验室的标准流程写成模板**，SpatialAgent 的经验说明，有模板的规划比让模型从零发挥稳定得多；
3. **要求 Agent 的每一步都落在 notebook 里**，包括它尝试过又放弃的分析，方便复现和审查；
4. **预先写下假设再让 Agent 检验**，像 OmicsNavigator 那样允许它说"不支持"，而不是让它在数据里一直找到显著为止；
5. **把面板设计当成人和 Agent 合作的任务**，SpatialAgent 的结果显示，人机合作设计的面板通常比任何一方单独设计的更好。

## 真正难的地方

演示视频里的科研 Agent 都很惊艳，但真正用起来，会遇到一批在通用 Agent 里不那么突出、在科学研究里却很致命的问题。

### 幻觉在科学里更危险

大模型编造一个不存在的函数名，代码一跑就报错；但它编造一篇不存在的论文、一个错误的基因功能、一条不存在的通路联系，往往没有任何东西会立即报错。更糟的是，这些错误读起来和正确的结论一样专业。

缓解的办法是 **让每一个事实性的论断都有出处**。像 FutureHouse 的 [PaperQA](https://arxiv.org/abs/2409.13740)<sup class="cite" id="cite-20"><a href="#ref-20" title="PaperQA2">20</a></sup> 系列那样，回答必须基于检索到的原文段落，并附上引用；数据库查询的结果原样保存，不让模型"凭记忆"填空。原则是：模型负责推理，事实来自工具。

### 验证是真正的瓶颈

Agent 可以在一个小时里提出一百个假设，但验证一个假设的湿实验可能要几个月。于是瓶颈从"想出好点子"转移到了"判断哪些点子值得验证"。


<figure class="diagram">
<svg viewBox="0 0 640 290" role="img" aria-label="假设验证漏斗：从上百个假设经过计算筛选和人工挑选，只有少数进入湿实验，越往下越慢越贵">
<defs><marker id="bio7" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0 0 L10 5 L0 10 z"/></marker></defs>
<rect class="c-purple" x="20" y="16" width="480" height="48" rx="6"/><text class="t" x="260" y="37" text-anchor="middle">Agent 提出上百个假设</text><text class="ts" x="260" y="55" text-anchor="middle">文献、数据、推理</text>
<rect class="c-blue" x="80" y="80" width="360" height="48" rx="6"/><text class="t" x="260" y="101" text-anchor="middle">计算筛选</text><text class="ts" x="260" y="119" text-anchor="middle">对接打分、ADMET 预测、文献核对</text>
<rect class="c-amber" x="140" y="144" width="240" height="48" rx="6"/><text class="t" x="260" y="165" text-anchor="middle">专家挑选</text><text class="ts" x="260" y="183" text-anchor="middle">可行性、成本、安全</text>
<rect class="c-green" x="195" y="208" width="130" height="48" rx="6"/><text class="t" x="260" y="229" text-anchor="middle">湿实验</text><text class="ts" x="260" y="247" text-anchor="middle">少数几个</text>
<path class="ln" d="M260 64 V78" marker-end="url(#bio7)"/><path class="ln" d="M260 128 V142" marker-end="url(#bio7)"/><path class="ln" d="M260 192 V206" marker-end="url(#bio7)"/>
<text class="ts" x="530" y="44">分钟级</text>
<text class="ts" x="530" y="108">小时级</text>
<text class="ts" x="530" y="172">天级</text>
<text class="ts" x="530" y="236">周到月，最贵</text>
<path class="ln" d="M515 30 V250" marker-end="url(#bio7)"/>
<text class="ts" x="260" y="280" text-anchor="middle">瓶颈在漏斗底部：决定哪些假设值得往下走，比生成假设更重要</text>
</svg>
<figcaption>图 9：越往下越慢、越贵，也越可信。计算指标只能当过滤器。</figcaption>
</figure>

一个自然的想法是用计算指标代替实验，比如用对接打分代替结合实验，用预测的毒性代替毒理测试。这在早期筛选时很有用，但要小心：**Agent 会优化你给它的任何指标**，包括指标的漏洞。一个分子可能对接分数极高，但根本无法合成，或者在体内完全没有活性。这和强化学习里的"奖励投机"是同一个问题。计算指标只能是过滤器，不能是终点。

### "新发现"可能并不新

当 Agent 宣布"发现"了什么的时候，第一个要问的问题是：这是真正的新东西，还是它在训练数据里见过？大模型读过海量文献，它提出的"新"假设，很可能只是某篇论文的复述。反过来，评测时也要小心答案泄露：用来测试的"已知发现"如果已经发表，模型可能只是在回忆，而不是在推理。

AI co-scientist 那个耐药机制的例子之所以引人注目，正是因为对应的研究在当时还没有发表。但即便如此，相关的前期工作是公开的，"独立推出"和"从已有线索拼出"之间的界限也并不总是清楚。这类问题需要领域专家逐条去判断。

### 统计和可复现性

给一个 Agent 一份数据和一个目标，让它"找出显著的结果"，它很可能会尝试十几种分析方法、几十种参数组合，直到某个 p 值小于 0.05。这在人类研究者身上叫 p-hacking，在 Agent 身上只会更快、更隐蔽。

应对办法是把分析计划和执行过程都留下来：Agent 尝试过的所有分析，不只是"成功"的那个，都应该保存在可复现的脚本或笔记本里；多重检验要做校正；关键结论最好用一份独立的数据再验证一次。说到底，Agent 的每一次分析都应该像一篇论文的方法部分那样，能被别人复现。

### 评测比一般 Agent 更难

[评测](/posts/agent-evaluation/) 那篇说过，Agent 评测要评结果、要跑多次、要读轨迹。在科研场景里，这些原则都还成立，但有一个额外的麻烦：**真正的目标，也就是做出新发现，几乎无法直接评测。**

现有的做法大多是退而求其次。[LAB-Bench](https://arxiv.org/abs/2407.10362)<sup class="cite" id="cite-21"><a href="#ref-21" title="LAB-Bench">21</a></sup> 测文献检索、序列操作、实验方案理解这些研究中的具体技能；[BixBench](https://arxiv.org/abs/2503.00096)<sup class="cite" id="cite-22"><a href="#ref-22" title="BixBench">22</a></sup> 测 Agent 能否完成真实的生物信息学分析任务；[ScienceAgentBench](https://arxiv.org/abs/2410.05080)<sup class="cite" id="cite-23"><a href="#ref-23" title="ScienceAgentBench">23</a></sup> 测能否根据论文复现数据分析。这些基准都有用，但它们测的是"研究助理"的能力，而不是"科学家"的能力。至于后者，目前最可信的评测仍然是湿实验，加上领域专家的判断。

ChemCrow 的教训在这里值得再提一次：在专业领域里，**用模型评审模型，很可能会奖励流畅而不是正确。** 评测集里一定要有专家参与。

### 生物安全

最后一个问题绕不开。能帮你设计药物的 Agent，原则上也能帮别人设计有害的东西；能查毒性数据的工具，也能被用来找毒性最强的分子。ChemCrow 的作者在论文里专门讨论过这个问题，并在工具层面加了对管制化学品的检查。

主流的模型提供方都会在模型层面限制与生物武器相关的能力，但对于搭建科研 Agent 的人来说，责任不能只推给模型。工具的权限、实验室接口的操作范围、哪些请求需要人工审批，这些都是 Harness 层面的设计决策。和 [安全](/posts/agent-basics/#安全边界放在模型之外) 那一节说的一样，边界要放在模型之外。

## 如果你是做生信的，想从哪里开始

如果你在做生物信息学，想把 Agent 用到自己的工作里，不需要一上来就做一个"AI 科学家"。下面是一些比较务实的建议：

1. **从一个你反复做的分析流程开始**，比如差异表达加富集分析、变异注释、单细胞的标准预处理，流程固定、结果可检查，最适合先交出去；
2. **把常用的工具和数据库包装成好用的接口**，参数清楚，返回值精简，ID 映射写进工具说明，能用现成的 MCP 服务就别重复造轮子；
3. **给 Agent 一个固定的、容器化的执行环境**，软件版本锁死，参考数据预先挂载，别让它每次都从 `pip install` 开始；
4. **让数据留在文件里，让 Agent 通过代码看数据**，上下文里只放摘要和结论；
5. **每一个结论都要有出处**，文献要有引用，数字要有生成它的脚本，分析过程要能复现；
6. **先攒一个小的评测集**，用你自己做过、知道答案的分析当任务，改了提示词或工具之后跑一遍，看结果是否一致；
7. **在花钱和动手之前设置人工审批**，任何要提交到实验室、调用付费服务或者处理患者数据的操作，都应该先停下来问人；
8. **把 Agent 当作一个很能干但没有经验的研究生**，它干活快、读得多，但需要你检查它的推理，尤其是它最兴奋的那些结论。

## 值得一看的项目和工具

如果你想亲手试一试，或者想看看这些系统的代码，下面这些是我觉得比较值得关注的：

**可以直接用的平台**

- [Biomni](https://github.com/snap-stanford/Biomni)：斯坦福的通用生物医学 Agent，开源，可以本地部署，适合拿来跑自己的分析任务；
- [FutureHouse](https://www.futurehouse.org/) 和 [Edison Scientific](https://arxiv.org/abs/2511.02824)：前者做了 PaperQA、Robin 等一系列科研 Agent，后者是它分拆出来的公司，推出了可以连续运行十几个小时、每次读上千篇论文的 AI 科学家 Kosmos；
- [Google AI co-scientist](https://arxiv.org/abs/2502.18864)：目前主要通过合作项目开放给研究机构；
- [Claude for Life Sciences](https://www.maginative.com/article/anthropic-launches-claude-for-life-sciences-with-benchling-pubmed-integration/)：Anthropic 推出的生命科学方案，通过连接器接入 Benchling、PubMed 等科研工具。

**开源代码，适合学习和改造**

- [PaperQA](https://github.com/Future-House/paper-qa)：基于检索、带引用的文献问答，"每个论断都要有出处"的好范例；
- [ToolUniverse](https://github.com/mims-harvard/ToolUniverse)：TxAgent 背后的生物医学工具集，可以直接作为其他 Agent 的工具来源；
- [Virtual Lab](https://github.com/zou-group/virtual-lab)：多 Agent "组会"的实现，代码量不大，很适合读；
- [CellVoyager](https://github.com/zou-group/CellVoyager)：自主重新分析单细胞数据的 Agent；
- [BioDiscoveryAgent](https://github.com/snap-stanford/BioDiscoveryAgent)：设计基因扰动实验的 Agent。

**评测基准**

- [LAB-Bench](https://arxiv.org/abs/2407.10362)：生物学研究中的实用技能，包括文献、序列操作和实验方案；
- [BixBench](https://arxiv.org/abs/2503.00096)：真实的生物信息学分析任务；
- [ScienceAgentBench](https://arxiv.org/abs/2410.05080)：根据论文复现数据驱动的科学分析。

## 小结

1. **AI 参与生命科学有三层**：专用模型解决具体问题，大模型助手回答问题，Agent 把它们串起来做一段研究；Agent 不是替代 AlphaFold，而是把它当工具用；
2. **科学方法本身就是一个循环**，和 Agent 循环形状相同，最大的区别是"执行实验"这一步又慢又贵；
3. **生物信息学特别适合 Agent**：工具碎、数据库多、文献读不完、很多中间结果能用代码验证；
4. **在药物发现里，Agent 目前最活跃的是靶点发现、老药新用和计算设计**，越往临床走，越是人主导、Agent 辅助；
5. **代表性系统展示了不同的设计**：ChemCrow 的工具增强，Coscientist 的实验室接口，AI co-scientist 的假设锦标赛，Virtual Lab 的角色分工，Biomni 的通用环境，Robin 的端到端流程；
6. **科研 Agent 的部件和通用 Agent 一样**，但每个部件都更重：工具链更长，环境更大，数据不能进上下文，记录要包括负面结果；
7. **单细胞与空间多组学是 Agent 落地最密集的方向之一**：从 GPTCelltype 的注释，到 CellAgent 的全流程，再到 SpatialAgent、STAgent、OmicsNavigator 的多模态空间分析和 CellVoyager 的自主再分析，但注释没有标准答案、double dipping、批次整合和真正的跨组学联合分析，仍然需要人来把关；
8. **真正的难点在科学本身**：幻觉更危险，验证是瓶颈，计算指标会被投机，"新发现"可能不新，统计容易被滥用，评测离真正的目标很远，生物安全必须在 Harness 层面设防。

AlphaFold 告诉我们，模型可以在一个定义清楚的问题上超过人类。科研 Agent 想回答的是一个更难的问题：在一个定义不清楚的问题上，模型能不能像科学家一样，知道该问什么、该做什么、什么时候该怀疑自己。现在的答案是"在人的看护下，部分可以"。这个"部分"正在变大，但"看护"这两个字，短期内大概还拿不掉。

## 参考文献

<section class="refs">
<ol>
<li id="ref-1"><span class="ref-n">[1]</span><span>Xu Z. et al. <a href="https://pubmed.ncbi.nlm.nih.gov/40461817/">A generative AI-discovered TNIK inhibitor for idiopathic pulmonary fibrosis: a randomized phase 2a trial</a>. <i>Nature Medicine</i>, 2025. <a class="ref-back" href="#cite-1" aria-label="回到正文">↩</a></span></li>
<li id="ref-2"><span class="ref-n">[2]</span><span>Bran A. M. et al. <a href="https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11116106/">Augmenting large language models with chemistry tools</a>. <i>Nature Machine Intelligence</i>, 2024. <a class="ref-back" href="#cite-2" aria-label="回到正文">↩</a></span></li>
<li id="ref-3"><span class="ref-n">[3]</span><span>Boiko D. A. et al. <a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC10733136">Autonomous chemical research with large language models</a>. <i>Nature</i>, 2023. <a class="ref-back" href="#cite-3" aria-label="回到正文">↩</a></span></li>
<li id="ref-4"><span class="ref-n">[4]</span><span>Gottweis J. et al. <a href="https://arxiv.org/abs/2502.18864">Towards an AI co-scientist</a>. <i>arXiv</i>, 2025. <a class="ref-back" href="#cite-4" aria-label="回到正文">↩</a></span></li>
<li id="ref-5"><span class="ref-n">[5]</span><span>Swanson K. et al. <a href="https://www.nature.com/nature-index/article/10.1038/s41586-025-09442-9">The Virtual Lab of AI agents designs new SARS-CoV-2 nanobodies</a>. <i>Nature</i>, 2025.（<a href="https://www.biorxiv.org/content/10.1101/2024.11.11.623004">预印本</a>） <a class="ref-back" href="#cite-5" aria-label="回到正文">↩</a></span></li>
<li id="ref-6"><span class="ref-n">[6]</span><span>Huang K. et al. <a href="https://www.biorxiv.org/content/10.1101/2025.05.30.656746v1">Biomni: A General-Purpose Biomedical AI Agent</a>. <i>bioRxiv</i>, 2025. <a class="ref-back" href="#cite-6" aria-label="回到正文">↩</a></span></li>
<li id="ref-7"><span class="ref-n">[7]</span><span>Ghareeb A. E. et al. <a href="https://arxiv.org/abs/2505.13400">Robin: A multi-agent system for automating scientific discovery</a>. <i>arXiv</i>, 2025. <a class="ref-back" href="#cite-7" aria-label="回到正文">↩</a></span></li>
<li id="ref-8"><span class="ref-n">[8]</span><span>Qu Y. et al. <a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC12920143">CRISPR-GPT for agentic automation of gene-editing experiments</a>. <i>Nature Biomedical Engineering</i>, 2025. <a class="ref-back" href="#cite-8" aria-label="回到正文">↩</a></span></li>
<li id="ref-9"><span class="ref-n">[9]</span><span>Roohani Y. et al. <a href="https://arxiv.org/abs/2405.17631">BioDiscoveryAgent: An AI Agent for Designing Genetic Perturbation Experiments</a>. <i>ICLR</i>, 2025. <a class="ref-back" href="#cite-9" aria-label="回到正文">↩</a></span></li>
<li id="ref-10"><span class="ref-n">[10]</span><span>Gao S. et al. <a href="https://arxiv.org/abs/2503.10970">TxAgent: An AI Agent for Therapeutic Reasoning Across a Universe of Tools</a>. <i>arXiv</i>, 2025. <a class="ref-back" href="#cite-10" aria-label="回到正文">↩</a></span></li>
<li id="ref-11"><span class="ref-n">[11]</span><span>Lu C. et al. <a href="https://arxiv.org/abs/2408.06292">The AI Scientist: Towards Fully Automated Open-Ended Scientific Discovery</a>. <i>arXiv</i>, 2024. <a class="ref-back" href="#cite-11" aria-label="回到正文">↩</a></span></li>
<li id="ref-12"><span class="ref-n">[12]</span><span>Mitchener L. et al. <a href="https://arxiv.org/abs/2511.02824">Kosmos: An AI Scientist for Autonomous Discovery</a>. <i>arXiv</i>, 2025. <a class="ref-back" href="#cite-12" aria-label="回到正文">↩</a></span></li>
<li id="ref-13"><span class="ref-n">[13]</span><span>Hou W., Ji Z. <a href="https://www.biorxiv.org/content/10.1101/2023.04.16.537094">Assessing GPT-4 for cell type annotation in single-cell RNA-seq analysis</a>. <i>Nature Methods</i>, 2024. <a class="ref-back" href="#cite-13" aria-label="回到正文">↩</a></span></li>
<li id="ref-14"><span class="ref-n">[14]</span><span>Xiao Y. et al. <a href="https://arxiv.org/abs/2407.09811">CellAgent: An LLM-driven Multi-Agent Framework for Automated Single-cell Data Analysis</a>. <i>ICLR</i>, 2026. <a class="ref-back" href="#cite-14" aria-label="回到正文">↩</a></span></li>
<li id="ref-15"><span class="ref-n">[15]</span><span>Wang H. et al. <a href="https://www.biorxiv.org/content/10.1101/2025.04.03.646459v1">SpatialAgent: An autonomous AI agent for spatial biology</a>. <i>bioRxiv</i>, 2025. <a class="ref-back" href="#cite-15" aria-label="回到正文">↩</a></span></li>
<li id="ref-16"><span class="ref-n">[16]</span><span><a href="https://www.biorxiv.org/content/10.1101/2025.04.01.646731">Spatial transcriptomics AI agent charts hPSC-pancreas maturation in vivo</a>. <i>bioRxiv</i>, 2025. <a class="ref-back" href="#cite-16" aria-label="回到正文">↩</a></span></li>
<li id="ref-17"><span class="ref-n">[17]</span><span>Li Y. et al. <a href="https://www.biorxiv.org/content/10.1101/2025.07.21.665821">OmicsNavigator: an LLM-driven multi-agent system for autonomous zero-shot biological analysis in spatial omics</a>. <i>bioRxiv</i>, 2025. <a class="ref-back" href="#cite-17" aria-label="回到正文">↩</a></span></li>
<li id="ref-18"><span class="ref-n">[18]</span><span><a href="https://www.biorxiv.org/content/10.1101/2025.06.06.658341">PhenoGraph: A Multi-Agent Framework for Phenotype-driven Discovery in Spatial Transcriptomics Data Augmented with Knowledge Graphs</a>. <i>bioRxiv</i>, 2025. <a class="ref-back" href="#cite-18" aria-label="回到正文">↩</a></span></li>
<li id="ref-19"><span class="ref-n">[19]</span><span>Alber S. et al. <a href="https://www.biorxiv.org/content/10.1101/2025.06.03.657517">CellVoyager: AI CompBio agent generates new insights by autonomously analyzing biological data</a>. <i>bioRxiv</i>, 2025. <a class="ref-back" href="#cite-19" aria-label="回到正文">↩</a></span></li>
<li id="ref-20"><span class="ref-n">[20]</span><span>Skarlinski M. D. et al. <a href="https://arxiv.org/abs/2409.13740">Language agents achieve superhuman synthesis of scientific knowledge</a>. <i>arXiv</i>, 2024. <a class="ref-back" href="#cite-20" aria-label="回到正文">↩</a></span></li>
<li id="ref-21"><span class="ref-n">[21]</span><span>Laurent J. M. et al. <a href="https://arxiv.org/abs/2407.10362">LAB-Bench: Measuring Capabilities of Language Models for Biology Research</a>. <i>arXiv</i>, 2024. <a class="ref-back" href="#cite-21" aria-label="回到正文">↩</a></span></li>
<li id="ref-22"><span class="ref-n">[22]</span><span>Mitchener L. et al. <a href="https://arxiv.org/abs/2503.00096">BixBench: a Comprehensive Benchmark for LLM-based Agents in Computational Biology</a>. <i>arXiv</i>, 2025. <a class="ref-back" href="#cite-22" aria-label="回到正文">↩</a></span></li>
<li id="ref-23"><span class="ref-n">[23]</span><span>Chen Z. et al. <a href="https://arxiv.org/abs/2410.05080">ScienceAgentBench: Toward Rigorous Assessment of Language Agents for Data-Driven Scientific Discovery</a>. <i>ICLR</i>, 2025. <a class="ref-back" href="#cite-23" aria-label="回到正文">↩</a></span></li>
</ol>
</section>
