# تثبيت أدوات أوميغا المحلية على اللابتوب (ADR-129)

خمس أدوات مفتوحة المصدر اجتازت المراجعة الأمنية: Oxigraph وSkyfield وPyPortfolioOpt وDocling وLightRAG. تقرير المراجعة في `docs/security/TOOLS-SECURITY-REVIEW-2026-10-25.md`. كلها ورقية: ولا وحدة منها تقدر ترسل أمر تداول أو تحرّك فلوس. وكل أداة تبقى مطفأة إلى أن تشغّلها.

## قبل البداية
- **Python 3.12** من python.org. وقت التثبيت علّم على «py launcher».
- مجلد المشروع: `C:\Users\Hp\Desktop\OMEGA_PRIME_PROJECT` (نسخة giant-core المحدثة).
- لـ LightRAG بس: برنامج **Ollama** من ollama.com.

## الخطوة 1: التثبيت الخفيف (حوالي 300 ميغا)
يثبّت Oxigraph وSkyfield وPyPortfolioOpt.

1. افتح PowerShell داخل مجلد المشروع.
2. الصق هذا السطر:
   ```
   powershell -ExecutionPolicy Bypass -File omega_tools\install-omega-tools.ps1
   ```

السكربت يثبّت فقط الحزم اللي لها بصمة SHA-256 مكتوبة في `omega_tools\requirements-light.txt`، وأي حزمة غير مطابقة يرفضها. ما يبني شي من المصدر، ويحط كل شي في `%USERPROFILE%\.omega\tools`.

## الخطوة 2 (اختيارية): التثبيت الكامل (عدة غيغابايت)
يضيف Docling (تحويل ملفات PDF والوورد إلى نص) وLightRAG (بحث في ملاحظاتك بنموذج محلي).

```
powershell -ExecutionPolicy Bypass -File omega_tools\install-omega-tools.ps1 -Full
```

هذي الخطوة تنزّل مرة وحدة بس: نماذج Docling من Hugging Face، وجدول tiktoken، ونموذجين Ollama (`qwen2.5:3b` و`bge-m3`). بعدها كل شي يشتغل بدون إنترنت.

## الخطوة 3: التشغيل
1. دبل كليك على `start-omega-tools.bat`. السكربت يكتب هذا الملف في المجلد وقت التثبيت، ويشغّل بس الأدوات اللي ثبّتها.
2. للتأكد، افتح هذا الرابط في المتصفح:
   ```
   http://127.0.0.1:8097/api/health
   ```
   المفروض تشوف `"on": true` عند كل أداة مثبتة.
3. `start-omega.bat` بعد صار يكتب لك «OMEGA tools 8097: running» لما تكون الأدوات شغالة.

## وين تحط ملفاتك
- **ملفات PDF والوورد اللي تبي Docling يقراها:** في `%USERPROFILE%\.omega\inbox`. ما يقرا شي من برّا هذا المجلد، ولا يفتح روابط.
- **ملاحظات LightRAG:** تنحفظ في `%USERPROFILE%\.omega\lightrag`.

## لو تبي تطفي أداة
افتح `start-omega-tools.bat` بالمفكرة، وشيل اسمها من سطر `OMEGA_TOOLS=`.

## الحدود
- الخدمة تشتغل على 127.0.0.1 بس، يعني ما يوصلها أحد من الشبكة.
- أي صفحة ويب تحاول تشغّل أداة، الخدمة ترفضها.
- مخرجات الأدوات استنتاج ومعلّمة: `[INFERENCE - Quant Model]` و`[INFERENCE - local LLM]`.
- التداول باقي ورقي. الحقيقي وTestnet مقفلين «قيد الموافقة».
