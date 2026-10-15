// Word, Excel and PowerPoint inside OMEGA (ADR-029): read .docx/.xlsx/.pptx into previews, and write Director 00
// reports as real .docx and .xlsx files. Office Open XML is zip + XML, so this is plain TypeScript on top of zip.ts.
import { readZip, writeZip } from "./zip.ts";

export type OfficeKind = "docx" | "xlsx" | "pptx";
export type Cell = string | number | boolean | null;
export type Preview =
  | { kind: "docx"; blocks: { text: string; heading: boolean }[] }
  | { kind: "xlsx"; sheets: { name: string; rows: Cell[][]; truncated: boolean }[] }
  | { kind: "pptx"; slides: { n: number; lines: string[] }[] };

const MAX_ROWS = 200, MAX_COLS = 30;

export function unescapeXml(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, "&");
}
export function escapeXml(s: string): string {
  // Also drops characters XML 1.0 forbids, which would make Office refuse the file.
  return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Which Office format a zip holds, from its parts (not its file name). */
export function officeKind(names: Iterable<string>): OfficeKind | null {
  const set = new Set(names);
  if (!set.has("[Content_Types].xml")) return null;
  if (set.has("word/document.xml")) return "docx";
  if (set.has("xl/workbook.xml")) return "xlsx";
  if (set.has("ppt/presentation.xml")) return "pptx";
  return null;
}

const texts = (xml: string, tag: string) => [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g"))].map(m => unescapeXml(m[1]));

/** Style ids that are headings. Ids are localised (an Arabic Word writes "1"), but style names stay "heading 1"/"Title". */
function headingStyles(styles: string): Set<string> {
  const ids = new Set<string>();
  for (const m of styles.matchAll(/<w:style\b[^>]*w:styleId="([^"]+)"[^>]*>([\s\S]*?)<\/w:style>/g))
    if (/<w:name w:val="(heading \d|title)"/i.test(m[2])) ids.add(m[1]);
  return ids;
}

function previewDocx(doc: string, styles = ""): Preview {
  const heads = headingStyles(styles);
  const blocks: { text: string; heading: boolean }[] = [];
  for (const m of doc.matchAll(/<w:p[\s>][\s\S]*?<\/w:p>/g)) {
    const p = m[0].replace(/<w:(?:br|cr)\b[^>]*\/>/g, "<w:t>\n</w:t>").replace(/<w:tab\/>/g, "<w:t>\t</w:t>");
    const text = texts(p, "w:t").join("").trim();
    const style = p.match(/<w:pStyle w:val="([^"]+)"/)?.[1] ?? "";
    if (text) blocks.push({ text, heading: heads.has(style) || /^(heading|title)/i.test(style) });
    if (blocks.length >= 2000) break;
  }
  return { kind: "docx", blocks };
}

/** "BC12" -> column index 54 (0-based). */
export function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, "").toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function previewXlsx(z: Map<string, Buffer>): Preview {
  const str = (n: string) => z.get(n)?.toString("utf8") ?? "";
  const shared = [...str("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => texts(m[1], "t").join(""));
  const rels = new Map([...str("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*>/g)].map(m => [
    m[0].match(/Id="([^"]+)"/)?.[1] ?? "", (m[0].match(/Target="([^"]+)"/)?.[1] ?? "").replace(/^\/?xl\//, "").replace(/^\//, ""),
  ]));
  const sheets = [...str("xl/workbook.xml").matchAll(/<sheet\b[^>]*>/g)].slice(0, 12).map(m => {
    const name = unescapeXml(m[0].match(/name="([^"]*)"/)?.[1] ?? "Sheet"), rid = m[0].match(/r:id="([^"]+)"/)?.[1] ?? "";
    const xml = str(`xl/${rels.get(rid) ?? ""}`), rows: Cell[][] = [];
    let truncated = false;
    for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g)) {
      if (rows.length >= MAX_ROWS) { truncated = true; break; }
      const row: Cell[] = [];
      for (const c of (r[1] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1], inner = c[2] ?? "", ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1];
        const col = ref ? colIndex(ref) : row.length;
        if (col >= MAX_COLS) { truncated = true; continue; }
        const t = attrs.match(/t="(\w+)"/)?.[1], v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        const val: Cell = t === "s" ? shared[Number(v)] ?? "" : t === "inlineStr" ? texts(inner, "t").join("")
          : t === "b" ? v === "1" : t === "str" || t === "e" ? unescapeXml(v ?? "") : v === undefined ? null : Number(v);
        while (row.length < col) row.push(null);
        row[col] = val;
      }
      rows.push(row);
    }
    return { name, rows, truncated };
  });
  return { kind: "xlsx", sheets };
}

function previewPptx(z: Map<string, Buffer>): Preview {
  const slides = [...z.keys()].map(n => n.match(/^ppt\/slides\/slide(\d+)\.xml$/)).filter(Boolean)
    .map(m => Number(m![1])).sort((a, b) => a - b).slice(0, 300)
    .map(n => {
      const xml = z.get(`ppt/slides/slide${n}.xml`)!.toString("utf8");
      const lines = [...xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)].map(p => texts(p[1], "a:t").join("").trim()).filter(Boolean);
      return { n, lines };
    });
  return { kind: "pptx", slides };
}

export function previewOffice(buf: Buffer): Preview {
  const z = readZip(buf, n => n.endsWith(".xml") || n.endsWith(".rels"));
  const kind = officeKind(z.keys());
  if (kind === "docx") return previewDocx(z.get("word/document.xml")!.toString("utf8"), z.get("word/styles.xml")?.toString("utf8"));
  if (kind === "xlsx") return previewXlsx(z);
  if (kind === "pptx") return previewPptx(z);
  throw new Error("not a Word, Excel or PowerPoint file");
}

const RTL = /[֐-ࣿיִ-﷿ﹰ-ﻼ]/;
const CT = (overrides: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides}</Types>`;
const ROOT_RELS = (target: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${target}"/></Relationships>`;

/** A Word document. Arabic paragraphs are set right-to-left. Headings are bold and larger. */
export function writeDocx(blocks: { text: string; style?: "title" | "heading" | "body" | "muted" }[]): Buffer {
  const para = ({ text, style = "body" }: { text: string; style?: string }) => {
    const rtl = RTL.test(text), size = style === "title" ? 36 : style === "heading" ? 28 : 22;
    const rPr = `<w:rPr>${style === "title" || style === "heading" ? "<w:b/><w:bCs/>" : ""}${style === "muted" ? '<w:color w:val="667788"/>' : ""}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>${rtl ? "<w:rtl/>" : ""}</w:rPr>`;
    const lines = text.split("\n").map(escapeXml);
    const runs = lines.map((l, i) => `<w:r>${rPr}${i ? "<w:br/>" : ""}<w:t xml:space="preserve">${l}</w:t></w:r>`).join("");
    return `<w:p><w:pPr>${rtl ? "<w:bidi/>" : ""}<w:spacing w:after="${style === "title" ? 240 : 120}"/></w:pPr>${runs}</w:p>`;
  };
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${blocks.map(para).join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1200" w:bottom="1440" w:left="1200" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  return writeZip([
    ["[Content_Types].xml", CT('<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>')],
    ["_rels/.rels", ROOT_RELS("word/document.xml")],
    ["word/document.xml", doc],
  ]);
}

/** An Excel workbook: one sheet per entry, first row bold and frozen, inline strings (no shared-string table). */
export function writeXlsx(sheets: { name: string; rows: Cell[][]; rtl?: boolean }[]): Buffer {
  const colName = (i: number) => { let s = ""; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
  const safeName = (n: string, i: number) => (n.replace(/[\\/?*[\]:]/g, " ").slice(0, 31).trim() || `Sheet${i + 1}`);
  const sheetXml = (rows: Cell[][], rtl = false) => {
    const body = rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => {
      const ref = `${colName(c)}${r + 1}`, s = r === 0 ? ' s="1"' : "";
      if (v === null || v === undefined || v === "") return "";
      if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"${s}><v>${v}</v></c>`;
      if (typeof v === "boolean") return `<c r="${ref}"${s} t="b"><v>${v ? 1 : 0}</v></c>`;
      return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(v)).slice(0, 32000)}</t></is></c>`;
    }).join("")}</row>`).join("");
    const widths = (rows[0] ?? []).map((_, c) => {
      const w = Math.min(60, Math.max(8, ...rows.slice(0, 200).map(r => String(r[c] ?? "").length + 2)));
      return `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`;
    }).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"${rtl ? ' rightToLeft="1"' : ""}><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${widths ? `<cols>${widths}</cols>` : ""}<sheetData>${body}</sheetData></worksheet>`;
  };
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`;
  const names = sheets.map((s, i) => safeName(s.name, i));
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${escapeXml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`;
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  return writeZip([
    ["[Content_Types].xml", CT(`<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}`)],
    ["_rels/.rels", ROOT_RELS("xl/workbook.xml")],
    ["xl/workbook.xml", workbook],
    ["xl/_rels/workbook.xml.rels", wbRels],
    ["xl/styles.xml", styles],
    ...sheets.map((s, i): [string, string] => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s.rows, s.rtl)]),
  ]);
}
