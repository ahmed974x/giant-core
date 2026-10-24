# Live trading readiness plan · خطة الجاهزية للتداول الحقيقي

Status: **proposal, locked «قيد الموافقة»**. Written 2026-10-24 for Ahmad (Director 00), ADR-119.
Nothing in this file, and nothing in the repository, signs or sends an order to any exchange. Real trading stays
locked under AGENTS.md §1 until Ahmad picks the limits below in his own words **and** the legal and security
reviews in §6 are done.

الحالة: **مقترح مقفول «قيد الموافقة»**. لا يوجد في المستودع أي كود يوقّع أو يرسل أمر لأي منصة. التداول الحقيقي
يبقى مقفول حتى يختار أحمد الحدود تحت بكلامه هو، وتخلص المراجعة القانونية والأمنية في القسم 6.

---

## 1. The short answer · الجواب المختصر

**EN.** The safest way to let PRIME trade with real money is *not* to write our own order-signing code. Use a
mature open-source engine that thousands of people already run (Freqtrade, GPL-3.0), on the laptop only, with
the exchange key stored there, encrypted, and never in the public site or in git. The OMEGA site stays the
brain and the dashboard: it produces signals, shows the readiness gate and the live status read-only, and the
engine on the laptop is the only thing that can touch the exchange, inside hard caps that the code cannot raise.

**AR.** أأمن طريقة إن PRIME يتداول بفلوس حقيقية هي **إننا ما نكتب كود توقيع أوامر من عندنا**. نستخدم محرّك
مفتوح المصدر ناضج يشغله آلاف الناس (Freqtrade، رخصة GPL-3.0) على اللابتوب بس، والمفتاح محفوظ هناك مشفّر، ولا
يدخل أبداً الموقع العام ولا git. موقع OMEGA يبقى هو المخ ولوحة العرض: يطلع الإشارات، ويعرض بوابة الجاهزية
والحالة المباشرة قراءة فقط، والمحرّك على اللابتوب هو الوحيد اللي يلمس المنصة، داخل سقوف ثابتة ما يقدر الكود
يرفعها.

## 2. Open-source engines compared · مقارنة المحركات المفتوحة

| Engine | Licence | Fits us because | Watch out |
|---|---|---|---|
| **Freqtrade** (recommended) | GPL-3.0 | Python, Docker, dry-run mode with the same code path as live, `max_open_trades`, `stake_amount`, `tradable_balance_ratio`, built-in protections (StoplossGuard, MaxDrawdown, CooldownPeriod, LowProfitPairs), Telegram and FreqUI with `/stop` and `/stopentry`, backtesting and hyperopt, FreqAI for models | GPL: our own code stays separate (we talk to its REST API, we do not copy its code into the site) |
| Hummingbot | Apache-2.0 | Market making and arbitrage, many connectors | Built for market making; more moving parts than we need for a few spot trades |
| CCXT | MIT | Unified exchange library used by Freqtrade itself | A library, not a bot: we would have to write the order, risk and kill logic ourselves, which is exactly what we want to avoid |
| NautilusTrader | LGPL-3.0 | Institutional-grade event engine, Rust core | Heavy to learn; overkill for a 20 to 100 USDT start |
| Jesse | MIT | Clean Python strategies, good backtests | Live trading plugin model differs; smaller community than Freqtrade |
| OctoBot | GPL-3.0 | Easy UI | Less control over hard caps |

Sources: each project's own GitHub repository and documentation (freqtrade/freqtrade, hummingbot/hummingbot,
ccxt/ccxt, nautechsystems/nautilus_trader, jesse-ai/jesse, Drakkar-Software/OctoBot), read 2026-10-24.
Versions are pinned only at install time after the security review in §6; nothing is installed by this plan.

## 3. Architecture · البنية

```
OMEGA site (public, GitHub Pages)      laptop only (127.0.0.1)                     exchange
  signals, court, PRIME   ──read──▶   omega-data-proxy :8796  ◀──REST, read──  Freqtrade :8080 ──signed──▶ Binance spot
  readiness gate (paper)              /live/status (read-only)                 key: dotenvx-encrypted       (key: trade only,
  live status (read-only)                                                      caps in config, kill switch   no withdrawal,
                                                                                                             IP allow-list)
```

- The public site never holds a key, never signs, never sends. It can only *read* the engine's status through
  the local proxy on `127.0.0.1` (a later PR, after approval).
- The engine runs in Docker on the laptop, bound to `127.0.0.1`, its REST API with a local password.
- PRIME's signals reach the engine only as a strategy file that Ahmad reviews; the engine re-checks every cap.

الموقع العام ما يمسك مفتاح ولا يوقّع ولا يرسل. يقرأ حالة المحرّك بس عن طريق الـ proxy المحلي. المحرّك يشتغل في
Docker على اللابتوب على 127.0.0.1 بس.

## 4. Hard guards · الحمايات الثابتة

1. **Your own key, trade only.** A new Binance API key (Ed25519 preferred) with *Enable Spot & Margin Trading*
   on, **withdrawals off**, margin and futures off, and **Restrict access to trusted IPs** set to the laptop's
   public IP. A key that can withdraw is refused by the setup check.
2. **Separate sub-account or a small balance.** Only the starting capital you pick sits where the key can trade.
3. **Hard caps in the engine config** (per trade, per day, open positions, total). The engine refuses to start if
   a cap is missing or above the numbers you approved.
4. **Kill switch.** One button in the Ops Room (through the local proxy) and Telegram `/stop`; plus the daily
   loss cap stops new entries automatically until the next UTC day.
5. **Human confirmation per order at first.** For the first N live orders every entry waits for your tap
   (Freqtrade `entry_pricing` with a confirm callback in our strategy, or `/forceenter` only). No auto entries
   until N confirmed trades are done and reviewed.
6. **Spot only.** No leverage, no futures, no margin, no shorting.
7. **Paper-vs-live gate.** Live stays locked until the paper track record passes the gate in §5, measured by
   TRADE LAB from the verified receipt chain.
8. **Every live fill gets a receipt** in the same hash chain format with `mode: "live"`, kept separate from the
   paper chain, so you can audit every order.
9. **Key hygiene.** The key lives only in the laptop's dotenvx-encrypted env (ADR-042), never in `localStorage`,
   the site, a chat, a screenshot or git. Rotate it every 90 days and after any doubt.

١. مفتاحك أنت، تداول بس، **السحب مقفول**، ومقيّد على IP اللابتوب. ٢. رصيد صغير أو حساب فرعي. ٣. سقوف ثابتة في
إعدادات المحرّك. ٤. زر إيقاف طوارئ + إيقاف تلقائي عند حد الخسارة اليومي. ٥. أول الصفقات كل أمر ينتظر موافقتك
بضغطة. ٦. سبوت بس، بدون رافعة. ٧. ما ينفتح الحقيقي إلا إذا نجح سجل الورقي في البوابة. ٨. كل تنفيذ حقيقي له
إيصال مشفّر. ٩. المفتاح على اللابتوب بس مشفّر، ونغيّره كل 90 يوم.

## 5. Numbers for you to choose · الأرقام اللي تختارها أنت

Defaults below are the recommended option. Reply with your own numbers in your own words; nothing is set until
you do.

| Limit · الحد | Careful · حذر | **Recommended · المقترح** | Bolder · أجرأ |
|---|---|---|---|
| Starting live capital · رأس المال الحقيقي | 20 USDT | **50 USDT** | 100 USDT |
| Max per trade · أقصى مبلغ للصفقة | 2 USDT | **5 USDT** | 10 USDT |
| Daily loss stop · وقف الخسارة اليومي | 1 USDT | **2 USDT** | 5 USDT |
| Total loss stop (engine off) · وقف الخسارة الكلي | 4 USDT | **10 USDT** | 20 USDT |
| Open positions · صفقات مفتوحة معاً | 1 | **2** | 3 |
| Orders confirmed by hand first · أوامر بموافقتك أولاً | 50 | **30** | 15 |
| Markets · الأسواق | BTCUSDT | **BTCUSDT, ETHUSDT** | the desk's four |

Paper track-record gate (TRADE LAB measures it; the card shows pass or fail live):

| Gate · البوابة | Recommended |
|---|---|
| Closed paper round trips · صفقات ورقية مغلقة | ≥ 100 |
| Days of paper trading · أيام تداول ورقي | ≥ 30 |
| Profit factor · معامل الربح | ≥ 1.20 |
| Max drawdown · أقصى تراجع | ≤ 10 % |
| Plan compliance · الالتزام بالخطة | ≥ 90 % |
| Receipt chain · سلسلة الإيصالات | verified |

## 6. Before any live code · قبل أي كود حقيقي

- **Legal review.** Kuwait's regulators have issued restrictive rules on virtual-asset activity since 2023, and
  Binance's own terms differ by country. A Kuwaiti lawyer should confirm in writing that personal spot trading
  through a foreign exchange account is allowed for you, and what tax or reporting applies. Questions are in
  `/mnt/project-files/launch-drafts/LAWYER-QUESTIONS.md`; add these. Until then: **تعذر التحقق منها**.
- **Security review** of the pinned Freqtrade release (image digest, dependencies, open ports, REST API password,
  Telegram token storage), written up in `docs/` like the Windows-MCP review.
- **Dry run** on the laptop with the exact live config for at least 14 days (Freqtrade `dry_run: true`), side by
  side with the Ops Room paper desk.
- Then a separate PR that adds only the read-only `/live/status` proxy route and the kill-switch call, and a
  separate approval from you for the first live order.

## 7. Honest expectations · توقعات صادقة

No engine, model or agent can promise profit. Most retail algorithmic traders lose money after fees. The caps
above exist so that the worst case is a small, known loss you chose in advance. Every signal stays
`[INFERENCE]`, every size `[INFERENCE - Quant Model]`.

ما في محرّك ولا نموذج ولا وكيل يضمن ربح. أغلب المتداولين الآليين الأفراد يخسرون بعد الرسوم. السقوف فوق عشان
أسوأ حالة تكون خسارة صغيرة ومعروفة اخترتها أنت من البداية.
