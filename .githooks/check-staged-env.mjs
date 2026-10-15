// Pre-commit guard (ADR-042). Values are never printed, only file and variable names.
import { execFileSync } from "node:child_process";

const git = (...a) => execFileSync("git", a, { encoding: "utf8" });
const staged = git("diff", "--cached", "--name-only", "--diff-filter=ACMR").split("\n").filter(Boolean);
const problems = [];
for (const file of staged) {
  const base = file.split("/").pop();
  if (/\.env\.keys$|^\.env\.keys$/.test(base)) { problems.push(`${file}: dotenvx private key files must never be committed`); continue; }
  if (!/^\.env($|\.)/.test(base) && !/\.env$/.test(base)) continue;
  const text = git("show", `:${file}`);
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || !m[2] || /^DOTENV_PUBLIC_KEY/.test(m[1])) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, "$2");
    const template = /\.example$/.test(base);
    const secretName = /(KEY|TOKEN|SECRET|PASSWORD|PASS|PIN|PRIVATE|DB_URL|DATABASE_URL)/i.test(m[1]);
    if (template ? secretName && value && !value.includes("${") && !/^(sk-ant-...|changeme|<.*>)$/i.test(value) : !value.startsWith("encrypted:")) problems.push(`${file}: ${m[1]} ${template ? "has a value in a template" : "is not encrypted"}`);
  }
}
if (problems.length) {
  console.error("Commit blocked: secrets would leave the laptop.\n  " + problems.join("\n  ") + "\nSee docs/SECURITY.md, section Secrets.");
  process.exit(1);
}
