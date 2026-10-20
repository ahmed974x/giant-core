# ADR-098: Public site on GitHub Pages

Date: 2026-10-20 · Status: Accepted. Ahmad chose "نشر عام" (public publish) on the decision card on 2026-10-20, with these conditions: publish from main only, after the PR is merged with CI and scans green; no secrets, personal invoice data or wallet data in the published files; the paper-only rules still hold.

## Context
Ahmad asked for `.github/workflows/deploy-pages.yml` to publish NABD, the Ops Room and THE CHAIN at `https://ahmed974x.github.io/giant-core/` on every merge to main, with relative paths. The repository is public.

## Decision
1. **Workflow** `.github/workflows/deploy-pages.yml`:
   - Triggers: push to `main` or a manual run. Pull requests never deploy.
   - The build job runs the whole-repo SkillSpector strict scan, assembles the site, scans the built site strictly, then uploads it with the official `actions/configure-pages`, `upload-pages-artifact` and `deploy-pages` actions.
   - Only the deploy job holds `pages: write` and `id-token: write`. The rest of the workflow has `contents: read`.
2. **Build script** `scripts/build-pages.mjs`:
   - Copies a fixed allowlist: the NABD pages, style, scripts, fonts, icons, manifest and service worker at the root, and the Ops Room, THE CHAIN, their manifest, service worker and icons under `omega-ops-room-v1/`. These are the same folder scopes as the local server, so every relative path, manifest and service worker works unchanged under `/giant-core/`.
   - Refuses to publish if any text file contains an e-mail address, a key-shaped string (OpenAI, Groq, Cerebras, Google, GitHub and AWS formats) or the name of a local secret file.
   - Writes `omega-ops-room.html` and `the-chain.html` redirect stubs with a strict CSP, a meta refresh and a link, plus `.nojekyll`.
3. **What a visitor gets.**
   - The pages run entirely in the visitor's browser. Their paper wallet, receipts and notes stay in their own `localStorage`, and nobody else's data is published or shared.
   - Browser-direct sources (Binance public market data, USGS, Open-Meteo, CoinGecko, mempool.space, NASA GIBS) work. Proxy-only layers (OpenSky, GDACS, GDELT, AIS, NGA, SEC, Stooq) show OFFLINE unless the visitor runs the proxy on their own machine.
   - Nothing signs or sends an order. The auto engine opens paper trades only, and `S` moves paper profit inside the paper ledger only.
4. The SEC contact e-mail stays out of the repository (ADR-094). The build check would stop a deploy that tried to publish it.

## Consequences
- GitHub Pages must use "GitHub Actions" as its source (Settings → Pages). This is a one-time owner setting that the workflow token cannot change.
- Verified in the sandbox: the build produced 29 files and passed its checks, and SkillSpector on the built site gave 0 critical and 0 high. All four pages served under `/giant-core/` loaded with no page errors, registered their service workers and reported no installability errors. The redirect stubs landed on the right pages.
