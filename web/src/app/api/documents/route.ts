// Documents (ADR-029): list and preview files sent from the phone, or download Director 00's ledger as Word/Excel.
// Private: needs the PIN (x-omega-pin header), same origin, throttled. Files are only parsed as data, never opened.
import path from "node:path";
import { directorData, makeThrottle } from "@/lib/director";
import { ledgerFile, listDocs, previewDoc } from "@/lib/documents";
import { guard } from "@/lib/guard";
import { approvals, rejections } from "@/lib/ledger";

const throttle = makeThrottle();
const inbox = () => path.join(directorData(), "inbox");

export async function GET(req: Request) {
  const blocked = guard(req, req.headers.get("x-omega-pin"), throttle);
  if (blocked) return blocked;
  const p = new URL(req.url).searchParams;

  const format = p.get("export");
  if (format === "xlsx" || format === "docx" || format === "pptx") {
    {
      const file = ledgerFile(format, await approvals(directorData()) as never[], await rejections(directorData()) as never[]);
      const type = { xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }[format];
      return new Response(new Uint8Array(file), { headers: { "Content-Type": type, "Content-Disposition": `attachment; filename="omega-ledger-${new Date().toISOString().slice(0, 10)}.${format}"`, "Cache-Control": "no-store" } });
    }
  }

  const file = p.get("file");
  if (file) {
    try { return Response.json(await previewDoc(inbox(), file), { headers: { "Cache-Control": "no-store" } }); }
    catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
  }
  return Response.json({ items: await listDocs(inbox()) }, { headers: { "Cache-Control": "no-store" } });
}

export const dynamic = "force-dynamic";
