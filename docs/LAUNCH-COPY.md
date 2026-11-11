# NABD launch copy (draft) / نص صفحة الإطلاق (مسودة)

Status: draft, not published. Written 2026-10-15 for ADR-072.
The page itself is the draft in `site-landing/` (PR #12, ADR-071). This file is the copy source; it does not change that PR.
Rule for every line here: it describes what exists in the repo today. Nothing promises returns, gives buy or sell calls, or claims a feature that is not built.

---

## 1. Hero / الواجهة

### Recommended (describes what exists today)

| | Arabic | English |
|---|---|---|
| Headline | **نبض: افهم ما يحرّك الأسواق، بأدلة لا بمزاعم.** | **NABD: understand what moves markets, with evidence, not claims.** |
| Sub-line | أدوات بحث وتعلّم على بيانات عامة ومفتوحة، وحساب تدريب بأموال وهمية. وننشر نتائج اختباراتنا، بما فيها ما فشل. | Research and learning tools on public, open data, plus a practice account in made-up money. We publish what we test, including what failed. |
| Button | انضم لقائمة الانتظار | Join the waitlist |
| Small print under button | لا نصائح استثمار ولا توصيات شراء أو بيع. أداة تعلّم وبحث فقط. | No investment advice and no buy or sell calls. A learning and research tool only. |

### Candidate, not usable yet: Ahmad's line

| Arabic | English |
|---|---|
| نبض: افهم السوق في 5 دقائق يومياً | NABD: understand the market in 5 minutes a day |

> **Note.** This line promises a daily 5-minute product. The Daily Briefing is not built yet (it is step 3 in the order landing, waitlist, Daily Briefing, payments). Use this headline only once the briefing exists and someone has timed a real reading of it. Until then, the recommended headline above is the honest one.
> **ملاحظة.** هذا السطر يَعِد بموجز يومي مدته 5 دقائق، والموجز اليومي غير مبني بعد. نستخدمه فقط بعد بناء الموجز وتجربته فعلياً.

---

## 2. Section 1: What NABD does / ماذا يفعل نبض

Intro line:
- AR: هذا ما هو مبني اليوم. لا شيء هنا يتصل بحساب تداول حقيقي.
- EN: This is what exists today. Nothing here connects to a real trading account.

| Card | Arabic | English | Source in repo |
|---|---|---|---|
| Practice account / حساب تدريب | تتدرّب برصيد وهمي. كل أمر يُحسب على السعر العام الحي مع رسوم 0.1% وانزلاق 0.05%. لا يتصل بأي منصة تداول ولا يحرّك أي أموال. | Practise with a made-up balance. Every order is priced at the live public price with a 0.1% fee and 0.05% slippage. It connects to no exchange and moves no money. | ADR-044 |
| Strategy lab / مختبر الاستراتيجيات | خمسة أنواع كلاسيكية (الاتجاه، العودة للمتوسط، الاختراق، الزخم، الأخبار) تُختبر على بيانات تاريخية حقيقية. النتائج تصف الماضي وليست وعداً بالمستقبل. | Five classic strategy types (trend, mean reversion, breakout, momentum, news) tested on real historical data. Results describe the past, not a promise about the future. | ADR-052 |
| Deep Research / البحث العميق | اسأل بالعربي أو الإنجليزي، فيبحث في مصادر مفتوحة ويكتب جواباً مع رابط مصدر لكل جملة. | Ask in Arabic or English. It searches open sources and answers with a source link for each claim. | DEEP-RESEARCH.md |
| Newton / نيوتن | حسابات دقيقة للمسافات وأوقات الوصول والمعادلات، مع عرض المدخلات والافتراضات حتى تتحقق بنفسك. | Exact distances, arrival times and equations, showing inputs and assumptions so you can check them. | ADR-062 |

Footer line:
- AR: البيانات من مصادر عامة أو مفتوحة الترخيص فقط، ضمن شروط استخدامها.
- EN: Data comes only from public or open-licensed sources, within their terms of use.

> Before publishing: confirm each card still matches the running app, and check the data licences for a paid product (the Bitcoin data used in research is CC BY-NC, non-commercial; see LAWYER-QUESTIONS.md Q6).

---

## 3. Section 2: What we tested (including the failure) / ماذا اختبرنا، بما فيه ما فشل

| | Arabic | English |
|---|---|---|
| Heading | ماذا اختبرنا | What we tested |
| Question | هل مؤشرات مستوحاة من الفيزياء (Hurst وLyapunov ونسبة شبيهة بـ Reynolds) تحذّر من الأزمات أفضل من التذبذب العادي لآخر 20 يوماً؟ | Do physics-inspired indicators (Hurst, Lyapunov and a Reynolds-style ratio) warn of crises better than plain 20-day volatility? |
| Answer | **لا.** في الأسهم الأمريكية والنفط والبيتكوين، لم يتفوّق أي منها على التذبذب العادي. | **No.** On US stocks, oil and Bitcoin, none of them beat plain volatility. |
| Key numbers | التذبذب العادي: 0.69 إلى 0.73 (المقياس AUC، و0.5 = رمي عملة). مؤشرات الفيزياء: 0.44 إلى 0.63. | Plain volatility: 0.69 to 0.73 (AUC score, 0.5 = a coin flip). Physics indicators: 0.44 to 0.63. |
| The one near-miss | أفضل نتيجة كانت Reynolds على البيتكوين (0.633، فترة ثقة 95%: 0.54 إلى 0.72). أعدنا اختبارها على بيانات 2023 إلى 2026 التي لم نرها، فسقطت إلى 0.329 (فترة الثقة 0.269 إلى 0.452). أغلقنا الملف. | The best result was Reynolds* on Bitcoin (0.633, 95% CI 0.54 to 0.72). We retested it on unseen 2023 to 2026 data and it fell to 0.329 (CI 0.269 to 0.452). File closed. |
| Why we publish it | ننشر الفشل لأن الأرقام يجب أن تُقاس لا أن تُزعم. | We publish failures because numbers should be measured, not asserted. |
| Link | اقرأ التقرير الكامل والكود | Read the full report and code |

Numbers source: `physics_lab/results/REPORT.md` and `oos_btc_2023_2026.json` (branch `claude/project-thread-huo78r`, ADR-065). The link needs a public location first (see LAUNCH-CHECKLIST.md).

---

## 4. Section 3: Waitlist / قائمة الانتظار

| | Arabic | English |
|---|---|---|
| Heading | انضم لقائمة الانتظار | Join the waitlist |
| Body | نبني نبض علناً. سجّل بريدك لتعرف حين نفتح الاستخدام، وأخبرنا ما الذي يتعبك في تحليل السوق. | We are building NABD in the open. Leave your email to hear when we open access, and tell us what makes market analysis hard for you. |
| Button | سجّلني | Sign me up |
| Privacy line | نستخدم بريدك فقط لإخبارك عن نبض. لا نبيعه ولا نشاركه، ويمكنك طلب حذفه في أي وقت. | We use your email only to tell you about NABD. We never sell or share it, and you can ask us to delete it at any time. |
| After submit | شكراً، أنت في القائمة. | Thanks, you are on the list. |

---

## 5. Waitlist form design / تصميم نموذج قائمة الانتظار

Three questions exactly as Ahmad wrote them, plus one consent box (recommended, because the form stores personal data).

| # | Field type | Required | Arabic | English |
|---|---|---|---|---|
| 1 | Email | Yes | البريد الإلكتروني | Email |
| 2 | Long text | No | ما أكبر مشكلة تواجهك في تحليل السوق؟ | What's your biggest pain in market analysis? |
| 3 | Single choice | No | هل تدفع مقابل أداة تحل هذه المشكلة؟ | Would you pay for a tool that solves it? |
| 3 options | | | نعم / ربما / لا | Yes / Maybe / No |
| Consent | Checkbox | Yes | أوافق على أن تتواصلوا معي بخصوص نبض. | I agree to be contacted about NABD. |

Data to store per row: email, answer 2, answer 3, language (ar/en), timestamp. Nothing else (no IP logging needed).

### Form tool options (none created)

| Tool | What I could verify on 2026-10-15 | Fit |
|---|---|---|
| **Formbricks** | Verified on its GitHub page and docs: core is AGPLv3, enterprise features (incl. AI) need a paid licence key; about 12.8k GitHub stars. Free self-hosting, but the current version runs eight services (app, Postgres, Redis/Valkey, SpiceDB and more); minimum 2 vCPU / 4 GB RAM for evaluation, valid HTTPS required. | Open source, but heavy for a 3-question form on the laptop. |
| **Tally.so** | **Not verified.** Not checked this session. To my knowledge it is a hosted service, not open source, which would conflict with the "open-source only" rule. Confirm before choosing. | Fastest, but likely not open source. |
| **n8n Form Trigger** (already in the stack) | Not verified this session. n8n and Postgres already run on the laptop. A form there needs the laptop reachable from the internet, which waits on the Cloudflare Tunnel step. | No new tool; blocked on public access. |

Recommendation: decide the tool together with where the page is hosted. If the page is on GitHub Pages and the laptop is not public yet, only a hosted form works today.
