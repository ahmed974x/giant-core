import { getTranslations, setRequestLocale } from "next-intl/server";
import AwesomeAtlas from "@/components/AwesomeAtlas";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return { title: (await getTranslations({ locale, namespace: "atlas" }))("title") };
}

export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ cat?: string }> }) {
  setRequestLocale((await params).locale);
  const { cat } = await searchParams;
  return <AwesomeAtlas initialCat={typeof cat === "string" ? cat.slice(0, 80) : ""} />;
}
