#!/usr/bin/env node
// Reads vertical metrics straight from WOFF2 files (ADR-133), so jarvis/replica/design/measurements.md
// cites numbers taken from the fonts themselves. Node standard library only (zlib Brotli), no network.
//
//   node jarvis/scripts/font-metrics.mjs jarvis/fonts/*.woff2          # table
//   node jarvis/scripts/font-metrics.mjs --json jarvis/fonts/*.woff2   # JSON
//
// WOFF2 (W3C Recommendation): a header, a table directory with UIntBase128 lengths, then one Brotli
// stream holding every table back to back. head, hhea and OS/2 are never transformed, so they are
// read as plain OpenType tables once the stream is inflated.
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { basename } from "node:path";

const KNOWN = ["cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep",
  "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS",
  "GSUB", "EBSC", "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln",
  "cvar", "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf",
  "Silf", "Glat", "Gloc", "Feat", "Sill"];

export function readWoff2(buf) {
  if (buf.toString("latin1", 0, 4) !== "wOF2") throw new Error("not a WOFF2 file");
  const numTables = buf.readUInt16BE(12);
  let p = 48;
  const base128 = () => { let v = 0; for (let i = 0; i < 5; i++) { const b = buf[p++]; v = v * 128 + (b & 0x7f); if (!(b & 0x80)) return v; } throw new Error("bad UIntBase128"); };
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const flags = buf[p++];
    const tagIdx = flags & 0x3f;
    let tag;
    if (tagIdx === 63) { tag = buf.toString("latin1", p, p + 4); p += 4; } else tag = KNOWN[tagIdx];
    const version = (flags >> 6) & 3;
    const origLength = base128();
    const transformed = (tag === "glyf" || tag === "loca") ? version !== 3 : version !== 0;
    const length = transformed ? base128() : origLength;
    tables.push({ tag, length });
  }
  const data = brotliDecompressSync(buf.subarray(p));
  const out = {};
  let off = 0;
  for (const t of tables) { out[t.tag] = data.subarray(off, off + t.length); off += t.length; }
  return out;
}

export function metrics(buf) {
  const t = readWoff2(buf);
  const head = t.head, hhea = t.hhea, os2 = t["OS/2"];
  const upm = head.readUInt16BE(18);
  const m = {
    unitsPerEm: upm,
    hheaAscender: hhea.readInt16BE(4), hheaDescender: hhea.readInt16BE(6), hheaLineGap: hhea.readInt16BE(8),
    typoAscender: os2.readInt16BE(68), typoDescender: os2.readInt16BE(70), typoLineGap: os2.readInt16BE(72),
    winAscent: os2.readUInt16BE(74), winDescent: os2.readUInt16BE(76),
    useTypoMetrics: Boolean(os2.readUInt16BE(62) & (1 << 7)),
    xHeight: os2.readUInt16BE(0) >= 2 ? os2.readInt16BE(86) : null,
    capHeight: os2.readUInt16BE(0) >= 2 ? os2.readInt16BE(88) : null,
  };
  // The line box browsers use: typo metrics when USE_TYPO_METRICS is set, else hhea.
  const asc = m.useTypoMetrics ? m.typoAscender : m.hheaAscender;
  const desc = m.useTypoMetrics ? m.typoDescender : m.hheaDescender;
  const gap = m.useTypoMetrics ? m.typoLineGap : m.hheaLineGap;
  m.contentHeightEm = +((asc - desc + gap) / upm).toFixed(3);
  m.ascentEm = +(asc / upm).toFixed(3);
  m.descentEm = +(-desc / upm).toFixed(3);
  m.capHeightEm = m.capHeight == null ? null : +(m.capHeight / upm).toFixed(3);
  m.xHeightEm = m.xHeight == null ? null : +(m.xHeight / upm).toFixed(3);
  return m;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const files = args.filter(a => a !== "--json");
  if (!files.length) { console.error("usage: node font-metrics.mjs [--json] <file.woff2>..."); process.exit(2); }
  const rows = files.map(f => ({ file: basename(f), ...metrics(readFileSync(f)) }));
  if (json) console.log(JSON.stringify(rows, null, 2));
  else for (const r of rows) console.log(`${r.file.padEnd(40)} upm ${r.unitsPerEm}  ascent ${r.ascentEm}  descent ${r.descentEm}  natural line ${r.contentHeightEm}  cap ${r.capHeightEm}  x ${r.xHeightEm}  typo ${r.useTypoMetrics}`);
}
