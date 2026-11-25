// Agent 技术地图的数据：自上而下五层，加一条贯穿各层的横切关注点。
// post 填文章的文件名（src/content/posts 下，不含扩展名）；
// 留空表示还没写，地图上会以虚线弱化显示，可以当作写作路线图。

export interface MapNode {
  zh: string;
  en: string;
  post?: string;
}

export interface MapLayer {
  key: string;
  zh: string;
  en: string;
  hint: string;
  nodes: MapNode[];
}

export const LAYERS: MapLayer[] = [
  {
    key: 'app',
    zh: '应用层',
    en: 'Application',
    hint: '用户最终看到的产品形态',
    nodes: [
      { zh: 'AI 应用工程', en: 'AI App Engineering', post: 'ai-app-development' },
      { zh: '对话助手', en: 'Chat Assistant' },
      { zh: '编程 Agent', en: 'Coding Agent' },
      { zh: '科研 Agent', en: 'Science Agent', post: 'ai-bio-agents' },
      { zh: '深度研究', en: 'Deep Research' },
      { zh: '个人 Agent', en: 'Personal Agent' },
      { zh: 'API 服务', en: 'API Backend', post: 'fastapi' },
    ],
  },
  {
    key: 'harness',
    zh: '编排层',
    en: 'Agent Harness',
    hint: '模型之外，让 Agent 跑起来的一切',
    nodes: [
      { zh: 'Agent 循环', en: 'Agent Loop', post: 'agent-basics' },
      { zh: 'Harness 工程', en: 'Harness Engineering', post: 'agent-harness' },
      { zh: '规划与推理', en: 'Planning & Reasoning', post: 'agent-planning-reasoning' },
      { zh: '上下文管理', en: 'Context Management', post: 'agent-context-management' },
      { zh: '记忆', en: 'Memory', post: 'agent-memory' },
      { zh: '子 Agent', en: 'Subagents', post: 'agent-subagents' },
      { zh: '技能', en: 'Skills', post: 'agent-skills' },
      { zh: '编排框架', en: 'Frameworks', post: 'langchain-langgraph' },
      { zh: '多 Agent 协作', en: 'Multi-Agent Systems' },
      { zh: '人机协同', en: 'Human-in-the-Loop' },
    ],
  },
  {
    key: 'cap',
    zh: '能力接入层',
    en: 'Tools & Integration',
    hint: 'Agent 伸向外部世界的手',
    nodes: [
      { zh: '工具调用', en: 'Tool Calling', post: 'agent-tools' },
      { zh: 'MCP 与 CLI', en: 'MCP & CLI', post: 'mcp-vs-cli' },
      { zh: '沙箱', en: 'Sandbox', post: 'agent-sandbox' },
      { zh: '检索增强', en: 'RAG', post: 'ai-app-development' },
      { zh: '向量检索', en: 'Vector Search', post: 'postgresql' },
      { zh: '结构化输出', en: 'Structured Output' },
      { zh: '计算机使用', en: 'Computer Use' },
    ],
  },
  {
    key: 'model',
    zh: '模型层',
    en: 'LLM',
    hint: 'Agent 的大脑',
    nodes: [
      { zh: 'Transformer', en: 'Architecture', post: 'transformer-intro' },
      { zh: '自注意力', en: 'Self-Attention', post: 'self-attention' },
      { zh: '术语演进', en: 'LLM Glossary', post: 'llm-terms-timeline' },
      { zh: '推理模型', en: 'Reasoning Models' },
      { zh: '提示工程', en: 'Prompt Engineering' },
      { zh: '后训练', en: 'Post-training' },
      { zh: '多模态', en: 'Multimodal' },
      { zh: '模型选型', en: 'Model Selection' },
    ],
  },
  {
    key: 'infra',
    zh: '推理与基础设施',
    en: 'Inference & Infra',
    hint: '把模型变成又快又便宜的服务',
    nodes: [
      { zh: 'KV 缓存', en: 'KV Cache', post: 'kv-cache-prompt-caching' },
      { zh: '提示缓存', en: 'Prompt Caching', post: 'kv-cache-prompt-caching' },
      { zh: 'GPU 与集群', en: 'GPU & Clusters', post: 'ai-infra-engineer' },
      { zh: '推理引擎', en: 'Inference Engines' },
      { zh: '量化', en: 'Quantization' },
      { zh: '分布式训练', en: 'Distributed Training' },
    ],
  },
];

export const CROSS: MapLayer = {
  key: 'cross',
  zh: '横切关注点',
  en: 'Cross-cutting',
  hint: '每一层都要考虑',
  nodes: [
    { zh: 'Agent 评测', en: 'Agent Evaluation', post: 'agent-evaluation' },
    { zh: '模型评测', en: 'LLM Benchmarking', post: 'evalscope-llm-evaluation' },
    { zh: '数据隔离', en: 'Data Isolation', post: 'postgres-rls' },
    { zh: '可观测性', en: 'Observability', post: 'agent-observability' },
    { zh: '成本与延迟', en: 'Cost & Latency' },
    { zh: '安全与护栏', en: 'Safety & Guardrails' },
  ],
};
