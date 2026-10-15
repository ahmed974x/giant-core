---
name: awesome-research
description: Find trustworthy free open-source tools, libraries and open-weight AI models by starting from the curated "awesome" lists (github.com/sindresorhus/awesome, github.com/topics/awesome) instead of raw popularity. Use whenever the user asks for the best/strongest/free/open-source tool, library, model or skill for something, or asks to research tools before adding them to a project.
---

# Research tools through the awesome lists

Curated awesome lists are a better first filter than star counts: every entry was reviewed by a
maintainer. Use them to build the candidate list, then verify each candidate yourself.

## 1. Find the right lists

- Index of indexes: https://github.com/sindresorhus/awesome (raw: https://raw.githubusercontent.com/sindresorhus/awesome/main/readme.md)
- Topic page: https://github.com/topics/awesome (search the API with `topic:awesome <subject>`)
- Lists used most often:
  - Python: vinta/awesome-python, krzjoa/awesome-python-data-science
  - ML / AI: josephmisiti/awesome-machine-learning, ChristosChristofidis/awesome-deep-learning, steven2358/awesome-generative-ai
  - Finance / markets: georgezouq/awesome-ai-in-finance
  - Data: 0xnr/awesome-bigdata, numetriclabz/awesome-db, mgramin/awesome-db-tools, 0xnr/awesome-analytics
  - Visuals: wbkd/awesome-d3, zingchart/awesome-charting
  - Security: sbilly/awesome-security
  - Scala: lauris/awesome-scala

Read the raw README of each relevant list and collect the `github.com/<owner>/<repo>` links in the right section.

## 2. Verify every candidate (all must hold)

- OSI license (MIT, Apache-2.0, BSD, MPL, ISC, LGPL, PSF). No license or NOASSERTION means skip.
- Pushed within the last 6 months, not archived, not a fork.
- Fits the actual need, in the project's language, and its RAM/CPU cost fits the machine
  (for OMEGA: a 7 GB laptop, so JVM/GPU stacks are flagged, not installed).
- For open-weight models: the license allows the use, and the weights or a free hosted tier exist.

## 3. Report, then ask

Give a short ranked list: name, what it would improve, license, last activity, cost. Recommend one.
Never install from a list without the user's go-ahead. Once they approve, install the smallest package
that does the job and add a test.
