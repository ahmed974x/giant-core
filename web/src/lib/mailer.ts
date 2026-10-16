// Briefing email (ADR-075): a configurable placeholder. It works out what would be sent and to whom, and sends
// nothing. Sending is added only after Ahmad gives the project's own address in writing and approves a test send;
// his personal address is not used. The project sender is a non-secret setting in web/config/briefing-email.json;
// an environment variable, when set, wins over it.
export type Env = Record<string, string | undefined>;
export type BriefingConfig = { sender?: string };
export type EmailPlan =
  | { send: false; reason: string }
  | { send: true; message: { from: string; to: string; subject: string; text: string } };

const ADDRESS = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export function briefingEmail(text: string, env: Env = process.env, now = new Date(), config: BriefingConfig = {}): EmailPlan {
  const to = env.BRIEFING_EMAIL_TO?.trim() ?? "";
  const from = env.BRIEFING_EMAIL_FROM?.trim() || config.sender?.trim() || "";
  if (!to) return { send: false, reason: "no recipient yet (BRIEFING_EMAIL_TO is empty)" };
  if (!ADDRESS.test(to) || (from && !ADDRESS.test(from))) return { send: false, reason: "the email address doesn't look valid" };
  if (!from) return { send: false, reason: "no sender address (set sender in web/config/briefing-email.json)" };
  if (!env.BRIEFING_SMTP_URL) return { send: false, reason: "no mail transport configured (BRIEFING_SMTP_URL is empty)" };
  if (env.BRIEFING_EMAIL_APPROVED !== "yes") return { send: false, reason: "waiting for Ahmad to approve a test send (BRIEFING_EMAIL_APPROVED)" };
  return { send: true, message: { from, to, subject: `OMEGA paper briefing ${now.toISOString().slice(0, 10)}`, text } };
}

/** Not built on purpose: there is no transport until the address and a test send are approved. */
export async function sendEmail(_plan: EmailPlan): Promise<never> {
  throw new Error("email sending is not built yet: waiting for the project address and an approved test send");
}
