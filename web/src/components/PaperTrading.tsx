"use client";
import { useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import type { Snapshot, Fill } from "@/lib/paper";

type View = Snapshot & { fillCount: number; priceError: string | null };
const PAIRS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "PAXGUSDT"];
// Arabic-Indic and Persian digits, and the Arabic decimal comma, typed on the phone keyboard.
const toNumber = (s: string) => Number(s.replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x6f0)).replace(/[٫,]/g, "."));

/** Paper trading (ADR-044): practice with made-up USDT at live prices. Nothing reaches an exchange. */
export default function PaperTrading() {
  const t = useTranslations("market.paper");
  const f = useFormatter();
  const [pin, setPin] = useState("");
  const [data, setData] = useState<View | null>(null);
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("100");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { try { setPin(sessionStorage.getItem("omega-pin") ?? ""); } catch { /* storage blocked */ } }, []);
  const load = useCallback(async () => {
    if (pin.length < 6) return;
    const r = await fetch("/api/paper", { headers: { "x-omega-pin": pin }, cache: "no-store" }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (r?.ok) { setData(j); try { sessionStorage.setItem("omega-pin", pin); } catch { /* storage blocked */ } }
    else setMsg({ ok: false, text: j.error ?? t("offline") });
  }, [pin, t]);
  useEffect(() => {
    load(); const id = setInterval(load, 30_000);
    window.addEventListener("omega-paper-changed", load);   // an approved proposal just filled
    return () => { clearInterval(id); window.removeEventListener("omega-paper-changed", load); };
  }, [load]);

  const send = async (payload: Record<string, unknown>) => {
    setBusy(true); setMsg(null);
    const r = await fetch("/api/paper", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin, ...payload }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: t("offline") };
    if (r?.ok) setData(j.account);
    setBusy(false);
    return { ok: !!r?.ok, j };
  };

  const order = async (sellAll = false) => {
    const n = toNumber(amount);
    if (!sellAll && !(n > 0)) { setMsg({ ok: false, text: t("badAmount") }); return; }
    const { ok, j } = await send({ action: "order", symbol, side: sellAll ? "sell" : side, ...(sellAll ? {} : { usd: n }) });
    const fill = j.fill as Fill | undefined;
    setMsg(ok && fill ? { ok: true, text: t(fill.side === "buy" ? "bought" : "sold", { qty: fill.qty, symbol: fill.symbol, price: usd(fill.price) }) } : { ok: false, text: j.error ?? t("failed") });
  };
  const reset = async () => {
    if (!confirm(t("resetConfirm"))) return;
    const { ok, j } = await send({ action: "reset", start_usd: 10_000 });
    setMsg(ok ? { ok: true, text: t("resetDone") } : { ok: false, text: j.error ?? t("failed") });
  };

  const usd = (n: number | null | undefined) => (n != null && Number.isFinite(n) ? f.number(n, { style: "currency", currency: "USD", maximumFractionDigits: n < 10 ? 4 : 2 }) : "—");
  const tone = (n: number | null | undefined) => (n == null ? "" : n > 0 ? "text-good" : n < 0 ? "text-bad" : "");
  const held = data?.holdings.find(h => h.symbol === symbol);

  return (
    <section className="panel p-4" aria-labelledby="paper-title">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="paper-title" className="font-semibold">{t("title")}</h2>
        <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-xs text-accent">{t("badge")}</span>
        <input type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={e => setPin(e.target.value)}
          placeholder={t("pin")} aria-label={t("pin")} className="ms-auto w-28 rounded-md border border-line bg-panel-2 px-2 py-1 text-sm" dir="ltr" />
      </div>
      <p className="mt-1 text-sm text-muted">{t("lead")}</p>

      {data && (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            [t("equity"), usd(data.equity), ""],
            [t("return"), `${data.returnPct > 0 ? "+" : ""}${f.number(data.returnPct, { maximumFractionDigits: 2 })}%`, tone(data.returnPct)],
            [t("cash"), usd(data.cash), ""],
            [t("realized"), usd(data.realized), tone(data.realized)],
          ].map(([label, value, cls]) => (
            <div key={label} className="rounded-lg bg-panel-2 px-3 py-2">
              <div className="text-xs text-muted">{label}</div>
              <div className={`num text-lg font-semibold ${cls}`} dir="ltr">{value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <label className="text-xs text-muted">{t("pair")}
          <select value={symbol} onChange={e => setSymbol(e.target.value)} className="mt-1 block rounded-md border border-line bg-panel-2 px-2 py-1.5 text-sm font-mono" dir="ltr">
            {[...new Set([...PAIRS, ...(data?.holdings.map(h => h.symbol) ?? [])])].map(p => <option key={p}>{p}</option>)}
          </select>
        </label>
        <div role="group" aria-label={t("side")} className="flex overflow-hidden rounded-md border border-line text-sm">
          {(["buy", "sell"] as const).map(s => (
            <button key={s} type="button" aria-pressed={side === s} onClick={() => setSide(s)}
              className={`px-3 py-1.5 ${side === s ? (s === "buy" ? "bg-good/20 text-good" : "bg-bad/20 text-bad") : "text-muted"}`}>{t(s)}</button>
          ))}
        </div>
        <label className="text-xs text-muted">{t("amount")}
          <input type="text" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)}
            className="mt-1 block w-28 rounded-md border border-line bg-panel-2 px-2 py-1.5 text-sm" dir="ltr" />
        </label>
        <button disabled={busy || !data} onClick={() => order()}
          className="rounded-md bg-brass px-4 py-1.5 text-sm font-semibold text-[#0A0E1A] disabled:opacity-40">{t(side === "buy" ? "placeBuy" : "placeSell")}</button>
        {held && <button disabled={busy} onClick={() => order(true)} className="rounded-md border border-line px-3 py-1.5 text-sm disabled:opacity-40">{t("sellAll")}</button>}
      </div>
      <p className="mt-1 text-xs text-muted">{t("costs")}</p>

      {msg && <p role="status" className={`mt-3 rounded-md px-3 py-2 text-sm ${msg.ok ? "bg-good/10 text-good" : "bg-bad/10 text-bad"}`}>{msg.text}</p>}
      {data?.priceError && <p className="mt-3 rounded-md bg-warn/10 px-3 py-2 text-sm text-warn">{t("noPrices")}</p>}

      {data && data.marked.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="num w-full text-sm" dir="ltr">
            <thead className="text-xs text-muted">
              <tr><th className="py-1 text-start font-normal">{t("cols.pair")}</th><th className="text-end font-normal">{t("cols.qty")}</th>
                <th className="text-end font-normal">{t("cols.avg")}</th><th className="text-end font-normal">{t("cols.price")}</th>
                <th className="text-end font-normal">{t("cols.value")}</th><th className="text-end font-normal">{t("cols.gain")}</th></tr>
            </thead>
            <tbody>
              {data.marked.map(m => (
                <tr key={m.symbol} className="border-t border-line/60">
                  <td className="py-1.5 font-mono">{m.symbol}</td>
                  <td className="text-end">{f.number(m.qty, { maximumFractionDigits: 8 })}</td>
                  <td className="text-end">{usd(m.avg)}</td>
                  <td className="text-end">{usd(m.price)}</td>
                  <td className="text-end">{usd(m.value)}</td>
                  <td className={`text-end ${tone(m.gain)}`}>{usd(m.gain)}{m.gainPct != null ? ` (${m.gainPct}%)` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.fills.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-muted">{t("history", { n: data.fillCount })}</summary>
          <ul className="mt-2 space-y-1 text-xs" dir="ltr">
            {data.fills.map(x => (
              <li key={x.id} className="num flex flex-wrap gap-x-3 text-muted">
                <span>{f.dateTime(new Date(x.at), { dateStyle: "short", timeStyle: "short" })}</span>
                <span className={x.side === "buy" ? "text-good" : "text-bad"}>{t(x.side)}</span>
                <span className="font-mono text-ink">{x.symbol}</span>
                <span>{f.number(x.qty, { maximumFractionDigits: 8 })} @ {usd(x.price)}</span>
                {x.side === "sell" && <span className={tone(x.realized)}>{usd(x.realized)}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3 text-xs text-muted">
        <span>{t("safety")}</span>
        {data && <button onClick={reset} disabled={busy} className="ms-auto underline disabled:opacity-40">{t("reset")}</button>}
      </div>
    </section>
  );
}
