import { getTranslations, setRequestLocale } from "next-intl/server";
import Earth from "@/components/Earth";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return { title: (await getTranslations({ locale, namespace: "nav" }))("earth") };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  return <Earth />;
}
