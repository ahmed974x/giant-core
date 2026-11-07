// Open-weight model catalog for Jarvis's local engines (ADR-140, widened in ADR-143), pure: used by
// openai-compat.mjs and ollama-bridge.mjs, and inlined into the page so Settings can show it without a server.
// Every family runs on this computer only (vLLM, llama.cpp, LM Studio or Ollama on 127.0.0.1). Licences
// are the ones the model cards state, as known on 2026-11-06; licences change between checkpoints, so
// check the card of the exact file you pull. "Open source" here means open weights; the terms differ:
// several are not OSI open-source licences (Llama, Gemma, Codestral).
export const MODEL_PROFILES = [
  // China
  { family: "deepseek-r1", match: /deepseek[-_.]?r1/i, maker: "DeepSeek", origin: "CN", licence: "MIT", role: "plan", strengths: "step-by-step reasoning; plans and checks", note: "Distilled sizes (1.5B–70B) run on a laptop or one GPU; the full 671B model needs a server." },
  { family: "deepseek-v3", match: /deepseek[-_.]?v3/i, maker: "DeepSeek", origin: "CN", licence: "MIT (V3-0324 and later; earlier checkpoints: DeepSeek Model License)", role: "chat", strengths: "general answers and tool calling", note: "671B mixture-of-experts: needs a multi-GPU vLLM server, not a laptop." },
  { family: "qwq", match: /\bqwq/i, maker: "Qwen (Alibaba)", origin: "CN", licence: "Apache 2.0", role: "math", strengths: "long reasoning on maths and logic", note: "32B; wants about 20 GB of GPU memory at 4-bit." },
  { family: "qwen3-coder", match: /qwen3[-_.]?coder/i, maker: "Qwen (Alibaba)", origin: "CN", licence: "Apache 2.0", role: "design", strengths: "agentic coding across many files", note: "30B-A3B runs on one large GPU; 480B-A35B needs a server." },
  { family: "qwen2.5-coder", match: /qwen2\.?5[-_.]?coder/i, maker: "Qwen (Alibaba)", origin: "CN", licence: "Apache 2.0 (0.5B, 1.5B, 7B, 14B, 32B; the 3B uses the Qwen Research License)", role: "design", strengths: "code and multi-file completion; follows Arabic and English prompts", note: "7B runs on a laptop; 32B wants about 24 GB of GPU memory at 4-bit." },
  { family: "glm-4", match: /glm[-_.]?4/i, maker: "Zhipu AI (THUDM)", origin: "CN", licence: "MIT (GLM-4-0414 series)", role: "tools", strengths: "function and tool calling", note: "9B and 32B sizes." },
  // United States and Europe
  { family: "llama-4-scout", match: /llama[-_.]?4[-_.]?scout/i, maker: "Meta", origin: "US", licence: "Llama 4 Community License (not OSI open source)", role: "context", strengths: "very long context for large projects", note: "17B active of 109B (mixture-of-experts); needs a large GPU." },
  { family: "llama-3.3", match: /llama[-_.]?3\.?3/i, maker: "Meta", origin: "US", licence: "Llama 3.3 Community License (not OSI open source)", role: "context", strengths: "general answers over large project context", note: "70B; about 40 GB of GPU memory at 4-bit." },
  { family: "gemma-3", match: /gemma[-_.]?3/i, maker: "Google", origin: "US", licence: "Gemma Terms of Use (not OSI open source)", role: "chat", strengths: "efficient, multilingual including Arabic", note: "27B fits one 24 GB GPU at 4-bit; smaller sizes run on a laptop." },
  { family: "olmo-2", match: /olmo[-_.]?2/i, maker: "Allen Institute for AI", origin: "US", licence: "Apache 2.0 (weights, data and code all open)", role: "chat", strengths: "fully open: weights, training data and code", note: "7B, 13B and 32B." },
  { family: "phi-4-reasoning", match: /phi[-_.]?4[-_.]?reasoning/i, maker: "Microsoft", origin: "US", licence: "MIT", role: "math", strengths: "compact reasoning on maths and science", note: "14B; runs on a laptop GPU." },
  { family: "codestral", match: /codestral/i, maker: "Mistral AI", origin: "EU", licence: "Mistral AI Non-Production License (no commercial use)", role: "design", strengths: "fast code completion", note: "22B. The licence forbids production and commercial use." },
];

// Jobs Jarvis gives a model. Only plan, design and chat are picked automatically; the rest are labels.
export const ROLE_LABEL = { plan: "Plans", design: "Designs and code", chat: "Answers", math: "Maths and logic", tools: "Tool calling", context: "Large project context" };

export function profileOf(name) {
  return MODEL_PROFILES.find(p => p.match.test(String(name || ""))) || null;
}
