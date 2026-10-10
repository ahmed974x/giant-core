"use client";
import { useEffect, useRef } from "react";

/** Deep-space background: slow drifting particles that lean away from the pointer and link up when close.
 *  Sits behind everything, never takes clicks, pauses when the tab is hidden, and stays still for reduced motion. */
export default function Particles() {
  const cv = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = cv.current!, ctx = c.getContext("2d")!;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const mouse = { x: -9999, y: -9999 };
    let w = 0, h = 0, raf = 0;
    type P = { x: number; y: number; vx: number; vy: number; r: number; hue: string };
    let ps: P[] = [];
    const hues = ["245,179,1", "124,58,237", "6,182,212", "226,232,240"];
    const size = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = c.clientWidth; h = c.clientHeight; c.width = w * dpr; c.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round(Math.min(90, (w * h) / 16000));
      ps = Array.from({ length: n }, (_, i) => ({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - 0.5) * 0.18, vy: (Math.random() - 0.5) * 0.18,
        r: Math.random() * 1.4 + 0.4, hue: hues[i % 7 === 0 ? 0 : i % 5 === 0 ? 1 : i % 3 === 0 ? 2 : 3] }));
    };
    const frame = () => {
      ctx.clearRect(0, 0, w, h);
      for (const p of ps) {
        if (!still) {
          const dx = p.x - mouse.x, dy = p.y - mouse.y, d2 = dx * dx + dy * dy;
          if (d2 < 120 * 120) { const f = (1 - Math.sqrt(d2) / 120) * 0.6; p.x += (dx / 120) * f; p.y += (dy / 120) * f; }
          p.x = (p.x + p.vx + w) % w; p.y = (p.y + p.vy + h) % h;
        }
        ctx.fillStyle = `rgba(${p.hue},0.7)`; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      }
      for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i], b = ps[j], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < 90) { ctx.strokeStyle = `rgba(148,160,184,${0.08 * (1 - d / 90)})`; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
      }
      if (!still && !document.hidden) raf = requestAnimationFrame(frame);
    };
    const resume = () => { cancelAnimationFrame(raf); if (!document.hidden) raf = requestAnimationFrame(frame); };
    const move = (e: PointerEvent) => { const r = c.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; };
    size(); raf = requestAnimationFrame(frame);
    window.addEventListener("resize", size); window.addEventListener("pointermove", move); document.addEventListener("visibilitychange", resume);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", size); window.removeEventListener("pointermove", move); document.removeEventListener("visibilitychange", resume); };
  }, []);
  return <canvas ref={cv} className="pointer-events-none fixed inset-0 -z-10 size-full" aria-hidden />;
}
