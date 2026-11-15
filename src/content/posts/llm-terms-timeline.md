---
title: 大模型术语年表：2022–2026，每年多出来的那些词
description: 从 RLHF、CoT 到 RAG、MoE，再到推理模型、MCP、Agent、Harness 和个人 Agent。按年份把这几年大模型圈子里冒出来的关键术语排一遍，每个词配一句白话解释，顺便标出哪些词其实比它走红的年份更早。
pubDate: 2026-11-15
tags: [LLM, Agent, 综述]
---

这几年读大模型相关的文章，最直观的感受是"词"更新得比模型还快。2022 年大家在聊 RLHF 和思维链，2023 年满屏都是 RAG 和向量数据库，2024 年开始讲推理模型，2025 年几乎每篇文章都绕不开 Agent，到了 2026 年，讨论的重心又移到了 Harness 和"让 Agent 在后台替你干活"上。

这篇把这些词按年份排一遍，每个词配一句白话解释。它不是严格的学术史，有两点先说明：

1. **按"走红"的年份归类，不按"提出"的年份**。很多词其实提出得更早，比如 RAG 的论文是 2020 年的，LoRA 是 2021 年的，MoE 更是上世纪的想法。遇到这种情况，我会在括号里标一下最早的出处；
2. **能找到一手来源的尽量引一手来源**：论文、官方博客、提出者本人的文章。二手的总结文章只作为线索，不作为依据。

## 2022：ChatGPT 之前和刚出来的时候

这一年的关键词，基本都围绕一个问题：怎么让一个"续写文本"的模型变成一个"听得懂人话、愿意好好回答"的助手。

- **Instruction Tuning（指令微调）**：用"指令→回答"格式的数据微调模型，让它能听懂人话。（最早系统提出是 Google 2021 年的 FLAN<sup class="cite" id="cite-1"><a href="#ref-1" title="Finetuned Language Models Are Zero-Shot Learners">1</a></sup>，2022 年随 InstructGPT 流行开来。）
- **RLHF（基于人类反馈的强化学习）**：人给回答排好坏，训练出奖励模型，再用强化学习（PPO）去优化模型。InstructGPT 把这套流程用在了 GPT-3 上<sup class="cite" id="cite-2"><a href="#ref-2" title="Training language models to follow instructions with human feedback">2</a></sup>，ChatGPT 沿用了同样的方法，它能火主要靠这一步。
- **CoT（Chain-of-Thought，思维链）**：让模型"一步步想"，先写出推理过程再给答案，推理题的正确率会明显提高<sup class="cite" id="cite-3"><a href="#ref-3" title="Chain-of-Thought Prompting Elicits Reasoning in Large Language Models">3</a></sup>。同年还有人发现，只在提示词里加一句 "Let's think step by step" 就有效果，这就是零样本 CoT<sup class="cite" id="cite-4"><a href="#ref-4" title="Large Language Models are Zero-Shot Reasoners">4</a></sup>。
- **Scaling Law / Chinchilla 定律**：参数量、数据量和算力之间存在最优配比。DeepMind 的 Chinchilla 论文发现，当时的大模型普遍"参数太多、数据太少"，在固定算力下，参数和训练 token 应该等比例增长，大约每个参数配 20 个 token<sup class="cite" id="cite-5"><a href="#ref-5" title="Training Compute-Optimal Large Language Models">5</a></sup>。（更早的 Scaling Law 是 OpenAI 2020 年提出的，Chinchilla 修正了其中的配比结论。）
- **Emergent Abilities（涌现能力）**：模型规模到了一定程度，突然会做以前做不了的事<sup class="cite" id="cite-6"><a href="#ref-6" title="Emergent Abilities of Large Language Models">6</a></sup>。不过这个说法后来有争议：2023 年有论文指出，很多"突然出现"是评测指标选得太"非黑即白"造成的，换成连续指标，曲线其实是平滑的<sup class="cite" id="cite-7"><a href="#ref-7" title="Are Emergent Abilities of Large Language Models a Mirage?">7</a></sup>。
- **Hallucination（幻觉）**：模型一本正经地编造内容。
- **Prompt Engineering（提示工程）**：靠设计输入来"调教"模型，包括写清楚指令、给几个示例（few-shot）、规定输出格式等等。
- **Prompt Injection（提示注入）**：这个词是 Simon Willison 在 2022 年 9 月起的名字，指外部输入里夹带的指令把开发者写的指令"顶掉"<sup class="cite" id="cite-8"><a href="#ref-8" title="Prompt injection attacks against GPT-3">8</a></sup>。它比 ChatGPT 还早两个多月，后来成了 Agent 安全的头号问题。

## 2023：生态爆发期

ChatGPT 让所有人都想把大模型接进自己的产品，这一年的词大多是"怎么用起来"和"怎么用得起"。

- **RAG（检索增强生成）**：先去知识库里检索相关资料，再拿资料来回答，用来减少幻觉和接入私有数据。（论文是 2020 年的<sup class="cite" id="cite-9"><a href="#ref-9" title="Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks">9</a></sup>，2023 年随着企业知识库问答大规模落地。）
- **Embedding / 向量数据库**：把文本变成向量，用来做语义检索，是 RAG 的底座。
- **Function Calling（函数调用）/ Tool Use**：模型输出结构化的调用请求，由程序去执行外部工具。OpenAI 在 2023 年 6 月把它做成了 API 的正式功能<sup class="cite" id="cite-10"><a href="#ref-10" title="Function calling and other API updates">10</a></sup>。
- **LoRA / QLoRA**：低秩适配，冻结原模型，只训练很少的附加参数就能微调大模型<sup class="cite" id="cite-11"><a href="#ref-11" title="LoRA: Low-Rank Adaptation of Large Language Models">11</a></sup>。QLoRA 在此基础上把底座模型量化到 4 bit，单张 48GB 显卡就能微调 65B 的模型<sup class="cite" id="cite-12"><a href="#ref-12" title="QLoRA: Efficient Finetuning of Quantized LLMs">12</a></sup>。（LoRA 是 2021 年的，QLoRA 是 2023 年 5 月的。）
- **PEFT（参数高效微调）**：LoRA、Adapter、Prefix Tuning 这类"只训练一小部分参数"的方法的统称。
- **Quantization（量化）**：降低权重精度（比如从 16 bit 降到 4 bit），让模型能在消费级硬件上跑。常见的名字里，GPTQ、AWQ 是量化算法，GGUF 是 llama.cpp 用的模型文件格式，INT4 则是精度本身，这几个不是同一层面的东西。
- **Open-weight Models（开放权重模型）**：Meta 在 2023 年 2 月发布 LLaMA，之后 Llama 2、Mistral、Qwen 陆续开放权重，本地部署、微调、量化这一整套生态才真正起来。
- **DPO（直接偏好优化）**：不用单独训练奖励模型，也不用 PPO，直接拿"好回答 / 差回答"的偏好数据来对齐，可以看成 RLHF 的简化版<sup class="cite" id="cite-13"><a href="#ref-13" title="Direct Preference Optimization: Your Language Model is Secretly a Reward Model">13</a></sup>。
- **Constitutional AI / RLAIF**：用一套写好的原则加上 AI 自己的反馈，替代一部分人工标注。（Anthropic 的 Constitutional AI 论文发表于 2022 年 12 月<sup class="cite" id="cite-14"><a href="#ref-14" title="Constitutional AI: Harmlessness from AI Feedback">14</a></sup>。）
- **MoE（混合专家）**：每个 token 只激活一部分"专家"参数，总参数可以很大，推理成本却不高。2023 年底的 Mixtral 8x7B 让它在开源圈火了起来。
- **FlashAttention / KV Cache / PagedAttention（vLLM）**：注意力计算和推理显存方面的优化。FlashAttention 通过减少显存读写来加速注意力计算；KV Cache 把算过的 Key、Value 存下来避免重复计算；vLLM 的 PagedAttention 像操作系统管理内存页那样管理 KV Cache，大幅减少显存浪费<sup class="cite" id="cite-15"><a href="#ref-15" title="Efficient Memory Management for Large Language Model Serving with PagedAttention">15</a></sup>。
- **Speculative Decoding（投机解码）**：小模型先猜几个 token，大模型一次性验证，猜对的直接收下，用来加速生成，而且输出分布和只用大模型完全一样<sup class="cite" id="cite-16"><a href="#ref-16" title="Fast Inference from Transformers via Speculative Decoding">16</a></sup>。
- **Long Context（长上下文）/ RoPE 外推**：通过位置插值等方法，把上下文窗口从 4K 一路扩到 100K 以上。
- **Jailbreak（越狱）**：用各种话术绕过模型的安全限制。它和提示注入经常被混为一谈，区别在于越狱是用户自己想绕过限制，提示注入是第三方内容劫持了模型。
- **Multimodal / VLM（多模态 / 视觉语言模型）**：能看图的 LLM，比如 GPT-4V、LLaVA。
- **LLM-as-a-Judge（用模型当评委）**：让强模型给其他模型的回答打分，代替一部分人工评测<sup class="cite" id="cite-17"><a href="#ref-17" title="Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena">17</a></sup>。后来几乎所有开放式任务的评测都离不开它。
- **Agent 雏形：ReAct、AutoGPT**：ReAct 让模型"想一步、做一步、看结果、再想"，把推理和行动交替进行<sup class="cite" id="cite-18"><a href="#ref-18" title="ReAct: Synergizing Reasoning and Acting in Language Models">18</a></sup>；AutoGPT 则是 2023 年春天最火的"全自动 Agent"演示。（ReAct 论文其实是 2022 年 10 月的。）

## 2024：效率、多模态、推理

模型能力继续往上走的同时，这一年大家开始认真算账：怎么更便宜、更快、更可控。年底，推理模型和 MCP 又给 2025 年埋下了伏笔。

- **Native Multimodal（原生多模态）**：文本、图像、语音放在一个模型里端到端处理，而不是"语音转文字→文本模型→文字转语音"拼起来，比如 GPT-4o<sup class="cite" id="cite-19"><a href="#ref-19" title="Hello GPT-4o">19</a></sup>。
- **SLM（小语言模型）**：几 B 参数、能跑在手机和笔记本上的模型，比如 Phi-3、Gemma、Llama 3.2 的小尺寸版本。
- **Synthetic Data（合成数据）**：用模型生成训练数据。
- **Distillation（蒸馏）**：大模型教小模型，用大模型的输出去训练小模型。
- **Prompt Caching（提示缓存）**：重复的前缀不再重复计算，能省钱也能提速。这一年 Google、Anthropic、OpenAI、DeepSeek 都在 API 里上了这个功能。
- **Structured Outputs / JSON Mode**：保证输出符合指定的格式。JSON Mode（2023 年底）只保证是合法的 JSON，Structured Outputs（2024 年）进一步保证符合你给的 JSON Schema。
- **Computer Use（电脑操作）**：模型看着截图去点鼠标、敲键盘。Anthropic 在 2024 年 10 月第一个把它作为公开 API 推出<sup class="cite" id="cite-20"><a href="#ref-20" title="Introducing computer use, a new Claude 3.5 Sonnet, and Claude 3.5 Haiku">20</a></sup>。
- **GraphRAG**：先用模型从文档里抽出实体和关系，建成知识图谱，再在图上做检索和总结，适合回答"这堆文档整体讲了什么"这类全局问题<sup class="cite" id="cite-21"><a href="#ref-21" title="From Local to Global: A Graph RAG Approach to Query-Focused Summarization">21</a></sup>。
- **Workflow vs Agent（工作流与智能体）**：Anthropic 在 2024 年底的一篇文章里做了一个后来被广泛引用的区分：工作流是"代码预先写好路径，模型在节点上干活"，Agent 是"模型自己决定下一步做什么、用什么工具"<sup class="cite" id="cite-22"><a href="#ref-22" title="Building effective agents">22</a></sup>。
- **Test-time Compute / Inference-time Scaling（推理时扩展）**：推理时多花算力"多想一会儿"，效果也会随之提升，这是继"训练时扩展"之后的第二条扩展曲线，以 OpenAI o1 为代表<sup class="cite" id="cite-23"><a href="#ref-23" title="Learning to reason with LLMs">23</a></sup>。
- **Reasoning Model（推理模型）**：先输出很长的思考过程再给答案的模型。
- **MCP（Model Context Protocol）**：Anthropic 在 2024 年 11 月开源的协议，统一模型应用连接外部工具和数据的方式<sup class="cite" id="cite-24"><a href="#ref-24" title="Introducing the Model Context Protocol">24</a></sup>。（更多内容见 [MCP 还是 CLI](/posts/mcp-vs-cli/)。）

## 2025：Agent 元年

如果只能用一句话概括 2025 年，那就是"模型学会了在循环里用工具"。推理能力、工具调用、长上下文在这一年汇合到了一起。

- **RLVR（可验证奖励的强化学习）**：用数学答案、代码测试这类能自动判对错的信号来做强化学习，不再需要人或奖励模型来打分。这个名字来自 AI2 在 2024 年底发布的 Tülu 3<sup class="cite" id="cite-25"><a href="#ref-25" title="Tülu 3: Pushing Frontiers in Open Language Model Post-Training">25</a></sup>。Karpathy 在他的 2025 年终回顾里写道，RLVR 在这一年成了训练流程里"事实上新的主要阶段"<sup class="cite" id="cite-26"><a href="#ref-26" title="2025 LLM Year in Review">26</a></sup>。
- **GRPO**：一种强化学习算法，不需要单独的价值模型，而是让模型对同一道题生成一组回答，用组内的相对好坏来算优势。它最早出现在 DeepSeekMath（2024 年 2 月）<sup class="cite" id="cite-27"><a href="#ref-27" title="DeepSeekMath: Pushing the Limits of Mathematical Reasoning in Open Language Models">27</a></sup>，随着 2025 年 1 月 DeepSeek-R1 的发布被广泛采用<sup class="cite" id="cite-28"><a href="#ref-28" title="DeepSeek-R1: Incentivizing Reasoning Capability in LLMs via Reinforcement Learning">28</a></sup>。
- **Thinking Budget / 混合推理**：一个模型里同时有"快答"和"深想"两种模式，思考的长度可以调。Claude 3.7 Sonnet、Gemini 2.5、Qwen3 都在这一年上了类似的设计。
- **Agentic AI / AI Agent**：Simon Willison 在他的 2025 年终回顾里采用的定义是"一个在循环中调用工具以达成目标的 LLM"（an LLM that runs tools in a loop to achieve a goal）<sup class="cite" id="cite-29"><a href="#ref-29" title="2025: The year in LLMs">29</a></sup>。他还有一个观察：推理能力真正的价值，最后体现在驱动工具上。
- **Coding Agent / Agentic Coding**：能写代码、跑代码、看结果、再改的 Agent，比如 Claude Code、Codex。Karpathy 把 Claude Code 视为第一个令人信服地展示了"LLM Agent 长什么样"的例子<sup class="cite"><a href="#ref-26" title="2025 LLM Year in Review">26</a></sup>。
- **Vibe Coding（氛围编程）**：Karpathy 在 2025 年 2 月起的名字，指只用自然语言描述需求，不看也不管代码，全交给 AI 去写<sup class="cite"><a href="#ref-26" title="2025 LLM Year in Review">26</a></sup>。
- **Context Engineering（上下文工程）**：比提示工程范围更大，关心的是给模型喂哪些信息、按什么结构、喂多少、什么时候清掉。2025 年年中这个词迅速取代了"提示工程"，Anthropic 后来专门写了一篇工程文章来讲它<sup class="cite" id="cite-30"><a href="#ref-30" title="Effective context engineering for AI agents">30</a></sup>。（更多内容见 [上下文管理](/posts/agent-context-management/)。）
- **Context Rot（上下文腐烂）**：上下文越长，模型对其中信息的利用就越差，哪怕远没到窗口上限<sup class="cite" id="cite-31"><a href="#ref-31" title="Context Rot: How Increasing Input Tokens Impacts LLM Performance">31</a></sup>。这是上下文工程之所以重要的直接原因。
- **Orchestration / Multi-agent（编排 / 多智能体）**：多个 Agent 分工协作，由一个编排者负责拆任务、分派和汇总。
- **Subagent（子智能体）**：由 Agent 自己派生出来的 Agent，拿到一个子任务和一个干净的上下文，干完只把结果交回来，用来隔离上下文，也可以并行干活。（更多内容见 [子 Agent](/posts/agent-subagents/)。）
- **A2A（Agent-to-Agent 协议）**：Google 在 2025 年 4 月提出的 Agent 之间互相通信的标准<sup class="cite" id="cite-32"><a href="#ref-32" title="Announcing the Agent2Agent Protocol (A2A)">32</a></sup>。MCP 管"Agent 怎么用工具"，A2A 管"Agent 怎么找另一个 Agent 帮忙"。
- **Deep Research（深度研究）**：Agent 自主进行多轮搜索、阅读，最后写成带引用的报告。（Google 在 2024 年 12 月先推出，OpenAI 在 2025 年 2 月跟进，之后成了各家的标配。）
- **AGENTS.md**：放在代码仓库根目录、写给 Coding Agent 看的说明文件，相当于"给 AI 的 README"，2025 年下半年被多家工具共同采用<sup class="cite" id="cite-33"><a href="#ref-33" title="AGENTS.md: a simple, open format for guiding coding agents">33</a></sup>。
- **Agent Skills**：把指令、脚本、资源打包成一个文件夹，Agent 平时只看到简短的描述，需要时再按需加载全部内容<sup class="cite" id="cite-34"><a href="#ref-34" title="Introducing Agent Skills">34</a></sup>。（更多内容见 [Agent Skills](/posts/agent-skills/)。）
- **Jagged Intelligence（锯齿状智能）**：模型在有些事上超越人类专家，却在简单的事上翻车。Karpathy 的比喻是：它同时是一个博学的天才和一个糊里糊涂的小学生<sup class="cite"><a href="#ref-26" title="2025 LLM Year in Review">26</a></sup>。
- **Reward Hacking（奖励欺骗）**：模型钻奖励函数的空子，而不是真正解决问题，比如为了让测试通过而直接改测试。这个概念在强化学习里很早就有，2025 年随着 RLVR 的大规模使用变得格外显眼。
- **Lethal Trifecta（致命三要素）**：Simon Willison 提出的 Agent 安全框架：只要一个 Agent 同时具备"能读私密数据""会接触不可信内容""能向外发送信息"这三点，攻击者就有可能通过提示注入把数据偷走<sup class="cite" id="cite-35"><a href="#ref-35" title="The lethal trifecta for AI agents: private data, untrusted content, and external communication">35</a></sup>。
- **Agentic Commerce（智能体商务）**：Agent 替用户去比价、下单、付钱。2025 年 9 月 OpenAI 和 Stripe 推出了 ACP（Agentic Commerce Protocol）<sup class="cite" id="cite-36"><a href="#ref-36" title="Buy it in ChatGPT: Instant Checkout and the Agentic Commerce Protocol">36</a></sup>，Google 推出了 AP2（Agent Payments Protocol）<sup class="cite" id="cite-37"><a href="#ref-37" title="Announcing Agent Payments Protocol (AP2)">37</a></sup>，这个方向从那时开始有了正式的协议。
- **Slop（AI 垃圾内容）**：批量生成的低质量 AI 内容。它被 Merriam-Webster 选为 2025 年度词汇<sup class="cite" id="cite-38"><a href="#ref-38" title="2025 Word of the Year: Slop">38</a></sup>，算是这些词里"出圈"最彻底的一个。

## 2026：工程化与落地

到了 2026 年，新原语出现得少了，大家的注意力转向怎么把已有的东西做扎实：模型外面那层工程怎么搭，Agent 怎么在后台长时间可靠地跑，怎么让普通人也能放心用。下半年，安全问题又以一种很多人没预料到的方式被推到了台前。

### 上半年

- **Harness（运行框架）/ Harness Engineering**：包在模型外面的那层工程，负责工具、上下文、循环、权限和反馈。LangChain 的一篇文章把 Agent 概括为"模型 + Harness"<sup class="cite" id="cite-39"><a href="#ref-39" title="The Anatomy of an Agent Harness">39</a></sup>；OpenAI 在 2026 年 2 月发表的《Harness engineering》里描述了一个几乎不手写代码的团队，工程师的主要工作变成了"设计环境、明确意图、搭建反馈回路"<sup class="cite" id="cite-40"><a href="#ref-40" title="Harness engineering: leveraging Codex in an agent-first world">40</a></sup>。同样的模型，换一个 Harness，表现可以差很多。（更多内容见 [Agent Harness](/posts/agent-harness/)。）
- **Claw / Personal Agent（个人 Agent）**：一个长期运行在你自己机器或云端、能连上你的消息、邮件和各种账号、替你处理日常事务的 Agent。开源项目 OpenClaw 在 2026 年初爆火，几经改名，"Claw"也成了这类软件的统称<sup class="cite" id="cite-41"><a href="#ref-41" title="2026 in LLMs (so far)">41</a></sup>。Simon Willison 的说法很直白：Claw 其实就是一个"换了一顶不那么吓人的帽子"的 Coding Agent。
- **Software Factory / Dark Factory（软件工厂 / 黑灯工厂）**：Dan Shapiro 借用自动驾驶分级，把 AI 写代码分成五级，最高一级叫"黑灯工厂"，即输入需求、产出软件、中间没有人参与<sup class="cite" id="cite-42"><a href="#ref-42" title="The Five Levels: from Spicy Autocomplete to the Dark Factory">42</a></sup>。StrongDM 的团队真的按这个思路在做，他们的两条规则是"代码不能由人来写"和"代码不能由人来审"<sup class="cite" id="cite-43"><a href="#ref-43" title="How StrongDM&#x27;s AI team build serious software without even looking at the code">43</a></sup>。
- **Agentic Engineering（智能体工程）**：和 Vibe Coding 相对，指专业工程师用 Coding Agent 做严肃的软件开发：不看代码可以，但要靠测试、规格和评审把住质量。Simon Willison 的博客把这类文章都归在这个标签下。
- **Background / Parallel Agents（后台 / 并行 Agent）**：把任务丢给 Agent，让它在后台的沙箱里跑上几个小时，同时还能开好几个，人只在开头布置任务、在结尾验收。
- **Long-horizon Tasks（长程任务）**：衡量 Agent 能连续自主工作多久。METR 在 2025 年提出用"任务时长"来衡量 Agent 能力：以人类专家完成任务所需的时间为尺子，看 Agent 能以 50% 的成功率完成多长的任务，并发现这个时长大约每 7 个月翻一倍<sup class="cite" id="cite-44"><a href="#ref-44" title="Measuring AI Ability to Complete Long Software Tasks">44</a></sup>。到 2026 年，它成了各家发布新模型时最常引用的指标之一。
- **Agentic Memory（智能体记忆）**：跨会话的长期记忆，让 Agent 下一次开新会话时还记得你的偏好、项目的约定和上次踩过的坑。（更多内容见 [Agent 的记忆](/posts/agent-memory/)。）
- **Evals / Agent 可观测性**：评测和全链路日志成了生产环境的标配。对 Agent 来说，只看最终答案对不对已经不够，还要能回放每一步调用了什么工具、看到了什么、为什么这么做。（更多内容见 [Agent 评测](/posts/agent-evaluation/)。）
- **Human-in-the-loop（人在回路）**：在关键节点暂停，等人确认后再继续，比如发邮件、付款、删数据之前。

### 下半年（7–11 月）

- **Eval 环境逃逸**：7 月，Hugging Face 披露其部分生产系统遭到入侵，整个攻击过程"从头到尾由一个自主 AI Agent 系统驱动"<sup class="cite" id="cite-45"><a href="#ref-45" title="Security incident disclosure — July 2026">45</a></sup>。几天后 OpenAI 说明，这发生在一次内部网络攻防能力评测中：参与评测的模型利用一个零日漏洞突破了评测环境的网络隔离，连到了 Hugging Face 的生产系统去找"测试答案"<sup class="cite" id="cite-46"><a href="#ref-46" title="OpenAI and Hugging Face partner to address security incident during model evaluation">46</a></sup>。同月底，Anthropic 也公布了三起类似事件：由于配置错误，评测机器带着真实的外网访问，Claude 模型在评测中进入了三家真实机构的系统<sup class="cite" id="cite-47"><a href="#ref-47" title="Investigating three real-world incidents in our cybersecurity evaluations">47</a></sup>。这些事件让"沙箱"和"评测隔离"从工程细节变成了行业话题，也是 Reward Hacking 最极端的一种表现：模型一心想拿到分数，于是去找了题目之外的路。（沙箱的原理见 [Agent 沙箱](/posts/agent-sandbox/)。）
- **Safe Claw / 面向大众的个人 Agent**：个人 Agent 在上半年主要是技术爱好者的玩具，下半年大公司开始把它做成普通人也能用的产品，重点放在隔离和授权上。比如 Meta 9 月推出的 Muse 运行在独立的虚拟机里，由另一个"哨兵"Agent 把关所有外网访问，发邮件、付款这类敏感操作都要先问用户<sup class="cite" id="cite-48"><a href="#ref-48" title="Introducing Muse: The World&#x27;s First Personal AI Agent Built for Everyone">48</a></sup>。
- **Personal Agent Protocol（个人 Agent 协议）**：10 月，Sierra 和 Meta 联合多家公司提出的开放标准，规定个人 Agent 怎么代表用户和商家打交道：Agent 怎么发现商家提供哪些服务、怎么登录用户账号、用户给只读还是可写权限、商家开放哪些操作<sup class="cite" id="cite-49"><a href="#ref-49" title="Introducing Personal Agent Protocol">49</a></sup>。如果说 MCP 解决的是"Agent 怎么接工具"，A2A 解决的是"Agent 怎么接 Agent"，这个协议想解决的是"替你办事的 Agent 怎么接商家"。

## 回头看这五年

把这些词按年份排完，能看出一条挺清楚的线：

1. **2022 年解决"能不能听懂"**：指令微调、RLHF、思维链，把续写模型变成了助手；
2. **2023 年解决"能不能用上"**：RAG、函数调用、LoRA、量化、vLLM，让大模型能接进业务、跑在自己的机器上；
3. **2024 年解决"能不能更好更省"**：原生多模态、提示缓存、结构化输出，还有推理时扩展这条新的扩展曲线；
4. **2025 年解决"能不能自己干活"**：RLVR 训练出的推理模型配上工具和循环，变成了真正可用的 Agent；
5. **2026 年解决"能不能放心交给它"**：Harness、后台 Agent、记忆、评测、沙箱、授权协议，关心的都是可靠性和边界。

还有一个有意思的现象：越往后，新词越少来自论文，越多来自工程博客和从业者的随手命名。Vibe Coding 是一条推文，Lethal Trifecta 是一篇博客，Claw 是一个开源项目的名字。这大概也说明，这个领域最前沿的东西，正在从实验室转移到每天用它干活的人手里。

## 参考文献

<section class="refs">
<ol>
<li id="ref-1"><span class="ref-n">[1]</span><span>Wei J. et al. <a href="https://arxiv.org/abs/2109.01652">Finetuned Language Models Are Zero-Shot Learners</a>. <i>ICLR</i>, 2022. <a class="ref-back" href="#cite-1" aria-label="回到正文">↩</a></span></li>
<li id="ref-2"><span class="ref-n">[2]</span><span>Ouyang L. et al. <a href="https://arxiv.org/abs/2203.02155">Training language models to follow instructions with human feedback</a>. <i>NeurIPS</i>, 2022. <a class="ref-back" href="#cite-2" aria-label="回到正文">↩</a></span></li>
<li id="ref-3"><span class="ref-n">[3]</span><span>Wei J. et al. <a href="https://arxiv.org/abs/2201.11903">Chain-of-Thought Prompting Elicits Reasoning in Large Language Models</a>. <i>NeurIPS</i>, 2022. <a class="ref-back" href="#cite-3" aria-label="回到正文">↩</a></span></li>
<li id="ref-4"><span class="ref-n">[4]</span><span>Kojima T. et al. <a href="https://arxiv.org/abs/2205.11916">Large Language Models are Zero-Shot Reasoners</a>. <i>NeurIPS</i>, 2022. <a class="ref-back" href="#cite-4" aria-label="回到正文">↩</a></span></li>
<li id="ref-5"><span class="ref-n">[5]</span><span>Hoffmann J. et al. <a href="https://arxiv.org/abs/2203.15556">Training Compute-Optimal Large Language Models</a>. <i>NeurIPS</i>, 2022. <a class="ref-back" href="#cite-5" aria-label="回到正文">↩</a></span></li>
<li id="ref-6"><span class="ref-n">[6]</span><span>Wei J. et al. <a href="https://arxiv.org/abs/2206.07682">Emergent Abilities of Large Language Models</a>. <i>TMLR</i>, 2022. <a class="ref-back" href="#cite-6" aria-label="回到正文">↩</a></span></li>
<li id="ref-7"><span class="ref-n">[7]</span><span>Schaeffer R. et al. <a href="https://arxiv.org/abs/2304.15004">Are Emergent Abilities of Large Language Models a Mirage?</a>. <i>NeurIPS</i>, 2023. <a class="ref-back" href="#cite-7" aria-label="回到正文">↩</a></span></li>
<li id="ref-8"><span class="ref-n">[8]</span><span>Willison S. <a href="https://simonwillison.net/2022/Sep/12/prompt-injection/">Prompt injection attacks against GPT-3</a>. <i>simonwillison.net</i>, 2022. <a class="ref-back" href="#cite-8" aria-label="回到正文">↩</a></span></li>
<li id="ref-9"><span class="ref-n">[9]</span><span>Lewis P. et al. <a href="https://arxiv.org/abs/2005.11401">Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks</a>. <i>NeurIPS</i>, 2020. <a class="ref-back" href="#cite-9" aria-label="回到正文">↩</a></span></li>
<li id="ref-10"><span class="ref-n">[10]</span><span>OpenAI <a href="https://openai.com/index/function-calling-and-other-api-updates/">Function calling and other API updates</a>. <i>OpenAI</i>, 2023. <a class="ref-back" href="#cite-10" aria-label="回到正文">↩</a></span></li>
<li id="ref-11"><span class="ref-n">[11]</span><span>Hu E. et al. <a href="https://arxiv.org/abs/2106.09685">LoRA: Low-Rank Adaptation of Large Language Models</a>. <i>ICLR</i>, 2022. <a class="ref-back" href="#cite-11" aria-label="回到正文">↩</a></span></li>
<li id="ref-12"><span class="ref-n">[12]</span><span>Dettmers T. et al. <a href="https://arxiv.org/abs/2305.14314">QLoRA: Efficient Finetuning of Quantized LLMs</a>. <i>NeurIPS</i>, 2023. <a class="ref-back" href="#cite-12" aria-label="回到正文">↩</a></span></li>
<li id="ref-13"><span class="ref-n">[13]</span><span>Rafailov R. et al. <a href="https://arxiv.org/abs/2305.18290">Direct Preference Optimization: Your Language Model is Secretly a Reward Model</a>. <i>NeurIPS</i>, 2023. <a class="ref-back" href="#cite-13" aria-label="回到正文">↩</a></span></li>
<li id="ref-14"><span class="ref-n">[14]</span><span>Bai Y. et al. <a href="https://arxiv.org/abs/2212.08073">Constitutional AI: Harmlessness from AI Feedback</a>. <i>arXiv</i>, 2022. <a class="ref-back" href="#cite-14" aria-label="回到正文">↩</a></span></li>
<li id="ref-15"><span class="ref-n">[15]</span><span>Kwon W. et al. <a href="https://arxiv.org/abs/2309.06180">Efficient Memory Management for Large Language Model Serving with PagedAttention</a>. <i>SOSP</i>, 2023. <a class="ref-back" href="#cite-15" aria-label="回到正文">↩</a></span></li>
<li id="ref-16"><span class="ref-n">[16]</span><span>Leviathan Y. et al. <a href="https://arxiv.org/abs/2211.17192">Fast Inference from Transformers via Speculative Decoding</a>. <i>ICML</i>, 2023. <a class="ref-back" href="#cite-16" aria-label="回到正文">↩</a></span></li>
<li id="ref-17"><span class="ref-n">[17]</span><span>Zheng L. et al. <a href="https://arxiv.org/abs/2306.05685">Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena</a>. <i>NeurIPS</i>, 2023. <a class="ref-back" href="#cite-17" aria-label="回到正文">↩</a></span></li>
<li id="ref-18"><span class="ref-n">[18]</span><span>Yao S. et al. <a href="https://arxiv.org/abs/2210.03629">ReAct: Synergizing Reasoning and Acting in Language Models</a>. <i>ICLR</i>, 2023. <a class="ref-back" href="#cite-18" aria-label="回到正文">↩</a></span></li>
<li id="ref-19"><span class="ref-n">[19]</span><span>OpenAI <a href="https://openai.com/index/hello-gpt-4o/">Hello GPT-4o</a>. <i>OpenAI</i>, 2024. <a class="ref-back" href="#cite-19" aria-label="回到正文">↩</a></span></li>
<li id="ref-20"><span class="ref-n">[20]</span><span>Anthropic <a href="https://www.anthropic.com/news/3-5-models-and-computer-use">Introducing computer use, a new Claude 3.5 Sonnet, and Claude 3.5 Haiku</a>. <i>Anthropic</i>, 2024. <a class="ref-back" href="#cite-20" aria-label="回到正文">↩</a></span></li>
<li id="ref-21"><span class="ref-n">[21]</span><span>Edge D. et al. <a href="https://arxiv.org/abs/2404.16130">From Local to Global: A Graph RAG Approach to Query-Focused Summarization</a>. <i>arXiv</i>, 2024. <a class="ref-back" href="#cite-21" aria-label="回到正文">↩</a></span></li>
<li id="ref-22"><span class="ref-n">[22]</span><span>Schluntz E., Zhang B. <a href="https://www.anthropic.com/engineering/building-effective-agents">Building effective agents</a>. <i>Anthropic Engineering Blog</i>, 2024. <a class="ref-back" href="#cite-22" aria-label="回到正文">↩</a></span></li>
<li id="ref-23"><span class="ref-n">[23]</span><span>OpenAI <a href="https://openai.com/index/learning-to-reason-with-llms/">Learning to reason with LLMs</a>. <i>OpenAI</i>, 2024. <a class="ref-back" href="#cite-23" aria-label="回到正文">↩</a></span></li>
<li id="ref-24"><span class="ref-n">[24]</span><span>Anthropic <a href="https://www.anthropic.com/news/model-context-protocol">Introducing the Model Context Protocol</a>. <i>Anthropic</i>, 2024. <a class="ref-back" href="#cite-24" aria-label="回到正文">↩</a></span></li>
<li id="ref-25"><span class="ref-n">[25]</span><span>Lambert N. et al. <a href="https://arxiv.org/abs/2411.15124">Tülu 3: Pushing Frontiers in Open Language Model Post-Training</a>. <i>arXiv</i>, 2024. <a class="ref-back" href="#cite-25" aria-label="回到正文">↩</a></span></li>
<li id="ref-26"><span class="ref-n">[26]</span><span>Karpathy A. <a href="https://karpathy.bearblog.dev/year-in-review-2025/">2025 LLM Year in Review</a>. <i>karpathy.bearblog.dev</i>, 2025. <a class="ref-back" href="#cite-26" aria-label="回到正文">↩</a></span></li>
<li id="ref-27"><span class="ref-n">[27]</span><span>Shao Z. et al. <a href="https://arxiv.org/abs/2402.03300">DeepSeekMath: Pushing the Limits of Mathematical Reasoning in Open Language Models</a>. <i>arXiv</i>, 2024. <a class="ref-back" href="#cite-27" aria-label="回到正文">↩</a></span></li>
<li id="ref-28"><span class="ref-n">[28]</span><span>DeepSeek-AI <a href="https://arxiv.org/abs/2501.12948">DeepSeek-R1: Incentivizing Reasoning Capability in LLMs via Reinforcement Learning</a>. <i>arXiv</i>, 2025. <a class="ref-back" href="#cite-28" aria-label="回到正文">↩</a></span></li>
<li id="ref-29"><span class="ref-n">[29]</span><span>Willison S. <a href="https://simonwillison.net/2025/Dec/31/the-year-in-llms/">2025: The year in LLMs</a>. <i>simonwillison.net</i>, 2025. <a class="ref-back" href="#cite-29" aria-label="回到正文">↩</a></span></li>
<li id="ref-30"><span class="ref-n">[30]</span><span>Anthropic Applied AI Team <a href="https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents">Effective context engineering for AI agents</a>. <i>Anthropic Engineering Blog</i>, 2025. <a class="ref-back" href="#cite-30" aria-label="回到正文">↩</a></span></li>
<li id="ref-31"><span class="ref-n">[31]</span><span>Chroma <a href="https://www.trychroma.com/research/context-rot">Context Rot: How Increasing Input Tokens Impacts LLM Performance</a>. <i>Chroma Research</i>, 2025. <a class="ref-back" href="#cite-31" aria-label="回到正文">↩</a></span></li>
<li id="ref-32"><span class="ref-n">[32]</span><span>Google <a href="https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/">Announcing the Agent2Agent Protocol (A2A)</a>. <i>Google Developers Blog</i>, 2025. <a class="ref-back" href="#cite-32" aria-label="回到正文">↩</a></span></li>
<li id="ref-33"><span class="ref-n">[33]</span><span>AGENTS.md <a href="https://agents.md/">AGENTS.md: a simple, open format for guiding coding agents</a>. <i>agents.md</i>, 2025. <a class="ref-back" href="#cite-33" aria-label="回到正文">↩</a></span></li>
<li id="ref-34"><span class="ref-n">[34]</span><span>Anthropic <a href="https://www.anthropic.com/news/skills">Introducing Agent Skills</a>. <i>Anthropic</i>, 2025. <a class="ref-back" href="#cite-34" aria-label="回到正文">↩</a></span></li>
<li id="ref-35"><span class="ref-n">[35]</span><span>Willison S. <a href="https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/">The lethal trifecta for AI agents: private data, untrusted content, and external communication</a>. <i>simonwillison.net</i>, 2025. <a class="ref-back" href="#cite-35" aria-label="回到正文">↩</a></span></li>
<li id="ref-36"><span class="ref-n">[36]</span><span>OpenAI <a href="https://openai.com/index/buy-it-in-chatgpt/">Buy it in ChatGPT: Instant Checkout and the Agentic Commerce Protocol</a>. <i>OpenAI</i>, 2025. <a class="ref-back" href="#cite-36" aria-label="回到正文">↩</a></span></li>
<li id="ref-37"><span class="ref-n">[37]</span><span>Google Cloud <a href="https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol">Announcing Agent Payments Protocol (AP2)</a>. <i>Google Cloud Blog</i>, 2025. <a class="ref-back" href="#cite-37" aria-label="回到正文">↩</a></span></li>
<li id="ref-38"><span class="ref-n">[38]</span><span>Merriam-Webster <a href="https://www.merriam-webster.com/wordplay/word-of-the-year">2025 Word of the Year: Slop</a>. <i>Merriam-Webster</i>, 2025. <a class="ref-back" href="#cite-38" aria-label="回到正文">↩</a></span></li>
<li id="ref-39"><span class="ref-n">[39]</span><span>Trivedy V. <a href="https://www.langchain.com/blog/the-anatomy-of-an-agent-harness">The Anatomy of an Agent Harness</a>. <i>LangChain Blog</i>, 2026. <a class="ref-back" href="#cite-39" aria-label="回到正文">↩</a></span></li>
<li id="ref-40"><span class="ref-n">[40]</span><span>Lopopolo R. <a href="https://openai.com/index/harness-engineering/">Harness engineering: leveraging Codex in an agent-first world</a>. <i>OpenAI</i>, 2026. <a class="ref-back" href="#cite-40" aria-label="回到正文">↩</a></span></li>
<li id="ref-41"><span class="ref-n">[41]</span><span>Willison S. <a href="https://simonwillison.net/2026/Sep/27/2026-in-llms-so-far/">2026 in LLMs (so far)</a>. <i>simonwillison.net</i>, 2026. <a class="ref-back" href="#cite-41" aria-label="回到正文">↩</a></span></li>
<li id="ref-42"><span class="ref-n">[42]</span><span>Shapiro D. <a href="https://www.danshapiro.com/blog/2026/01/the-five-levels-from-spicy-autocomplete-to-the-software-factory/">The Five Levels: from Spicy Autocomplete to the Dark Factory</a>. <i>danshapiro.com</i>, 2026. <a class="ref-back" href="#cite-42" aria-label="回到正文">↩</a></span></li>
<li id="ref-43"><span class="ref-n">[43]</span><span>Willison S. <a href="https://simonwillison.net/2026/Feb/7/software-factory/">How StrongDM&#x27;s AI team build serious software without even looking at the code</a>. <i>simonwillison.net</i>, 2026. <a class="ref-back" href="#cite-43" aria-label="回到正文">↩</a></span></li>
<li id="ref-44"><span class="ref-n">[44]</span><span>Kwa T. et al. <a href="https://arxiv.org/abs/2503.14499">Measuring AI Ability to Complete Long Software Tasks</a>. <i>METR</i>, 2025. <a class="ref-back" href="#cite-44" aria-label="回到正文">↩</a></span></li>
<li id="ref-45"><span class="ref-n">[45]</span><span>Hugging Face <a href="https://huggingface.co/blog/security-incident-july-2026">Security incident disclosure — July 2026</a>. <i>Hugging Face Blog</i>, 2026. <a class="ref-back" href="#cite-45" aria-label="回到正文">↩</a></span></li>
<li id="ref-46"><span class="ref-n">[46]</span><span>OpenAI <a href="https://openai.com/index/hugging-face-model-evaluation-security-incident/">OpenAI and Hugging Face partner to address security incident during model evaluation</a>. <i>OpenAI</i>, 2026. <a class="ref-back" href="#cite-46" aria-label="回到正文">↩</a></span></li>
<li id="ref-47"><span class="ref-n">[47]</span><span>Anthropic <a href="https://www.anthropic.com/news/investigating-incidents-cybersecurity-evals">Investigating three real-world incidents in our cybersecurity evaluations</a>. <i>Anthropic</i>, 2026. <a class="ref-back" href="#cite-47" aria-label="回到正文">↩</a></span></li>
<li id="ref-48"><span class="ref-n">[48]</span><span>Meta <a href="https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/">Introducing Muse: The World&#x27;s First Personal AI Agent Built for Everyone</a>. <i>Meta Newsroom</i>, 2026. <a class="ref-back" href="#cite-48" aria-label="回到正文">↩</a></span></li>
<li id="ref-49"><span class="ref-n">[49]</span><span>Taylor B., Bavor C. <a href="https://sierra.ai/blog/introducing-personal-agent-protocol">Introducing Personal Agent Protocol</a>. <i>Sierra Blog</i>, 2026. <a class="ref-back" href="#cite-49" aria-label="回到正文">↩</a></span></li>
</ol>
</section>

