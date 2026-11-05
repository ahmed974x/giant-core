// OpenAI-compatible client for local open-weight models (ADR-140). Pure Node; no SDK.
//   - Talks to an OpenAI-compatible server on THIS computer only: vLLM (`vllm serve`, port 8000),
//     llama.cpp's llama-server (8080), LM Studio (1234) or Ollama's own /v1 (11434). The address is pinned
//     at start to http://127.0.0.1:<port>[/v1]; any other host is refused, so a request, a header or a
//     model answer can never point the client elsewhere (SSRF), and no workspace text leaves the machine.
//   - Hosted endpoints (api.deepseek.com, DashScope, any cloud) are not supported: they need a key and
//     would send workspace data outside, which AGENTS.md §1 and §3 keep for Director 00 to decide.
//   - Every call has a timeout and refuses redirects; a whole answer is capped at 2 MB and a stream at
//     2 MB of text. Model names are checked; ":cloud" / "-cloud" names are refused (ADR-112, ADR-136).
//   - Streaming reads Server-Sent Events (`data: {...}` lines, `data: [DONE]`) and passes each piece of
//     text, and each piece of reasoning (`reasoning_content`, as vLLM's DeepSeek-R1 parser sends it, or
//     text inside <think>…</think>), to callbacks. Answers stay untrusted data for the caller.

export const MODEL_RE = /^[a-z0-9][a-z0-9._/-]{0,95}(:[a-z0-9._-]{1,40})?$/i;
export const isCloudModel = m => /(:|-)cloud$/i.test(String(m || ""));

export class CompatError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Open-weight families Jarvis knows how to use, with the licence their model cards state (read 2026-11-05;
// check the card of the exact checkpoint you pull) and the job each is picked for.
export const MODEL_PROFILES = [
  { family: "deepseek-r1", match: /deepseek[-_.]?r1/i, maker: "DeepSeek", licence: "MIT", role: "plan", strengths: "step-by-step reasoning; plans and checks", note: "Distilled sizes (1.5B–70B) run on a laptop or one GPU; the full 671B model needs a server." },
  { family: "deepseek-v3", match: /deepseek[-_.]?v3/i, maker: "DeepSeek", licence: "MIT (V3-0324 and later; earlier checkpoints: DeepSeek Model License)", role: "chat", strengths: "general answers and tool calling", note: "671B mixture-of-experts: needs a multi-GPU vLLM server, not a laptop." },
  { family: "qwen2.5-coder", match: /qwen2\.?5[-_.]?coder/i, maker: "Qwen (Alibaba)", licence: "Apache 2.0 (0.5B, 1.5B, 7B, 14B, 32B; the 3B uses the Qwen Research License)", role: "design", strengths: "code and multi-file completion; follows Arabic and English prompts", note: "7B runs on a laptop; 32B wants about 24 GB of GPU memory at 4-bit." },
];
export const profileOf = name => MODEL_PROFILES.find(p => p.match.test(String(name || ""))) || null;

// The preferred model for a job: the person's choice, else the family whose role matches, else the
// Jarvis Modelfiles' names, else any local model.
export function pickModel(models, mode, wanted) {
  if (wanted) { const w = models.find(n => n === wanted || n === wanted + ":latest"); if (w) return w; }
  const role = mode === "design" ? "design" : mode === "plan" ? "plan" : "chat";
  const named = { plan: "jarvis-planner", design: "jarvis-designer", chat: "jarvis-planner" }[role];
  const byName = models.find(n => n.startsWith(named));
  if (byName) return byName;
  const byRole = models.find(n => (profileOf(n) || {}).role === role);
  if (byRole) return byRole;
  const fallback = role === "chat" ? models.find(n => profileOf(n)) : null;
  return fallback || models[0] || null;
}

// Only http://127.0.0.1:<port>, optionally ending in /v1 (no other path, no credentials, no query).
export function pinCompatUrl(raw) {
  let u;
  try { u = new URL(String(raw || "")); } catch (e) { throw new CompatError(400, "The OpenAI-compatible address is not a URL."); }
  const path = u.pathname.replace(/\/+$/, "");
  if (u.protocol !== "http:" || u.hostname !== "127.0.0.1" || !u.port || u.username || u.password || u.search || u.hash || !(path === "" || path === "/v1")) {
    throw new CompatError(400, "The OpenAI-compatible client talks to http://127.0.0.1:<port>/v1 only; refused " + u.protocol + "//" + u.host + u.pathname + ".");
  }
  return "http://127.0.0.1:" + u.port + "/v1";
}

export function checkModelName(m) {
  if (!MODEL_RE.test(String(m || ""))) throw new CompatError(400, "That is not a model name.");
  if (isCloudModel(m)) throw new CompatError(400, m + " runs on someone else's servers, not this machine. Pick a local model.");
  return m;
}

// Splits a stream of text into answer and reasoning when the model writes <think>…</think> inline
// (Ollama's DeepSeek-R1). Tags may arrive cut across pieces, so a short tail is held back.
export function thinkSplitter(onText, onThinking) {
  let inThink = false, buf = "";
  const OPEN = "<think>", CLOSE = "</think>";
  const flush = final => {
    for (;;) {
      const tag = inThink ? CLOSE : OPEN;
      const i = buf.indexOf(tag);
      if (i >= 0) {
        if (i) (inThink ? onThinking : onText)(buf.slice(0, i));
        buf = buf.slice(i + tag.length); inThink = !inThink; continue;
      }
      // Keep any tail that could be the start of a tag until the next piece arrives.
      let keep = 0;
      if (!final) for (let k = Math.min(tag.length - 1, buf.length); k > 0; k--) if (tag.startsWith(buf.slice(-k))) { keep = k; break; }
      const out = buf.slice(0, buf.length - keep);
      if (out) (inThink ? onThinking : onText)(out);
      buf = buf.slice(buf.length - keep);
      return;
    }
  };
  return { push: s => { buf += s; flush(false); }, end: () => flush(true) };
}

export function createOpenAICompatClient({ baseUrl, fetchImpl = fetch, timeoutMs = 120000 } = {}) {
  const base = pinCompatUrl(baseUrl);
  const post = (path, body, ms, signal) => fetchImpl(base + path, {
    method: "POST", headers: { "content-type": "application/json", accept: body.stream ? "text/event-stream" : "application/json" },
    body: JSON.stringify(body), redirect: "error", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms),
  });
  const fail = e => { throw e instanceof CompatError ? e : new CompatError(503, e && e.name === "TimeoutError" ? "The local model gave no answer in time." : "No OpenAI-compatible server answers on " + base + "."); };

  async function models() {
    let r;
    try { r = await fetchImpl(base + "/models", { redirect: "error", signal: AbortSignal.timeout(1500) }); } catch (e) { fail(e); }
    if (!r.ok) throw new CompatError(502, "The local server answered HTTP " + r.status + " for /v1/models.");
    const text = await r.text();
    if (text.length > 512 * 1024) throw new CompatError(502, "The model list is larger than 512 KB.");
    let j; try { j = JSON.parse(text); } catch (e) { throw new CompatError(502, "The model list is not JSON."); }
    return (Array.isArray(j.data) ? j.data : []).map(m => String(m && m.id || "")).filter(n => MODEL_RE.test(n) && !isCloudModel(n));
  }

  async function chat({ model, messages, temperature = 0.3, maxTokens = 2048 }) {
    checkModelName(model);
    let r;
    try { r = await post("/chat/completions", { model, messages, temperature, max_tokens: maxTokens, stream: false }, timeoutMs); } catch (e) { fail(e); }
    if (!r.ok) throw new CompatError(502, "The local model answered HTTP " + r.status + ".");
    const text = await r.text();
    if (text.length > 2 * 1024 * 1024) throw new CompatError(502, "The answer is larger than 2 MB.");
    let j; try { j = JSON.parse(text); } catch (e) { throw new CompatError(502, "The answer is not JSON."); }
    const msg = (j.choices && j.choices[0] && j.choices[0].message) || {};
    return { content: typeof msg.content === "string" ? msg.content : "", reasoning: typeof msg.reasoning_content === "string" ? msg.reasoning_content : "", usage: j.usage || null };
  }

  // Calls onToken(text) and onThinking(text) as pieces arrive; resolves with the totals.
  async function stream({ model, messages, temperature = 0.3, maxTokens = 2048, onToken = () => {}, onThinking = () => {}, signal }) {
    checkModelName(model);
    let r;
    try { r = await post("/chat/completions", { model, messages, temperature, max_tokens: maxTokens, stream: true }, timeoutMs, signal); } catch (e) { fail(e); }
    if (!r.ok || !r.body) throw new CompatError(502, "The local model answered HTTP " + r.status + ".");
    let content = "", reasoning = "", size = 0, pending = "";
    const split = thinkSplitter(t => { content += t; onToken(t); }, t => { reasoning += t; onThinking(t); });
    const decoder = new TextDecoder();
    const reader = r.body.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 2 * 1024 * 1024) throw new CompatError(502, "The streamed answer passed 2 MB, so it was stopped.");
        pending += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, nl).trim(); pending = pending.slice(nl + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") { split.end(); return { content, reasoning }; }
          let j; try { j = JSON.parse(data); } catch (e) { continue; }
          const d = (j.choices && j.choices[0] && j.choices[0].delta) || {};
          if (typeof d.reasoning_content === "string" && d.reasoning_content) { reasoning += d.reasoning_content; onThinking(d.reasoning_content); }
          if (typeof d.content === "string" && d.content) split.push(d.content);
        }
      }
    } catch (e) {
      try { await reader.cancel(); } catch (e2) { /* already closed */ }
      fail(e);
    }
    const last = pending.trim();
    if (last.startsWith("data:") && last.slice(5).trim() !== "[DONE]") {
      try { const d = (JSON.parse(last.slice(5).trim()).choices || [{}])[0].delta || {}; if (d.reasoning_content) { reasoning += d.reasoning_content; onThinking(d.reasoning_content); } if (d.content) split.push(d.content); } catch (e) { /* not JSON: ignored */ }
    }
    split.end();
    return { content, reasoning };
  }

  return { base, models, chat, stream };
}
