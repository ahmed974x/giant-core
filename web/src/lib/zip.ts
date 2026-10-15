// Minimal zip reader and writer for Office files (ADR-029). Word, Excel and PowerPoint files are zip archives of XML,
// so no Office suite or zip dependency is needed. The reader enforces limits so a hostile file can't exhaust memory.
import { crc32, inflateRawSync } from "node:zlib";

export const LIMITS = { entries: 3000, entryBytes: 40 * 1024 * 1024, totalBytes: 120 * 1024 * 1024 };

/** Entries by name. Reads the central directory, so data descriptors and odd local headers are handled. */
export function readZip(buf: Buffer, want?: (name: string) => boolean): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip file");
  const count = buf.readUInt16LE(eocd + 10), dirOffset = buf.readUInt32LE(eocd + 16);
  if (count > LIMITS.entries) throw new Error("too many entries");
  const out = new Map<string, Buffer>();
  let p = dirOffset, total = 0;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad central directory");
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42), name = buf.toString("utf8", p + 46, p + 46 + nlen);
    p += 46 + nlen + xlen + clen;
    if (name.endsWith("/") || (want && !want(name))) continue;
    if (usize > LIMITS.entryBytes || (total += usize) > LIMITS.totalBytes) throw new Error("archive expands too much");
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error("bad local header");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const body = buf.subarray(start, start + csize);
    const data = method === 0 ? Buffer.from(body) : method === 8 ? inflateRawSync(body, { maxOutputLength: LIMITS.entryBytes }) : null;
    if (!data) throw new Error(`unsupported compression ${method}`);
    out.set(name, data);
  }
  return out;
}

/** A stored (uncompressed) zip. Office opens these fine; files stay small because the XML is short. */
export function writeZip(files: [string, string | Buffer][]): Buffer {
  const locals: Buffer[] = [], dir: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of files) {
    const data = typeof content === "string" ? Buffer.from(content, "utf8") : content, nm = Buffer.from(name, "utf8");
    const crc = crc32(data) >>> 0;
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(0, 8);
    h.writeUInt32LE(0, 10); h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(nm.length, 26); h.writeUInt16LE(0, 28);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(0, 10);
    c.writeUInt32LE(0, 12); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(nm.length, 28); c.writeUInt32LE(offset, 42);
    locals.push(h, nm, data); dir.push(c, nm);
    offset += 30 + nm.length + data.length;
  }
  const dirBuf = Buffer.concat(dir), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dirBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dirBuf, end]);
}
