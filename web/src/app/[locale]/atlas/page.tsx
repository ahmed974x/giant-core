import { getTranslations, setRequestLocale } from "next-intl/server";
import AwesomeAtlas from "@/components/AwesomeAtlas";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return { title: (await getTranslations({ locale, namespace: "atlas" }))("title") };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  return <AwesomeAtlas />;
}
