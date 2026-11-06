// Formal checks on a plan's state machine (ADR-145), pure: used by the server (macros) and inlined into
// the page (Ctrl+K composer). The same algorithm is in .claude/skills/replica-formal-verify/state_prover.py.
// A plan becomes a finite state machine: start, one state per step, an effect state after each sensitive
// approval, and the terminals done and stopped. Breadth-first search over every state proves three things:
//   1. Deadlock freedom: every reachable state that is not a terminal has a way out.
//   2. Reachability: every step can be reached from start (no orphan steps).
//   3. Safety: no money, publish, permissions, install or outbound effect is reachable without passing a
//      locked approval state. Proof: remove the locked states and search again; no effect may be reached.
//      A violation comes with the path that reaches the effect (a counterexample).
export const SENSITIVE = ["money", "publish", "permissions", "install", "outbound"];

export function planMachine(steps) {
  const list = Array.isArray(steps) ? steps : [];
  const states = [{ id: "start" }, { id: "done", terminal: true }, { id: "stopped", terminal: true }];
  const transitions = [];
  const after = list.map(() => []);
  list.forEach((s, i) => (s.depends || []).forEach(d => { if (Number.isInteger(d) && d >= 0 && d < i) after[d].push(i); }));
  list.forEach((s, i) => {
    const id = "s" + i;
    const locked = s.kind === "approval" && s.locked === true;
    states.push({ id, step: i, title: String(s.title || "").slice(0, 160), kind: s.kind || "tool", category: s.category || null, locked });
    if (!(s.depends || []).length) transitions.push({ from: "start", to: id, event: "begin" });
    const next = after[i].length ? after[i].map(j => "s" + j) : ["done"];
    let out = id;
    if (s.kind === "approval" && SENSITIVE.includes(s.category)) {
      // The effect happens only after a person approves; a refusal stops the mission.
      states.push({ id: "e" + i, effect: s.category, step: i });
      transitions.push({ from: id, to: "e" + i, event: "approved" }, { from: id, to: "stopped", event: "rejected" });
      out = "e" + i;
    } else if (s.kind === "approval") {
      transitions.push({ from: id, to: "stopped", event: "rejected" });
    } else if (s.kind === "gate") {
      transitions.push({ from: id, to: "stopped", event: "fail" });
    }
    for (const n of next) transitions.push({ from: out, to: n, event: s.kind === "approval" ? "approved" : "ok" });
  });
  if (!list.length) transitions.push({ from: "start", to: "done", event: "empty" });
  return { initial: "start", states, transitions };
}

function search(m, skip) {
  const out = new Map(m.transitions.map(t => [t.from, []]));
  for (const t of m.transitions) out.get(t.from).push(t);
  const prev = new Map([[m.initial, null]]), queue = [m.initial];
  while (queue.length) {
    const s = queue.shift();
    for (const t of out.get(s) || []) if (!prev.has(t.to) && !skip.has(t.to)) { prev.set(t.to, t); queue.push(t.to); }
  }
  return { prev, out };
}
const pathTo = (prev, id) => { const p = []; for (let t = prev.get(id); t; t = prev.get(t.from)) p.unshift(t.from + " -" + t.event + "-> " + t.to); return p; };

export function prove(m) {
  const byId = new Map(m.states.map(s => [s.id, s]));
  const bad = m.transitions.filter(t => !byId.has(t.from) || !byId.has(t.to));
  const { prev, out } = search(m, new Set());
  const reachable = [...prev.keys()];
  const deadlocks = reachable.filter(id => !byId.get(id).terminal && !(out.get(id) || []).length);
  const unreachable = m.states.filter(s => !prev.has(s.id) && s.step !== undefined).map(s => s.id);
  const locked = new Set(m.states.filter(s => s.locked).map(s => s.id));
  const free = search(m, locked).prev;
  const violations = m.states.filter(s => s.effect && free.has(s.id)).map(s => ({ state: s.id, effect: s.effect, path: pathTo(free, s.id) }));
  const effects = m.states.filter(s => s.effect).length;
  const verified = !bad.length && !deadlocks.length && !unreachable.length && !violations.length && prev.has("done");
  return { verified, states: m.states.length, transitions: m.transitions.length, reachable: reachable.length, deadlocks, unreachable, violations, effects, lockedStates: locked.size, danglingTransitions: bad.length, reachesDone: prev.has("done") };
}

export const provePlan = steps => prove(planMachine(steps));
