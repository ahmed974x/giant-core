import { getTranslations, setRequestLocale } from "next-intl/server";
import SendBox from "@/components/SendBox";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return { title: (await getTranslations({ locale, namespace: "nav" }))("send") };
}

type Shared = { title?: string; text?: string; url?: string };

// Also the PWA share target: sharing from any phone app opens this page with ?title=&text=&url= prefilled.
export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Shared> }) {
  setRequestLocale((await params).locale);
  const q = await searchParams;
  const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 1500) : "");
  // Android often puts the shared link in "text"; pull it out so it lands in the link field.
  let text = [str(q.title), str(q.text)].filter(Boolean).join("\n"), url = str(q.url);
  if (!url) {
    const m = text.match(/https?:\/\/\S+/);
    if (m) { url = m[0]; text = text.replace(m[0], "").trim(); }
  }
  return <SendBox initialText={text} initialUrl={url} />;
}

export const dynamic = "force-dynamic";
