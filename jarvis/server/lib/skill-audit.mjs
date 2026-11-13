// In-memory skill audit for the live skill loader (ADR-142), pure: used by jarvis/server/lib/skill-loader.mjs
// and inlined into the page for sample mode. Every skill that reaches the workspace (imported from GitHub,
// written by the local model, derived, fixed or captured) passes two layers before it is mounted:
//   1. SkillSpector's own rules (passed in as `rules`, the list scripts/skillspector-audit.mjs uses), plus
//      the forge's Python import check (forge.mjs scanFiles).
//   2. Eleven loader rules for what an agent skill must never ask a person or an agent to do. They are text
//      rules written here from the common risks in public skill collections; no third-party scanner runs.
// Any critical or high finding refuses the skill. Only text is read; nothing here runs the skill.
/* SKILLSPECTOR_RULES_START */
export const LOADER_RULES = [
  { id: "LOAD-SUDO", sev: "high", re: "\\bsudo\\s+\\S|\\bdoas\\s+\\S|\\bsu\\s+-c\\b", msg: "Asks for root rights." },
  { id: "LOAD-TUNNEL", sev: "critical", re: "\\b(ngrok|localtunnel|serveo\\.net|cloudflared\\s+tunnel|bore\\.pub|tailscale\\s+funnel)\\b", msg: "Opens a tunnel from this computer to the internet." },
  { id: "LOAD-PIPE-SHELL", sev: "critical", re: "(curl|wget|iwr|Invoke-WebRequest)[^\\n|]*\\|\\s*(sudo\\s+)?(ba|z|da|k)?sh\\b|\\|\\s*iex\\b", msg: "Runs a downloaded script." },
  { id: "LOAD-EVAL", sev: "high", re: "(^|[^\\w.$])(eval|exec)\\s*\\(|new\\s+Function\\s*\\(|\\bcompile\\s*\\([^)]*,\\s*['\"]exec", msg: "Runs a string as code." },
  { id: "LOAD-PROCESS", sev: "high", re: "\\b(subprocess|child_process|os\\.system|os\\.popen|execSync|spawnSync|Runtime\\.getRuntime\\(\\)\\.exec|ShellExecute)\\b", msg: "Starts a process." },
  { id: "LOAD-ENV", sev: "high", re: "\\b(process\\.env|os\\.environ|getenv\\s*\\(|printenv|\\$env:|\\benv\\s*\\|)", msg: "Reads environment variables, where keys live." },
  { id: "LOAD-CRON", sev: "high", re: "\\b(crontab\\s+-|/etc/cron|schtasks\\s+/create|launchctl\\s+load|systemctl\\s+enable)", msg: "Installs a scheduled or always-on task." },
  { id: "LOAD-DESTROY", sev: "critical", re: "\\brm\\s+-[a-z]*r[a-z]*f|\\bmkfs\\b|\\bdd\\s+if=|\\bformat\\s+[a-z]:|Remove-Item\\s+-Recurse\\s+-Force", msg: "Deletes files or disks." },
  { id: "LOAD-SECRETS", sev: "high", re: "(\\.ssh/|id_rsa|\\.aws/credentials|\\.netrc|\\.npmrc|\\.pypirc|\\.git-credentials|Login Data|keychain)", msg: "Reads a credential store." },
  { id: "LOAD-INTERNAL-URL", sev: "high", re: "https?://(localhost|127\\.|0\\.0\\.0\\.0|10\\.|192\\.168\\.|172\\.(1[6-9]|2\\d|3[01])\\.|169\\.254\\.|\\[::1?\\]|\\[::ffff:|\\[f[cd])", msg: "Points at a private or loopback address." },
  { id: "LOAD-OVERRIDE", sev: "high", re: "ignore (all )?(previous|prior|above|system) (instructions|rules)|disregard (the )?(system|previous) prompt|--dangerously-skip-permissions|bypassPermissions|you are now (in )?developer mode", msg: "Tries to override the agent's rules." },
];
/* SKILLSPECTOR_RULES_END */

// files: {path: text}; rules: SkillSpector's RULES; scanFiles: forge.mjs's scanner.
export function auditSkill(files, rules, scanFiles) {
  const base = scanFiles(files, rules);
  const extra = [];
  for (const [path, text] of Object.entries(files)) {
    String(text).split("\n").forEach((line, i) => {
      for (const r of LOADER_RULES) {
        let re; try { re = new RegExp(r.re, "i"); } catch (e) { continue; }
        if (re.test(line)) extra.push({ file: path, line: i + 1, rule: r.id, sev: r.sev, msg: r.msg });
      }
    });
  }
  const findings = [...base.findings, ...extra];
  const count = s => findings.filter(f => f.sev === s).length;
  return { findings, critical: count("critical"), high: count("high"), medium: count("medium"), low: count("low"), ok: !count("critical") && !count("high"), layers: ["skillspector", "loader-11"] };
}

// A skill name from free words: lower-case, hyphens, 3–41 characters, starting with a letter.
export function slugName(words, fallback = "workspace-skill") {
  const s = String(words || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s-]/g, " ").trim().split(/\s+/).filter(w => w.length > 1 && !["a", "an", "the", "for", "and", "to", "of", "me", "my", "that", "with"].includes(w)).slice(0, 5).join("-").replace(/-+/g, "-").slice(0, 41).replace(/-$/, "");
  return /^[a-z][a-z0-9-]{2,40}$/.test(s) ? s : fallback;
}

// The steps of a captured skill, from a finished mission: every locked step becomes a stop, never an action.
export function stepsFromMission(m) {
  return (m.steps || []).slice(0, 10).map(s => s.locked || s.kind === "approval"
    ? "Stop at “" + String(s.title).slice(0, 80) + "”: it needs Director 00's approval outside Jarvis."
    : String(s.title).slice(0, 120) + (s.kind === "gate" && s.gate ? " (gate: " + s.gate + ")" : ""));
}
