# ROADMAP-BRAZIL: research notes only

Status: **RESEARCH, not a plan of record.** Written 2026-10-16 at Ahmad's request (ADR-073). No code for B3,
ProfitDLL, Tucano, NautilusTrader, TradingAgents or Alpaca is in this repository, and none is added until Ahmad
approves it in writing. Real money, live broker connections and live keys are out of scope until then. Nothing
here is legal advice; the legal points must be confirmed by a Brazilian lawyer.

Legend: **Verified** = checked against the source linked, on 2026-10-16. **Unverified** = claimed in the plan Ahmad
pasted, but not confirmed.

## 1. The tools named in the plan

| Claim | Status | What the source says |
|---|---|---|
| NautilusTrader: Rust core, Python strategies, same code in backtest and live | **Verified** | PyPI page: Rust core with PyO3 bindings, "identical strategy implementations between research and live deployment"; LGPL-3.0-or-later; v1.231.0 (2026-08-02). [pypi.org/project/nautilus-trader](https://pypi.org/project/nautilus-trader/) |
| NautilusTrader has a B3 / Brazil adapter | **Not found** | The integrations list on PyPI names no Brazilian venue. It lists Interactive Brokers; whether IB reaches B3 for this account is unverified. |
| TradingAgents (TauricResearch) is a multi-agent LLM trading framework (analysts, researchers, trader, risk team) | **Verified** | Paper arXiv 2412.20138. [arxiv.org/pdf/2412.20138v6](https://arxiv.org/pdf/2412.20138v6) |
| TradingAgents has "70k+ stars" | **Unverified** | A third-party tracker showed 31,553 stars on 2026-03-08. [oosmetrics.com](https://oosmetrics.com/repo/TauricResearch/TradingAgents). GitHub itself was not reachable from this session. Its license was not checked. |
| Tucano: Rust framework with native B3 integration via ProfitDLL | **Partly verified** | `tucano-core` 0.12.2 (2025-08-14), repo github.com/brbtavares/tucano: "live-trading, paper-trading and back-testing"; B3 via ProfitDLL is described as **in progress**, not finished. License of the core crate not stated. [crate page](https://rust-digger.code-maven.com/crates/tucano-core) |
| ProfitDLL can be used freely | **Unverified / doubtful** | The `profitdll` crate (MIT) says the real backend needs **Windows with the DLL installed and licensed** from Nelógica, has no affiliation with Nelógica, and is "educational/experimental". Nelógica's licence terms and price were not found. [crate page](https://rust-digger.code-maven.com/crates/profitdll) |
| "B3 API certificate" for an individual | **Unverified** | No public source found describing a B3 API certificate for an individual. Retail access normally goes through a Brazilian broker; this needs confirming with a broker. |
| mt5se for Brazilian market data | **Unverified** | Not checked. |
| Alpaca opens accounts for Kuwait residents | **Unverified** | Not confirmed from Alpaca's own pages. |

## 2. Rules for a Kuwait resident (to confirm with a lawyer)

- **Foreign portfolio investment in Brazil.** BCB/CVM Joint Resolution 13 (published 2024-12-03, in force
  2025-01-01) replaced Resolution 4,373. It removes the custodian requirement and lets a non-resident individual
  skip the Brazilian legal representative in some cases, e.g. securities investment with their own funds.
  **Verified** via [Lefosse](https://lefosse.com/news/alerts/bcb-and-cvm-publish-a-joint-resolution-to-simplify-access-to-the-financial-and-capital-markets-for-non-resident-investors/)
  and the [CVM text](https://www.gov.br/cvm/en/foreign-investors/regulation-files/RESOLUTIONCVM13_.pdf).
  Whether a Brazilian broker will onboard a Kuwait resident, and the tax registration (CPF) steps, are **unverified**.
- **The plan cites "CVM Resolution 20/2021" for managing other people's money. That is the wrong rule.** CVM 20
  covers securities **analysts**; CVM 21 covers **portfolio management**; CVM 19 covers **consultants**.
  **Verified** via [Legismap](https://legismap.com.br/conteudos/artigos-e-noticias/cvm-publica-novas-resolucoes-de-prestadores-de-servico-no-mercado).
  This matters: publishing or selling signals to others may fall under CVM 19/20, not only managing money.
- "Trading your own money needs no licence" and "spoofing/layering is prohibited and monitored by CVM/BSM": plausible,
  **unverified** here.
- Kuwait side: selling signals to others may need a Kuwait CMA licence (see council-session notes). Unchanged.

## 3. How it could fit OMEGA later (sketch, no code)

1. Keep today's design: signals → proposal queue → Ahmad approves → paper ledger (ADR-073). Any new engine plugs in
   only as another **signal source** that writes proposals with evidence links.
2. Research stage: NautilusTrader backtests on historical B3 data (source to be chosen), run offline, results shown
   as proposals on paper. No broker connection.
3. Data stage: read-only live B3 data, still paper only, still human approval.
4. Real money: only after a lawyer's written answer (Kuwait CMA + Brazil), a broker account Ahmad opens himself,
   and Ahmad's written approval. Out of scope today.

## 4. Open questions for Ahmad
- Which Brazilian broker, and will it accept a Kuwait resident?
- Is the ProfitDLL licence (Windows-only, paid, Nelógica) acceptable, given the "free/open-source" preference?
- Which historical B3 data source is allowed for backtests?
