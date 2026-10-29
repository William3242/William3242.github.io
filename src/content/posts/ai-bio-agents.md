---
title: AI for 生物信息学：Agent 怎么参与药物发现和科学发现
description: AlphaFold 证明了模型能解决生物学里的具体问题，而 Agent 想做的是更进一步：读文献、提假设、写分析代码、调用计算工具，甚至操控实验室。这篇梳理 Agent 在药物发现和科学发现里的位置、几个有代表性的系统，以及它们真正难在哪里。
pubDate: 2026-10-29
tags: [Agent, LLM, AI for Science, 生物信息学]
---

2024 年的诺贝尔化学奖，一半颁给了 David Baker 的计算蛋白质设计，另一半颁给了 DeepMind 的 Demis Hassabis 和 John Jumper，理由是 AlphaFold 对蛋白质结构的预测。这大概是"AI for Science"第一次被这样正式地承认。

但 AlphaFold 做的是一件边界非常清楚的事：给它一条氨基酸序列，它给你一个三维结构。问题是人提的，结果是人解读的，下一步做什么也是人决定的。它是一个极其强大的**工具**，而不是一个会自己做研究的东西。

过去两三年，另一条路线越来越热闹：让大语言模型以 Agent 的形式参与研究本身。它读文献、提出假设、查数据库、写分析代码、调用 AlphaFold 这样的专用模型，有的还能把实验方案发给自动化实验室去执行，再根据结果决定下一步。这篇就来聊聊这件事：Agent 在药物发现和科学发现里到底在做什么，有哪些值得一看的系统，以及它们离"AI 科学家"还有多远。

这个系列前面几篇讲的都是通用的 Agent 构造，比如 [循环](/posts/agent-basics/)、[工具](/posts/agent-tools/)、[上下文](/posts/agent-context-management/)、[子 Agent](/posts/agent-subagents/) 和 [评测](/posts/agent-evaluation/)。这篇换个角度，看看这些部件放进一个具体领域之后会变成什么样子。

## 从"预测一个东西"到"做一段研究"

AI 参与生命科学研究，大致可以分成三个层次。

**第一层是专用模型。** AlphaFold 预测结构，ESM 这样的蛋白质语言模型学习序列的表示，各种分子生成模型设计新的化合物，ADMET 模型预测一个分子的吸收、代谢和毒性。它们在各自的任务上往往远超人类，但每个模型只回答一种问题，输入输出格式固定，不会自己决定下一步。

**第二层是对话式的大模型助手。** 你问它某个基因的功能，让它解释一段 R 代码，或者帮你总结一篇论文。它知道的东西很广，但只是"知道"：它不去查最新的数据库，不跑你的数据，回答完一个问题就停下来。

**第三层是 Agent。** 它用大模型做决策，但手里有工具：文献检索、数据库查询、代码执行、专用模型，甚至实验室的机器人。它在一个循环里工作，每一步看到上一步的结果，再决定接下来做什么，直到完成一个比较大的目标。

这三层不是替代关系。Agent 恰恰是把第一层的专用模型当成工具来用的，AlphaFold 在 Agent 眼里就是一个 `predict_structure` 函数。Agent 补上的是专用模型之间那些原本由人完成的部分：决定该用哪个模型、怎么准备输入、怎么解读输出、结果不对的时候换什么思路。

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
<figcaption>图 1：假设、实验、分析、更新，科学方法和 Agent 循环的形状几乎一样，区别在于"执行"这一步可能要花几周。</figcaption>
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

药物发现是一条很长的流水线。一个新药从立项到上市通常要十年以上，花费以十亿美元计，而进入临床的候选药物绝大多数最后都会失败。AI 能参与的环节很多，图 2 是一个粗略的地图。

<figure class="diagram">
<svg viewBox="0 0 640 250" role="img" aria-label="药物发现的五个阶段以及每个阶段中 Agent 可以承担的任务">
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
<rect class="frame" x="10" y="80" width="112" height="150" rx="6"/>
<text class="ts" x="66" y="104" text-anchor="middle">文献与知识图谱</text>
<text class="ts" x="66" y="126" text-anchor="middle">组学数据分析</text>
<text class="ts" x="66" y="148" text-anchor="middle">提出靶点假设</text>
<text class="ts" x="66" y="170" text-anchor="middle">老药新用</text>
<rect class="frame" x="138" y="80" width="112" height="150" rx="6"/>
<text class="ts" x="194" y="104" text-anchor="middle">虚拟筛选</text>
<text class="ts" x="194" y="126" text-anchor="middle">分子对接</text>
<text class="ts" x="194" y="148" text-anchor="middle">结构预测</text>
<text class="ts" x="194" y="170" text-anchor="middle">抗体/蛋白设计</text>
<rect class="frame" x="266" y="80" width="112" height="150" rx="6"/>
<text class="ts" x="322" y="104" text-anchor="middle">分子生成与打分</text>
<text class="ts" x="322" y="126" text-anchor="middle">构效关系分析</text>
<text class="ts" x="322" y="148" text-anchor="middle">合成路线规划</text>
<text class="ts" x="322" y="170" text-anchor="middle">自动化合成</text>
<rect class="frame" x="394" y="80" width="112" height="150" rx="6"/>
<text class="ts" x="450" y="104" text-anchor="middle">ADMET 预测</text>
<text class="ts" x="450" y="126" text-anchor="middle">毒性文献检索</text>
<text class="ts" x="450" y="148" text-anchor="middle">实验方案设计</text>
<text class="ts" x="450" y="170" text-anchor="middle">实验数据分析</text>
<rect class="frame" x="522" y="80" width="108" height="150" rx="6"/>
<text class="ts" x="576" y="104" text-anchor="middle">试验方案设计</text>
<text class="ts" x="576" y="126" text-anchor="middle">患者招募匹配</text>
<text class="ts" x="576" y="148" text-anchor="middle">文档与申报</text>
<text class="ts" x="576" y="170" text-anchor="middle">安全信号监测</text>
<text class="ts" x="320" y="246" text-anchor="middle">越往左，越适合让 Agent 自主探索；越往右，越需要人和监管把关</text>
</svg>
<figcaption>图 2：药物发现的主要阶段，以及 Agent 在每个阶段里可以承担的工作。</figcaption>
</figure>

几个阶段分开说一下。

**靶点发现**是最"开放"的一段，也是 Agent 目前最活跃的地方。要回答的问题是"干预哪个基因或蛋白，可能治疗这个病"。这需要把文献、遗传学证据、表达数据、通路知识拼在一起推理，正好是大模型擅长、而传统专用模型不擅长的事。老药新用（drug repurposing）也属于这一类：在已经批准上市的药物里，找一个可能对新适应症有效的，好处是安全性数据现成，能大大缩短后面的路。

**苗头化合物和先导优化**是传统计算化学的主场，虚拟筛选、分子对接、分子生成模型都已经发展了很多年。Agent 在这里扮演的更多是"调度者"：决定生成哪类分子、用什么打分、怎么在活性、选择性、可合成性之间做权衡，再把结果整理成化学家能看懂的报告。合成路线规划（逆合成）和自动化合成，则把 Agent 和真实的化学实验连了起来。

**临床前和临床阶段**，Agent 更多是一个效率工具：读毒理文献、设计实验方案、匹配临床试验的入组条件、起草申报文档。这些环节结果的代价很高，监管要求很严，所以通常是人主导、Agent 辅助。

值得一提的是，"AI 发现的药"已经不只是概念。Insilico Medicine 用生成式 AI 发现靶点并设计分子的 rentosertib（一个 TNIK 抑制剂），2025 年在 *Nature Medicine* 上发表了针对特发性肺纤维化的 2a 期临床结果。它用的主要是专用的生成模型和打分模型，而不是今天说的 LLM Agent，但它说明了一件事：计算方法产出的分子，是可以一路走进临床的。

## 几个有代表性的系统

这几年冒出来的科研 Agent 很多，下面挑几个在设计上各有代表性的说一说。它们大致按"自主程度"从低到高排列。

### ChemCrow：给模型配上化学家的工具箱

ChemCrow 是 2023 年 EPFL 和 Rochester 的团队做的化学 Agent，后来发表在 *Nature Machine Intelligence* 上。它的结构很朴素：GPT-4 加上 18 个化学专家设计的工具，用 ReAct 的方式在"思考、调用工具、观察结果"之间循环。工具包括分子量计算、SMILES 和名称的互转、文献检索、反应预测、逆合成规划、安全性检查，以及连接 IBM 的云端自动化化学平台 RoboRXN 的接口。

它最有意思的地方不是做出了什么，而是它清楚地展示了 **为什么化学需要工具**。大模型对化学有很多"知识"，但让它直接算一个分子的分子量、判断一个 SMILES 字符串是否合法，它很容易出错，而且错得很自信。把这些事交给 RDKit 这样的确定性工具，模型只负责决定"该算什么"，可靠性就上来了。这正是 [工具](/posts/agent-tools/) 那篇里说的：工具不是给模型添功能，而是把模型不擅长的事交出去。

ChemCrow 还留下了一个关于评测的教训。作者让化学家和 GPT-4 分别给 ChemCrow 和不带工具的 GPT-4 的回答打分。化学家明显更认可 ChemCrow，因为它的答案在化学上更正确；而 GPT-4 作为评审，却给两者打出了差不多的分，甚至更偏向不带工具的那个，因为它的回答读起来更流畅、更完整。**模型评审分辨不出"听起来对"和"真的对"**，这在专业领域尤其明显，也是 [评测](/posts/agent-evaluation/#用好模型评审) 那篇反复强调要让模型评审和人对齐的原因。

### Coscientist：从屏幕走进实验室

同一年，卡内基梅隆大学 Gomes 组的 Coscientist 发表在 *Nature* 上。它的结构是一个规划者（Planner）加上几个模块：网页搜索、文档检索、代码执行，以及实验自动化接口。

它做的事情比 ChemCrow 更进一步：给一个目标，比如"做一个 Suzuki 偶联反应"，它会自己上网查反应条件，读液体处理机器人的 API 文档，写出控制机器人的代码，在真实的实验室硬件上执行，然后读回实验数据。论文里它成功完成了钯催化的 Suzuki 和 Sonogashira 偶联反应，还在一个反应条件优化任务上表现出了根据结果调整下一轮实验的能力。

Coscientist 的意义在于它把 [Agent 循环](/posts/agent-basics/#最小的-agent-循环) 的"环境"从计算机扩展到了物理世界。这也带来了全新的风险：代码写错了可以重跑，试剂加错了可能就是一次事故。所以这类系统往往会在执行前加上严格的检查，把能做的操作限制在一个很小的、预先定义好的集合里，思路和 [沙箱](/posts/agent-sandbox/) 是一样的：边界要放在模型之外。

### AI co-scientist：用多 Agent 生成和打磨假设

2025 年初，Google 发布了 AI co-scientist。它的目标不是执行实验，而是做研究中最"像科学家"的那部分：**提出新的、可检验的假设**。

它是一个典型的多 Agent 系统，基于 Gemini 2.0。一个监督者（Supervisor）分配任务，下面有几个角色各司其职：

- **生成**（Generation）Agent 读文献、做"头脑风暴"，提出初始假设；
- **反思**（Reflection）Agent 像同行评审一样检查假设的正确性、新颖性和可检验性；
- **排名**（Ranking）Agent 让假设两两"辩论"，用类似国际象棋的 Elo 分数做锦标赛排序；
- **进化**（Evolution）Agent 把排名靠前的假设组合、简化、改进，产生新一代；
- **近似度**（Proximity）Agent 给假设聚类，避免重复；
- **元评审**（Meta-review）Agent 总结整轮评审中反复出现的问题，反馈给其他 Agent。

这个设计本质上是把 [评测](/posts/agent-evaluation/) 和 [子 Agent](/posts/agent-subagents/) 的思路搬进了生成过程本身：不是生成一个答案就交差，而是生成很多个，让它们互相竞争，再把评审意见喂回去。论文里一个重要观察是，给系统更多的计算时间，假设的质量（用 Elo 衡量）会持续上升，这就是所谓的"测试时计算扩展"。

更重要的是，它的几个假设经过了湿实验验证：在急性髓系白血病上提出的老药新用候选，有几个在细胞实验中显示出抑制效果；在肝纤维化上提出的新靶点，在人类肝脏类器官里得到了支持；最引人注目的是，在一个关于细菌耐药基因如何跨物种传播的问题上，它独立提出的机制假设，和伦敦帝国理工学院的团队花了多年实验得到、但当时尚未发表的结论一致。

### Virtual Lab：一个由 Agent 组成的课题组

斯坦福 James Zou 组的 Virtual Lab（2025 年发表在 *Nature*）走得更"拟人"一些。它模仿的是一个真实课题组的工作方式：一个扮演 PI（课题组长）的 Agent，带着几个不同专业背景的"科学家" Agent，比如免疫学家、计算生物学家、机器学习专家，外加一个专门挑毛病的批评者 Agent。

它们通过"组会"推进研究。在团队会议上，PI 提出议题，各个专家轮流发言，批评者指出问题，PI 汇总并做决定；在单独会议上，某个专家 Agent 负责把决定落实成代码。人类研究者只在关键节点给出很少的指导。

论文里的任务是为新出现的新冠病毒变体设计纳米抗体。Virtual Lab 自己决定了技术路线：从已有的、针对早期毒株的纳米抗体出发做突变，而不是从头设计；然后把 ESM 蛋白质语言模型、AlphaFold-Multimer 和 Rosetta 串成一条计算流水线来打分筛选。最后设计出的 92 个纳米抗体经过实验验证，其中有两个对新变体的结合能力明显提升，同时保留了对原始毒株的结合。

Virtual Lab 有两点值得注意。一是它说明"角色扮演"式的多 Agent 不只是噱头：不同角色带来的视角差异，加上一个专职的批评者，确实能让方案更周全。二是它的产出是一条**可执行的计算流水线**加一批**可以拿去做实验的序列**，而不是一段文字结论，这让它的结果可以被检验。

### Biomni：一个通用的生物医学 Agent

前面几个系统都是为某一类任务量身定做的。斯坦福 Leskovec 组等团队在 2025 年推出的 Biomni，想做的是一个**通用**的生物医学 Agent。

它的做法很有意思。为了确定 Agent 需要什么工具，作者先让模型从大量生物医学论文里挖掘"研究者实际做了哪些操作、用了哪些工具和数据库"，再据此构建了一个统一的环境：一百多个专门工具、几十个数据库、上百个常用软件包。Agent 的行动方式不是一次调用一个固定的函数，而是**直接写代码**，在这个环境里自由组合工具，这和 [工具](/posts/agent-tools/) 那篇里讲的"代码即行动"是同一个思路。

它在一系列差异很大的任务上做了测试，比如基因优先级排序、罕见病诊断、单细胞数据分析、实验方案设计，展示了一个 Agent 不用为每个任务单独改造，也能处理相当广的生物医学问题。

### 走向"AI 科学家"：Robin 和更自主的系统

再往前一步，就是试图把整个研究循环自动化的系统。

FutureHouse 在 2025 年展示的 Robin 是一个多 Agent 系统，它把文献 Agent 和数据分析 Agent 串起来，目标是干性年龄相关性黄斑变性（干性 AMD）的治疗。它先从文献里提出机制假设和候选药物，人类在实验室做完实验后，它再分析实验数据、提出下一轮假设。最后它提出了 ripasudil，一个已经在日本获批用于青光眼的 ROCK 抑制剂，作为干性 AMD 的候选药物，并通过后续的 RNA 测序分析提出了可能的作用机制。论文里几乎所有的假设、实验设计和数据分析都出自 Agent，人类负责的是动手做实验。

同一类工作还有很多：做 CRISPR 基因编辑实验设计的 CRISPR-GPT，设计基因扰动实验的 BioDiscoveryAgent，把两百多个生物医学工具整合进来做治疗推理的 TxAgent，以及在机器学习领域尝试从选题到写论文全流程自动化的 Sakana AI Scientist。它们的共同趋势是：**Agent 负责的环节越来越多，人越来越像一个审批者和实验执行者。**

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
<figcaption>图 3：科研 Agent 的典型组成。虚线表示通往物理世界的那条路，通常要经过人类审批。</figcaption>
</figure>

**工具**是最重的一部分。生物医学的工具链又长又杂，把它们包装成 Agent 好用的接口，本身就是一项大工程。Biomni 和 TxAgent 背后的 ToolUniverse 都在做这件事，越来越多的生物数据库和软件也开始提供 MCP 接口。[工具](/posts/agent-tools/) 那篇里说的原则在这里同样成立，甚至更重要：返回值要精简，错误信息要可操作，ID 体系要说清楚，否则模型会在"Ensembl ID 和基因符号怎么对应"这种事上反复绊倒。

**代码执行和沙箱**几乎是必需的。真实的生信分析没法只靠调用几个固定函数完成，Agent 需要写代码来清洗数据、串联工具、画图、做统计。这就需要一个隔离的、预装好常用软件的执行环境。生信环境的特别之处在于它很"重"：动辄几十 GB 的参考基因组和索引，需要 GPU 的结构预测，跑几个小时的比对任务。[沙箱](/posts/agent-sandbox/) 不仅要安全，还要能挂载大文件、支持长任务。

**上下文管理**面对的是另一种规模的数据。一个 FASTQ 文件可能有几千万条测序读段，一个单细胞表达矩阵有几万个基因乘以几十万个细胞，这些东西不可能也不应该放进模型的上下文。Agent 必须学会"通过代码看数据"：把数据留在文件系统里，只把统计摘要、图表和关键结果读回来，和 [上下文管理](/posts/agent-context-management/) 里讲的"让数据留在外面"是一回事。

**记忆和研究记录**在科研场景里格外重要。一个研究项目可能持续几个月，跨越很多次会话。哪些假设试过了、结果是什么、哪些路走不通，这些都需要被记下来。科研里有一个特别容易丢的东西叫**负面结果**：失败的实验通常不会发表，但对下一步决策至关重要。一个好的科研 Agent 应该像一个认真的研究生一样记实验记录，参见 [记忆](/posts/agent-memory/) 那篇。

**多 Agent** 在这个领域用得比在编程领域更多，原因是科研天然需要"多个视角"和"互相质疑"。AI co-scientist 的锦标赛、Virtual Lab 的批评者，本质上都是在用一个 Agent 去检查另一个 Agent 的推理，弥补单个模型容易一条路走到黑的问题。

**人在回路**是最后、也是最关键的一个部件。几乎所有走到湿实验验证的系统，都有人在某个环节把关：选哪些假设去验证，实验方案是否安全可行，结果是否可信。这不只是因为技术还不够成熟，也是因为实验的成本和风险决定了，"执行"这一步不能完全交给模型。

## 真正难的地方

演示视频里的科研 Agent 都很惊艳，但真正用起来，会遇到一批在通用 Agent 里不那么突出、在科学研究里却很致命的问题。

### 幻觉在科学里更危险

大模型编造一个不存在的函数名，代码一跑就报错；但它编造一篇不存在的论文、一个错误的基因功能、一条不存在的通路联系，往往没有任何东西会立即报错。更糟的是，这些错误读起来和正确的结论一样专业。

缓解的办法是 **让每一个事实性的论断都有出处**。像 FutureHouse 的 PaperQA 系列那样，回答必须基于检索到的原文段落，并附上引用；数据库查询的结果原样保存，不让模型"凭记忆"填空。原则是：模型负责推理，事实来自工具。

### 验证是真正的瓶颈

Agent 可以在一个小时里提出一百个假设，但验证一个假设的湿实验可能要几个月。于是瓶颈从"想出好点子"转移到了"判断哪些点子值得验证"。

一个自然的想法是用计算指标代替实验，比如用对接打分代替结合实验，用预测的毒性代替毒理测试。这在早期筛选时很有用，但要小心：**Agent 会优化你给它的任何指标**，包括指标的漏洞。一个分子可能对接分数极高，但根本无法合成，或者在体内完全没有活性。这和强化学习里的"奖励投机"是同一个问题。计算指标只能是过滤器，不能是终点。

### "新发现"可能并不新

当 Agent 宣布"发现"了什么的时候，第一个要问的问题是：这是真正的新东西，还是它在训练数据里见过？大模型读过海量文献，它提出的"新"假设，很可能只是某篇论文的复述。反过来，评测时也要小心答案泄露：用来测试的"已知发现"如果已经发表，模型可能只是在回忆，而不是在推理。

AI co-scientist 那个耐药机制的例子之所以引人注目，正是因为对应的研究在当时还没有发表。但即便如此，相关的前期工作是公开的，"独立推出"和"从已有线索拼出"之间的界限也并不总是清楚。这类问题需要领域专家逐条去判断。

### 统计和可复现性

给一个 Agent 一份数据和一个目标，让它"找出显著的结果"，它很可能会尝试十几种分析方法、几十种参数组合，直到某个 p 值小于 0.05。这在人类研究者身上叫 p-hacking，在 Agent 身上只会更快、更隐蔽。

应对办法是把分析计划和执行过程都留下来：Agent 尝试过的所有分析，不只是"成功"的那个，都应该保存在可复现的脚本或笔记本里；多重检验要做校正；关键结论最好用一份独立的数据再验证一次。说到底，Agent 的每一次分析都应该像一篇论文的方法部分那样，能被别人复现。

### 评测比一般 Agent 更难

[评测](/posts/agent-evaluation/) 那篇说过，Agent 评测要评结果、要跑多次、要读轨迹。在科研场景里，这些原则都还成立，但有一个额外的麻烦：**真正的目标，也就是做出新发现，几乎无法直接评测。**

现有的做法大多是退而求其次。LAB-Bench 测文献检索、序列操作、实验方案理解这些研究中的具体技能；BixBench 测 Agent 能否完成真实的生物信息学分析任务；ScienceAgentBench 测能否根据论文复现数据分析。这些基准都有用，但它们测的是"研究助理"的能力，而不是"科学家"的能力。至于后者，目前最可信的评测仍然是湿实验，加上领域专家的判断。

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

## 小结

1. **AI 参与生命科学有三层**：专用模型解决具体问题，大模型助手回答问题，Agent 把它们串起来做一段研究；Agent 不是替代 AlphaFold，而是把它当工具用；
2. **科学方法本身就是一个循环**，和 Agent 循环形状相同，最大的区别是"执行实验"这一步又慢又贵；
3. **生物信息学特别适合 Agent**：工具碎、数据库多、文献读不完、很多中间结果能用代码验证；
4. **在药物发现里，Agent 目前最活跃的是靶点发现、老药新用和计算设计**，越往临床走，越是人主导、Agent 辅助；
5. **代表性系统展示了不同的设计**：ChemCrow 的工具增强，Coscientist 的实验室接口，AI co-scientist 的假设锦标赛，Virtual Lab 的角色分工，Biomni 的通用环境，Robin 的端到端流程；
6. **科研 Agent 的部件和通用 Agent 一样**，但每个部件都更重：工具链更长，环境更大，数据不能进上下文，记录要包括负面结果；
7. **真正的难点在科学本身**：幻觉更危险，验证是瓶颈，计算指标会被投机，"新发现"可能不新，统计容易被滥用，评测离真正的目标很远，生物安全必须在 Harness 层面设防。

AlphaFold 告诉我们，模型可以在一个定义清楚的问题上超过人类。科研 Agent 想回答的是一个更难的问题：在一个定义不清楚的问题上，模型能不能像科学家一样，知道该问什么、该做什么、什么时候该怀疑自己。现在的答案是"在人的看护下，部分可以"。这个"部分"正在变大，但"看护"这两个字，短期内大概还拿不掉。
