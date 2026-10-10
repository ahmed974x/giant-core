// Shared GDELT 2.0 helpers: the 15-minute "lastupdate" index and its single-file zip exports.
import { inflateRawSync } from "node:zlib";

export type GdeltFile = "export" | "mentions" | "gkg";

/** URL of the newest 15-minute file of the given kind (https). */
export async function latestUrl(kind: GdeltFile): Promise<string> {
  const idx = await fetch("https://data.gdeltproject.org/gdeltv2/lastupdate.txt", { signal: AbortSignal.timeout(10_000), cache: "no-store" });
  if (!idx.ok) throw new Error(`gdelt index ${idx.status}`);
  const line = (await idx.text()).split("\n").find(l => l.includes(`.${kind}.`));
  const url = line?.split(" ")[2]?.trim().replace(/^http:/, "https:");
  if (!url) throw new Error(`no ${kind} file in the GDELT index`);
  return url;
}

/** A GDELT zip holds exactly one deflated CSV; read its local header and inflate it (no zip dependency). */
export function unzipSingle(buf: Buffer): string {
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error("not a zip");
  const method = buf.readUInt16LE(8), nameLen = buf.readUInt16LE(26), extraLen = buf.readUInt16LE(28);
  let size = buf.readUInt32LE(18);
  const start = 30 + nameLen + extraLen;
  if (size === 0) size = buf.length - start; // sizes in a data descriptor: inflate stops at the end of the stream
  const body = buf.subarray(start, start + size);
  return (method === 8 ? inflateRawSync(body) : body).toString("utf8");
}

export async function fetchCsv(url: string): Promise<string> {
  const r = await fetch(url, { signal: AbortSignal.timeout(45_000), cache: "no-store" });
  if (!r.ok) throw new Error(`gdelt file ${r.status}`);
  return unzipSingle(Buffer.from(await r.arrayBuffer()));
}

/** "20261010003000" in a GDELT file name -> ISO time. */
export function stampOf(url: string): string {
  const m = url.match(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : new Date().toISOString();
}
