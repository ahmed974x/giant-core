// Phone intake (ADR-025): a note, task, link or file sent from the phone becomes a Director 00 proposal.
// PIN + same-origin + throttle as for approvals; files are byte-checked and stored under services/director00/data/inbox.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { directorDir, makeThrottle, pinOk, runDirector } from "@/lib/director";
import { directorRequest, MAX_FILE, sniff, storedName, validate } from "@/lib/intake";
import { excerpt, readPage } from "@/lib/reader";

const throttle = makeThrottle();

export async function POST(req: Request) {
  const origin = req.headers.get("origin"), host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try { if (origin && new URL(origin).host !== host) return Response.json({ error: "forbidden" }, { status: 403 }); }
  catch { return Response.json({ error: "forbidden" }, { status: 403 }); }
  const id = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  if (throttle.blocked(id)) return Response.json({ error: "too many wrong PINs; try again in 15 minutes" }, { status: 429 });
  if (!process.env.DIRECTOR_WEB_PIN) return Response.json({ error: "sending is off: set DIRECTOR_WEB_PIN in web/.env.local" }, { status: 403 });

  const form = await req.formData().catch(() => null);
  if (!form) return Response.json({ error: "bad form" }, { status: 400 });
  if (!pinOk(form.get("pin"), process.env.DIRECTOR_WEB_PIN)) {
    throttle.fail(id);
    return Response.json({ error: "wrong PIN" }, { status: 401 });
  }

  let item;
  try { item = validate(form.get("kind"), form.get("text"), form.get("url")); }
  catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }

  let attachment = "";
  const file = form.get("file");
  if (file && typeof file !== "string" && file.size > 0) {
    if (file.size > MAX_FILE) return Response.json({ error: "file is larger than 8 MB" }, { status: 413 });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = sniff(bytes);
    if (!type) return Response.json({ error: "only images, PDFs and plain text can be sent" }, { status: 415 });
    const name = storedName(file.name, type.ext);
    const dir = path.join(directorDir(), "data", "inbox");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, name), bytes, { flag: "wx" });
    attachment = `inbox/${name}`;
  }

  // Links get a readable snapshot (ADR-026): stored next to attachments, summarised in the request. Failure is not fatal.
  let snapshot = "", reader: string | null = null, note = item.text;
  if (item.kind === "link") {
    try {
      const page = await readPage(item.url);
      const name = storedName(page.title || new URL(item.url).hostname, "md");
      const dir = path.join(directorDir(), "data", "inbox");
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, name), `# ${page.title || item.url}\n\n<${item.url}>\n\n${page.text}\n`, { flag: "wx" });
      snapshot = `inbox/${name}`; reader = page.source;
      const ex = excerpt(page);
      if (ex) note = [item.text.trim(), ex].filter(Boolean).join(" — ");
    } catch (e) { reader = `unread: ${(e as Error).message}`; }
  }

  try {
    const request = directorRequest(item.kind, note, item.url, attachment) + (snapshot ? ` [snapshot: ${snapshot}]` : "");
    const out = await runDirector(["ask", request]) as { thread_id: string; status: string };
    return Response.json({ ok: true, thread_id: out.thread_id, status: out.status, attachment: attachment || null, snapshot: snapshot || null, reader });
  } catch (e) {
    return Response.json({ error: (e as Error).message, attachment: attachment || null }, { status: 502 });
  }
}

export const dynamic = "force-dynamic";
