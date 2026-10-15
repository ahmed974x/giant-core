# فحص أمني: طبقة الرؤية + TradingView (قراءة فقط)

التاريخ: 2026-10-15. المراجع: Claude. القرار المرتبط: `docs/adr/ADR-070-vision-trading-mcp-review.md`.
الطريقة: تنزيل الحزمة المنشورة نفسها (sdist من PyPI أو tarball من npm) في مجلد مؤقت فارغ في السحابة، وقراءة الملفات فقط.
**ما تم تشغيل pip ولا npm ولا uvx ولا npx ولا أي سكربت، وما انفتحت جلسة TradingView، وما تغير شي في اللابتوب.**
ملاحظة: GitHub API محجوب لهذه المستودعات في هذي الجلسة، فتاريخ "آخر تحديث" أدناه هو تاريخ نشر الحزمة على PyPI/npm، إلا إذا ذكرت غير كذا.

## الخلاصة

| # | الأداة | الحزمة @ الإصدار (تاريخ النشر) | الحكم | السبب باختصار |
|---|---|---|---|---|
| 1 | argus-screens | PyPI 0.1.0 (2026-10-02) | **آمن للنظر (بشروط)** | محلي بالكامل، بدون إنترنت، OCR من ويندوز نفسه، يحجب تطبيقات كلمات السر والبنوك. لكن أمر `argus install` يعطي نفسه موافقة دائمة ويشتغل مع ويندوز. |
| 2 | page-vision-mcp | PyPI 0.1.0 (2026-07-17) | **يحتاج تعديل** | الافتراضي يرسل لقطات الشاشة إلى OpenAI (gpt-4o). يصلح فقط إذا وجهناه لـ Ollama المحلي وحددنا المجلدات. ناشر مجهول. |
| 3 | mcp-local-vision | PyPI 0.1.0 (2025-12-09) | **يحتاج تعديل** | أداة وحدة بس (مو 3). النموذج يقدر يختار يرسل الصورة لـ OpenAI/Anthropic/Google/OpenRouter. بدون مستودع ولا اسم ناشر. |
| 4 | claude-vision | npm 1.2.0 (2026-02-21) | **يحتاج تعديل** | لقطات محلية، لكن OCR (tesseract.js) يحمّل ملفات اللغة من الإنترنت وقت التشغيل، وما فيه حجب للنوافذ الحساسة. argus أفضل منه. |
| 5 | vlm-mcp | PyPI 0.2.0 (2026-03-11) | **رفض** | المستودع وهمي (`github.com/example`)، والحزمة فيها مفتاح API حقيقي لصاحبها وإعدادات Claude الخاصة فيه. يحتاج مفتاح سحابي إجباري. |
| 6 | qa-screens | PyPI 0.2.0 (2026-09-19) | **رفض** | يسحب توكن GitHub حقك (`gh auth token`) وينشر تقارير الأخطاء كـ issues في مستودع المطور تلقائياً. يحمّل Chromium بالخلفية. يخزن كوكيز وتوكنات دخول. |
| 7 | agent-vision-mcp | npm 0.1.2 (2026-05-21) | **رفض** | يتطلب فتح Chrome الحقيقي على منفذ 9222: أي برنامج على اللابتوب يقدر يتحكم بجلساتك المسجلة. فيه تنفيذ JavaScript داخل التبويب. |
| 8 | tradingview-mcp (atilaahmettaner) | PyPI `tradingview-mcp-server` 0.8.1 (2026-08-24) | **يحتاج تعديل** | ما فيه أوامر تداول ولا تتبع. لكن البيانات من نقاط TradingView غير رسمية، وشروط TradingView تمنع الاستخدام الآلي (بند 3). ثبّت الإصدار ولا تثبّت من git مباشرة. |
| 9 | TVControl (FerroxLabs) | npm `@ferroxlabs/tvcontrol` 2.5.3 (2026-09-08) | **رفض** | يتحكم بالماوس والكيبورد داخل TradingView Desktop وهو مسجل بحسابك عبر منفذ CDP مفتوح. يقدر يوصل لـ"Trading Panel"، يعني لو ربطت وسيط ممكن ينضغط شراء/بيع حقيقي. المطور نفسه يقول إنه قد يخالف شروط TradingView. |
| 10 | tradingview-assistant | PyPI 0.8.2 (2026-04-27) | **رفض** | فيه أداة `execute_order` مكتوب عليها "paper now, live later". نسخة متفرعة بنفس اسم الحزمة والأمر حق atilaahmettaner فتتعارض معه. ما تحدث من أبريل. |

**المحصلة:** واحد آمن للنظر بشروط (argus-screens)، أربعة تحتاج تعديل، خمسة مرفوضة. ما فيه ولا أداة تنفذ أوامر تداول حقيقية اليوم، لكن TVControl يقدر يضغط أزرار الوسيط وtradingview-assistant ناوي يضيف التداول الحقيقي.

### التحقق من ادعاءات الخطة

| الادعاء | النتيجة | الدليل |
|---|---|---|
| tradingview-mcp فيه 37 أداة | **صحيح تقريباً**: 38 في الإصدار 0.8.1 | `src/tradingview_mcp/server.py` فيه 38 `@mcp.tool`. الـREADME يقول 37. |
| TVControl فيه 113 أداة | **صحيح** في حزمة npm 2.5.3 | 113 تسجيل `server.tool(...)` في `src/tools/`. صفحة GitHub تقول 88 والـREADME يقول 102 (قديمة). |
| tradingview-assistant فيه 30+ أداة | **صحيح**: 70 | `server.py` فيه 70 `@mcp.tool`. |
| "No TradingView account needed" | **صحيح لـ atilaahmettaner فقط** | يستخدم `scanner.tradingview.com` العام عبر مكتبة `tradingview-screener==3.0.0` و`tradingview-ta`. TVControl يحتاج TradingView Desktop مسجل الدخول. |
| "مجاني" | **صحيح للتشغيل الذاتي** | MIT. لكن المطور يبيع نسخة مستضافة pro.cryptosieve.com بـ 9$ و29$ شهرياً. |
| mcp-local-vision أدواته analyze_local_image, extract_text, ui_to_artifact | **خطأ** | فيه أداة وحدة بس: `analyze_local_image`. الأدوات الثانية من vlm-mcp. |
| page-vision-mcp فيه 5 أدوات | **صحيح** | capture_page, analyze_ui, compare_ui, extract_text, crop_analyze. |
| vlm-mcp فيه 8 أدوات | **صحيح** | 8 `Tool(...)` في `vlm_mcp/server.py`. |
| "كل الأدوات مفتوحة المصدر" | **غير متحقق لـ 3** | mcp-local-vision بدون رابط مستودع، vlm-mcp رابطه وهمي، page-vision-mcp ناشر باسم أرقام. الكود موجود في الحزمة (MIT) لكن ما نعرف مين وراه. |
| mcp.tradingview.com هو خادم TradingView الرسمي | **صحيح** | أطلقته TradingView 2026-09-16 (نسخة تجريبية). **مو مجاني**: يحتاج اشتراك Essential أو أعلى، والتجربة المجانية ما تشمله. 35 أداة، بدون أوامر تداول، والبيانات متأخرة. |
| ADR-093 و ADR-094 | **خطأ في الترقيم** | آخر رقم عندنا 069، فهذا ADR-070. |
| "Claude ما يشوف الشارت" | **نصف صحيح** | Claude يقرأ الصور أصلاً إذا انعطى لقطة. الناقص هو أداة تاخذ اللقطة، وهذا اللي يحله argus. |

### شروط TradingView (بيانات وإعادة توزيع)

من صفحة الشروط [tradingview.com/policies](https://www.tradingview.com/policies/) (قريتها من النسخة [in.tradingview.com/policies](https://in.tradingview.com/policies)):
- **بند 3:** البيانات "licensed for exclusive display-only use"، والشركة "explicitly prohibits any form of non-display usage"، وتعرّفه بأنه "any machine-driven processes that do not involve the direct, human-readable display of such data"، ومنها "creating products or services based on TradingView content". وتمنع "any distribution of TradingView content" و"commercial usage of any of our services or APIs".
- **بند 26 (ميزات AI):** "only for your own lawful, personal, non-automated use".
- TVControl يقرّ في الـREADME حقه: [github.com/FerroxLabs/tvcontrol](https://github.com/FerroxLabs/tvcontrol) إن الشروط "restrict automated data collection, scraping, and non-display usage" وإنه قد يتعارض معها.
- الخادم الرسمي: [مدونة TradingView](https://www.tradingview.com/blog/en/tradingview-mcp-server-public-beta-60864/) و[التوثيق](https://www.tradingview.com/mcp/docs).

**المعنى لنبض:** إدخال بيانات TradingView آلياً في Director 00 أو التداول التجريبي أو شاشة في الموقع = استخدام "non-display" ممنوع بالبند 3، حتى لو الأداة مجانية. الاستخدام الأسلم: سؤال يدوي منك في Claude والجواب يُعرض لك. ممكن الحساب ينحظر (TradingView عندها صفحة حظر بسبب "suspicious activity").

---

## التفاصيل والأدلة

### 1. argus-screens: آمن للنظر بشروط
- المؤلف: Sahil Dayal، MIT، المستودع `github.com/sahildayal/argus`. ويندوز 10/11 فقط، Python 3.12+. **عمره أسبوعين** وإصدار واحد.
- 11 أداة (`src/argus/server.py`): look, screenshot, zoom, list_screens, latest_snip, latest_mark, read_text, find_text, save_baseline, compare, wait_for. كلها مقروءة فقط عدا save_baseline.
- **ما فيه أي اتصال بالإنترنت** في `src/argus/*.py` (بحثت عن http, socket, urllib, requests). الـOCR من Windows.Media.Ocr المدمج.
- خصوصية جيدة (`config.py`): يسوّد نوافذ 1Password/Bitwarden/KeePass وواتساب وتيليجرام وسيجنال، وتبويبات البنوك وBinance وCoinbase وPayPal، وإشعارات ويندوز. اختصار إيقاف `ctrl+alt+p`. يحذف اللقطات بعد 7 أيام.
- **الخطر:** `src/argus/install.py:129-150`: أمر `argus install` يسجل نفسه في Claude Code وClaude Desktop وVS Code وCodex وGemini، ويضيف `mcp__argus` إلى `permissions.allow` في `~/.claude/settings.json` (يعني ما يسألك قبل اللقطة)، و`install.py:274` يضيف اختصار تشغيل مع ويندوز.
- **الشروط:** لا تشغّل `argus install`. نضيفه يدوياً في `claude_desktop_config.json` فقط. نضيف لقائمة الحجب: نافذة "OMEGA PRIME - رمز الموقع"، نافذة المفاتيح، صفحة Keys Vault، وأي محفظة. تثبيت بالإصدار والبصمة:
  `argus-screens==0.1.0 --hash=sha256:fe5a4d336be075e8fa66a42b3c0a98a52dfde3de4d7102a03748ec088e7e23ea`

### 2. page-vision-mcp: يحتاج تعديل
- الناشر `666666999999666`، MIT، إصدار واحد.
- `config.py:56-59`: الافتراضي `VISION_BASE_URL=https://api.openai.com/v1` و`gpt-4o`. أي لقطة تروح لـ OpenAI إذا ما غيرناه.
- `config.py:12`: `load_dotenv()` يقرأ أي `.env` في المجلد اللي يشتغل منه.
- `image/security.py:109-111`: إذا ما حددت `VISION_ALLOWED_PATHS` يقدر يقرأ أي صورة في الجهاز. فيه حماية SSRF للصور، لكن `capture_page` ما يفحص الرابط.
- يحتاج Playwright + تنزيل Chromium (~150MB).
- **التعديل المطلوب:** `VISION_BASE_URL=http://127.0.0.1:11434/v1`، `VISION_ALLOWED_PATHS` لمجلد لقطات واحد، تثبيت بالإصدار. انتبه: نموذج رؤية مثل qwen2.5-vl على لابتوب 7GB ثقيل؛ الأصغر (3B) يمكن يمشي.

### 3. mcp-local-vision: يحتاج تعديل
- بدون مؤلف ولا رابط مستودع في PyPI. الحزمة فيها ملفات تطوير منسية (`install.log`, `test_failures.log`) من جهاز المطور.
- `server.py:14-36`: أداة وحدة `analyze_local_image(file_path, question, timeout, provider)`. `provider` يختاره النموذج: local, openai, anthropic, google, openrouter. إذا كان أي مفتاح موجود في البيئة، الصورة تطلع للسحابة.
- يقرأ أي ملف صورة بالمسار، بدون حد للمجلدات. يعتمد على مكتبات anthropic وgoogle-generativeai حتى لو ما استخدمتها.
- **التعديل:** 214 سطر بس، فالأسلم ننسخ المنطق لأداة محلية حقنا مقفلة على Ollama. كتثبيت مباشر: لا.

### 4. claude-vision: يحتاج تعديل
- npm `claude-vision` 1.2.0، الناشر meltingpixels، MIT، `github.com/meltingpixelsai/claude-vision`. ما فيه postinstall.
- 7 أدوات (`build/index.js`): list_monitors, screenshot, screenshot_window, screenshot_region, screenshot_active, extract_text, cleanup.
- `build/tools/extractText.js:29`: `Tesseract.recognize` بدون `langPath`، يعني tesseract.js يحمّل ملفات اللغة من CDN أول مرة (سلوك المكتبة الافتراضي).
- ما فيه حجب لنوافذ حساسة. يحفظ اللقطات في مجلد temp.
- `npx claude-vision` في الخطة يشغّل آخر إصدار بدون تثبيت. argus يغطي نفس الشي بأمان أكثر.

### 5. vlm-mcp: رفض
- `pyproject.toml`: المؤلف "VLM MCP Team <team@vlm-mcp.example.com>"، الرابط `github.com/example/vlm-mcp` = وهمي.
- الحزمة المنشورة فيها `.mcp.json` بمفتاح `sk-...` حقيقي (51 حرف) لراوتر داخلي لشركة، و`.claude/settings.local.json` فيه `enableAllProjectMcpServers: true`. ما نسخت المفتاح.
- `server.py:738`: `VLM_API_KEY` إجباري، الافتراضي OpenAI. `server.py:356`: يحمّل أي رابط بدون فحص.

### 6. qa-screens: رفض
- Len Dierickx، MIT. 18 أداة منها 7 للدخول (OAuth, cookies, storage_state).
- `reporting.py:1-17` و`:166-168`: تقارير الأخطاء **مفعلة افتراضياً** وتنشر issue في `astuanax/qa-screens` باستخدام `GITHUB_TOKEN` أو `gh auth token` حقك. يقول إنه يمسح التوكنات قبل النشر، لكنه إرسال بيانات من جهازك بدون ما تطلب.
- `browser.py:28-55` و`server.py:609`: يحمّل Chromium بالخلفية أول ما يشتغل.
- اختياري: Gemini وFigma (سحابة).

### 7. agent-vision-mcp: رفض
- **تنبيه:** فيه حزمتين بنفس الاسم. PyPI (idealizing 0.0.3، الافتراضي `api.example.com` ونموذج `glm-4v-flash` السحابي). وnpm (kedarvartak 0.1.2) وهي اللي توصف الخطة: رؤية تبويبات Chrome عبر CDP.
- `dist/browser/cdp/chrome-cdp-client.js:1,34`: يطلب تشغيل Chrome بـ `--remote-debugging-port=9222`. هذا المنفذ بدون كلمة سر: أي برنامج على اللابتوب يقدر يقرأ ويتحكم بكل جلساتك المسجلة (Gmail، البنك، Claude).
- `dist/browser/cdp/browser-tab-context-service.js:34`: `Runtime.evaluate` = تنفيذ كود داخل الصفحة. و`dist/server.js:30` يخلي النموذج يحدد عنوان CDP بنفسه.

### 8. tradingview-mcp (atilaahmettaner): يحتاج تعديل
- 5.0k نجمة، 158 commit، MIT. الحزمة الرسمية على PyPI اسمها `tradingview-mcp-server` (0.8.1). الـREADME يحذر من نسخ مزيفة تضيف `package.json` وتثبت برمجيات خبيثة عبر npm.
- ما فيه أدوات أوامر تداول (بحثت عن order, broker, execute). ما فيه تتبع في الكود. كلمة "Telemetry" في `screener_service.py:599` تخص النسخة المستضافة المدفوعة.
- مصادر البيانات: `scanner.tradingview.com` (غير رسمي)، Yahoo Finance `query1/query2` (غير رسمي)، Reddit، RSS (CNBC, Dow Jones, CoinDesk, Cointelegraph)، CoinGecko، Marketaux اختياري بمفتاح مجاني.
- `core/services/proxy_manager.py`: يدعم بروكسي Webshare متغير (residential) لتجاوز حدود TradingView/Yahoo. يشتغل فقط إذا انحط `PROXY_PASSWORD`. **لازم يبقى مطفي.**
- الخطة تثبته من `git+https://github.com/...` بدون إصدار، يعني كل تشغيل ممكن يجيب كود جديد. **التعديل:** تثبيت من PyPI بالإصدار والبصمة:
  `tradingview-mcp-server==0.8.1 --hash=sha256:1c01ff74105f6f94eedc150584cca75e6415affeeda206715b95963c688b561e`
- **الشروط:** للأسئلة اليدوية في Claude فقط، لا يُربط بـ Director 00 ولا التداول التجريبي ولا شاشة في الموقع (بند 3).

### 9. TVControl (FerroxLabs): رفض
- npm `@ferroxlabs/tvcontrol` 2.5.3، الناشر على npm `seandonahoe`. على GitHub: 34 نجمة، 10 commits، MIT، متفرع من `tradesdontlie/tradingview-mcp`.
- الاعتماديات: `@modelcontextprotocol/sdk`، `chrome-remote-interface`، `zod`. ما فيه postinstall.
- **الوصول للإدخال والشاشة:** يشتغل على TradingView Desktop مفتوح بـ `--remote-debugging-port=9222` (`src/connection.js:14`، `scripts/launch_tv_debug.bat`). نفس خطر المنفذ المفتوح في رقم 7، بس على تطبيق مسجل بحساب TradingView حقك. أدوات: ui_click, ui_mouse_click, ui_keyboard, ui_type_text, ui_hover, ui_scroll, capture_screenshot, و`ui_evaluate` (كود حر، مقفل إلا بـ `TV_MCP_ADVANCED=1`).
- **التداول:** ما فيه أداة أمر حقيقي. `replay_trade` (`src/core/replay.js:284`) داخل وضع الإعادة فقط (محاكاة). لكن `src/core/ui.js:209` يعرف زر "Trading Panel"، وأدوات الضغط العامة تقدر توصل لأزرار الشراء/البيع إذا ربطت وسيط في TradingView. الـREADME يقول "No real trades are executed" لكن الكود ما يمنعه تقنياً.
- **يكتب في حسابك:** alert_create, watchlist_*, pine_save, layout_save.
- يتطلب TradingView Desktop وحساب. هل يحتاج اشتراك مدفوع: **غير متحقق**.

### 10. tradingview-assistant: رفض
- PyPI 0.8.2، Debarpan Bose Chowdhury، المستودع `DEBARPAN2000/tradingview-mcp`. ما تحدث من 2026-04-27.
- نفس اسم الحزمة الداخلية `tradingview_mcp` ونفس الأمر `tradingview-mcp` حق atilaahmettaner: لو انثبتوا مع بعض واحد يمسح الثاني.
- `server.py:899-907`: أداة `execute_order(user_id, symbol, side, quantity, price, paper=True)`، الوصف "Unified execution entrypoint (paper now, live later)". `core/services/execution_service.py:16-21` يرجع `not_implemented` للحقيقي اليوم، لكن تحديث واحد يفعّله. نبض عنده تداول تجريبي حقه أصلاً.
- `mcp[cli]>=1.12.0` بدون حد أعلى.

---

## قرار أحمد (2026-10-15 23:25Z)
- **argus-screens فقط** معتمد. انثبت 0.1.0 بعد التحقق من البصمة، بدون `argus install` وبدون تشغيل مع ويندوز. قائمة الحجب: `ops/argus/config.toml`. اختبار الحجب نجح على 7 نوافذ.
- **TradingView مرفوض بالكامل** (الأدوات الثلاث)، وكل أدوات الرؤية الثانية مرفوضة.
