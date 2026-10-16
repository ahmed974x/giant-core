import { getTranslations, setRequestLocale } from "next-intl/server";
import Account from "@/components/Account";
import { authEnabled, configuredProviders } from "@/lib/accounts";
import { currentUserKey } from "@/lib/auth";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return { title: (await getTranslations({ locale, namespace: "account" }))("title") };
}

/** Account and profile (ADR-075). Sign-in is through NextAuth; off until it is configured in web/.env.local. */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const enabled = authEnabled();
  const signedIn = enabled ? Boolean(await currentUserKey().catch(() => null)) : false;
  return <Account enabled={enabled} signedIn={signedIn} providers={configuredProviders()} locale={locale} />;
}

export const dynamic = "force-dynamic";
