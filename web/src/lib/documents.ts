// Documents (ADR-029): the files sent from the phone, previewed in the app, and Director 00's ledger as Word/Excel.
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { previewOffice, writeDocx, writeXlsx, type Cell, type Preview } from "./office.ts";
import { writePptx } from "./pptx.ts";

export type DocItem = { name: string; type: string; size: number; modified: string };
export type DocPreview = Preview | { kind: "text"; text: string } | { kind: "binary"; type: string };

const TYPE: Record<string, string> = { docx: "word", xlsx: "excel", pptx: "powerpoint", pdf: "pdf", png: "image", jpg: "image", webp: "image", heic: "image", txt: "text", md: "text" };
// Only names the intake itself writes: date-random-name.ext, no separators, no dot-dot.
const SAFE = /^\d{8}-[0-9a-f]{8}-[\p{L}\p{N}_-]{1,80}\.(docx|xlsx|pptx|pdf|png|jpg|webp|heic|txt|md)$/u;

export const isSafeName = (name: string) => SAFE.test(name);

export async function listDocs(dir: string): Promise<DocItem[]> {
  const names = await readdir(dir).catch(() => [] as string[]);
  const items = await Promise.all(names.filter(isSafeName).map(async name => {
    const s = await stat(path.join(dir, name));
    return { name, type: TYPE[name.split(".").pop()!] ?? "file", size: s.size, modified: s.mtime.toISOString() };
  }));
  return items.sort((a, b) => b.modified.localeCompare(a.modified));
}

export async function previewDoc(dir: string, name: string): Promise<DocPreview> {
  if (!isSafeName(name)) throw new Error("unknown file");
  const ext = name.split(".").pop()!, buf = await readFile(path.join(dir, name));
  if (ext === "docx" || ext === "xlsx" || ext === "pptx") return previewOffice(buf);
  if (ext === "txt" || ext === "md") return { kind: "text", text: buf.toString("utf8").slice(0, 50_000) };
  return { kind: "binary", type: TYPE[ext] ?? "file" };
}

type Approval = { thread_id: string; request: string; status: string; risk: string | null; decided_by: string | null; decided_at: string | null; created_at: string };
type Rejection = { thread_id: string; code: string; stage: string | null; reason: string | null; rejected_by: string | null; created_at: string };

export function ledgerRows(approvals: Approval[], rejections: Rejection[]) {
  const level = (r: string | null) => { try { return (JSON.parse(r ?? "{}") as { level?: string }).level ?? ""; } catch { return ""; } };
  const a: Cell[][] = [["Thread", "Request", "Status", "Risk", "Decided by", "Decided at", "Created"],
    ...approvals.map(x => [x.thread_id, x.request, x.status, level(x.risk), x.decided_by, x.decided_at, x.created_at])];
  const r: Cell[][] = [["Thread", "Code", "Stage", "Reason", "Rejected by", "When"],
    ...rejections.map(x => [x.thread_id, x.code, x.stage, x.reason, x.rejected_by, x.created_at])];
  return { a, r };
}

/** Director 00's ledger as an Excel workbook (two sheets), a Word report or a PowerPoint briefing. */
export function ledgerFile(format: "xlsx" | "docx" | "pptx", approvals: Approval[], rejections: Rejection[], now = new Date()): Buffer {
  const { a, r } = ledgerRows(approvals, rejections);
  if (format === "xlsx") return writeXlsx([{ name: "Approvals", rows: a }, { name: "Rejections", rows: r }]);
  const pending = approvals.filter(x => x.status === "pending" || x.status === "escalated");
  if (format === "pptx") {
    const codes = new Map<string, number>();
    for (const x of rejections) codes.set(x.code, (codes.get(x.code) ?? 0) + 1);
    const clip = (s: string) => (s.length > 110 ? `${s.slice(0, 107)}…` : s);
    return writePptx([
      { title: "Director 00 briefing", subtitle: `OMEGA PRIME · ${now.toISOString().slice(0, 10)}` },
      { title: "At a glance", big: [
        { value: String(pending.length), label: "Waiting for approval" },
        { value: String(approvals.filter(x => x.status === "executed" || x.status === "approved").length), label: "Approved" },
        { value: String(rejections.length), label: "Rejected" }] },
      { title: "Waiting for your approval", bullets: pending.length ? pending.slice(0, 7).map(x => clip(x.request)) : ["Nothing is waiting."] },
      { title: "Why proposals were rejected", bullets: codes.size ? [...codes].sort((p, q) => q[1] - p[1]).map(([c, k]) => `${c}: ${k}`) : ["No rejections yet."] },
    ]);
  }
  return writeDocx([
    { text: "OMEGA PRIME · Director 00 ledger", style: "title" },
    { text: `Generated ${now.toISOString().slice(0, 16).replace("T", " ")} UTC · ${approvals.length} proposals · ${rejections.length} rejections`, style: "muted" },
    { text: `Waiting for approval (${pending.length})`, style: "heading" },
    ...(pending.length ? pending.map(x => ({ text: `${x.thread_id} · ${x.created_at}\n${x.request}` })) : [{ text: "Nothing is waiting.", style: "muted" as const }]),
    { text: "Recent rejections", style: "heading" },
    ...rejections.slice(0, 50).map(x => ({ text: `${x.code} · ${x.thread_id} · ${x.created_at}${x.reason ? `\n${x.reason}` : ""}` })),
  ]);
}
