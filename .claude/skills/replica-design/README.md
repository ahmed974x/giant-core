# replica-design (نسخة محسّنة)

مهارة Claude لبناء نظام تصميم «غرفة نظيفة» (Clean-Room) لتطبيق تريد إعادة بنائه:
أدوار الألوان، مقاييس الخطوط والمسافات، ومواصفات المكونات بكل حالاتها، دون نسخ
شعارات التطبيق الأصلي أو خطوطه أو نصوصه أو لونه التجاري.

مبنية على `replica-design` من [Jakeschincariol/replica-skill](https://github.com/Jakeschincariol/replica-skill)
(رخصة MIT)، ومتوافقة مع مجلد `replica/` الذي تستخدمه بقية مهارات الحزمة.

## ما الذي أُضيف على الأصل

| الفجوة في الأصل | الإضافة هنا |
| --- | --- |
| يطلب «قِس بأداة اختيار الألوان» دون أداة | `sample.py`: يقرأ لقطات PNG بدون مكتبات، ويستخرج الألوان السائدة مجمّعة، أو قيمة بكسل محدد |
| يطلب توليد `tokens.css` وإعداد Tailwind دون أداة | `build_tokens.py`: يولّد CSS (فاتح + داكن + تقليل الحركة) وإعداد Tailwind v3 أو كتلة `@theme` لـ v4 |
| لا يوجد وضع داكن | `color-dark` في القالب، و`contrast.py` يفحص الوضعين |
| الأدوار `warning` و`focus` مذكورة لكنها غير موجودة في القالب | 16 دوراً لونياً، وكلها تجتاز WCAG AA في الوضعين (32 فحصاً، 0 فشل) |
| لا يوجد قالب `components.md` | قالب جاهز مع أنماط WAI-ARIA وخريطة لوحة المفاتيح لكل مكوّن |
| وصف المهارة أطول من 200 حرف | 175 حرفاً، فيُقبل الرفع في claude.ai |
| فحص WCAG فقط | `--apca 60`: يضيف معيار APCA (نتائجه مطابقة لحزمة apca-w3 الرسمية) |
| ألوان hex فقط | `--oklch`: يكتب الألوان بصيغة OKLCH ويُبقي hex في تعليق |
| الوضع الفاتح هو الافتراضي دائماً | `"theme-default": "dark"` يجعل الداكن افتراضياً والفاتح زر تبديل |

## التثبيت

**Claude Code (عام لكل المشاريع):**

```bash
mkdir -p ~/.claude/skills && cp -r replica-design ~/.claude/skills/
```

ثم استدعِها بالأمر `/replica-design`.

**claude.ai / Claude Desktop:** من Settings ثم Capabilities ثم Skills، ارفع الملف `replica-design.zip`.

**بدون Skills:** الصق محتوى `SKILL.md` في أول المحادثة. تعمل الطريقة حينها، لكن بدون أدوات Python.

## الأدوات (Python 3.8+، مكتبة قياسية فقط، بلا اتصال بالشبكة)

```bash
python3 sample.py replica/screens/S01.png --top 12
```

```bash
python3 sample.py replica/screens/S01.png --at 120,48 640,300
```

```bash
python3 build_tokens.py replica/design/tokens.json --oklch
```

```bash
python3 contrast.py replica/design/tokens.json --apca 60
```

```bash
python3 -m unittest discover -s tests -v
```

## الملفات

```
SKILL.md                  تعليمات المهارة
sample.py                 قياس الألوان من لقطات الشاشة
build_tokens.py           tokens.json -> tokens.css + tailwind.tokens.js
contrast.py               بوابة WCAG للوضعين الفاتح والداكن
templates/tokens.json     قالب الرموز (16 دوراً، فاتح + داكن)
templates/components.md   قالب مواصفات المكونات
tests/test_tools.py       الاختبارات
```

في هذا المستودع: المراجعة الأمنية `docs/security/REPLICA-DESIGN-SKILL-REVIEW-2026-11-04.md` وقرار التصميم ADR-132.

الرخصة: MIT، وتبقى نسبة العمل الأصلي لـ Jake Schincariol.
