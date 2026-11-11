# NABD launch checklist / قائمة الإطلاق

Status: draft, written 2026-10-15 for ADR-072. Every row below is an outward action: each one needs Ahmad's own go at the time, and Claude does none of them alone.
"When" is the gate it waits on, not a date.

## Claims in the plan, checked on 2026-10-15

| Claim in the plan | What I found | Status |
|---|---|---|
| Lago, open-source billing, 9,726 stars | getlago/lago on GitHub shows **10.3k** stars (rounded), licence AGPLv3. Lago does **not collect money itself**: it needs a payment provider (official: Stripe, Adyen, GoCardless; community: Cashfree, Moneyhash; or webhooks to another provider). Stripe does not support Kuwait accounts (earlier finding). | Verified; star figure in the plan is out of date |
| Formbricks, open-source, 100% self-hostable | AGPLv3 core, about 12.8k stars, free self-hosting. Not 100%: enterprise features (incl. AI) need a paid licence key. Self-hosting runs eight services, minimum 2 vCPU / 4 GB RAM. | Verified, with that caveat |
| Arc CMS, landing page + waitlist | The only "ARC CMS" found is a Yii-based PHP CMS on SourceForge, last updated 2016-10-24, with no waitlist feature. Could not find the project the plan means. | **Not verified** |
| Lightning Landing, GitHub Pages | No project by that name found. The landing draft (PR #12) is already plain HTML that GitHub Pages can serve, so no template is needed. | **Not verified** |
| Tally.so | Not checked this session. Believed to be a hosted service, not open source. | **Not verified** |

Sources: github.com/getlago/lago, getlago.com/docs/guide/payments/payment-providers, github.com/formbricks/formbricks, formbricks.com/docs/self-hosting/overview, sourceforge.net/p/goarc.

## Outward actions

| # | Action | What exactly | Approval needed | Blocker | When |
|---|---|---|---|---|---|
| 1 | Email the lawyer | Send docs/LAWYER-QUESTIONS.md (AR + EN) | Ahmad picks the lawyer and sends it himself | A lawyer's contact | Now; nothing blocks it |
| 2 | Kuwaiti commercial licence (MOCI) | Apply for the minimum licence for a sole proprietor | Ahmad, in person or via the ministry portal; fees are his | Lawyer's answer to Q4 (type, cost, office need) | After the lawyer answers Q4 |
| 3 | Publish the physics report | Make the report and code public (merge branch `claude/project-thread-huo78r` into a public repo, or a separate public repo) | Ahmad's go to publish and to pick a code licence | Repo is not public; code licence not chosen; data licences (see ZENODO-ABSTRACT.md) | Before 4, 5, 6 |
| 4 | Turn on GitHub Pages for the landing page | Merge PR #12, enable Pages, set noindex off | Ahmad's merge and settings change | PR #12 TODOs (feature list, disclaimer, waitlist link, report link); Pages on a private repo may need a paid GitHub plan (not verified) | After 3 and the form exists |
| 5 | Create the waitlist form | Build the 3-question form from LAUNCH-COPY.md section 5 | Ahmad picks the tool and creates the account | Tool choice (Tally not open source?; Formbricks heavy; n8n needs the laptop public via Cloudflare Tunnel); privacy line reviewed (lawyer Q7) | Before 4 |
| 6 | Zenodo upload | Upload report + code per ZENODO-ABSTRACT.md, get a DOI | Ahmad's account, name and go; a DOI cannot be deleted later | 3 done; author name; code licence; data licence check | After 3 |
| 7 | Hacker News post | "Show HN" or plain link to the negative result, title in English, e.g. "Physics-inspired crisis indicators don't beat plain volatility (negative result)" | Ahmad posts from his own account | 3 and 6 done; HN's Show HN rules (not checked this session) may exclude sign-up pages, so lead with the report, not the waitlist | After 6 |
| 8 | Reddit posts | Same result, adapted to each subreddit (e.g. r/algotrading, r/quant) | Ahmad posts from his own account | Each subreddit's self-promotion rules (not checked) | After 6, a day apart from HN |
| 9 | Twitter/X thread | 4 to 6 posts: question, method, table, out-of-sample failure, link; AR and EN versions | Ahmad posts | 3 and 6 done | Same day as 7 |
| 10 | Any email to waitlist sign-ups | First "you're on the list" or launch email | Ahmad approves each send | Form exists; privacy notice reviewed; sending tool chosen | After 5 |
| 11 | Billing with Lago | Self-host Lago and connect a payment provider | Ahmad, plus his payment-provider account | **BLOCKED** until (a) a payment provider that accepts a Kuwaiti business exists (Stripe does not; Tap and MyFatoorah terms not verified) and (b) the lawyer has answered Q1 to Q3 | Not this week |
| 12 | Any paid subscription or price on the page | Show a price or take money | Ahmad | **BLOCKED** by 2 and 11 | Not this week |

## Shippable this week without any blocker

- Send the lawyer email (1).
- Choose the waitlist tool (5).
- Decide whether the physics report goes public (3).

Everything else waits on one of those three.
