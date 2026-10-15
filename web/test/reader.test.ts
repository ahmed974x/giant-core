import { test } from "node:test";
import assert from "node:assert/strict";
import { excerpt, htmlToText, isPrivateAddress, readPage } from "../src/lib/reader.ts";

const PUBLIC = "http://93.184.216.34/article";
const html = (body: string, type = "text/html; charset=utf-8", status = 200, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { "content-type": type, ...headers } });

test("private and special addresses are refused", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.8.3", "172.20.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:192.168.1.1"])
    assert.ok(isPrivateAddress(ip), ip);
  for (const ip of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:4700::1111"]) assert.ok(!isPrivateAddress(ip), ip);
});

test("htmlToText keeps the article and drops scripts and chrome", () => {
  const out = htmlToText(`<html><head><title>Port &amp; rates</title><script>alert(1)</script></head><body>
    <nav>menu</nav><article><h1>Suez</h1><p>Transit fees rose 15%.</p><style>p{}</style></article><footer>c</footer></body></html>`);
  assert.equal(out.title, "Port & rates");
  assert.match(out.text, /Suez\nTransit fees rose 15%\./);
  assert.doesNotMatch(out.text, /alert|menu|p\{\}/);
  assert.equal(htmlToText(`<p data-mw='{"a":">x<"}'>clean</p>`).text, "clean", "quoted > inside attributes");
});

test("Firecrawl is used when a key is set", async () => {
  let called = "";
  const f = (async (url: string | URL, init?: RequestInit) => {
    called = String(url);
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer fc-test");
    return Response.json({ success: true, data: { markdown: "# Hello\n\nworld", metadata: { title: "Hello" } } });
  }) as typeof fetch;
  const page = await readPage(PUBLIC, { FIRECRAWL_API_KEY: "fc-test" }, f);
  assert.equal(called, "https://api.firecrawl.dev/v2/scrape");
  assert.deepEqual(page, { title: "Hello", text: "# Hello\n\nworld", source: "firecrawl" });
});

test("a Firecrawl failure falls back to the local reader", async () => {
  const f = (async (url: string | URL) =>
    String(url).includes("firecrawl") ? Response.json({ success: false, error: "quota" }, { status: 402 })
      : html("<title>Local</title><p>body text</p>")) as typeof fetch;
  const page = await readPage(PUBLIC, { FIRECRAWL_API_KEY: "fc-test" }, f);
  assert.equal(page.source, "local");
  assert.equal(page.title, "Local");
});

test("the local reader refuses private targets, including via redirect", async () => {
  const f = (async (url: string | URL) =>
    String(url).startsWith(PUBLIC) ? html("", "text/html", 302, { location: "http://127.0.0.1:3100/api/director" }) : html("secret")) as typeof fetch;
  await assert.rejects(readPage("http://192.168.8.3:8443/", {}, f), /private/);
  await assert.rejects(readPage("http://localhost:5678/", {}, f), /private/);
  await assert.rejects(readPage(PUBLIC, {}, f), /private/);
  await assert.rejects(readPage("file:///C:/Windows/win.ini", {}, f), /http/);
});

test("non-pages are not read locally", async () => {
  const f = (async () => html("%PDF-1.7", "application/pdf")) as typeof fetch;
  await assert.rejects(readPage(PUBLIC, {}, f), /not a web page/);
});

test("excerpt gives title and a clean opening", () => {
  assert.equal(excerpt({ title: "T", text: "## Big **news** here", source: "local" }), "Title: T — Excerpt: Big news here");
  assert.equal(excerpt({ title: "", text: "", source: "local" }), "");
});
