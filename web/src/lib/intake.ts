// Phone intake (ADR-025): whatever Ahmad sends from his phone becomes a Director 00 proposal waiting in the approval
// inbox. Nothing is acted on directly; files are only stored (never opened or executed) after their bytes are checked.
import { randomBytes } from "node:crypto";
import { officeKind } from "./office.ts";
import { readZip } from "./zip.ts";

export const KINDS = ["note", "task", "link"] as const;
export type Kind = (typeof KINDS)[number];
export const MAX_FILE = 8 * 1024 * 1024;

/** The request Director 00 receives. Its planner turns "remember: …" into a memory write, which waits for approval. */
export function directorRequest(kind: Kind, text: string, url = "", attachment = ""): string {
  const body = text.trim().replace(/\s+/g, " ").slice(0, 1500);
  const link = url.trim().slice(0, 500);
  const att = attachment ? ` [attachment: ${attachment}]` : "";
  if (kind === "task") return `remember: TASK: ${body}${att}`;
  if (kind === "link") return `remember: LINK: ${link}${body ? ` (${body})` : ""}${att}`;
  return `remember: ${body}${att}`;
}

export function validate(kind: unknown, text: unknown, url: unknown): { kind: Kind; text: string; url: string } {
  if (!(KINDS as readonly unknown[]).includes(kind)) throw new Error("choose note, task or link");
  const t = typeof text === "string" ? text : "", u = typeof url === "string" ? url.trim() : "";
  if (kind === "link") {
    if (!/^https?:\/\/[^\s]{3,}$/i.test(u)) throw new Error("paste a full http(s) link");
  } else if (t.trim().length < 3) {
    throw new Error("write at least 3 characters");
  }
  return { kind: kind as Kind, text: t, url: u };
}

const OFFICE_MIME = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
} as const;

/** File type from its bytes, not its name: images, PDFs, plain text and Word/Excel/PowerPoint (checked inside the zip). */
export function sniff(bytes: Uint8Array): { ext: string; mime: string } | null {
  const b = bytes, ascii = (from: number, n: number) => String.fromCharCode(...b.subarray(from, from + n));
  if (b.length >= 4 && ascii(0, 4) === "%PDF") return { ext: "pdf", mime: "application/pdf" };
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, 3) === "PNG") return { ext: "png", mime: "image/png" };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return { ext: "webp", mime: "image/webp" };
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4) {
    try {
      const kind = officeKind(readZip(Buffer.from(b), n => n === "[Content_Types].xml" || /^(word\/document|xl\/workbook|ppt\/presentation)\.xml$/.test(n)).keys());
      // Macro-enabled files (.docm/.xlsm/.pptm) have a vbaProject part; refuse those rather than store code.
      if (kind && !/vbaProject/.test(Buffer.from(b).toString("latin1"))) return { ext: kind, mime: OFFICE_MIME[kind] };
    } catch { /* not a readable zip */ }
    return null;
  }
  if (b.length >= 12 && ascii(4, 4) === "ftyp" && /^(heic|heix|mif1|msf1)$/.test(ascii(8, 4))) return { ext: "heic", mime: "image/heic" };
  const head = b.subarray(0, Math.min(b.length, 4096));
  if (head.length && !head.includes(0)) {
    try { new TextDecoder("utf-8", { fatal: true }).decode(head); return { ext: "txt", mime: "text/plain" }; } catch { /* binary */ }
  }
  return null;
}

/** A safe stored name: date, random id, and a cleaned version of the original name (no paths, no odd characters). */
export function storedName(original: string, ext: string, now = new Date()): string {
  const base = original.replace(/^.*[\\/]/, "").replace(/\.[^.]*$/, "").normalize("NFKC")
    .replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "file";
  const day = now.toISOString().slice(0, 10).replace(/-/g, "");
  return `${day}-${randomBytes(4).toString("hex")}-${base}.${ext}`;
}
