// Briefing email (ADR-075): a configurable placeholder. It works out what would be sent and to whom, and sends
// nothing. Sending is added only after Ahmad gives the project's own address in writing and approves a test send;
// his personal address is not used.
export type Env = Record<string, string | undefined>;
export type EmailPlan =
  | { send: false; reason: string }
  | { send: true; message: { from: string; to: string; subject: string; text: string } };

const ADDRESS = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export function briefingEmail(text: string, env: Env = process.env, now = new Date()): EmailPlan {
  const to = env.BRIEFING_EMAIL_TO?.trim() ?? "", from = env.BRIEFING_EMAIL_FROM?.trim() ?? "";
  if (!to) return { send: false, reason: "no project address yet (BRIEFING_EMAIL_TO is empty)" };
  if (!ADDRESS.test(to) || (from && !ADDRESS.test(from))) return { send: false, reason: "the email address doesn't look valid" };
  if (!from || !env.BRIEFING_SMTP_URL) return { send: false, reason: "no mail sender configured (BRIEFING_EMAIL_FROM / BRIEFING_SMTP_URL)" };
  if (env.BRIEFING_EMAIL_APPROVED !== "yes") return { send: false, reason: "waiting for Ahmad to approve a test send (BRIEFING_EMAIL_APPROVED)" };
  return { send: true, message: { from, to, subject: `OMEGA paper briefing ${now.toISOString().slice(0, 10)}`, text } };
}

/** Not built on purpose: there is no transport until the address and a test send are approved. */
export async function sendEmail(_plan: EmailPlan): Promise<never> {
  throw new Error("email sending is not built yet: waiting for the project address and an approved test send");
}
