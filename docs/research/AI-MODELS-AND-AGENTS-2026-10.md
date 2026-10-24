# AI models, agent frameworks and agent techniques · read on 2026-10-24 (ADR-121)

**بالعربي باختصار:** هذا ملخص بحث مفتوح المصدر عن أحدث نماذج الذكاء الاصطناعي وأطر الوكلاء، وكل رقم له مصدر عام وتاريخ. لا توجد «أسرار مخفية» ولا «مكتبات لا يعرفها بشر»: كل ما يصلح موجود منشور برخصته. النماذج المغلقة تُذكر للمقارنة فقط ولا يُنسخ منها شيء. الأرقام أدناه أرقام المصادر نفسها وليست قياسنا. نفس البيانات في `scripts/lib/agent-core.mjs` وتظهر ثلاثية الأبعاد في صفحة النواة `omega-ops-room-v1/omega-core.html`.

Everything below is public. A number is the source's number on its date, not a measurement of ours. Where the
sources disagree or say nothing, the field is left blank and the disagreement is named.

## 1. Closed frontier models (reference only; weights not public)

BenchLM frontier ranking, data refreshed 2026-10-23 (https://benchlm.ai/frontier-ai-models):

| Rank | Model | Maker | Score | Output $ / 1M tokens |
|---|---|---|---|---|
| 1 | Claude Opus 5.5 | Anthropic | 86.6 | 20 |
| 2 | GPT-6.1 Sol | OpenAI | 84.2 | 10 |
| 3 | GPT-6 Astra | OpenAI | 84.0 | 50 |
| 4 | Claude Fable 5.1 | Anthropic | 83.1 | 50 |
| 5 | Gemini 4 Argon | Google | 82.8 | 10 |
| 6 | Claude Sonnet 5.5 | Anthropic | 82.2 | 10 |

Meta Muse Wonder (2026-10-12, TechCrunch): API at $4 / $20 per 1M tokens; the article does not say the weights are
published. Its benchmark claims are Meta's own and were not independently checked.

## 2. Open-weight models

| Model | Maker | Date | Total / active params | Context | Licence | Source |
|---|---|---|---|---|---|---|
| DeepSeek V4.1 Flash 1017 | DeepSeek | 2026-10-17 | blank: ≈763B (file-size estimate) vs 552B in another source | 1M | MIT | SmartScope |
| DeepSeek V4 Pro-0813 | DeepSeek | — | 1.7T | 1M | MIT | Wavect |
| Kimi K3 | Moonshot AI | weights 2026-07-27 | 2.8T / 104B | 1M | Kimi K3 License (separate deal for hosted services above $20M a year) | Unite.AI |
| GLM-5.3 | Z.ai | weights 2026-08-29 | 744B / 40B (another source: 753B) | — | GLM-5.3 License (security review above $10B revenue) | GIGAZINE |
| Qwen3.8-2.4T-A95B | Alibaba | — | 2.4T / 95B | — | Qwen3.8-Max License | eWeek |
| Qwen3.8-27B | Alibaba | reported 2026-08-17 | 27B dense | 262K (1M with YaRN) | Apache-2.0 | eWeek |
| Muse Glimmer 30B | Meta | reviewed 2026-08-10 | 30B dense | 128K | Apache-2.0 | Artificial Analysis (Intelligence Index 35) |
| Gemma 4 31B / 26B MoE / E4B | Google | 2026-04-02 | 31B / 26B (3.8B active) / 4.5B | 256K / 256K / 128K | Apache-2.0 | DataNorth |
| Llama 4 Scout | Meta | — | 109B / 17B | 10M | Llama 4 Community License | Wavect |

Kimi K3.1 Pro (2026-10-23) appears on the LLM Gateway timeline, but no source read says whether its weights are
public: «تعذر التحقق منها».

**What can run on Ahmad's laptop** (rule of thumb, [INFERENCE]: 4-bit weights ≈ 0.55 GB per billion parameters
plus 2 GB, out of three quarters of the memory): with 16 GB only Gemma 4 E4B; with 32 GB also Qwen3.8-27B, Muse
Glimmer 30B and Gemma 4 31B / 26B. The core page lets you pick the memory size. Installing any model needs Ahmad's
go; the existing local bridge (ADR-112) already talks to Ollama on 127.0.0.1.

Sources: [BenchLM](https://benchlm.ai/frontier-ai-models) ·
[TechCrunch](https://techcrunch.com/2026/10/12/meta-releases-its-first-frontier-model-muse-wonder/) ·
[SmartScope](https://smartscope.blog/en/blog/deepseek-v4-1-flash-1017-release-benchmarks-price-2026/) ·
[Wavect](https://wavect.io/blog/open-weight-llm-comparison-2026/) ·
[Unite.AI](https://www.unite.ai/moonshot-opens-kimi-k3-weights-under-a-revenue-tiered-license/) ·
[GIGAZINE](https://gigazine.net/gsc_news/en/20260829-glm-5-3-open/) ·
[eWeek](https://www.eweek.com/news/alibaba-qwen3-8-27b-license-apac-china/) ·
[Artificial Analysis](https://artificialanalysis.ai/articles/muse-glimmer) ·
[DataNorth](https://datanorth.ai/news/google-releases-gemma-4-open-models) ·
[LLM Gateway](https://llmgateway.io/timeline)

## 3. Agent frameworks (ideas taken as text; nothing installed)

From [FutureAGI's 2026 comparison](https://futureagi.com/blog/oss-agent-frameworks-2026/) (a vendor of evaluation
tools, so its comparisons may lean):

| Framework | Licence | Strength | Idea taken into the core |
|---|---|---|---|
| LangGraph | MIT | shared state, checkpoints, resume, retry a node | missions checkpoint after every step |
| Letta (MemGPT) | Apache-2.0 | long-lived self-edited memory | capped memory that keeps lessons longer than events |
| CrewAI | MIT | roles, tasks, crews | one task and tool set per helper |
| smolagents | Apache-2.0 | code agents (executor not a security boundary) | tools from a fixed allow-list; no generated code runs |
| Agno | Apache-2.0 (source also lists MPL-2.0) | memory, guardrails, tracing | measured time for every run |
| LlamaIndex agents | MIT | retrieval workflows | recall by words against the task |
| AutoGen / AG2 | MIT / Apache-2.0 | message passing; AutoGen in maintenance | nothing |

## 4. Agent techniques (published papers)

| Paper | arXiv | Used as |
|---|---|---|
| ReAct | 2210.03629 | observe, plan, act, record each cycle |
| Plan-and-Solve | 2305.04091 | missions written as steps with dependencies first |
| Reflexion | 2303.11366 | three failures with one error → a written lesson |
| Generative Agents | 2304.03442 | recall = 0.995^hours + importance + word overlap |
| MemGPT | 2310.08560 | working mission + capped long-term memory |
| Voyager | 2305.16291 | an approach that worked after a switch becomes first choice |
| Tree of Thoughts | 2305.10601 | other approaches tried before a step is blocked |
| Self-Consistency | 2203.11171 | the brief notes when scout and analyst disagree |

## 5. What was declined

- Copying or "distilling" a closed model: its weights are not public and its terms forbid it.
- "Hidden" or leaked tools: none were looked for, and none are needed.
- Anything that sends an order, signs, or moves money: real trading stays locked (AGENTS.md §1).
