"use client";
// A short system sound on decisions (Ahmad's tip): a soft rising ping when something is approved or sent, a lower
// one on rejection. Web Audio only, no files; silent if the browser blocks audio.
let ctx: AudioContext | null = null;

export function ping(kind: "ok" | "no" = "ok") {
  try {
    ctx ??= new AudioContext();
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(kind === "ok" ? 880 : 330, t);
    o.frequency.exponentialRampToValueAtTime(kind === "ok" ? 1320 : 220, t + 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.08, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g).connect(ctx.destination);
    o.start(t); o.stop(t + 0.4);
  } catch { /* audio unavailable */ }
}
