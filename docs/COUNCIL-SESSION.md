# Council Session (جلسة المجلس) — service design

Status: **design only — not for sale.** No price, payment, publishing or outreach until the open items in §6 are closed. See ADR-068.
الحالة: **تصميم فقط، غير معروض للبيع.** لا سعر ولا دفع ولا نشر ولا تواصل مع أحد قبل إغلاق البنود في القسم 6.

## 1. What the customer receives / ماذا يستلم العميل
- **Topic:** the customer picks one topic (a sector, a commodity, an event, a technology). / العميل يختار موضوعاً واحداً.
- **Five perspectives / خمس زوايا:** five advisor personas each analyse the same topic from a different lens:
  1. Macro & history (الاقتصاد الكلي والتاريخ)
  2. Supply chain & logistics (سلاسل الإمداد والشحن)
  3. Risk & what can go wrong (المخاطر)
  4. Data & statistics, including where the data is weak (البيانات وحدودها)
  5. Sceptic / devil's advocate (الناقد)
- **Sources:** every factual claim carries a citation (link, dataset, publication + date). A claim with no source is cut, not softened. / كل معلومة لها مصدر، وما ليس له مصدر يُحذف.
- **Plain summary:** one page, plain language, where the five agree and where they disagree. / ملخص صفحة واحدة: أين اتفقوا وأين اختلفوا.
- **Delivery shape (proposed by Ahmed):** PDF report + one 30-minute call. **Price: TBD, not final.** / تقرير PDF + مكالمة 30 دقيقة. **السعر: لم يُحدد.**
- **Tooling:** free/open-source only: local LLM + SearXNG (the existing Oracle), Pandoc or WeasyPrint for the PDF, Jitsi Meet for the call.
- **Human check:** Ahmed reads every report before it goes out. Nothing is sent automatically. / أحمد يراجع كل تقرير قبل إرساله.

## 2. Output rules / قواعد الصياغة
| Never / ممنوع | Use instead / البديل |
|---|---|
| "buy", "sell", "hold", "you should…" / اشترِ، بِع، احتفظ | "Research shows…" / "تشير الأبحاث إلى…" |
| Target prices, price ranges, entry/exit levels / سعر مستهدف | "Historical patterns suggest…" / "تشير الأنماط التاريخية إلى…" |
| "Guaranteed", "will rise", win rates, returns / مضمون، نسب ربح | "One scenario is…; a competing view is…" / "أحد السيناريوهات… ورأي مقابل…" |
| Advice tailored to the customer's money or portfolio / نصيحة لمحفظة العميل | General analysis of the topic only / تحليل عام للموضوع فقط |

- The customer makes every decision; each report ends with that sentence in AR and EN. / القرار للعميل وحده، وتُختم كل وثيقة بهذه الجملة.
- **No numbers in public material:** no performance figures, no customer counts, no stars, no revenue, no backtest results. Goals stay in internal notes only. Public line: "First month: launch + learning". / لا أرقام في أي مادة عامة؛ الأهداف داخلية فقط.
- A pre-send check greps the PDF for the banned words above (AR + EN) and blocks delivery on a hit. / فحص آلي للكلمات الممنوعة قبل الإرسال.

## 3. Legal position, stated honestly / الموقف القانوني بصراحة
- Calling the service "educational" **does not by itself remove licensing obligations.** If the substance of the output is a view on specific securities or assets, a regulator may treat it as investment advice whatever the label says. / تسمية الخدمة "تعليمية" **لا تُسقط وحدها** متطلبات الترخيص؛ العبرة بالمضمون لا بالاسم.
- Kuwait's Capital Markets Authority (Law No. 7 of 2010 and its Executive Bylaws) regulates securities activities including investment advice. Whether this service falls inside that scope is **an open legal question**, not something this document can answer. / هيئة أسواق المال (القانون 7 لسنة 2010 ولائحته) تنظم أنشطة الأوراق المالية ومنها الاستشارات. هل تدخل الخدمة ضمن نطاقها؟ **سؤال مفتوح.**
- **Must be answered by a Kuwaiti lawyer before any sale.** Questions to bring: (a) is a multi-perspective report on a named listed company or asset "investment advice"? (b) does limiting topics to sectors/commodities/events (no named securities) change that? (c) does the 30-minute call change it? (d) what disclaimers are required either way? / **يجب أن يجيب محامٍ كويتي قبل أي بيع**، مع هذه الأسئلة الأربعة.
- This document deliberately contains **no wording designed to avoid licensing review.** The rules in §2 are about honest, non-advisory content, not a workaround. If the lawyer says a licence is needed, the answer is to get one or not sell. / هذه الوثيقة **لا تحتوي صياغة غرضها التهرب من الترخيص.** إن قال المحامي يلزم ترخيص: إما نحصل عليه أو لا نبيع.

## 4. The service must not / ما لا تفعله الخدمة أبداً
- No tracking of private individuals; no analysis of a person's identity, location or behaviour. / لا تتبع أشخاص ولا تحليل هويات.
- No anti-bot, CAPTCHA-solving, scraping-evasion or any evasion tooling; open data and official APIs only. / لا أدوات تجاوز الحماية أو التهرب.
- No use of the trading engine's paper or live outputs (strategies, backtests, Director 00 proposals, Profit Sweeper) as advice or as report content. / لا استخدام لمخرجات محرك التداول (ورقي أو حي) كنصيحة أو كمحتوى.
- No automated sending; no outbound marketing by Claude. / لا إرسال آلي ولا تسويق من Claude.

## 5. Payment providers — checked 2026-10-15 / مزودو الدفع
| Provider | Kuwait seller? | Allows this service? |
|---|---|---|
| Paddle | Not on the unsupported list ([source](https://www.paddle.com/help/start/intro-to-paddle/which-countries-are-supported-by-paddle)) | **No.** Prohibits "pure consulting or advisory services… coaching" and "Investment or financial advice, including trading signals" ([source](https://paddle.com/help/start/intro-to-paddle/what-am-i-not-allowed-to-sell-on-paddle)) |
| Lemon Squeezy | Kuwait listed for bank payouts ([source](https://docs.lemonsqueezy.com/help/getting-started/supported-countries)) | **No.** Prohibits "Services of any kind (including… consulting…)" ([source](https://docs.lemonsqueezy.com/help/getting-started/prohibited-products)) |
| Tap Payments | Unverified (only third-party pages found) | Unverified; fees unverified |
| MyFatoorah | Unverified (only third-party pages found) | Unverified; fees unverified |

بالعربي: Paddle و Lemon Squeezy يمنعان بيع الاستشارات والخدمات بشكل صريح، و Paddle يمنع النصائح المالية بالاسم، فهما **لا يصلحان** لهذه الخدمة بشكلها الحالي. Tap و MyFatoorah لم يتم التحقق من شروطهما ورسومهما من مصادر رسمية.

## 6. Open items for Ahmed / بنود مفتوحة لأحمد
1. **Lawyer's answer** (CMA scope, §3) — blocks everything else. / رد المحامي، ويوقف كل شيء آخر.
2. **Payment provider** — Paddle/Lemon Squeezy ruled out by their own rules (§5); check Tap / MyFatoorah terms for advisory/research services and whether a Kuwaiti commercial licence is required. / مزود الدفع.
3. **Final price** — TBD. / السعر النهائي.
4. Topic whitelist: sectors/commodities/events only, or named securities too (depends on 1). / قائمة المواضيع المسموحة.
