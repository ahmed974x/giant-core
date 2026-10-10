// Runs once when the web server starts (Next.js instrumentation hook). Starts the phone-alert watcher (ADR-035):
// every minute it checks Director 00's ledger and Phoenix's log and pushes anything new to subscribed phones.
// Phoenix keeps this server alive, so the watcher is always on without another scheduled task.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.OMEGA_ALERTS === "off") return;
  const { checkOnce } = await import("./lib/alerts");
  const { directorData } = await import("./lib/director");
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await checkOnce(directorData()); } catch (e) { console.error("alerts:", (e as Error).message); } finally { running = false; }
  };
  setTimeout(tick, 5_000);
  setInterval(tick, 60_000).unref();
}
