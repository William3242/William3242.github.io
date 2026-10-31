---
title: Agent 的规划与推理：想多少、写下来多少、交给谁来验证
description: 推理模型让"先想一想"变成了模型自带的能力，但 Agent 的规划问题并没有因此消失。这篇拆开讲推理和规划的区别，思维链和推理模型改变了什么，ReAct 和先计划后执行各自适合什么，为什么要把计划写下来，大模型到底会不会规划，搜索和反思什么时候有用，思考预算怎么给，以及模型说出来的推理过程能信多少。
pubDate: 2026-10-31
tags: [Agent, LLM, 推理]
---

在 [搭建 Agent 的基础知识](/posts/agent-basics/#规划与推理) 里，规划与推理只占了一个小节：边想边做、先计划后执行、待办清单、反思，再加一句"框架层面的规划越来越轻，更多的工作是给模型提供好的反馈信号"。

这句话我现在仍然同意，但它省略了很多东西。推理模型到底改变了什么，哪些规划逻辑可以交给模型、哪些还得写在 Harness 里；计划应该放在模型的思考里，还是写进一个文件；让模型"再检查一遍"为什么常常没用；思考预算给多少合适；模型写出来的推理过程，能不能当作它真实的决策依据。这篇就专门讲这些。

## 先分清：推理和规划不是一回事

这两个词经常连在一起说，但它们回答的是不同的问题。

**推理**是从已知推出结论。读完一段报错日志，判断问题出在连接池配置上；看完三份调研结果，发现其中两份互相矛盾。推理的产物是一个判断。

**规划**是决定一串动作，让世界从现在的状态走到目标状态。先复现问题，再定位代码，再改，再跑测试。规划的产物是一个动作序列，而且每个动作都会改变后面的局面。

Agent 两样都需要，而且它们的难点不一样。推理出错，通常是"想错了"；规划出错，往往是"想对了每一步，但顺序错了、漏了前置条件、或者走到一半忘了目标"。

更有用的一个视角是看它们**发生在哪里**。同样是"规划"，可以发生在三个地方：

<figure class="diagram">
<svg viewBox="0 0 640 250" role="img" aria-label="规划与推理可以发生在三个层次：模型内部的思考、上下文里的显式计划、Harness 里的控制流">
<defs><marker id="pr1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0 0 L10 5 L0 10 z"/></marker></defs>
<rect class="c-purple" x="20" y="20" width="440" height="60" rx="6"/>
<text class="t" x="40" y="45">模型内部：思考</text>
<text class="ts" x="40" y="66">思维链 · 推理模型的思考 token · 通常用完即弃</text>
<rect class="c-blue" x="20" y="95" width="440" height="60" rx="6"/>
<text class="t" x="40" y="120">上下文里：显式计划</text>
<text class="ts" x="40" y="141">待办清单 · 计划文件 · 每一步都看得见、改得了</text>
<rect class="c-green" x="20" y="170" width="440" height="60" rx="6"/>
<text class="t" x="40" y="195">Harness 里：控制流</text>
<text class="ts" x="40" y="216">固定工作流 · 搜索与验证器 · 预算和停止条件</text>
<path class="ln" d="M500 32 V218" marker-start="url(#pr1)" marker-end="url(#pr1)"/>
<text class="ts" x="516" y="44">更灵活</text>
<text class="ts" x="516" y="62">但看不见、不可控</text>
<text class="ts" x="516" y="196">更可控、可验证</text>
<text class="ts" x="516" y="214">但更死板</text>
</svg>
<figcaption>图 1：同样叫"规划"，可以放在模型的思考里、上下文里，或者 Harness 的代码里。设计一个 Agent，很大程度上是在决定每件事放在哪一层。</figcaption>
</figure>

这张图是这篇的主线。后面讲的每一种做法，都可以看成是在这三层之间挪东西：推理模型把很多规划逻辑从 Harness 挪进了模型内部；待办清单把计划从模型内部挪到了上下文里；验证器和搜索又把"判断对不对"从模型挪回了 Harness。

## 从思维链到推理模型

先回顾一下推理这条线是怎么走过来的。

2022 年的 [思维链（Chain-of-Thought）](https://arxiv.org/abs/2201.11903)<sup class="cite" id="cite-1"><a href="#ref-1" title="Chain-of-Thought">1</a></sup> 论文发现，在少样本示例里写出中间推理步骤，大模型在数学和常识推理题上的表现会明显变好。同一年，[Kojima 等人](https://arxiv.org/abs/2205.11916)<sup class="cite" id="cite-2"><a href="#ref-2" title="Zero-Shot Reasoners">2</a></sup> 发现连示例都不用，只要在问题后面加一句"Let's think step by step"，就有类似的效果。[Self-Consistency](https://arxiv.org/abs/2203.11171)<sup class="cite" id="cite-3"><a href="#ref-3" title="Self-Consistency">3</a></sup> 又往前走了一步：同一个问题采样多条推理路径，取最多的那个答案，比只走一条路更可靠。

这些都是提示词层面的技巧，模型本身没变。2024 年 9 月 OpenAI 发布 [o1](https://openai.com/index/learning-to-reason-with-llms/)<sup class="cite" id="cite-4"><a href="#ref-4" title="Learning to reason with LLMs">4</a></sup>，事情变了性质：模型通过强化学习被训练成在回答之前先进行很长的思考，而且思考得越久，效果越好。2025 年的 [DeepSeek-R1](https://www.nature.com/nature-index/article/10.1038/s41586-025-09422-z)<sup class="cite" id="cite-5"><a href="#ref-5" title="DeepSeek-R1">5</a></sup> 公开了一条类似的路线，并展示了在只用结果正确与否作为奖励的强化学习下，反思、验证、换一种方法再试这些行为会自己冒出来。

与此同时，[Snell 等人](https://arxiv.org/abs/2408.03314)<sup class="cite" id="cite-6"><a href="#ref-6" title="Scaling test-time compute">6</a></sup> 系统地研究了"推理时多花算力"这件事，结论是：如果分配得当，在推理时多花算力，有时比换一个大得多的模型更划算，但收益很依赖题目的难度。

对 Agent 开发者来说，这一连串变化带来了几个很实际的影响：

- **"请一步一步思考"这类提示词基本可以删了**。推理模型自己会想，额外的思维链提示往往只是多花 token；
- **思考可以发生在工具调用之间**。较新的模型支持在两次工具调用之间继续思考（常叫 interleaved thinking），而不是只在最开始想一次。对 Agent 来说这很关键，因为最需要想的时候，往往是刚拿到一个出乎意料的工具结果的时候；
- **很多过去写在框架里的规划逻辑，可以交给模型**。拆解任务、决定下一步、发现走错了要回头，这些现在模型自己就能做得不错。

关于第二点，有一个很能说明问题的小例子。Anthropic 在 2025 年初介绍过一个 [think 工具](https://www.anthropic.com/engineering/claude-think-tool)<sup class="cite" id="cite-7"><a href="#ref-7" title="The think tool">7</a></sup>：它什么也不做，只是给模型一个"停下来想一想"的位置，参数就是一段想法。在规则繁多的客服类任务上，这个什么也不做的工具带来了相当明显的提升。到 2025 年底，这篇文章加了一段更新：随着模型的扩展思考能力变强，现在多数情况下更推荐直接用扩展思考，而不是单独的 think 工具。

这个过程本身就是图 1 的一个缩影：**一个规划上的需求，先是在 Harness 里用工具实现，然后被模型能力吸收了。**

## 边想边做：ReAct 仍然是骨架

推理模型解决的是"每一步想得好不好"。Agent 还需要回答"一步一步怎么串起来"。

最基本的串法仍然是 [ReAct](https://arxiv.org/abs/2210.03629)<sup class="cite" id="cite-8"><a href="#ref-8" title="ReAct">8</a></sup>：思考、行动、观察，再思考。今天的工具调用 API 其实就是 ReAct 的基础设施化，基础那篇里的 [最小 Agent 循环](/posts/agent-basics/#最小的-agent-循环) 就是它。

ReAct 好用的原因是**每一步都有来自环境的反馈**。模型不需要一次想清楚整个过程，只需要根据当前看到的东西决定下一步。这和人调试代码的方式很像：没人在动手之前就把所有步骤列好，都是跑一下、看一眼、再决定。

但它有几个固定的失败模式，跑过长任务的人应该都见过：

- **短视**。每一步都是局部最优，合起来却绕了远路。比如为了修一个测试，连续改了五个文件，最后发现根本原因在第一个文件里；
- **兜圈子**。搜一个关键词没找到，换个说法再搜，再换，十几轮之后还在原地；
- **忘了目标**。任务做到第四十步，上下文里塞满了中间结果，最初的要求被挤到了很远的地方，模型开始"完成"一个和原来不太一样的任务；
- **过早收工**。看到一个看起来像答案的东西就停了，没有确认它是否真的满足了全部要求。

后面几节讲的做法，基本都是在针对这几个问题。

## 先计划后执行

对付短视和忘记目标，最直接的办法是先想好整体再动手。

[Plan-and-Solve](https://arxiv.org/abs/2305.04091)<sup class="cite" id="cite-9"><a href="#ref-9" title="Plan-and-Solve">9</a></sup> 在单次推理里验证了这个思路：先让模型把问题拆成子任务、制定计划，再按计划逐步求解，比直接"一步一步想"漏掉的步骤更少。在 Agent 里，它对应的是先计划后执行（Plan-and-Execute）：先产出一份步骤清单，再一步一步执行，执行过程中发现偏离就回头修改计划。

<figure class="diagram">
<svg viewBox="0 0 640 300" role="img" aria-label="对比边想边做的 ReAct 循环与先计划后执行、偏离时重新规划的流程">
<defs><marker id="pr2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0 0 L10 5 L0 10 z"/></marker></defs>
<rect class="frame" x="12" y="16" width="290" height="270" rx="10"/>
<text class="t" x="157" y="42" text-anchor="middle">边想边做（ReAct）</text>
<rect class="c-purple" x="97" y="64" width="120" height="38" rx="6"/><text class="t" x="157" y="88" text-anchor="middle">思考</text>
<rect class="c-blue" x="30" y="170" width="110" height="38" rx="6"/><text class="t" x="85" y="194" text-anchor="middle">行动</text>
<rect class="c-amber" x="175" y="170" width="110" height="38" rx="6"/><text class="t" x="230" y="194" text-anchor="middle">观察</text>
<path class="ln" d="M130 104 L96 166" marker-end="url(#pr2)"/>
<path class="ln" d="M142 189 H171" marker-end="url(#pr2)"/>
<path class="ln" d="M220 168 L186 106" marker-end="url(#pr2)"/>
<text class="ts" x="157" y="240" text-anchor="middle">每一步只看当前的观察</text>
<text class="ts" x="157" y="260" text-anchor="middle">灵活，但容易短视、兜圈子</text>
<rect class="frame" x="330" y="16" width="298" height="270" rx="10"/>
<text class="t" x="479" y="42" text-anchor="middle">先计划后执行</text>
<rect class="c-purple" x="350" y="60" width="120" height="38" rx="6"/><text class="t" x="410" y="84" text-anchor="middle">制定计划</text>
<rect class="c-blue" x="350" y="130" width="120" height="38" rx="6"/><text class="t" x="410" y="154" text-anchor="middle">执行下一步</text>
<rect class="c-amber" x="350" y="200" width="120" height="38" rx="6"/><text class="t" x="410" y="224" text-anchor="middle">观察结果</text>
<rect class="c-gray" x="500" y="200" width="110" height="38" rx="6"/><text class="t" x="555" y="224" text-anchor="middle">偏离计划？</text>
<path class="ln" d="M410 100 V126" marker-end="url(#pr2)"/>
<path class="ln" d="M410 170 V196" marker-end="url(#pr2)"/>
<path class="ln" d="M472 219 H496" marker-end="url(#pr2)"/>
<path class="ln" d="M540 198 V149 H474" marker-end="url(#pr2)"/>
<path class="ln" d="M590 198 V79 H474" marker-end="url(#pr2)"/>
<text class="ts" x="534" y="178" text-anchor="end">否</text>
<text class="ts" x="598" y="140">是</text>
<text class="ts" x="545" y="72" text-anchor="middle">重新规划</text>
<text class="ts" x="479" y="262" text-anchor="middle">有全局视角，计划本身可以被检查</text>
</svg>
<figcaption>图 2：ReAct 每一步只看眼前；先计划后执行多了一份可以被检查和修改的计划，以及一条"偏离了就回去重新规划"的路径。</figcaption>
</figure>

两种方式不是二选一。实际的 Agent 几乎都是混合的：有一份粗粒度的计划，每一步的具体做法仍然是边想边做。区别在于计划的粒度和它的约束力。

| | 边想边做 | 先计划后执行 |
| --- | --- | --- |
| 适合 | 探索性任务、环境反馈丰富、下一步取决于上一步的结果 | 步骤多、有明确的完成标准、需要中途向人汇报进度 |
| 典型场景 | 调试、调研、读一个陌生代码库 | 迁移、批量修改、多文件的功能开发 |
| 主要风险 | 短视、兜圈子、忘了目标 | 计划本身错了还照着执行；环境变了计划没跟上 |
| 关键设计 | 好的工具反馈、轮数预算 | 允许并鼓励重新规划，计划要能被检查 |

表里最后一行的"主要风险"值得多说一句。先计划后执行最危险的地方，不是计划写得粗，而是**模型对自己写下的计划过于忠诚**。计划是在信息最少的时候写的，执行到第三步发现前提不成立，正确的做法是回去改计划，而不是硬着头皮往下走。所以在系统提示词里，我会明确写上类似"计划是可以修改的，发现前提不成立时，先更新计划再继续"这样的话。

还有一种很实用的做法是**让人审计划**。在动手修改任何东西之前，Agent 先把计划交给用户确认。很多编程 Agent 都有这样一种"只计划、不执行"的模式。它的价值不只是防止 Agent 做错事，更在于计划是用户最容易给出有效反馈的时机：看一份五行的计划，比看一份五百行的 diff 容易得多。

## 把计划写下来：待办清单与计划文件

基础那篇里说过，待办清单这个朴素的做法在长任务里效果出奇地好。现在可以说得更具体一点：它好用，是因为**它把计划从模型的思考里，挪到了上下文里**，也就是从图 1 的第一层挪到了第二层。

<figure class="diagram">
<svg viewBox="0 0 640 240" role="img" aria-label="Agent 循环读写一份计划文件，计划在压缩后依然保留，用户也能看到进度">
<defs><marker id="pr3" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0 0 L10 5 L0 10 z"/></marker></defs>
<rect class="c-blue" x="20" y="70" width="150" height="90" rx="8"/>
<text class="t" x="95" y="110" text-anchor="middle">Agent 循环</text>
<text class="ts" x="95" y="132" text-anchor="middle">思考 · 调用工具</text>
<path class="ln" d="M172 98 H236" marker-end="url(#pr3)"/>
<text class="ts" x="204" y="90" text-anchor="middle">更新状态</text>
<path class="ln" d="M236 138 H172" marker-end="url(#pr3)"/>
<text class="ts" x="204" y="156" text-anchor="middle">每轮读回</text>
<rect class="c-gray" x="240" y="24" width="220" height="190" rx="6"/>
<text class="t" x="258" y="50">plan.md</text>
<text class="ts" x="258" y="80">[x] 复现重复扣款</text>
<text class="ts" x="258" y="104">[x] 定位重试和回调逻辑</text>
<text class="t" x="258" y="128">[&gt;] 给回调加幂等检查</text>
<text class="ts" x="258" y="152">[ ] 补一个超时重试的测试</text>
<text class="ts" x="258" y="176">[ ] 跑完整测试</text>
<text class="ts" x="258" y="200">备注：网关侧已排除</text>
<rect class="c-green" x="500" y="36" width="124" height="60" rx="6"/>
<text class="t" x="562" y="62" text-anchor="middle">压缩之后</text><text class="ts" x="562" y="82" text-anchor="middle">计划还在</text>
<rect class="c-amber" x="500" y="136" width="124" height="60" rx="6"/>
<text class="t" x="562" y="162" text-anchor="middle">用户随时</text><text class="ts" x="562" y="182" text-anchor="middle">看得到进度</text>
<path class="ln dash" d="M462 80 H498" marker-end="url(#pr3)"/>
<path class="ln dash" d="M462 166 H498" marker-end="url(#pr3)"/>
</svg>
<figcaption>图 3：计划写在模型的思考里，下一轮就可能看不见；写进上下文或文件，它就成了 Agent、用户和下一次会话都能读到的状态。</figcaption>
</figure>

写下来之后，几件事会变得不一样：

- **它会被反复看到**。每一轮的上下文里都有这份清单，目标不会被中间结果挤走。这直接针对的是 ReAct 的"忘了目标"；
- **它能活过压缩**。上下文被 [压缩](/posts/agent-context-management/#手段三压缩compaction) 的时候，中间过程会被总结掉，但一份写在文件里的计划不受影响。这和 [结构化笔记](/posts/agent-context-management/#手段四外部记忆与结构化笔记) 是同一个思路；
- **它能被检查**。"还有两项没做"是一个可以用代码判断的事实。Harness 可以在模型想要结束时检查清单，如果还有未完成的项，就提醒它，而不是让它带着半成品收工。这直接针对"过早收工"；
- **它是给人看的进度条**。长任务里，用户最想知道的就是"做到哪了"。一份实时更新的清单，比任何总结都直观；
- **它能交接**。会话结束了，下一个会话、或者一个 [子 Agent](/posts/agent-subagents/)，读这份文件就知道从哪里接着做。

关于格式，我的经验是越简单越好。每一项一行，状态只有"未开始、进行中、已完成"三种，同一时间只有一项在进行中。再加一个备注区，记已经排除的方向和重要的发现。不要把它变成一份详细的设计文档，那样模型会花大量精力维护它，而不是做事。

还有一个细节：**清单的粒度要和验证的粒度对齐**。"实现登录功能"太粗，做到一半很难说清楚完成了没有；"给 `/login` 加上限流，并让 `test_login_rate_limit` 通过"就好得多，因为它的完成与否可以被一个具体的检查确认。

## 大模型到底会不会规划

讲到这里，有一个问题绕不过去：大模型的规划能力到底有多可靠？

答案取决于你怎么问。学术界有一批相当冷静的研究。[PlanBench](https://arxiv.org/abs/2206.10498)<sup class="cite" id="cite-10"><a href="#ref-10" title="PlanBench">10</a></sup> 用经典规划问题（比如积木世界）测试大模型，发现它们在这类需要严格满足前置条件的问题上表现很差；更说明问题的是，如果把积木、桌子这些名字换成无意义的符号，问题结构完全不变，模型的表现会进一步大幅下降。这说明它很大程度上依赖的是对常见情形的熟悉，而不是对问题结构的推理。

Kambhampati 等人在 [LLM-Modulo](https://arxiv.org/abs/2402.01817)<sup class="cite" id="cite-11"><a href="#ref-11" title="LLM-Modulo">11</a></sup> 这篇立场论文里把话说得更直接：大模型自己不能可靠地规划，也不能可靠地验证自己的计划；但它很擅长**生成候选计划**，以及把自然语言的需求翻译成形式化的描述。所以合理的架构是让大模型负责生成，让外部的验证器负责判断，两者循环。[LLM+P](https://arxiv.org/abs/2304.11477)<sup class="cite" id="cite-12"><a href="#ref-12" title="LLM+P">12</a></sup> 走得更远：让大模型把问题翻译成规划语言 PDDL，交给经典规划器求解，再把结果翻译回来。

这些研究里的模型和今天的推理模型已经隔了几代，具体数字早就过时了。但我觉得它们的结论在结构上仍然成立：**生成计划很便宜，判断计划对不对才是可靠性的来源。** 这件事在 Agent 里有一个非常朴素的版本：测试、编译器、类型检查、数据校验，都是验证器。Agent 在编程任务上进步最快，很大程度上是因为编程是验证器最丰富的领域。

另一个角度是看任务的长度。METR 的 [一项研究](https://arxiv.org/abs/2503.14499)<sup class="cite" id="cite-13"><a href="#ref-13" title="Measuring AI Ability to Complete Long Tasks">13</a></sup> 用"人类专家需要多久完成"来衡量任务长度，发现前沿模型能以 50% 成功率完成的任务长度，从 2019 年以来大约每 7 个月翻一倍。换句话说，模型能撑住的规划长度在稳定地变长，但在任何一个时间点，越长的任务成功率越低。这和图 1 的思路是一致的：**任务越长，越需要把计划和检查从模型内部挪出来。**

## 搜索：多想几条路

到目前为止，Agent 都是沿着一条路往前走。另一类做法是同时探索好几条路，再从中挑。

<figure class="diagram">
<svg viewBox="0 0 640 250" role="img" aria-label="三种搜索方式：多次采样投票、生成多个候选由验证器挑选、树搜索边走边评估">
<rect class="frame" x="8" y="8" width="204" height="234" rx="8"/>
<text class="t" x="110" y="30" text-anchor="middle">多次采样，投票</text>
<circle class="c-blue" cx="110" cy="60" r="9"/>
<path class="ln" d="M106 68 L40 136"/><path class="ln" d="M108 69 L85 136"/><path class="ln" d="M112 69 L135 136"/><path class="ln" d="M114 68 L180 136"/>
<rect class="c-gray" x="24" y="138" width="32" height="26" rx="4"/><text class="ts" x="40" y="156" text-anchor="middle">A</text>
<rect class="c-gray" x="69" y="138" width="32" height="26" rx="4"/><text class="ts" x="85" y="156" text-anchor="middle">A</text>
<rect class="c-gray" x="119" y="138" width="32" height="26" rx="4"/><text class="ts" x="135" y="156" text-anchor="middle">B</text>
<rect class="c-gray" x="164" y="138" width="32" height="26" rx="4"/><text class="ts" x="180" y="156" text-anchor="middle">A</text>
<rect class="c-green" x="40" y="190" width="140" height="32" rx="4"/><text class="ts" x="110" y="211" text-anchor="middle">取多数：A</text>
<rect class="frame" x="218" y="8" width="204" height="234" rx="8"/>
<text class="t" x="320" y="30" text-anchor="middle">生成 N 个，验证器挑</text>
<circle class="c-blue" cx="320" cy="60" r="9"/>
<path class="ln" d="M316 68 L250 136"/><path class="ln" d="M318 69 L295 136"/><path class="ln" d="M322 69 L345 136"/><path class="ln" d="M324 68 L390 136"/>
<rect class="c-gray" x="234" y="138" width="32" height="26" rx="4"/><text class="ts" x="250" y="156" text-anchor="middle">1</text>
<rect class="c-gray" x="279" y="138" width="32" height="26" rx="4"/><text class="ts" x="295" y="156" text-anchor="middle">2</text>
<rect class="c-green" x="329" y="138" width="32" height="26" rx="4"/><text class="ts" x="345" y="156" text-anchor="middle">3</text>
<rect class="c-gray" x="374" y="138" width="32" height="26" rx="4"/><text class="ts" x="390" y="156" text-anchor="middle">4</text>
<path class="ln dash" d="M250 166 L300 188"/><path class="ln dash" d="M295 166 L312 188"/><path class="ln dash" d="M345 166 L328 188"/><path class="ln dash" d="M390 166 L340 188"/>
<rect class="c-purple" x="250" y="190" width="140" height="32" rx="4"/><text class="ts" x="320" y="211" text-anchor="middle">验证器：测试 / 打分</text>
<rect class="frame" x="428" y="8" width="204" height="234" rx="8"/>
<text class="t" x="530" y="30" text-anchor="middle">树搜索，边走边评估</text>
<circle class="c-blue" cx="530" cy="60" r="9"/>
<path class="ln" d="M524 67 L490 100"/><path class="ln" d="M536 67 L570 100"/>
<circle class="c-gray" cx="486" cy="108" r="9"/>
<circle class="c-red" cx="574" cy="108" r="9"/>
<text class="ts" x="592" y="112">剪枝</text>
<path class="ln" d="M481 116 L462 150"/><path class="ln" d="M491 116 L510 150"/>
<path class="ln dash" d="M569 116 L552 150"/><path class="ln dash" d="M579 116 L598 150"/>
<circle class="c-gray" cx="460" cy="158" r="9"/>
<circle class="c-green" cx="512" cy="158" r="9"/>
<circle class="c-gray dash" cx="550" cy="158" r="9"/>
<circle class="c-gray dash" cx="600" cy="158" r="9"/>
<text class="ts" x="530" y="200" text-anchor="middle">每一步打分</text>
<text class="ts" x="530" y="220" text-anchor="middle">差的分支提前放弃</text>
</svg>
<figcaption>图 4：三种常见的搜索。它们共同的前提是：有一个比"随便挑一个"更好的选择办法，要么是多数票，要么是验证器，要么是每一步的评估。</figcaption>
</figure>

从简单到复杂，大致是这三种：

- **多次采样，投票**。就是前面提到的 Self-Consistency<sup class="cite"><a href="#ref-3" title="Self-Consistency">3</a></sup>，适合答案是一个可比较的值的场景；
- **生成多个候选，由验证器挑**（Best-of-N）。写五个补丁，哪个通过测试用哪个。验证器越可靠，这个方法越有效；
- **树搜索**。[Tree of Thoughts](https://arxiv.org/abs/2305.10601)<sup class="cite" id="cite-14"><a href="#ref-14" title="Tree of Thoughts">14</a></sup> 让模型在每一步生成几个候选思路、评估它们，再决定沿哪条走下去，走不通可以回溯。给中间步骤打分的思路，在 [Let's Verify Step by Step](https://arxiv.org/abs/2305.20050)<sup class="cite" id="cite-15"><a href="#ref-15" title="Let's Verify Step by Step">15</a></sup> 里有一个更正式的版本：训练一个过程奖励模型，逐步判断推理是否正确，用它来挑选解答，比只看最终答案的效果更好。

这些方法在数学题和代码生成上很有效，但搬到 Agent 里有两个现实的障碍。

第一个是**成本**。每多一条分支，就多一整段 Agent 轨迹的 token 和时间。对一个本来就要跑几十轮的任务，开五条分支就是五倍的账单。

第二个、也是更根本的，是**真实世界不能分叉**。数学题可以想五种解法；但 Agent 发出去的邮件、删掉的文件、改掉的线上配置，没法"在另一条分支上撤回"。搜索只在**动作可以撤销**的地方才成立。所以在 Agent 里，搜索通常出现在两个位置：一是在纯思考的阶段，比如比较几种修复方案；二是在 [沙箱](/posts/agent-sandbox/) 里，每条分支在一个隔离的副本里执行，最后只把通过验证的那一条应用到真实环境。

我的经验是，大多数 Agent 不需要显式的树搜索。推理模型已经在思考内部做了一部分"想几条路再选"的工作。真正值得在 Harness 层面做搜索的，是那些**验证器便宜且可靠、单次成功率不高、而结果价值很高**的任务，比如生成几个候选补丁，用测试来挑。

## 反思与自我纠错：外部信号才是关键

搜索是"多试几次"，反思是"试完了回头看一看"。

[Reflexion](https://arxiv.org/abs/2303.11366)<sup class="cite" id="cite-16"><a href="#ref-16" title="Reflexion">16</a></sup> 是这方面的代表工作：Agent 失败之后，用自然语言写下一段反思，"上次失败是因为没有检查边界条件"，下一次尝试时把这段反思放进上下文。在编程等任务上，这个做法带来了明显的提升。

但另一篇论文给这件事泼了一盆冷水。[Huang 等人](https://arxiv.org/abs/2310.01798)<sup class="cite" id="cite-17"><a href="#ref-17" title="Cannot Self-Correct Reasoning Yet">17</a></sup> 发现，**在没有任何外部反馈的情况下**，让模型检查并修改自己的推理，效果往往不会变好，有时还会变差：它会把原本正确的答案改错。之前很多"自我纠错"的正面结果，仔细看都悄悄用到了外部信息，比如知道正确答案，或者知道什么时候该停。

这两个结果放在一起看，结论很清楚：

<figure class="diagram">
<svg viewBox="0 0 640 240" role="img" aria-label="有外部信号的反思循环与没有外部信号的自我检查对比">
<defs><marker id="pr5" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0 0 L10 5 L0 10 z"/></marker></defs>
<text class="ts" x="20" y="26">有外部信号</text>
<rect class="c-blue" x="20" y="36" width="130" height="56" rx="6"/><text class="t" x="85" y="69" text-anchor="middle">生成方案</text>
<rect class="c-green" x="250" y="36" width="150" height="56" rx="6"/><text class="t" x="325" y="59" text-anchor="middle">外部检查</text><text class="ts" x="325" y="79" text-anchor="middle">测试 · 编译 · 校验器</text>
<rect class="c-blue" x="490" y="36" width="130" height="56" rx="6"/><text class="t" x="555" y="69" text-anchor="middle">根据反馈修改</text>
<path class="ln" d="M152 64 H246" marker-end="url(#pr5)"/>
<path class="ln" d="M402 64 H486" marker-end="url(#pr5)"/>
<text class="ts" x="444" y="56" text-anchor="middle">具体的错误</text>
<path class="ln" d="M555 94 V122 H325 V96" marker-end="url(#pr5)"/>
<text class="ts" x="440" y="138" text-anchor="middle">再检查，直到通过或用尽预算</text>
<text class="ts" x="20" y="168">没有外部信号</text>
<rect class="c-gray dash" x="20" y="178" width="130" height="44" rx="6"/><text class="t" x="85" y="205" text-anchor="middle">生成方案</text>
<rect class="c-gray dash" x="250" y="178" width="150" height="44" rx="6"/><text class="t" x="325" y="205" text-anchor="middle">模型自己再看一遍</text>
<rect class="c-red" x="490" y="178" width="130" height="44" rx="6"/><text class="ts" x="555" y="205" text-anchor="middle">可能把对的改错</text>
<path class="ln dash" d="M152 200 H246" marker-end="url(#pr5)"/>
<path class="ln dash" d="M402 200 H486" marker-end="url(#pr5)"/>
</svg>
<figcaption>图 5：反思有没有用，主要取决于有没有带来新信息。测试失败的报错是新信息；"请再检查一遍"不是。</figcaption>
</figure>

**反思的价值来自它带进来的新信息，而不是"再想一遍"这个动作本身。** Reflexion 有效，是因为它的反思是基于一次真实失败的反馈写出来的；单纯让模型自我审视，没有给它任何它之前不知道的东西。

落到实践上，这意味着：

- **与其写"完成后请仔细检查你的工作"，不如给它一个能跑的检查**：运行测试、跑一遍类型检查、用脚本校验输出格式、截图看看页面是否真的渲染出来了；
- **错误信息要具体**。"测试失败"远不如"`test_refund` 断言失败：期望 100，实际 200"有用。这和 [工具报错](/posts/agent-tools/) 的设计原则是一样的；
- **没有现成的验证器时，换一个视角**。让一个没看过实现过程的 [子 Agent](/posts/agent-subagents/#什么时候值得拆出去) 去审查，比让同一个上下文"再看一遍"更容易发现问题，因为它没有被原来的思路锁住。这不完全等于外部信号，但至少引入了一点新的视角；
- **反思写下来，也要有作用域**。从一次失败里总结出的教训，如果要跨会话保留，就是 [记忆](/posts/agent-memory/) 的问题了，同样要小心别把一次偶然的失败总结成一条错误的规律。

## 思考预算：想多久合适

推理模型带来了一个新的旋钮：思考预算。大多数 API 都允许你设定模型最多能用多少 token 来思考，或者选择一个"努力程度"。

直觉上是想得越多越好，但实际上并非如此。[一项关于"过度思考"的研究](https://arxiv.org/abs/2412.21187)<sup class="cite" id="cite-18"><a href="#ref-18" title="Overthinking of o1-like LLMs">18</a></sup> 发现，o1 这类模型在"2 加 3 等于几"这种问题上也会花掉大量 token，反复验证一个早就得出的答案，而这些额外的思考几乎没有带来任何准确率上的收益。

<figure class="diagram">
<svg viewBox="0 0 640 260" role="img" aria-label="示意图：不同难度的任务，成功率随思考预算增加的变化形状不同">
<defs><marker id="pr6" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0 0 L10 5 L0 10 z"/></marker></defs>
<path class="ln" d="M60 220 H600" marker-end="url(#pr6)"/>
<path class="ln" d="M60 220 V24" marker-end="url(#pr6)"/>
<text class="ts" x="596" y="244" text-anchor="end">思考预算</text>
<text class="ts" x="68" y="22">成功率</text>
<path class="c-green" style="fill:none;stroke-width:2" d="M60 72 C 140 62, 240 60, 360 62 S 520 70, 590 76"/>
<path class="c-blue" style="fill:none;stroke-width:2" d="M60 176 C 140 120, 240 96, 360 90 S 520 88, 590 88"/>
<path class="c-amber" style="fill:none;stroke-width:2" d="M60 210 C 200 204, 320 170, 420 142 S 540 122, 590 118"/>
<text class="ts" x="470" y="56">简单任务：很快饱和</text>
<text class="ts" x="410" y="108">中等任务：前期收益大</text>
<text class="ts" x="300" y="200">难任务：需要更多预算才起效</text>
<text class="ts" x="600" y="212" text-anchor="end">（示意，非实测数据）</text>
</svg>
<figcaption>图 6：一个示意。思考预算的边际收益和任务难度强相关：简单任务很快饱和，多想只是浪费；难任务的收益来得晚，但来了之后很可观。</figcaption>
</figure>

在 Agent 里，思考预算的问题更复杂一些，因为它是**乘在轮数上的**。一个 Agent 跑五十轮，每轮多想一千个 token，就是多五万个 token，以及相应的延迟。所以与其给所有步骤一个统一的高预算，不如区分对待：

| 场景 | 建议 | 原因 |
| --- | --- | --- |
| 简单的读取、格式转换、按明确指令执行 | 低预算或不开思考 | 不需要推理，多想只增加延迟 |
| 任务开始时的拆解和规划 | 高预算 | 一次想清楚，后面几十轮都受益 |
| 刚拿到意外的工具结果、测试失败 | 中到高预算 | 最需要重新判断局面的时刻 |
| 不可逆操作之前 | 高预算，再加外部确认 | 想清楚的成本远低于做错的成本 |
| 大量重复的子任务（批处理、逐个文件检查） | 低预算，配合便宜的模型 | 成本会被重复次数放大 |

有些 Harness 会把这种区分做成机制：规划阶段用一个强模型、高预算；执行阶段用一个快模型、低预算；遇到失败时再升级回来。这和子 Agent 那篇里讲的"[用便宜的模型做阅读和搜索](/posts/agent-subagents/#专用子-agent把委派变成可复用的角色)"是一个思路。

还有一点：**思考预算不能代替轮数预算**。模型想得再多，也可能在环境里兜圈子。轮数、token、墙钟时间这些 [外部的刹车](/posts/agent-subagents/#预算深度和超时谁来叫停)，仍然要在 Harness 里设好。

## 模型说出来的推理，能信多少

最后一个问题，也是我觉得最容易被想当然的一个：模型写出来的思考过程，是不是它真正的决策依据？

答案是：**不完全是**。[Turpin 等人](https://arxiv.org/abs/2305.04388)<sup class="cite" id="cite-19"><a href="#ref-19" title="Unfaithful explanations in CoT">19</a></sup> 做过一个很巧妙的实验：在少样本示例里，让正确答案总是选项 A，模型就会倾向于选 A，哪怕这次 A 是错的；而它写出来的思维链会给出一套看起来很合理的理由来支持 A，完全不提"因为前面的例子都选 A"。

到了推理模型这一代，情况有所改善，但没有根本解决。Anthropic 的 [一项研究](https://arxiv.org/abs/2505.05410)<sup class="cite" id="cite-20"><a href="#ref-20" title="Reasoning Models Don't Always Say What They Think">20</a></sup> 在题目里悄悄放入提示（比如暗示答案），然后检查模型在用到这个提示时，有没有在思考过程中承认。结果是，承认的比例普遍偏低，在很多设置下不到五分之一；而且题目越难，越不容易承认。

这对 Agent 开发有几个直接的含义：

- **思考过程是很好的调试材料，但不是审计依据**。读思考过程能帮你理解模型大致在想什么，[读轨迹](/posts/agent-evaluation/#去读轨迹) 时它非常有用；但"它的思考里没有提到要删文件"不能证明它不会删文件；
- **监控思考过程有价值，但不能只靠它**。用另一个模型去扫描 Agent 的思考，发现"我打算绕过这个检查"之类的苗头，是一层有用的防护；但它能抓到的只是模型愿意说出来的那部分；
- **边界要放在模型之外**。这是这个系列反复出现的一句话，在这里有了一个新的理由：我们不能指望通过读模型的想法来确认它的意图。真正能依赖的，是 [权限](/posts/agent-tools/#权限不是所有工具都一样危险)、[沙箱](/posts/agent-sandbox/) 和 [不可逆操作前的确认](/posts/agent-sandbox/#三不可逆操作需要沙箱之外的确认)；
- **别对思考过程做太强的优化**。如果你根据思考过程里出现的内容来惩罚模型（比如在训练或者自动评分里），最可能的结果是它学会不在思考里写那些内容，而不是不那样做。

## 怎么知道规划和推理变好了

[评测](/posts/agent-evaluation/) 那篇讲的框架在这里同样适用，只是有几个值得单独看的指标：

- **完成率和轮数要一起看**。一个改动让成功率不变、但平均轮数从四十降到二十五，通常说明规划变好了；
- **重新规划的次数和时机**。从不重新规划，可能说明它对计划过于忠诚；频繁重新规划，可能说明最初的计划太粗或者太早；
- **清单完成度**。Agent 宣布完成时，它自己的待办清单上还有几项没勾？这是一个几乎零成本、却很能说明问题的信号；
- **无效步骤的比例**。重复的搜索、读了又没用上的文件、改了又改回来的代码。这些在 [轨迹](/posts/agent-evaluation/#去读轨迹) 里很容易看到，而且往往直接指向规划上的问题；
- **思考 token 的分布**。看看 token 花在了哪些步骤上。如果大量思考花在简单的读取上，而关键决策前只想了几句，预算就该调整。

另外，一定要在**换模型的时候**重新跑一遍。推理模型每一代的变化，常常会让一些过去必要的规划脚手架变得多余，甚至有害。过去为了弥补模型不足而写的"请先列计划再动手"，在新模型上可能只是让它多做了一次无用功。评测是判断哪些脚手架可以拆掉的唯一可靠办法。

## 动手时的几条建议

1. **先用推理模型和一个简单的循环**。看它在哪里失败，再决定加什么，不要预先搭一个复杂的规划框架；
2. **删掉"请一步一步思考"这类提示**，把篇幅留给目标、约束和完成标准；
3. **长任务一定要有显式的计划**，写在上下文或文件里，粒度和验证的粒度对齐；
4. **明确告诉模型计划是可以改的**，前提不成立时先更新计划再继续；
5. **有风险的任务，先让人审计划**，五行计划比五百行 diff 好审得多；
6. **反思要配外部信号**：测试、编译、校验器、截图。没有验证器时，换一个没看过过程的视角；
7. **搜索只在动作可撤销、验证器可靠的地方用**，真实环境里的分叉放进沙箱；
8. **思考预算按步骤区分**：规划和意外时多想，简单执行时少想，同时保留轮数和时间的外部刹车；
9. **把思考过程当作调试材料，而不是审计依据**，安全边界放在模型之外；
10. **每换一代模型，就重新评估一遍脚手架**，能删的就删。

## 小结

1. **推理是得出判断，规划是安排动作**。Agent 两样都要，规划的错误更多是顺序、前提和目标上的错误；
2. **规划可以放在三层**：模型内部的思考、上下文里的显式计划、Harness 里的控制流。设计 Agent 很大程度上是决定每件事放在哪一层；
3. **推理模型把很多规划逻辑吸收进了模型**，"一步一步想"的提示不再必要，工具调用之间的思考变得重要；
4. **ReAct 仍然是骨架**，它的短视、兜圈子、忘记目标和过早收工，是其他做法要解决的问题；
5. **先计划后执行带来全局视角**，但要允许并鼓励重新规划，有风险时让人先审计划；
6. **把计划写下来**，它会被反复看到、活过压缩、能被检查、能给人看、能交接；
7. **生成计划很便宜，验证计划才是可靠性的来源**，验证器越丰富的领域，Agent 进步越快；
8. **搜索需要可撤销的动作和可靠的选择办法**，在真实环境里，分叉要放进沙箱；
9. **反思的价值来自新信息**，没有外部反馈的自我检查，可能把对的改成错的；
10. **思考预算要按步骤分配**，过度思考是真实存在的浪费；
11. **模型说出来的推理不一定是它真实的依据**，所以边界要放在模型之外。

基础那篇说，框架层面的规划越来越轻。写完这篇，我会补充半句：**变轻的是"替模型想"的那部分，变重的是"帮模型验证"的那部分。** 模型越来越会想，但它想得对不对，仍然要靠外面的世界来告诉它。

## 参考文献

<section class="refs">
<ol>
<li id="ref-1"><span class="ref-n">[1]</span><span>Wei J. et al. <a href="https://arxiv.org/abs/2201.11903">Chain-of-Thought Prompting Elicits Reasoning in Large Language Models</a>. <i>NeurIPS</i>, 2022. <a class="ref-back" href="#cite-1" aria-label="回到正文">↩</a></span></li>
<li id="ref-2"><span class="ref-n">[2]</span><span>Kojima T. et al. <a href="https://arxiv.org/abs/2205.11916">Large Language Models are Zero-Shot Reasoners</a>. <i>NeurIPS</i>, 2022. <a class="ref-back" href="#cite-2" aria-label="回到正文">↩</a></span></li>
<li id="ref-3"><span class="ref-n">[3]</span><span>Wang X. et al. <a href="https://arxiv.org/abs/2203.11171">Self-Consistency Improves Chain of Thought Reasoning in Language Models</a>. <i>ICLR</i>, 2023. <a class="ref-back" href="#cite-3" aria-label="回到正文">↩</a></span></li>
<li id="ref-4"><span class="ref-n">[4]</span><span>OpenAI. <a href="https://openai.com/index/learning-to-reason-with-llms/">Learning to Reason with LLMs</a>. 2024. <a class="ref-back" href="#cite-4" aria-label="回到正文">↩</a></span></li>
<li id="ref-5"><span class="ref-n">[5]</span><span>DeepSeek-AI. <a href="https://www.nature.com/nature-index/article/10.1038/s41586-025-09422-z">DeepSeek-R1 incentivizes reasoning in LLMs through reinforcement learning</a>. <i>Nature</i>, 2025.（<a href="https://arxiv.org/abs/2501.12948">预印本</a>） <a class="ref-back" href="#cite-5" aria-label="回到正文">↩</a></span></li>
<li id="ref-6"><span class="ref-n">[6]</span><span>Snell C. et al. <a href="https://arxiv.org/abs/2408.03314">Scaling LLM Test-Time Compute Optimally can be More Effective than Scaling Model Parameters</a>. <i>ICLR</i>, 2025. <a class="ref-back" href="#cite-6" aria-label="回到正文">↩</a></span></li>
<li id="ref-7"><span class="ref-n">[7]</span><span>Anthropic. <a href="https://www.anthropic.com/engineering/claude-think-tool">The "think" tool: Enabling Claude to stop and think in complex tool use situations</a>. 2025. <a class="ref-back" href="#cite-7" aria-label="回到正文">↩</a></span></li>
<li id="ref-8"><span class="ref-n">[8]</span><span>Yao S. et al. <a href="https://arxiv.org/abs/2210.03629">ReAct: Synergizing Reasoning and Acting in Language Models</a>. <i>ICLR</i>, 2023. <a class="ref-back" href="#cite-8" aria-label="回到正文">↩</a></span></li>
<li id="ref-9"><span class="ref-n">[9]</span><span>Wang L. et al. <a href="https://arxiv.org/abs/2305.04091">Plan-and-Solve Prompting: Improving Zero-Shot Chain-of-Thought Reasoning by Large Language Models</a>. <i>ACL</i>, 2023. <a class="ref-back" href="#cite-9" aria-label="回到正文">↩</a></span></li>
<li id="ref-10"><span class="ref-n">[10]</span><span>Valmeekam K. et al. <a href="https://arxiv.org/abs/2206.10498">PlanBench: An Extensible Benchmark for Evaluating Large Language Models on Planning and Reasoning about Change</a>. <i>NeurIPS Datasets and Benchmarks</i>, 2023. <a class="ref-back" href="#cite-10" aria-label="回到正文">↩</a></span></li>
<li id="ref-11"><span class="ref-n">[11]</span><span>Kambhampati S. et al. <a href="https://arxiv.org/abs/2402.01817">Position: LLMs Can't Plan, But Can Help Planning in LLM-Modulo Frameworks</a>. <i>ICML</i>, 2024. <a class="ref-back" href="#cite-11" aria-label="回到正文">↩</a></span></li>
<li id="ref-12"><span class="ref-n">[12]</span><span>Liu B. et al. <a href="https://arxiv.org/abs/2304.11477">LLM+P: Empowering Large Language Models with Optimal Planning Proficiency</a>. <i>arXiv</i>, 2023. <a class="ref-back" href="#cite-12" aria-label="回到正文">↩</a></span></li>
<li id="ref-13"><span class="ref-n">[13]</span><span>Kwa T., West B. et al. <a href="https://arxiv.org/abs/2503.14499">Measuring AI Ability to Complete Long Tasks</a>. <i>arXiv</i>, 2025. <a class="ref-back" href="#cite-13" aria-label="回到正文">↩</a></span></li>
<li id="ref-14"><span class="ref-n">[14]</span><span>Yao S. et al. <a href="https://arxiv.org/abs/2305.10601">Tree of Thoughts: Deliberate Problem Solving with Large Language Models</a>. <i>NeurIPS</i>, 2023. <a class="ref-back" href="#cite-14" aria-label="回到正文">↩</a></span></li>
<li id="ref-15"><span class="ref-n">[15]</span><span>Lightman H. et al. <a href="https://arxiv.org/abs/2305.20050">Let's Verify Step by Step</a>. <i>ICLR</i>, 2024. <a class="ref-back" href="#cite-15" aria-label="回到正文">↩</a></span></li>
<li id="ref-16"><span class="ref-n">[16]</span><span>Shinn N. et al. <a href="https://arxiv.org/abs/2303.11366">Reflexion: Language Agents with Verbal Reinforcement Learning</a>. <i>NeurIPS</i>, 2023. <a class="ref-back" href="#cite-16" aria-label="回到正文">↩</a></span></li>
<li id="ref-17"><span class="ref-n">[17]</span><span>Huang J. et al. <a href="https://arxiv.org/abs/2310.01798">Large Language Models Cannot Self-Correct Reasoning Yet</a>. <i>ICLR</i>, 2024. <a class="ref-back" href="#cite-17" aria-label="回到正文">↩</a></span></li>
<li id="ref-18"><span class="ref-n">[18]</span><span>Chen X. et al. <a href="https://arxiv.org/abs/2412.21187">Do NOT Think That Much for 2+3=? On the Overthinking of o1-Like LLMs</a>. <i>arXiv</i>, 2024. <a class="ref-back" href="#cite-18" aria-label="回到正文">↩</a></span></li>
<li id="ref-19"><span class="ref-n">[19]</span><span>Turpin M. et al. <a href="https://arxiv.org/abs/2305.04388">Language Models Don't Always Say What They Think: Unfaithful Explanations in Chain-of-Thought Prompting</a>. <i>NeurIPS</i>, 2023. <a class="ref-back" href="#cite-19" aria-label="回到正文">↩</a></span></li>
<li id="ref-20"><span class="ref-n">[20]</span><span>Chen Y. et al. <a href="https://arxiv.org/abs/2505.05410">Reasoning Models Don't Always Say What They Think</a>. <i>arXiv</i>, 2025. <a class="ref-back" href="#cite-20" aria-label="回到正文">↩</a></span></li>
</ol>
</section>
