---
title: 大模型评测：从"跑个分"到"可信的结论"，以 EvalScope 为例
description: 一个模型到底好不好，换了模型是变好还是变差？这篇先把大模型评测本身讲清楚：评什么、怎么打分、有哪些坑；再以魔搭社区开源的 EvalScope 为例，看一套评测框架是怎么把基准测试、LLM 裁判、自定义数据集、评测指数、Agent 评测和推理性能压测放进同一个工具里的。
pubDate: 2026-11-23
tags: [LLM, 评测, 工具]
---

前面写过一篇 [Agent 评测](/posts/agent-evaluation/)，讲的是怎么判断一个 Agent 系统有没有变好。那篇的前提是"模型已经选好了"，而在它之前其实还有一个更基础的问题：**模型本身怎么评？**

这个问题在实际工作里出现得非常频繁：

- 新出了一个开源模型，宣传说"数学超过某某"，在我的场景里是不是真的更好？
- 自己微调了一版，训练 loss 降了，但能力有没有退化？
- 同一个模型，换了量化方式、换了推理框架、换了 API 供应商，输出质量还一致吗？
- 上线之前，这个服务在 100 并发下首字延迟是多少，能扛住吗？

这些问题的共同点是：**靠手动试几个例子得出的"感觉"，几乎都不可靠。** 模型输出有随机性，单个例子的好坏代表不了整体；而人对"看起来不错"的回答又特别宽容。所以需要评测，而且需要一套可复现的评测流程。

这篇分两部分。前半部分讲大模型评测本身：评什么、怎么打分、常见的坑。后半部分以 [EvalScope](https://github.com/modelscope/evalscope) 为例，看一个开源评测框架是怎么把这些问题落到工具上的。EvalScope 是魔搭社区（ModelScope）做的一站式评测框架，覆盖能力评测、推理性能压测和结果可视化，官方文档里还附带了 Qwen3、QwQ 等模型的评测最佳实践。

## 大模型评测在评什么

"评测"这个词底下其实混着好几类完全不同的问题，先分开：

| 维度 | 关心的问题 | 典型手段 |
|------|-----------|---------|
| **能力** | 会不会做数学、写代码、读文档、调用工具 | 基准测试（MMLU、GSM8K、HumanEval、SWE-bench……） |
| **偏好/质量** | 回答是不是用户更喜欢的、写得好不好 | LLM 裁判打分、两两对战（Arena） |
| **事实性/安全** | 会不会胡编、会不会输出有害内容 | SimpleQA、HaluEval、红队数据集 |
| **业务适配** | 在**我的**任务上表现如何 | 自定义数据集、加权评测指数 |
| **性能** | 延迟、吞吐、并发能力、成本 | 推理服务压测（TTFT、TPOT、tokens/s） |

前四类评的是"答得好不好"，最后一类评的是"答得快不快"。很多团队只做第一类：看看公开榜单，挑个分数高的。但真正做选型或上线决策时，后面几类往往更关键。一个在 MMLU 上高 2 分的模型，如果在你的业务数据上差 5 分、延迟还高一倍，那它就不是更好的选择。

## 怎么打分：几种评分方式

不管评什么，评测的骨架都一样：**一批输入 → 让模型生成 → 用某种方式判断输出好不好 → 汇总成分数。** 差别主要在"怎么判断"这一步。

### 规则匹配

最简单也最可靠的方式。选择题看模型选的字母对不对，数学题从输出里抽出最终数字和标准答案比较，代码题直接跑单元测试。

规则匹配的难点不在比较，而在**答案提取**。模型不会老老实实只输出一个"C"，它可能说"综上所述，我认为答案是 C 选项"，也可能先推理三段再给答案，甚至中途改主意。提取规则写得不好，模型明明答对了也会判错。所以评测框架通常会在 prompt 里约束格式（比如"最后一行写'答案是：LETTER'"），再配合针对性的提取逻辑。

同一个模型在不同框架里的 GSM8K 分数差好几个点，很多时候就是 prompt 模板和答案提取不一样造成的。这也是为什么**横向比较分数时，必须在同一套框架、同一套配置下跑**。

### 参考答案相似度

对开放式问答，没法精确匹配，早期做法是算生成结果和参考答案的 n-gram 重合度，也就是 ROUGE、BLEU 这些指标。

它们的问题很明显：只看字面重合，不看语义。"中国的首都是北京"和"北京"语义一致，但 ROUGE 的精确率会很低；而一个字面上很像、但关键事实写错的回答，分数反而可能不错。这类指标现在主要用于摘要、翻译这类有明确参考文本的任务，或者作为一个便宜的粗筛信号。

### LLM 裁判（LLM-as-a-Judge）

用一个更强的模型来判断被测模型的输出。常见两种用法：

- **有参考答案**：让裁判判断"这个回答和参考答案在语义上是否一致"，本质上是一个更聪明的答案匹配器；
- **无参考答案**：给裁判一套评分标准，让它直接打分，比如从有用性、准确性、完整性几个维度各打 1–10 分。

LLM 裁判极大地扩展了可评测的范围，但也带来了新的问题：

- **位置偏差**：两两比较时，裁判倾向于偏好放在前面（或后面）的那个回答；
- **长度偏差**：更长、看起来更"努力"的回答更容易得高分；
- **自我偏好**：裁判倾向于偏好和自己风格相近的输出；
- **输出不稳定**：裁判本身也有随机性，格式也可能出错导致解析失败。

对应的缓解手段也比较固定：交换位置各判一次、多次判分取平均或投票、多个裁判模型交叉验证、要求裁判输出结构化结果，并且**定期抽样人工核对裁判结论**。

### 两两对战（Pairwise / Arena）

不给绝对分数，只问"A 和 B 哪个更好"。对大量模型做两两比较后，用 Elo 或 Bradley-Terry 模型算出排名。LMSYS Chatbot Arena 就是这个思路，只是裁判是真人。

相对判断比绝对打分更稳定，人和模型都更擅长说"这个比那个好"，而不是"这个值 7.5 分"。代价是需要比较的次数随模型数量增长，而且结果是相对排名，换一批参赛模型分数就会变。

### 执行验证

代码、SQL、Agent 任务这类可以"跑一下看看"的，最好的评分器就是执行结果：单元测试是否通过、查询结果是否一致、仓库里的测试是否修复。这是最客观的方式，代价是需要沙箱环境来安全地运行模型生成的代码。

## 评测的常见坑

评测最危险的地方不是"分数低"，而是"分数看起来合理，但结论是错的"。下面几个坑基本每个做过评测的人都踩过。

### 数据污染

公开基准的题目早就躺在互联网上，很可能已经进了模型的训练数据。模型在 GSM8K 上拿高分，可能是会做数学，也可能只是背过题。

应对思路：优先关注**更新的、持续更新的基准**（比如按时间切分题目的 LiveCodeBench、更难更新的 SWE-bench Pro）；对比新旧题目上的分数差；最重要的是**用自己的私有数据集**，那才是没被污染的。

### 基准饱和

MMLU、GSM8K 这类基准，头部模型已经普遍做到 90% 以上，几个点的差距更多反映的是噪声和题目本身的错误，而不是能力差异。这时候应该换更难的基准（GPQA-Diamond、AIME、Humanity's Last Exam 之类），或者干脆换评测维度。

### 对配置极度敏感

同一个模型，下面这些因素都能让分数变化好几个点：

- prompt 模板和 system prompt；
- few-shot 的数量和示例选择；
- 采样参数（temperature、top_p、max_tokens）；
- 推理模型的思考长度上限（截断了，答案就没了）；
- 答案提取逻辑。

所以一个评测结果如果不附带完整配置，基本没有参考价值。**分数必须和配置一起保存。**

### 随机性：跑一次不算数

只要 temperature 不为 0，模型每次输出都不一样。题量又不大的时候（AIME 一年只有 30 道题），跑一次的分数波动可能比两个模型之间的差距还大。

常见的处理方式是同一题生成多次，再用不同口径汇总：

- **平均正确率（mean@k）**：k 次的平均，反映稳定水平；
- **pass@k**：k 次里至少一次正确的概率，反映"能力上限"，代码评测常用；
- **pass^k**：k 次全部正确的概率，反映"可靠性"，对 Agent 和生产场景更有意义；
- **多数投票（vote@k / maj@k）**：k 次结果投票后再判对错。

这几个口径回答的是不同的问题。一个 pass@5 很高但 pass^5 很低的模型，说明它"有时候能做对"，但不能放心交给它独立完成任务。

### 只看总分

总分把所有信息压成一个数字。两个模型总分一样，可能一个数学好、一个代码好；一个模型总分高了，可能是某个子集大涨掩盖了另一个子集的退化。**评测结果一定要能拆开看：按子集、按难度、按题目类型，最后落到具体的样本。**

这和 Agent 评测里"一定要去读轨迹"是同一个道理：分数告诉你有没有问题，具体样本才告诉你问题是什么。

## EvalScope 是什么

带着上面这些问题，再看 EvalScope 就比较容易理解它的设计了。它想解决的是：**把"选基准、跑推理、打分、汇总、可视化、对比"这一整条链路标准化，让评测结果可复现、可对比、可追溯。**

它覆盖的范围相当广：

- **模型类型**：大语言模型、多模态模型（VLM）、Embedding、Reranker、文生图/图像编辑、语音等；
- **基准**：内置了大量常用基准，从 MMLU、C-Eval、GSM8K 这些经典基准，到 AIME、GPQA、LiveCodeBench、SWE-bench、τ²-bench、BFCL、GAIA 这类推理和 Agent 基准；
- **模型来源**：本地模型（自动从 ModelScope 下载，用 transformers 推理），或者任意 OpenAI 兼容 API，也支持 Anthropic API 和 LiteLLM 路由；
- **评测后端**：默认的 Native 后端之外，还可以把 OpenCompass、VLMEvalKit、RAGAS / MTEB 作为后端调起来；
- **性能压测**：一个独立的 `evalscope perf` 子命令，测推理服务的延迟和吞吐；
- **可视化**：一个 Web 面板，看报告、对比多模型、逐条查看预测结果。

从架构上可以分成三层：

1. **输入层**：模型（本地或 API）+ 数据集（标准基准或自定义数据）；
2. **核心层**：多后端评测、LLM 裁判、Agent 循环、性能监控；
3. **输出层**：结构化报告（JSON、表格、日志）+ 可视化面板。

## 上手：三种方式跑起来

安装只需要一行（要求 Python 3.11 及以上）：

```bash
pip install evalscope
```

### 评测一个 API 模型

这是最推荐的入门方式，不需要 GPU，任何 OpenAI 兼容的服务都可以，包括 vLLM、SGLang 自己部署的服务和各家云厂商的 API：

```bash
evalscope eval \
  --model your-model-name \
  --api-url $OPENAI_API_BASE_URL \
  --api-key $OPENAI_API_KEY \
  --eval-type openai_api \
  --datasets gsm8k arc \
  --limit 5
```

`--limit 5` 表示每个数据集只跑前 5 条，用来先验证流程是否通畅。正式评测时去掉它。`--limit` 也接受小数，比如 `0.1` 表示跑前 10%。

### 评测一个本地模型

```bash
evalscope eval \
  --model Qwen/Qwen2.5-0.5B-Instruct \
  --datasets gsm8k arc \
  --limit 5
```

模型会自动从 ModelScope 下载并用 transformers 加载。适合评测自己微调出来的 checkpoint。不过对于大模型或大批量评测，更实际的做法通常是先用 vLLM 起一个服务，再按 API 方式评测，推理速度会快很多。

### 用 Python 配置

更复杂的评测建议写成配置，方便版本管理和复现：

```python
from evalscope import run_task, TaskConfig

task_cfg = TaskConfig(
    model='your-model-name',
    api_url='https://your-openai-compatible-endpoint/v1',
    api_key='your_api_key',
    eval_type='openai_api',
    datasets=['gsm8k', 'arc'],
    limit=5,
)

run_task(task_cfg)
```

`run_task` 也接受字典、YAML 或 JSON 文件。把评测配置写进 YAML 放进仓库，是让评测可复现最简单的一步。

### 看结果

跑完之后终端会打印一张汇总表：

```text
┌───────────────────────┬───────────┬────────────┬───────────────┬───────┬─────────┐
│ Model                 │ Dataset   │ Metric     │ Subset        │   Num │ Score   │
├───────────────────────┼───────────┼────────────┼───────────────┼───────┼─────────┤
│ Qwen2.5-0.5B-Instruct │ gsm8k     │ Accuracy ↑ │ main          │     5 │ 40%     │
├───────────────────────┼───────────┼────────────┼───────────────┼───────┼─────────┤
│ Qwen2.5-0.5B-Instruct │ arc       │ Accuracy ↑ │ ARC-Easy      │     5 │ 80%     │
├───────────────────────┼───────────┼────────────┼───────────────┼───────┼─────────┤
│ Qwen2.5-0.5B-Instruct │ arc       │ Accuracy ↑ │ ARC-Challenge │     5 │ 40%     │
└───────────────────────┴───────────┴────────────┴───────────────┴───────┴─────────┘
```

注意它天然是按**子集**拆开的，而不是只给一个总分。完整产物会落在 `outputs/<timestamp>/` 下，分成 `configs`、`logs`、`predictions`（模型原始输出）、`reviews`（打分结果）和 `reports`（汇总报告）几个目录。配置和每一条预测都保留下来，这正好对应前面说的"分数必须和配置一起保存""要能落到具体样本"。

想用界面看，可以启动可视化面板：

```bash
pip install 'evalscope[service]'
evalscope service
```

打开 `http://127.0.0.1:9000`，可以看报告概览、多模型对比，以及逐条查看每个样本的输入、模型输出和判分结果。

## 控制变量：生成参数、重复采样与聚合

前面说过评测对配置极度敏感，EvalScope 把这些变量都暴露成了显式参数：

```bash
evalscope eval \
  --model Qwen/Qwen3-0.6B \
  --model-args '{"revision": "master", "precision": "torch.float16", "device_map": "auto"}' \
  --generation-config '{"do_sample":true,"temperature":0.6,"max_tokens":512}' \
  --dataset-args '{"gsm8k": {"few_shot_num": 0, "few_shot_random": false}}' \
  --datasets gsm8k \
  --limit 10
```

三组参数分别对应模型加载（`--model-args`）、采样（`--generation-config`）和数据集本身（`--dataset-args`，比如 few-shot 数量）。

针对随机性，可以用 `repeats` 让每个样本生成多次，再用 `aggregation` 选择汇总口径：

- `mean_and_pass_at_k`：同时给出平均正确率和 pass@k，适合代码评测；
- `mean_and_vote_at_k`：多数投票；
- `mean_and_pass_hat_k`：k 次全对的概率，也就是 pass^k，适合 τ²-bench 这类 Agent 评测；
- `bayes_at_n`：在固定题集上给出正确率的后验均值和标准差，题目少的时候尤其有用，能直接看到"这个分数有多不确定"。

```python
task_cfg = TaskConfig(
    model='your-model-name',
    api_url='...',
    eval_type='openai_api',
    datasets=['aime25'],
    repeats=8,
    aggregation='mean_and_pass_at_k',
    generation_config={'temperature': 0.6, 'max_tokens': 32000},
)
```

对 AIME 这种只有几十道题的基准，跑 8 次取平均比跑 1 次靠谱得多。

另外，EvalScope 的基准带有可发布的评测版本标识，配合缓存机制：用 `use_cache` 指向上次的输出目录，可以复用已有的模型预测；再加上 `rerun_review=True`，就能在不重新推理的情况下只重算打分。这在调整评分规则或更换裁判模型时非常省钱。

## 配置 LLM 裁判

需要语义判断的基准（比如 SimpleQA）或者开放式问答，就要用到裁判模型。EvalScope 用一个 `judge` 对象统一配置：

```python
TaskConfig(
    model='MODEL',
    datasets=['simple_qa'],
    judge={
        'strategy': 'llm',
        'models': {
            'model_id': 'JUDGE_MODEL',
            'api_url': 'OPENAI_COMPATIBLE_URL',
            'api_key': 'JUDGE_API_KEY',
            'generation_config': {'temperature': 0.0, 'retries': 3},
        },
        'repeats': 1,
        'position_swap': 'auto',
        'aggregation': 'mean',
        'min_valid_judges': 1,
    },
)
```

这几个字段基本就是前面"LLM 裁判的问题"的对策清单：

- `strategy`：`rule` 只用规则，`llm` 用裁判，`auto` 跟随基准自身的设定；比较有意思的是 `llm_recall`，**先用规则判，只让裁判复核规则判错的样本**，取两者较高分。规则可靠但容易漏判（比如答案格式不标准），这种组合既保留了规则的客观性，又减少了误判，成本也比全量用裁判低；
- `models`：可以传一个列表，配置多个独立裁判交叉判分；
- `repeats` + `aggregation`：每个裁判多次判分，用均值、中位数或多数投票汇总；
- `position_swap`：对比类评测时交换回答顺序，对付位置偏差。

还有一个值得注意的设计：裁判输出不合法（不是规定格式的 JSON）时，这次判分被记为**无效并排除**，而不是默认给被测模型打 0 分。报告里会附带裁判的覆盖率、失败数和分歧情况。这避免了"裁判自己出错，结果算在被测模型头上"这种隐蔽的偏差。代价是参与计分的样本可能比总样本少，所以看分数时要同时看覆盖率。

## 用自己的数据评测

前面说过，没被污染、和业务最相关的评测集，只能是你自己的数据。EvalScope 预定义了几种自定义数据格式，最常用的是选择题和问答题。

### 选择题

准备一个 CSV 或 JSONL，文件名形如 `{subset_name}_val.csv`（可选的 `{subset_name}_dev.csv` 用作 few-shot 示例）：

```text
id,question,A,B,C,D,answer
1,通常来说，组成动物蛋白质的氨基酸有____,4种,22种,20种,19种,C
2,血液内存在的下列物质中，不属于代谢终产物的是____。,尿素,尿酸,丙酮酸,二氧化碳,C
```

然后用 `general_mcq` 这个固定的数据集名指向它：

```python
task_cfg = TaskConfig(
    model='Qwen/Qwen2-0.5B-Instruct',
    datasets=['general_mcq'],
    dataset_args={
        'general_mcq': {
            'local_path': 'custom_eval/text/mcq',
            'subset_list': ['example'],
        }
    },
)
```

也支持多正确答案（`answer` 写成字母列表）和 CoT 模板。

### 问答题

JSONL 每行一条，可以是 `query` + `response`，也可以是完整的 `messages` 多轮对话：

```json
{"system": "你是一位地理学家", "query": "中国的首都是哪里？", "response": "中国的首都是北京"}
{"messages": [{"role": "user", "content": "世界上最大的沙漠是哪个？"}], "response": "是撒哈拉沙漠"}
```

用 `general_qa` 加载。有参考答案时默认算 ROUGE 和 BLEU，但正如前面说的，这两个指标只看字面，所以更推荐配一个裁判做语义判断；没有参考答案时（`response` 留空），就只能靠裁判按评分标准打分。

除此之外还有工具调用格式，用来测模型能不能在恰当的时机、用正确的参数调用工具，对做 Agent 选型很有用。

## 构建自己的评测指数

单一基准不等于真实场景。你的业务可能是"60% 中文知识问答 + 30% 数学推理 + 10% 代码"，这时候任何一个公开榜单都没法直接回答"哪个模型最适合我"。

EvalScope 的 **Collection** 功能就是为这个设计的：把多个数据集按权重组合成一个"评测指数"，一次跑完，得到一个按你的业务价值加权的综合分。思路和 Artificial Analysis Intelligence Index 这类第三方指数一样，只是权重由你自己定。

第一步定义 Schema，可以嵌套分组：

```python
from evalscope.collections import CollectionSchema, DatasetInfo

schema = CollectionSchema(name='my_index', datasets=[
    CollectionSchema(name='math', weight=3.0, datasets=[
        DatasetInfo(name='gsm8k', weight=1.0, task_type='math'),
        DatasetInfo(name='aime25', weight=1.0, task_type='math'),
    ]),
    CollectionSchema(name='reasoning', weight=1.0, datasets=[
        DatasetInfo(name='arc', weight=1.0, task_type='reasoning'),
    ]),
])
```

第二步按策略抽样，生成一个混合数据集：

```python
from evalscope.collections import WeightedSampler
from evalscope.utils.io_utils import dump_jsonl_data

sampler = WeightedSampler(schema)
mixed_data = sampler.sample(1000)
dump_jsonl_data(mixed_data, 'outputs/mixed_data.jsonl')
```

除了按权重抽样（`WeightedSampler`），还有保持原始规模比例的分层抽样（`StratifiedSampler`）和每个数据集等量的均匀抽样（`UniformSampler`）。

第三步把这个混合文件当作一个数据集来评测：

```python
task_cfg = TaskConfig(
    model='qwen2.5-7b-instruct',
    api_url='https://dashscope.aliyuncs.com/compatible-mode/v1',
    api_key=os.getenv('DASHSCOPE_API_KEY'),
    eval_type='openai_api',
    datasets=['data_collection'],
    dataset_args={'data_collection': {'local_path': 'outputs/mixed_data.jsonl'}},
)
```

结果会同时给出每一层的分数和加权后的总分。这个工作流的价值在于：**定义一次指数，之后每个候选模型、每次微调都用同一个指数去量**，结论天然可比。混合数据集也可以固定下来随项目一起版本化，保证每次量的都是同一批题。

## 竞技场模式

对开放式任务，与其让裁判给每个回答打绝对分，不如让候选模型两两对战。EvalScope 的 Arena 模式就是这么做的：对同一批问题收集多个模型的回答，由裁判两两比较，最后输出胜率和置信区间：

```text
Model           WinRate (%)  CI (%)
------------  -------------  ---------------
qwen2.5-72b            69.3  (-13.3 / +12.2)
qwen2.5-7b             50    (+0.0 / +0.0)
qwen2.5-0.5b            4.7  (-2.5 / +4.4)
```

这里的 7b 是基线模型，所以胜率恰好是 50%。置信区间很重要：上面 72b 的区间有正负十几个点，说明样本量还不够大，如果两个模型的区间大面积重叠，就不能说谁一定更好。

## 从模型评测走向 Agent 评测

模型能力越来越多地体现在多步任务和工具使用上，单轮问答式的评测已经不够了。EvalScope 这一年在这个方向上加了不少东西，大致分两种模式。

### 内置 AgentLoop

把普通基准变成多轮工具调用任务。比如让模型在做 GSM8K 时可以调用 Python 验证计算：

```python
from evalscope import TaskConfig, run_task
from evalscope.api.agent import NativeAgentConfig

task_config = TaskConfig(
    model='qwen-plus',
    api_url='https://dashscope.aliyuncs.com/compatible-mode/v1',
    api_key='<your-key>',
    eval_type='openai_api',
    datasets=['gsm8k'],
    limit=5,
    agent_config=NativeAgentConfig(
        strategy='function_calling',
        tools=['python_exec'],
        environment='docker',
        max_steps=5,
    ),
)
run_task(task_config)
```

每一轮执行"生成 → 解析 → 调用工具 → 观察 → 再生成"，直到模型调用 `submit` 提交答案或达到步数上限。几个关键配置：

- `strategy`：交互协议，模型支持原生工具调用就用 `function_calling`，不支持就用 `react` 这类文本协议；
- `tools`：工具白名单，比如 `bash`、`python_exec`；还可以通过 `mcp_servers` 挂载任意 MCP 服务器（网页抓取、搜索、GitHub 等）；
- `environment`：`local` 没有隔离，只适合开发；正式评测用 `docker`，或者 E2B 之类的远端沙箱，这和 [Agent 沙箱](/posts/agent-sandbox/) 那篇讲的是同一件事；
- `max_steps`：数学和问答 5–10 步，代码修复类任务往往要上百步。

每个样本的完整轨迹（Agent Trace）都会保存下来，并能在可视化面板里按步骤回放。这一点非常关键：Agent 任务的失败原因千奇百怪，有的是推理错了，有的是工具参数写错了，有的是陷入了死循环。只看最终对错是看不出来的。

### 外部 Agent Bridge

另一种模式是直接评测成品 Agent CLI，比如 Claude Code、Codex。Bridge 会透明地把 CLI 发出的 LLM 请求转发给被测模型，同时记录完整的交互轨迹。这样可以回答一个很实际的问题：**同一个 Agent 外壳，换不同的底座模型，表现差多少？**

在基准层面，EvalScope 已经接入了 SWE-bench（含 Verified、Pro、Multilingual）、Terminal-Bench、τ²/τ³-bench、BFCL、GAIA、BrowseComp、MCP-Atlas 等主流 Agent 基准。如果你在读 [Agent 评测](/posts/agent-evaluation/) 那篇时想找一个现成的工具来跑这些基准，这是一个可以直接用的选择。

## 推理性能压测

能力评测回答"答得好不好"，上线前还得回答"答得快不快、扛不扛得住"。EvalScope 内置了一个压测工具：

```bash
pip install 'evalscope[perf]'

evalscope perf \
  --parallel 1 10 50 100 200 \
  --number 10 20 100 200 400 \
  --model Qwen2.5-0.5B-Instruct \
  --url http://127.0.0.1:8801/v1/chat/completions \
  --api openai \
  --dataset random \
  --max-tokens 1024 \
  --min-tokens 1024 \
  --min-prompt-length 1024 \
  --max-prompt-length 1024 \
  --tokenizer-path Qwen/Qwen2.5-0.5B-Instruct \
  --extra-args '{"ignore_eos": true}'
```

`--parallel` 和 `--number` 一一对应，这条命令会依次在 1、10、50、100、200 并发下各跑一轮，最后输出对比报告。`random` 数据集配合 `ignore_eos` 可以把输入输出长度都固定在 1024 token，排除长度波动对结果的干扰。

需要关注的几个核心指标：

- **TTFT（Time To First Token）**：首字延迟，用户等多久才看到第一个字，主要受 prefill 和排队影响；
- **TPOT（Time Per Output Token）**：每个输出 token 的平均耗时，决定"打字速度"；
- **Output Throughput**：整体输出 tokens/s，决定一台机器能服务多少请求；
- **分位数**：P50 看典型情况，P99 看最差的那 1% 用户。

TTFT 和吞吐之间是此消彼长的：并发越高，吞吐越高，但单个请求的 TTFT 和 TPOT 也会变差。压测的目的就是找到这条曲线的拐点。EvalScope 还提供 SLA 自动调优，你给定延迟约束（比如 TTFT P99 不超过 2 秒），它自动搜索满足约束的最大并发；以及多轮对话、真实 Agent 轨迹回放的压测，更接近 Agent 场景下的真实负载（长上下文、多轮、带工具调用间隔）。

一个容易被忽略的点：**能力评测和性能评测应该在同一个部署上做。** 量化、换推理框架、开投机解码，都可能同时影响速度和质量。只测速度就宣布"优化成功"，可能质量已经悄悄掉了。EvalScope 支持在一次能力评测中同时记录 TTFT、TPOT 这些性能指标，正好可以把两件事放在一起看。

## 一套实际可用的评测工作流

把上面的东西串起来，一个比较务实的模型评测流程大概是这样：

1. **先用小样本跑通**：`--limit 5` 跑一遍，确认 API 通、答案能正确提取、输出目录里的预测看起来合理。很多"模型很差"的结论，其实是格式没对上；
2. **选基准要有针对性**：别贪多。挑三到五个和你的场景相关、尚未饱和的公开基准，再加上自己的私有数据集；
3. **固定配置并入库**：把 `TaskConfig` 写成 YAML 放进仓库，包括生成参数、few-shot 设置、裁判配置。每次评测都从配置启动，而不是手敲命令；
4. **题少就多跑几次**：题量在几百以下的基准，用 `repeats` 加上合适的聚合口径，同时看均值和波动；
5. **建立自己的指数**：用 Collection 把关心的能力按权重组合起来，作为模型选型和迭代的统一标尺；
6. **抽样读预测和裁判结论**：分数变化超过预期（不管变好还是变坏）时，一定去面板里看具体样本，确认是能力变化而不是评测出了问题；
7. **上线前压测**：在实际部署上测性能曲线，确认在目标并发下的 P99 延迟能接受。

## 小结

大模型评测的核心矛盾在于：我们想用一个数字回答"这个模型好不好"，但"好"本身是多维的、依赖场景的，而且测量过程充满了噪声和偏差。所以评测要做的不是追求一个更高的分数，而是让结论**可信**：配置可复现、噪声被量化、打分方式经得起抽查、结果能拆到具体样本。

EvalScope 的价值在于把这些原则落成了一个工具里的默认行为：配置和预测全量保存，按子集拆分报告，`repeats` 和多种聚合口径应对随机性，结构化的裁判配置应对裁判偏差，Collection 让你用自己的权重定义"好"，Agent 模式和轨迹回放把评测延伸到多步任务，压测工具补上了性能这一维。

当然，工具只能降低评测的成本，替代不了评测的判断。选哪些基准、权重怎么定、哪些样本值得读，仍然需要你对自己的场景有清楚的认识。但至少，有了一个顺手的工具之后，"换个模型试试"这件事，可以从靠感觉变成靠数据了。

## 参考

- [EvalScope GitHub 仓库](https://github.com/modelscope/evalscope)
- [EvalScope 中文文档](https://evalscope.readthedocs.io/zh-cn/latest/)
- [Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena](https://arxiv.org/abs/2306.05685)：LLM 裁判的位置偏差、长度偏差等问题的系统分析
- [Evaluating Large Language Models Trained on Code](https://arxiv.org/abs/2107.03374)：pass@k 指标的出处
