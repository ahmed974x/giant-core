// The live Skill Forge (ADR-138), pure: used by jarvis/server/lib/memory.mjs's forge routes and
// inlined into the page for sample mode. It writes a skill from a short description (or takes a
// pasted SKILL.md), then scans every file with SkillSpector's own rules (passed in as `rules`, the
// same list scripts/skillspector-audit.mjs uses) plus a check for network and process imports in
// Python. A skill with any critical or high finding is refused. A mounted skill lives only in the
// workspace's registry; writing it into .claude/skills is an install, which stays a locked approval
// (AGENTS.md §1). Nothing here runs the code it writes.

export const NAME_RE = /^[a-z][a-z0-9-]{2,40}$/;
const PY_FORBIDDEN = /^\s*(import|from)\s+(socket|urllib|http\.client|requests|httpx|aiohttp|subprocess|ctypes|smtplib|ftplib)\b/m;

const fileKind = path => (/\.(py|m?js|cjs|ts)$/.test(path) ? "code" : /\.html?$/.test(path) ? "html" : /(SKILL|AGENTS|CLAUDE)\.md$|\.md$/.test(path) ? "agent" : "other");

// rules: [{id, sev, re, flags, files, msg}] (SkillSpector's RULES); files: {path: text}
export function scanFiles(files, rules) {
  const findings = [];
  for (const [path, text] of Object.entries(files)) {
    const kind = fileKind(path);
    for (const r of rules) {
      if (!(r.files === "*" || r.files === kind)) continue;
      let re;
      try { re = new RegExp(r.re, (r.flags || "").replace("g", "")); } catch (e) { continue; }
      const lines = String(text).split("\n");
      lines.forEach((line, i) => { if (re.test(line)) findings.push({ file: path, line: i + 1, rule: r.id, sev: r.sev, msg: r.msg }); });
    }
    if (kind === "code" && path.endsWith(".py")) {
      String(text).split("\n").forEach((line, i) => { if (PY_FORBIDDEN.test(line)) findings.push({ file: path, line: i + 1, rule: "FORGE-PY-IMPORT", sev: "high", msg: "A forged skill may not reach the network or start processes." }); });
    }
  }
  const count = s => findings.filter(f => f.sev === s).length;
  return { findings, critical: count("critical"), high: count("high"), medium: count("medium"), low: count("low"), ok: !count("critical") && !count("high") };
}

const cleanText = (s, n) => String(s || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

// A skill from a description: a SKILL.md with the giant-core section, and for kind "python-tool" a
// standard-library tool skeleton that reads one file inside --root and prints JSON.
export function forgeSkill({ name, description, kind = "checklist", steps = [] }) {
  const n = String(name || "").trim().toLowerCase();
  if (!NAME_RE.test(n)) throw Object.assign(new Error("Name it with 3 to 41 lower-case letters, digits or hyphens, starting with a letter."), { status: 400 });
  const d = cleanText(description, 300);
  if (d.length < 10) throw Object.assign(new Error("Describe what the skill does in a sentence (10+ characters)."), { status: 400 });
  const list = (Array.isArray(steps) && steps.length ? steps : ["Read the files the task names, and nothing else.", "Check them against the rules below.", "List each problem with its file and line, then stop."]).map(s => cleanText(s, 160)).filter(Boolean).slice(0, 10);
  const files = {};
  files["SKILL.md"] = `---
name: ${n}
description: ${d}
---

# ${n}

${d}

## Steps

${list.map((s, i) => `${i + 1}. ${s}`).join("\n")}
${kind === "python-tool" ? `
## Tool

\`python3 tool.py FILE --root REPO\` reads one file inside the repository and prints a JSON summary
(lines, words, the longest line). Standard library only; no network, no processes.
` : ""}
## In giant-core

- AGENTS.md and DESIGN.md win over this skill.
- Money, publishing, permission changes, installs and outbound messages are never done here; they
  stay «قيد الموافقة» cards for Director 00.
- Forged in Jarvis's Skill Forge and scanned with SkillSpector's rules. Writing it into
  .claude/skills needs Director 00's approval and a written security review.
`;
  if (kind === "python-tool") {
    files["tool.py"] = `#!/usr/bin/env python3
"""${n}: read one file inside --root and print a JSON summary. Standard library only."""

import argparse
import json
import os
import sys


def inside(root, path):
    base = os.path.realpath(root)
    p = os.path.realpath(os.path.join(base, path))
    return p if p == base or p.startswith(base + os.sep) else None


def main(argv=None):
    ap = argparse.ArgumentParser(description=${JSON.stringify(d)})
    ap.add_argument("file")
    ap.add_argument("--root", default=".")
    a = ap.parse_args(argv)
    p = inside(a.root, a.file)
    if not p or not os.path.isfile(p):
        print(f"${n}: {a.file} is not a file inside {a.root}", file=sys.stderr)
        return 2
    with open(p, encoding="utf-8", errors="replace") as fh:
        lines = fh.read().splitlines()
    print(json.dumps({"file": a.file, "lines": len(lines), "words": sum(len(x.split()) for x in lines), "longest": max((len(x) for x in lines), default=0)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
`;
  }
  return { name: n, description: d, kind: kind === "python-tool" ? "python-tool" : "checklist", files };
}

// A pasted SKILL.md: read its name and description from the front matter.
export function readSkillMd(text) {
  const t = String(text || "");
  if (t.length > 64 * 1024) throw Object.assign(new Error("Keep SKILL.md under 64 KB."), { status: 400 });
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(t);
  if (!fm) throw Object.assign(new Error("SKILL.md needs front matter with name and description."), { status: 400 });
  const name = ((/^name:\s*(.+)$/m.exec(fm[1]) || [])[1] || "").trim();
  const description = ((/^description:\s*(.+)$/m.exec(fm[1]) || [])[1] || "").trim();
  if (!NAME_RE.test(name)) throw Object.assign(new Error("The front matter's name must be 3 to 41 lower-case letters, digits or hyphens."), { status: 400 });
  if (description.length < 10) throw Object.assign(new Error("The front matter needs a description."), { status: 400 });
  return { name, description: description.slice(0, 300), kind: "pasted", files: { "SKILL.md": t } };
}
