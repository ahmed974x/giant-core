# إعداد Cloudflare Tunnel + Access + TOTP (القائمة النهائية)

آخر تحديث: 2026-10-15 · الحالة: **جاهزة، وما نفّذنا ولا خطوة.** ننتظر منك اسم الدومين اللي اشتريته.

| البند | القيمة |
|---|---|
| الدومين | `<دومينك>` اللي تشتريه الحين. وإذا وافقوا على nabd.eu.org بعدين، ينضاف كدومين ثاني بنفس الإعدادات |
| فريق Zero Trust | `<team>` ← رابط الدخول: `https://<team>.cloudflareaccess.com` |
| طريقة الدخول | **رمز يوصل لإيميلك (One-time PIN) + Google Authenticator**. بدون Google OAuth |
| من يقدر يدخل | إيميلك فقط |
| الخطة | **Free فقط**. إذا طلب بطاقة أو طلع أي مبلغ: **وقّف وأرسل لي صورة** |
| الموقع | يبقى على `127.0.0.1:3100`. Tailscale و Caddy ما نلمسهم |

> لا ترسل لي توكن ولا مفتاح ولا باسورد أبداً. التوكن ينسخ من صفحة Cloudflare للابتوب مباشرة.

**الترتيب:** النفق ← Access ← TOTP ← **ربط الرابط آخر شي**.
النفق يتركّب بدون رابط عام، يعني ما يفتح شي للعامة. والرابط العام ما ينضاف إلا بعد ما يكون Access و TOTP شغالين، عشان الموقع ما يكون مكشوف ولا دقيقة.

---

## 0. قبل البداية (أنت)

- [ ] **0.1** اشترِ الدومين من Cloudflare: Domain Registration → Register Domains (حوالي 10$ بالسنة، والتجديد التلقائي يكون شغال). إذا اشتريته من مكان ثاني: Add a domain → وغيّر الـ nameservers للي يعطيك إياها Cloudflare.
- [ ] **0.2** فعّل 2FA على حساب Cloudflare نفسه (My Profile → Authentication)، واحفظ أكواد الاسترداد على ورق.
- [ ] **0.3** افتح Zero Trust → اسم الفريق: `<team>` → الخطة: **Free**.
- [ ] **0.4** ثبّت Google Authenticator على الآيفون.
- [ ] **0.5** أرسل لي في الثريد **اسم الدومين بس**.

## 1. النفق (بدون رابط عام)

- [ ] **1.1** Zero Trust → **Networking → Tunnels** → **Create a tunnel** → Cloudflared → الاسم `omega-laptop` → Windows.
- [ ] **1.2** على اللابتوب افتح **PowerShell كمسؤول**:
  ```powershell
  winget install --id Cloudflare.cloudflared -e
  ```
- [ ] **1.3** في صفحة Cloudflare اضغط زر نسخ أمر التثبيت، والصقه في نفس نافذة PowerShell. شكله كذا:
  `cloudflared.exe service install eyJ...` (التوكن طويل ويبدأ بـ `eyJ`. **لا ترسله لي**)
- [ ] **1.4** انتظر لين تصير حالة النفق **Healthy**. بعدها **لا تضيف أي Route ولا Published application** الحين، وتجاوز هالخطوة لو الصفحة طلبتها.
- [ ] **1.5** تأكد إن الخدمة شغالة:
  ```powershell
  Get-Service cloudflared | Select-Object Status, StartType   # المتوقع: Running / Automatic
  ```

## 2. Access (القفل)

- [ ] **2.1** Zero Trust → **Integrations → Identity providers**: تأكد إن **One-time PIN** موجود (موجود من الأساس).
- [ ] **2.2** Zero Trust → **Access controls → Applications** → Add an application → **Self-hosted**:
  - Application name: `OMEGA`
  - Domain: `omega` . `<دومينك>`
  - Session duration: **24 hours**
  - Login methods: **One-time PIN** فقط
- [ ] **2.3** Policy:
  - Name: `Ahmad only` · Action: **Allow**
  - Include → **Emails** → إيميلك (بالضبط نفس الإيميل اللي توصلك عليه الرموز)
  - احفظ التطبيق.

## 3. TOTP (Google Authenticator)

- [ ] **3.1** Zero Trust → **Access controls → Access settings** → **Allow multi-factor authentication** → علّم **Authenticator application**.
  - إذا الخيار **ما طلع**، أو طلب ترقية أو مبلغ: **وقّف وقل لي**. ما نشترك.
- [ ] **3.2** Authentication duration: **24 hours** → فعّل **Apply global MFA settings by default** → **Save**.
- [ ] **3.3** من الجوال افتح `https://<team>.cloudflareaccess.com` → إيميلك → الرمز اللي يوصلك → **Account → MFA devices → Add an MFA device → Authenticator application** → امسح الـ QR بـ Google Authenticator → اكتب الـ 6 أرقام.

## 4. ربط الرابط (آخر خطوة)

- [ ] **4.1** Zero Trust → Networking → Tunnels → `omega-laptop` → تبويب **Routes** → Add route → **Published application**:
  - Subdomain: `omega` · Domain: `<دومينك>` · Service URL: `http://127.0.0.1:3100`
  - Add route.

## 5. الفحوصات

| # | الفحص | المتوقع | مين |
|---|---|---|---|
| 5.1 | `curl.exe -sI https://omega.<دومينك>/ar` | **302** يحوّل لـ `<team>.cloudflareaccess.com`، **مو 200** | أنا |
| 5.2 | من الجوال على 4G والـ Wi-Fi مطفأ | إيميل ← رمز الإيميل ← رمز Authenticator ← يفتح الموقع | أنت |
| 5.3 | نافذة خاصة بإيميل ثاني | **ينرفض**، وما يوصله رمز | أنت |
| 5.4 | رمز Authenticator قديم | ينرفض | أنت |
| 5.5 | Restart للابتوب وبعدها تسجيل دخول | الرابط يرجع يشتغل (قبل تسجيل الدخول يطلع 502، وهذا طبيعي) | أنت + أنا |
| 5.6 | رابط Tailscale و `:8443` | الاثنين شغالين مثل قبل | أنا |
| 5.7 | Zero Trust → Logs → Access | 5.2 مسموح و 5.3 مرفوض | أنا |

## لو صار شي

| المشكلة | الحل |
|---|---|
| ضاع الجوال | Zero Trust → **Team & Resources → Users** → حسابك → MFA devices → احذف الجهاز ← وأعد الخطوة 3.3 |
| حساب Cloudflare نفسه | تدخل بأكواد الاسترداد الورقية |
| التوكن انكشف | Tunnels → `omega-laptop` → Refresh token، وبعدها أعد 1.3 |
| تبي توقف كل شي بسرعة | احذف الـ Route من الخطوة 4.1، والموقع يرجع مقفول فوراً |
| nabd.eu.org انقبل | Add a domain ← وكرر 2.2 و 4.1 بالدومين الجديد. باقي الخطوات ما تتغير |

## مرفوض

فتح منفذ في الراوتر · `trycloudflare.com` (رابط عام بدون Access) · Tailscale Funnel · أي خطة مدفوعة · Google OAuth (يحتاج Secret تلصقه بيدك).
