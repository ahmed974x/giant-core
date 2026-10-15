// Major Gulf oil sites watched by the Oil Watch fire bot (ADR-047). No server imports, so the screen can use it too.
export type OilSite = { id: string; name: string; nameAr: string; lat: number; lon: number };
// Approximate centres of major Gulf export, processing and refining sites (public locations).
export const OIL_SITES: OilSite[] = [
  { id: "abqaiq", name: "Abqaiq processing", nameAr: "بقيق", lat: 25.93, lon: 49.67 },
  { id: "ras-tanura", name: "Ras Tanura terminal", nameAr: "رأس تنورة", lat: 26.64, lon: 50.16 },
  { id: "jubail", name: "Jubail industrial city", nameAr: "الجبيل", lat: 27.01, lon: 49.66 },
  { id: "ahmadi", name: "Mina al-Ahmadi refinery", nameAr: "ميناء الأحمدي", lat: 29.06, lon: 48.15 },
  { id: "basra", name: "Basra oil terminal", nameAr: "ميناء البصرة النفطي", lat: 29.68, lon: 48.81 },
  { id: "abadan", name: "Abadan refinery", nameAr: "عبادان", lat: 30.34, lon: 48.27 },
  { id: "kharg", name: "Kharg Island terminal", nameAr: "جزيرة خرج", lat: 29.24, lon: 50.31 },
  { id: "ras-laffan", name: "Ras Laffan LNG", nameAr: "رأس لفان", lat: 25.9, lon: 51.55 },
  { id: "ruwais", name: "Ruwais refinery", nameAr: "الرويس", lat: 24.11, lon: 52.73 },
  { id: "jebel-ali", name: "Jebel Ali", nameAr: "جبل علي", lat: 25.01, lon: 55.06 },
  { id: "fujairah", name: "Fujairah storage hub", nameAr: "الفجيرة", lat: 25.17, lon: 56.36 },
  { id: "bandar-abbas", name: "Bandar Abbas", nameAr: "بندر عباس", lat: 27.15, lon: 56.21 },
];
