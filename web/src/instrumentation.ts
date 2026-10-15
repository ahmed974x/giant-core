// Runs once when the web server starts (Next.js instrumentation hook):
//   1. log redaction on every console call (ADR-042)
//   2. the secrets check: refuse to start if .env.local isn't encrypted, the keys aren't loaded, or Git could leak them
//   3. the phone-alert watcher (ADR-035): every minute, new proposals and Phoenix incidents are pushed to the phone
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { installLogRedaction } = await import("./lib/logger");
  installLogRedaction();
  if (process.env.NEXT_PHASE !== "phase-production-build") {
    const { enforceSecrets } = await import("./lib/security/check-secrets");
    enforceSecrets();
  }
  if (process.env.OMEGA_ALERTS === "off") return;
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
