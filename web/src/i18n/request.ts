import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  // Gulf time by default (UTC+3); override with OMEGA_TZ.
  return { locale, timeZone: process.env.OMEGA_TZ ?? "Asia/Qatar", messages: (await import(`../../messages/${locale}.json`)).default };
});
