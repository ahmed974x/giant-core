# تقرير الدرع الذاتي · OMEGA self-shield

> 2026-10-24T14:19:14.422Z · الدرجة 73/100 · الحكم: يحتاج متابعة · نجح 30 · فشل 4 · تخطّى 0
> Defensive self-test of this repository and its own local proxy in a sandbox (127.0.0.1, offline). No third party is contacted or tested.

## الصندوق المعزول

- العنوان http://127.0.0.1:44945 · الشبكة الخارجية مقطوعة (OMEGA_OFFLINE=1) · منزل ومخزن مؤقتان يُحذفان بعد الفحص

## المراحل

| المرحلة | الحالة | ملاحظة |
|---|---|---|
| sandbox | ✓ | http://127.0.0.1:44945, offline, temporary home |
| probes | ✗ | 31 probes, 4 open |
| pages | ✓ | 8 pages, 0 findings |
| secrets | ✓ | 650 tracked text files, 0 key-shaped strings |
| skillspector | ✓ | critical 0, high 0 |
| dependencies (OSV) | تخطّى | off; run with --deps on the laptop (sends package names and versions to api.osv.dev) |

## النتائج

| الحالة | الخطورة | الفحص | الدليل | الإصلاح |
|---|---|---|---|---|
| ✗ | متوسطة | صفحة من موقع عام داخل iframe معزول (Origin null) تطلب إذن الشبكة الخاصة (pna-null) | header access-control-allow-private-network: true must be absent | send Access-Control-Allow-Private-Network only to http(s) loopback origins; file:// pages are local already and need no grant |
| ✗ | متوسطة | رؤوس الحماية على الصفحات (hdr-page) | header cross-origin-opener-policy is missing, expected same-origin; header cross-origin-resource-policy is missing, expected same-site | add Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Resource-Policy: same-site to every answer |
| ✗ | متوسطة | اتصال بطيء يرسل الرؤوس حرفاً حرفاً (Slowloris، اتصال واحد) (slow-headers) | connection still open after 16000 ms | server.headersTimeout ≤ 10 s and server.requestTimeout ≤ 30 s |
| ✗ | منخفضة | رؤوس الحماية على واجهات البيانات (hdr-api) | header cross-origin-resource-policy is missing, expected same-site | add Cross-Origin-Resource-Policy: same-site |
| ✓ | حرجة | قراءة ملف خارج المجلد بـ ../ (trav-dotdot) | HTTP 404 |  |
| ✓ | حرجة | تجاوز المجلد بترميز %2e%2e (trav-encoded) | HTTP 404 |  |
| ✓ | حرجة | تجاوز المجلد بشرطة مرمّزة %2f (trav-slash) | HTTP 404 |  |
| ✓ | حرجة | تجاوز المجلد بشرطة خلفية (ويندوز) (trav-backslash) | HTTP 404 |  |
| ✓ | حرجة | قراءة مجلد git (file-dotgit) | HTTP 404 |  |
| ✓ | حرجة | قراءة ملف أسرار .env (file-env) | HTTP 404 |  |
| ✓ | حرجة | إجبار السيرفر على طلب موقع غريب (ssrf-host) | HTTP 400 |  |
| ✓ | حرجة | إجبار السيرفر على طلب خدمة داخلية (ssrf-loopback) | HTTP 400 |  |
| ✓ | حرجة | لا نص يشبه مفتاحاً سرياً في الملفات المتتبّعة (secrets-clean) | 650 files |  |
| ✓ | عالية | قطع المسار ببايت صفري (trav-null) | HTTP 404 |  |
| ✓ | عالية | قراءة شيفرة السيرفر نفسه (file-source) | HTTP 404 |  |
| ✓ | عالية | قراءة ملفات data الخاصة (file-data) | HTTP 404 |  |
| ✓ | عالية | إعادة ربط DNS باسم مضيف غريب (host-rebind) | HTTP 421 |  |
| ✓ | عالية | قراءة البيانات من موقع غريب (cors-evil) | HTTP 403 |  |
| ✓ | عالية | موقع يتنكر باسم localhost (cors-evil-sub) | HTTP 403 |  |
| ✓ | عالية | خداع المضيف بـ user@host (ssrf-userinfo) | HTTP 400 |  |
| ✓ | عالية | اسم مصدر من نموذج الكائن (__proto__) (ssrf-proto) | HTTP 400 |  |
| ✓ | عالية | منفذ غير معتاد على مضيف مسموح (ssrf-port) | HTTP 400 |  |
| ✓ | عالية | صفحة من القرص أو iframe تستعمل النموذج المحلي (llm-null) | HTTP 403 |  |
| ✓ | عالية | موقع غريب يستعمل النموذج المحلي (llm-evil) | HTTP 403 |  |
| ✓ | عالية | السيرفر ما زال يعمل بعد كل الهجمات (alive) | HTTP 200 |  |
| ✓ | عالية | 8 صفحة: CSP صارمة، بلا معالجات داخلية ولا style ولا سكربت خارجي بلا SRI (pages-clean) | 8 pages |  |
| ✓ | عالية | SkillSpector على المستودع كله (0 حرجة، 0 عالية) (skillspector) | critical 0 · high 0 · medium 379 · low 179 |  |
| ✓ | متوسطة | طلب بسيط بلا preflight (text/plain) (llm-simple) | HTTP 415 |  |
| ✓ | متوسطة | جسم طلب ضخم للنموذج المحلي (llm-big) | HTTP 413 |  |
| ✓ | متوسطة | إعادة توجيه مفتوحة إلى موقع آخر (redir-open) | HTTP 302 |  |
| ✓ | منخفضة | طريقة PUT (method-put) | HTTP 405 |  |
| ✓ | منخفضة | طريقة TRACE (method-trace) | HTTP 405 |  |
| ✓ | منخفضة | تسريب مسارات الجهاز في رسالة الخطأ (err-leak) | HTTP 503 |  |
| ✓ | منخفضة | عنوان طلب طوله 20 ألف حرف (url-huge) | HTTP 431 |  |

---
فحص دفاعي للمستودع وللسيرفر المحلي نفسه فقط، في صندوق معزول بلا إنترنت. لا يُفحص أي طرف آخر ولا يُرسل أي شيء للخارج.
