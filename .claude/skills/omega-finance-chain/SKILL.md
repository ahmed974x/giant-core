---
name: omega-finance-chain
description: Use when researching a stock, building a valuation model, reviewing an earnings call or updating a ticker's notes.md for OMEGA. Rules for the three THE CHAIN agents; research only, never trading.
---

# OMEGA finance chain

Tool: `omega-ops-room-v1/the-chain.html` (open by double-click; state lives in the browser). The same rules apply when an agent does this work in text.

Order: **Market Researcher → Institutional Model Builder → Earnings Reviewer → notes.md**. Each step hands its summary to the next and appends it to the ticker's notes.md.

## Hard limits

- Research and display only. No orders, no broker or exchange keys, no signals sent anywhere. The 24/7 execution agent, public copy-trading vaults and investor profit split stay locked «قيد الموافقة» until Ahmad gives a separate explicit approval and legal review is done.
- Free, open sources only (GDELT DOC 2.0 for news, SEC EDGAR links for filings). No CAPTCHA solving, no scraping behind logins, no paid feeds.
- Not investment advice; say so wherever a conclusion is shown.

## 1. Market Researcher

- News from the last 90 days, split into company, regulatory and sector. Every item shows its source domain, its date and a link.
- Analyst price targets over the last 6 months as a range (low, median, high, change of the median). Only entries with a source link and a date count.
- Bulls versus bears: each argument with its source and date.
- Management quotes verbatim, with speaker, date and source; compare wording between the older and newer half.
- **Every claim has a source and a date.** Anything without both is shown and labelled **«تعذر التحقق منها»** and is left out of every summary number.
- Anything inferred by keywords or heuristics is tagged **[INFERENCE]**.
- End with **Information Gaps**: what is missing, unverified or one-sided.

## 2. Institutional Model Builder

Five sheets: **INPUTS · HISTORICALS · PROJECTION · VALUATION · SENSITIVITY**.

- No hard-coded number outside INPUTS. Formulas read only INPUTS and HISTORICALS. Sensitivity steps, the ranking perturbation and the 30% break threshold are INPUTS too.
- VALUATION has a DCF (FCF = EBIT × (1 − tax) + D&A − capex − ΔNWC; Gordon terminal value; WACC must exceed terminal growth) and comps (median peer EV/EBITDA and P/E).
- SENSITIVITY is a two-way matrix of price per share, any two drivers.
- Always report: the **top 3 assumptions** by impact, the **level of each that moves the price by 30%**, and the **top 3 risks** ranked by how close that level is to today's value.
- Export CSV and Excel. A teaching example is labelled as invented numbers on screen and in exports.

## 3. Earnings Reviewer

- **What was said vs expectations:** actual against consensus EPS and revenue, each with its source; forward-guidance sentences quoted verbatim.
- **How it was said vs last quarter:** hedging and confidence word rates per 1,000 words and the words that rose or fell. [INFERENCE].
- **Answered vs dodged:** each analyst question with the answer excerpt and a verdict (answered, partial, dodged) and the reason. [INFERENCE].
- **Thesis test:** the user's thesis in exactly 3 sentences, each checked against exact quotes that support or contradict it.
- **Falsification criteria:** measurable conditions (metric, threshold, date) that would prove the thesis wrong. No thesis is final without them.

## 4. notes.md (one file per ticker, cumulative)

```
# [TICKER]

## رأيي في 3 جمل
1. 
2. 
3. 

## ما الذي قد يثبت خطئي
- 

## آخر مراجعة
YYYY-MM-DD

## ما الذي تغيّر
- 

## سجل السلسلة
### YYYY-MM-DD · <agent>
- ...
```

Each "مراجعة جديدة" updates the date and writes what changed in the view and the risks since the previous review. Agent summaries are appended to «سجل السلسلة» and never overwrite the user's own view.
