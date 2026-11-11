# Zenodo record draft: physics-signals negative result

Status: draft, nothing uploaded. Written 2026-10-15 for ADR-072. Every number below is copied from
`physics_lab/results/metrics.json`, `REPORT.md` and `oos_btc_2023_2026.json` on branch
`claude/project-thread-huo78r` (ADR-065).

## Metadata

- **Upload type:** Publication / Report (with software attached; see "What to upload")
- **Title:** Physics-inspired market indicators do not beat 20-day volatility as crisis warnings: a negative result on S&P 500, WTI oil and Bitcoin
- **Authors:** [Ahmad's full name as it should appear]; affiliation: independent
- **Keywords:** negative result, Hurst exponent, Lyapunov exponent, Reynolds number, econophysics, drawdown prediction, ROC AUC, block bootstrap, Bitcoin, WTI, S&P 500
- **Licence (text):** CC BY 4.0 suggested for the report. Data licences differ, see below.
- **Language:** English (Arabic summary can go in "Additional notes")

## Abstract (English, ~250 words)

Physics-inspired indicators, namely the Hurst exponent, a Lyapunov-style divergence rate and a Reynolds-style flow ratio, are often promoted as early warnings of market crises, with fixed thresholds borrowed from fluid dynamics and chaos theory. We tested them on free daily data for the S&P 500 (2000-2018, n = 4,759 days), WTI crude oil (1987-2026, n = 9,244) and Bitcoin (2011-2026, n = 5,517). The target was the worst 10% of forward 20-trading-day drawdowns per asset; signals at day t used data up to t only, with window lengths (252 and 20 days) fixed before running. Skill was measured as ROC AUC with 95% confidence intervals from a 63-day block bootstrap. Plain 20-day volatility scored 0.731 [0.643, 0.821] on the S&P 500, 0.691 [0.611, 0.754] on WTI and 0.687 [0.597, 0.753] on Bitcoin; VIX scored 0.743 [0.656, 0.821]. Every confidence interval for Hurst and Lyapunov contained 0.5. The fixed thresholds failed as written: the Reynolds-style ratio never exceeded 2000 (maximum 17.4, 21.4 and 1578), while a positive Lyapunov value occurred on 100% of days, as it does for shuffled returns. The only result above chance, the Reynolds-style ratio on Bitcoin (AUC 0.633 [0.540, 0.717]), still trailed volatility and failed an out-of-sample test on 2023-2026 data (1,219 days, 14 stress days, stress cutoff fixed from pre-2023 data): AUC 0.329 [0.269, 0.452]. On daily data, none of these indicators adds warning value over volatility. Code, per-day signal values and data checksums are provided for reproduction.

## الملخص بالعربية (للملاحظات الإضافية)

اختبرنا ثلاثة مؤشرات مستوحاة من الفيزياء (Hurst وLyapunov ونسبة شبيهة بـ Reynolds) كتحذير مبكر من الأزمات على مؤشر S&P 500 ونفط WTI والبيتكوين. التذبذب العادي لآخر 20 يوماً تفوّق عليها كلها (AUC بين 0.687 و0.731). العتبات المشهورة لم تعمل: Reynolds لم تتجاوز 2000 أبداً، وLyapunov كان موجباً في كل الأيام مثل البيانات العشوائية. أفضل نتيجة (Reynolds على البيتكوين، 0.633) سقطت في اختبار 2023 إلى 2026 إلى 0.329 [0.269، 0.452]. النتيجة سلبية: لا قيمة إضافية لهذه المؤشرات على البيانات اليومية.

## Method notes (for "Additional notes")

- Reynolds* = |drift t-stat| x sqrt(20) x volume ratio; its scale is arbitrary, so pipe-flow thresholds (2000/4000) cannot transfer.
- Overlapping 20-day targets inflate naive significance, hence the block bootstrap. Seed 7.
- Limits: daily closes only (no order book), one window length per signal, S&P 500 data ends in 2018.

## What to upload, and what not to

| Item | Upload? | Why |
|---|---|---|
| Report (PDF of REPORT.md, EN + AR) | Yes | Our own text. |
| `physics_lab/` code + `metrics.json` + `oos_btc_2023_2026.json` | Yes | Our own code and results; needs a code licence chosen first (e.g. MIT). |
| `signals_btc.csv.gz` | Only under non-commercial terms | Derived from CoinMetrics data, CC BY-NC 4.0. |
| `signals_sp500.csv.gz` | Check first | S&P 500 data came via the `arch` package from Yahoo Finance; redistribution terms not verified. |
| `signals_wti.csv.gz` | Check first | Source github.com/datasets/oil-prices (EIA); licence not verified this session. |
| Raw price files | No | Link to sources and give SHA-256 checksums instead (already in `metrics.json`). |

Blockers before upload: Ahmad's Zenodo account, his name for the author field, a code licence choice, and Ahmad's go.
