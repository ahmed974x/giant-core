"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type Status = "unsupported" | "off" | "on" | "blocked";

const toKey = (b64u: string) => {
  const s = atob(b64u.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64u.length + 3) % 4));
  return Uint8Array.from(s, c => c.charCodeAt(0));
};

/** Turn phone alerts on or off (ADR-035). Needs the installed app over HTTPS; iPhones need iOS 16.4+ and the app
 *  added to the home screen. */
export default function PhoneAlerts() {
  const t = useTranslations("company.alerts");
  const [status, setStatus] = useState<Status>("off");
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try { setPin(sessionStorage.getItem("omega-pin") ?? ""); } catch { /* storage blocked */ }
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) { setStatus("unsupported"); return; }
    if (Notification.permission === "denied") { setStatus("blocked"); return; }
    navigator.serviceWorker.ready.then(r => r.pushManager.getSubscription()).then(s => setStatus(s ? "on" : "off")).catch(() => null);
  }, []);

  const call = async (body: Record<string, unknown>) => {
    try { sessionStorage.setItem("omega-pin", pin); } catch { /* storage blocked */ }
    const r = await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, pin }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: t("offline") };
    if (!r?.ok) throw new Error(j.error ?? t("failed"));
    return j;
  };

  const turnOn = async () => {
    setBusy(true); setMsg(null);
    try {
      if ((await Notification.requestPermission()) !== "granted") { setStatus("blocked"); throw new Error(t("denied")); }
      const { publicKey } = await (await fetch("/api/push", { cache: "no-store" })).json();
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(publicKey) });
      await call({ action: "subscribe", subscription: sub.toJSON() });
      await call({ action: "test" });
      setStatus("on"); setMsg({ ok: true, text: t("onMsg") });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    setBusy(false);
  };

  const turnOff = async () => {
    setBusy(true); setMsg(null);
    try {
      const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
      if (sub) { await call({ action: "unsubscribe", endpoint: sub.endpoint }); await sub.unsubscribe(); }
      setStatus("off"); setMsg({ ok: true, text: t("offMsg") });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    setBusy(false);
  };

  return (
    <section className="panel p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">{t("title")}</h2>
        <span className={`rounded px-2 py-0.5 text-xs ${status === "on" ? "bg-good/15 text-good" : "bg-panel-2 text-muted"}`}>{t(`status.${status}`)}</span>
        {status !== "unsupported" && status !== "blocked" && (
          <input type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={e => setPin(e.target.value)}
            placeholder={t("pin")} aria-label={t("pin")} className="ms-auto w-28 rounded-md border border-line bg-panel-2 px-2 py-1 text-sm" dir="ltr" />
        )}
      </div>
      <p className="mt-1 text-sm text-muted">{t(status === "unsupported" ? "unsupported" : status === "blocked" ? "blockedHelp" : "lead")}</p>
      {(status === "off" || status === "on") && (
        <div className="mt-3 flex gap-2">
          {status === "off"
            ? <button disabled={busy || pin.length < 6} onClick={turnOn} className="rounded-md bg-brass px-4 py-1.5 text-sm font-semibold text-[#071526] disabled:opacity-40">{t("on")}</button>
            : <>
                <button disabled={busy || pin.length < 6} onClick={() => call({ action: "test" }).then(() => setMsg({ ok: true, text: t("testMsg") })).catch(e => setMsg({ ok: false, text: e.message }))}
                  className="rounded-md border border-line px-3 py-1.5 text-sm disabled:opacity-40">{t("test")}</button>
                <button disabled={busy || pin.length < 6} onClick={turnOff} className="rounded-md border border-line px-3 py-1.5 text-sm text-muted disabled:opacity-40">{t("off")}</button>
              </>}
        </div>
      )}
      {msg && <p className={`mt-3 rounded-md px-3 py-2 text-sm ${msg.ok ? "bg-good/10 text-good" : "bg-bad/10 text-bad"}`}>{msg.text}</p>}
    </section>
  );
}
