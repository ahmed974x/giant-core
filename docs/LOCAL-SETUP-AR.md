# تشغيل نظام التداول الورقي على اللابتوب (تجربة قبل الدمج)

الفرع: `feat/paper-trading-mvp` · السجل: ADR-073 · كل الأوامر في **PowerShell**.

> **مهم:**
> - التجربة تنزل في مجلد منفصل اسمه `OMEGA_PAPER`. لا تشغّل `git pull` ولا `git reset` في مجلد المشروع الأصلي، لأن فيه تعديلات ما انرفعت.
> - الموقع الأصلي يظل شغال على المنفذ 3100، ونسخة التجربة تشتغل على **3101**.
> - هالخطوات ما فيها ولا مفتاح ولا كلمة سر. الرمز (PIN) نفس رمز الموقع اللي تعرفه.
> - النظام ورقي بالكامل: ما فيه أوامر حقيقية، ولا مفاتيح بورصة، ولا تحويل أموال.

## المتطلبات (مرة وحدة)
- Node.js 20.9 أو أحدث: `node --version`
- Python 3.11 أو أحدث: `python --version`
- Git: `git --version`
- ملف المفتاح السري موجود في `C:\Users\Hp\.omega\secrets\web.env.keys` (هو نفسه اللي يشغّل موقعك الحالي).

## 1. نزّل الفرع في مجلد منفصل
```powershell
cd C:\Users\Hp\Desktop\OMEGA_PRIME_PROJECT
git fetch origin feat/paper-trading-mvp
git worktree add ..\OMEGA_PAPER origin/feat/paper-trading-mvp
Copy-Item .\web\.env.local ..\OMEGA_PAPER\web\.env.local
```
آخر سطر ينسخ ملف الإعدادات المشفّر من مشروعك الأصلي. الملف يظل مشفّراً، والأمر ما يطبع منه شي.

## 2. الوكلاء (Director 00 وبيئة بايثون)
```powershell
cd C:\Users\Hp\Desktop\OMEGA_PAPER\services\director00
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```
إذا طلع خطأ "running scripts is disabled"، شغّل هذا السطر مرة وحدة وعيد الأمر:
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`

## 3. الواجهة (تطبيق الموقع على 3101)
```powershell
cd C:\Users\Hp\Desktop\OMEGA_PAPER\web
npm ci
npm test
npm run build
node scripts\secure-run.mjs start -p 3101 -H 127.0.0.1
```
- `npm test` لازم يطلع في الآخر `# fail 0` (عندنا طلع `# tests 126` و `# pass 126`).
- آخر أمر يشغّل الموقع. خلّ النافذة مفتوحة.

## 4. قاعدة البيانات
النظام الورقي **ما يحتاج Docker ولا Postgres**. الحساب الورقي والمقترحات يتسجلون في ملفين نصّيين:
`services\director00\data\paper\ledger.jsonl` و `services\director00\data\paper\proposals.jsonl`
(داخل `OMEGA_PAPER`، يعني التجربة تبدأ بحساب ورقي جديد بـ 10,000 USDT وما تلمس حسابك الحالي).

إذا تبي الخدمات الخلفية الباقية شغّالة مثل العادة (هي أصلاً ترجع لحالها بعد إعادة التشغيل، ADR-064):
```powershell
cd C:\Users\Hp\Desktop\OMEGA_PRIME_PROJECT
docker compose --profile director up -d memory
```

## 5. جرّب
1. افتح http://127.0.0.1:3101/ar ثم شاشة **السوق**.
2. اكتب الرمز في خانة "الحساب الورقي".
3. في لوحة **"مقترحات الصفقات"** اضغط **"افحص الإشارات"**. بتطلع مقترحات لـ BTC و ETH و SOL و PAXG إذا فيه إشارات اليوم.
4. كل مقترح فيه الأرقام ورابط **"الدليل"** للبيانات الخام. افتحه وتأكد بعينك.
5. اضغط **"موافقة"** على واحد. بيتسجل في الحساب الورقي فوق. اضغط **"رفض"** على ثاني وشوف إنه ما تسجل.

## 6. التقرير اليومي (تجربة يدوية)
بنافذة PowerShell ثانية، والموقع شغال على 3101:
```powershell
cd C:\Users\Hp\Desktop\OMEGA_PAPER\web
$env:OMEGA_SITE_URL = "http://127.0.0.1:3101"
npm run paper:scan
```
- يطبع عدد المقترحات الجديدة ومكان ملف التقرير، مثل
  `services\director00\data\paper\briefings\2026-10-16.md`
- التقرير فيه أفضل 3 مقترحات بأرقامها وروابطها. يرسل كمان تنبيه للجوال إذا الجوال مشترك بالتنبيهات.
- الفحص **ما يسجّل أي صفقة**. الموافقة دايماً بيدك.

## 7. الفحص التلقائي 09:00 (بعد الدمج فقط)
بعد ما تقول "ادمج" وننقل الكود لمجلدك الأصلي، شغّل هذا مرة وحدة من مجلد المشروع الأصلي:
```powershell
cd C:\Users\Hp\Desktop\OMEGA_PRIME_PROJECT
powershell -ExecutionPolicy Bypass -File ops\phoenix\install-paper-scan.ps1
```
يسجّل مهمة ويندوز اسمها "OMEGA Paper Scan" تشتغل كل يوم الساعة 09:00 بتوقيت اللابتوب (الكويت).
للحذف: `schtasks /Delete /TN "OMEGA Paper Scan" /F`

## إيقاف التجربة وحذفها
- سكّر نافذة الموقع (Ctrl+C).
- للحذف بالكامل:
```powershell
cd C:\Users\Hp\Desktop\OMEGA_PRIME_PROJECT
git worktree remove ..\OMEGA_PAPER --force
```

## إذا صار خطأ
انسخ آخر 20 سطر من النافذة وأرسلهم في نفس الثريد.
