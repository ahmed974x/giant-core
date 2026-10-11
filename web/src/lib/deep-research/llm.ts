// Deep Research model access (ADR-050). Free/open models only, tried in order:
//   1. Cortex gateway (OpenAI-compatible, 127.0.0.1:8089) on the omega/oracle route, which already ranks the free
//      fast providers (Groq > Cerebras > Gemini > local) and falls back by itself; then omega/free-smart.
//   2. Ollama directly (the laptop's local Qwen), so research still works with Docker or Cortex down.
// When every link fails the pipeline switches to its extractive mode (no model, quotes only) instead of failing.
type Fetch = typeof fetch;
type Env = Record<string, string | undefined>;
export type Msg = { role: "system" | "user"; content: string };
export type Link = { name: string; url: string; model: string; token?: string; ms: number };

export function chain(env: Env = process.env): Link[] {
  const cortex = (env.CORTEX_URL ?? "http://127.0.0.1:8089/v1").replace(/\/+$/, "");
  const token = env.OMEGA_GATEWAY_TOKEN?.trim();
  const out: Link[] = [];
  if (token) {
    for (const model of [env.DEEP_RESEARCH_MODEL ?? "omega/oracle", "omega/free-smart"])
      out.push({ name: `cortex:${model}`, url: cortex, model, token, ms: 90_000 });
  }
  if (env.OLLAMA_URL !== "") {
    const model = env.DEEP_RESEARCH_LOCAL_MODEL ?? "qwen2.5:3b";
    out.push({ name: `local:${model}`, url: (env.OLLAMA_URL ?? "http://127.0.0.1:11434/v1").replace(/\/+$/, ""), model, ms: 300_000 });
  }
  return out;
}

/** One chat completion through the first link that answers. Remembers dead links for this run via `skip`. */
export async function chat(messages: Msg[], opts: { env?: Env; f?: Fetch; maxTokens?: number; json?: boolean; skip?: Set<string>; signal?: AbortSignal } = {}):
  Promise<{ text: string; model: string }> {
  const f = opts.f ?? fetch;
  const errors: string[] = [];
  for (const link of chain(opts.env)) {
    if (opts.skip?.has(link.name)) continue;
    try {
      const signal = opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(link.ms)]) : AbortSignal.timeout(link.ms);
      const r = await f(`${link.url}/chat/completions`, {
        method: "POST", signal,
        headers: { "Content-Type": "application/json", ...(link.token ? { Authorization: `Bearer ${link.token}` } : {}) },
        body: JSON.stringify({ model: link.model, messages, temperature: 0.2, max_tokens: opts.maxTokens ?? 1200, stream: false }),
      });
      if (!r.ok) throw new Error(`${r.status}`);
      const j = await r.json() as { model?: string; choices?: { message?: { content?: string } }[] };
      const text = (j.choices?.[0]?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
      if (!text) throw new Error("empty answer");
      return { text, model: j.model ? `${link.name.split(":")[0]}:${j.model}` : link.name };
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      opts.skip?.add(link.name);
      errors.push(`${link.name}: ${(e as Error).message}`);
    }
  }
  throw new Error(`no model answered (${errors.join("; ") || "none configured"})`);
}

/** First JSON object in a model reply (models wrap JSON in prose or ```json fences). */
export function parseJson<T>(text: string): T | null {
  const body = text.replace(/```(?:json)?/g, "");
  const start = body.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try { return JSON.parse(body.slice(start, i + 1)) as T; } catch { return null; }
    }
  }
  return null;
}
