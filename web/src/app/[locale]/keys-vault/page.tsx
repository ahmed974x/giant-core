import { getTranslations, setRequestLocale } from "next-intl/server";
import KeysVault from "@/components/KeysVault";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return { title: (await getTranslations({ locale, namespace: "vault" }))("title"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

// The token arrives in the link (?token=…); the page removes it from the address bar as soon as it loads.
export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ token?: string }> }) {
  setRequestLocale((await params).locale);
  const { token } = await searchParams;
  return <KeysVault token={typeof token === "string" ? token.slice(0, 100) : ""} />;
}

export const dynamic = "force-dynamic";
