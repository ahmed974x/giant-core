// Shared @font-face block for Jarvis pages (ADR-133). Node standard library only.
// Each face tries a font installed on the machine first (local()), then the vendored WOFF2 embedded
// as a data: URI, so every page works offline from file:// under `font-src data:`.
// "Inter Fallback" maps a system face onto Inter's measured vertical metrics, so line boxes do not
// move if the embedded face is ever unavailable (values from jarvis/scripts/font-metrics.mjs).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { metrics } from "../font-metrics.mjs";

const FACES = [
  { family: "Inter Variable", file: "inter-latin-wght-normal.woff2", weight: "100 900", local: ["Inter Variable", "Inter"],
    range: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD" },
  { family: "Geist Mono Variable", file: "geist-mono-latin-wght-normal.woff2", weight: "100 900", local: ["Geist Mono Variable", "Geist Mono"],
    range: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD" },
  { family: "Readex Pro Variable", file: "readex-pro-arabic-wght-normal.woff2", weight: "160 700", local: ["Readex Pro Variable", "Readex Pro"],
    range: "U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC" },
];

const pct = v => `${(v * 100).toFixed(1)}%`;

// only: optional list of family names to include (the Studio preview needs Inter and Readex only).
export function fontFaceCss(repoRoot, only) {
  const dir = join(repoRoot, "jarvis", "fonts");
  const out = [];
  for (const f of FACES) {
    if (only && !only.includes(f.family)) continue;
    const b64 = readFileSync(join(dir, f.file)).toString("base64");
    const locals = f.local.map(n => `local("${n}")`).join(", ");
    out.push(`@font-face { font-family: "${f.family}"; font-style: normal; font-weight: ${f.weight}; font-display: swap;
  src: ${locals}, url(data:font/woff2;base64,${b64}) format("woff2");
  unicode-range: ${f.range}; }`);
  }
  const inter = metrics(readFileSync(join(dir, FACES[0].file)));
  out.push(`@font-face { font-family: "Inter Fallback"; src: local("Arial"), local("Helvetica Neue"), local("Liberation Sans"), local("Roboto");
  ascent-override: ${pct(inter.ascentEm)}; descent-override: ${pct(inter.descentEm)}; line-gap-override: 0%; }`);
  return out.join("\n");
}
