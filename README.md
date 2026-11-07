# Jarvis retina screenshots (ADR-134)

Captured on 2026-11-04 from the live local server (`jarvis/server`, SQLite) with Playwright Chromium at `deviceScaleFactor: 2`. Dark and light themes; 1440, 768 and 375 wide (so 2880, 1536 and 750 pixels). This branch holds images only and is never merged.

## Studio after a clean-room clone, English LTR preview

| | 1440 | 768 | 375 |
| --- | --- | --- | --- |
| dark | ![studio-clone-en dark 1440](retina/studio-clone-en-dark-1440.png) | ![studio-clone-en dark 768](retina/studio-clone-en-dark-768.png) | ![studio-clone-en dark 375](retina/studio-clone-en-dark-375.png) |
| light | ![studio-clone-en light 1440](retina/studio-clone-en-light-1440.png) | ![studio-clone-en light 768](retina/studio-clone-en-light-768.png) | ![studio-clone-en light 375](retina/studio-clone-en-light-375.png) |

## Studio after a clean-room clone, Arabic RTL preview

| | 1440 | 768 | 375 |
| --- | --- | --- | --- |
| dark | ![studio-clone-ar-rtl dark 1440](retina/studio-clone-ar-rtl-dark-1440.png) | ![studio-clone-ar-rtl dark 768](retina/studio-clone-ar-rtl-dark-768.png) | ![studio-clone-ar-rtl dark 375](retina/studio-clone-ar-rtl-dark-375.png) |
| light | ![studio-clone-ar-rtl light 1440](retina/studio-clone-ar-rtl-light-1440.png) | ![studio-clone-ar-rtl light 768](retina/studio-clone-ar-rtl-light-768.png) | ![studio-clone-ar-rtl light 375](retina/studio-clone-ar-rtl-light-375.png) |

## Skill Mixer with the Replica pipeline

| | 1440 | 768 | 375 |
| --- | --- | --- | --- |
| dark | ![skill-mixer dark 1440](retina/skill-mixer-dark-1440.png) | ![skill-mixer dark 768](retina/skill-mixer-dark-768.png) | ![skill-mixer dark 375](retina/skill-mixer-dark-375.png) |
| light | ![skill-mixer light 1440](retina/skill-mixer-light-1440.png) | ![skill-mixer light 768](retina/skill-mixer-light-768.png) | ![skill-mixer light 375](retina/skill-mixer-light-375.png) |

## Agent editor (tools, permissions, linked skills, locked rows)

| | 1440 | 768 | 375 |
| --- | --- | --- | --- |
| dark | ![agent-editor dark 1440](retina/agent-editor-dark-1440.png) | ![agent-editor dark 768](retina/agent-editor-dark-768.png) | ![agent-editor dark 375](retina/agent-editor-dark-375.png) |
| light | ![agent-editor light 1440](retina/agent-editor-light-1440.png) | ![agent-editor light 768](retina/agent-editor-light-768.png) | ![agent-editor light 375](retina/agent-editor-light-375.png) |

## Locked approvals «قيد الموافقة»

| | 1440 | 768 | 375 |
| --- | --- | --- | --- |
| dark | ![locked-approvals dark 1440](retina/locked-approvals-dark-1440.png) | ![locked-approvals dark 768](retina/locked-approvals-dark-768.png) | ![locked-approvals dark 375](retina/locked-approvals-dark-375.png) |
| light | ![locked-approvals light 1440](retina/locked-approvals-light-1440.png) | ![locked-approvals light 768](retina/locked-approvals-light-768.png) | ![locked-approvals light 375](retina/locked-approvals-light-375.png) |

## ADR-135 (2026-11-05)

Mission Control on the live server (giant-core's "Release readiness" mission, run for real), dark and light, at 1440, 768 and 375, deviceScaleFactor 2:

- `mission-control-*`: phases, steps and the side panel (context health, capsules);
- `mission-locked-step-*`: the locked publish step as a «بانتظار الموافقة» card while the other steps carried on;
- `mission-capsules-*`: inspecting capsule #2 (hash check and saved states);
- `missions-list-*`.

The Studio, Skill Mixer, agent editor and locked approval shots were retaken from the same build. The Studio shots now show the template extractor: Jarvis tokens and a glass bar.

## ADR-136 (2026-11-05)

Local model bridge, on the real server with a **fake Ollama on 127.0.0.1**. The sandbox has no Ollama, so the model answers shown are fixed test text. Dark and light, at 1440, 768 and 375:

- `llm-mission-planner-*`: a mission planned by `jarvis-planner`, with its thinking folded as untrusted text and the publish step locked by rule;
- `llm-settings-*`: the Local model panel;
- `llm-studio-design-*`: a page designed from a description; only the layout was kept.

## ADR-137 (2026-11-05)

Real server, giant-core workspace, dark and light, at 1440, 768 and 375, in **English and Arabic** (60 shots):

- `workflow-editor-*`: the SVG editor with the locked publish step selected;
- `workflow-mission-*`: the mission a workflow run made, with locked steps waiting;
- `analytics-*`: creator mode, the numbers and the bar charts;
- `webhooks-*`: an incoming hook, and an outside outgoing hook locked as «بانتظار الموافقة»;
- `plans-tokens-*`: draft subscriber plans, the locked billing switch and the token ledger.

## ADR-143 (2026-11-06)

Governance page and the model catalog, dark and light, at 1440, 768 and 375, in **English and Arabic** (36 shots):

- `governance-rules-*`: the surgical rules, the quality gate (62 rules) and the register of adopted and excluded tools;
- `governance-map-*`: the SVG knowledge map from `replica-graphify` with a screen selected and its links lit;
- `model-catalog-*`: Settings → the 12 open-weight families with maker, origin, licence and job.

## ADR-144 (2026-11-06)

Real server with a **fake local model on 127.0.0.1** (the sandbox has no Ollama; its answers are fixed test text), dark and light, at 1440, 768 and 375, in **English and Arabic** (36 shots):

- `council-debate-*`: architect, red team and UX critic, synthesizer; the publish and pay steps the model left unlocked leave the council locked «بانتظار الموافقة»;
- `studio-time-machine-*`: two SHA-256 chained snapshots compared side by side;
- `studio-heatmap-*`: the attention grid over the preview with small targets outlined, and Fitts, Hick and mirror symmetry.

## ADR-145 (2026-11-06)

Real server, giant-core workspace, dark and light, at 1440, 768 and 375, in **English and Arabic** (36 shots):

- `macro-composer-*`: Ctrl+K → Compose a macro, with «Formal Proof: Verified» and the publish and pay steps stopping at «قيد الموافقة»;
- `macro-mission-*`: the mission the server made after proving the macro again;
- `studio-export-*`: the five exports, with the SQL tables that start locked.

## ADR-146 (2026-11-06)

Real server, dark and light, at 1440, 768 and 375, in **English and Arabic** (24 shots):

- `evidence-gates-*`: the UI-state gate (27/27) and the measured mutation results (493/493 killed, [VERIFIED] while each file's hash matches);
- `field-busy-*`: the Missions goal field in its busy state.

## ADR-147 (2026-11-06)

Dark and light, at 1440, 768 and 375, in **English and Arabic** (24 shots):

- `telemetry-lttb-*`: Analytics → Telemetry in sample mode: 5,000 made-up build times (labelled «مثال تعليمي — أرقام افتراضية») cut to 120 points by LTTB, four anomalies marked, Welford, EWMA and VPIN [INFERENCE];
- `merkle-proof-*`: Logs → Merkle audit tree on the real server, with an inclusion proof checked in the browser.

## ADR-148 (2026-11-06)

Real server, dark and light, at 1440, 768 and 375, in **English and Arabic** (24 shots):

- `diagnostics-layers-*`: the five layers, each checked now and marked ready;
- `diagnostics-bundle-*`: the bundle saved on this computer after the scrubber, with the count of removed values.

## ADR-149 (2026-11-06)

Sample mode, dark and light, in **English and Arabic** (20 shots):

- `studio-gz-template-*` (1440, 768, 375): Studio → Exports → «Compressed template», the `.json.gz` export and the import field (1 MB packed, 2 MB unpacked cap);
- `studio-sync-window1-*` and `studio-sync-window2-*` (720): two windows of the same page; the site name typed in the first appears in the second (`BroadcastChannel`).

## ADR-150 (2026-11-07)

Real server, dark and light, at 1440, 768 and 375, in **English and Arabic** (24 shots):

- `studio-reversal-*`: Studio → Autonomous Reversal Log after **Reverse and correct** on a blue to purple gradient and a glass bar: the corrections, the corrected copy and the log with SHA-256 hashes;
- `diagnostics-reversal-*`: the same log in `#/diagnostics`, read-only.

## ADR-151 (2026-11-07)

Real server, dark and light, at 1440, 768 and 375, in **pure English and pure Arabic** (24 shots):

- `pure-diagnostics-*`: the proof layer with the server's own details in the page's language («748 ناجح، 0 فاشل», «تم القضاء على 1008/1008 طفرة», «0 حرج، 0 عالي») and the new bilingual purity check;
- `pure-settings-models-*`: the open-weight catalog, licence notes translated, names and identifiers isolated.

## ADR-152 (2026-11-07)

Dark and light, at 1440, 768 and 375, in **English and Arabic** (24 shots):

- `recon-live-*`: `#/recon` on the real server for `acme.example`, with fixture answers standing in for the four public GETs (the cloud sandbox has no outbound network): registration and DNSSEC, certificate names, the 0-100 header grade with fixes, security.txt;
- `recon-sample-*`: the sample page's teaching example for `example.com`, labelled «مثال تعليمي — أرقام افتراضية».

## ADR-153 (2026-11-07)

Real server, dark and light, at 1440, 768 and 375, in **English and Arabic** (24 shots):

- `studio-heal-*`: Studio → Colours after **Heal contrast automatically** on a theme with four failing pairs: every badge passes, and the report gives each change with WCAG and APCA Lc before and after;
- `reversal-contrast-*`: the reversal engine healing a template's colour pairs (`#777777` on white, and an OKLCH blue on near-black, hue kept).

## ADR-154 (2026-11-07)

Real server, dark and light, at 1440, 768 and 375, in **English and Arabic** (36 shots):

- `math-calculus-*`: `#/math` for x³ − 6x² + 11x − 6 on [0.5, 3.5]: the simplified expression, the derivative 3x² − 12x + 11, the roots 1, 2, 3 by Brent and Newton, Simpson's integral, each back-check passed and [VERIFIED];
- `math-ode-plot-*`: RK4 for dy/dx = −2y + x, y(0) = 1, 20 steps: y(2) = 0.7728959917, the step-doubling check, and the solution drawn as one SVG path;
- `math-number-theory-*`: 104729 prime by Miller-Rabin with 13 bases, and x ≡ 23 (mod 105) by the Chinese remainder theorem.

## ADR-155 (2026-11-07)

Real server, dark and light, at 1440, 768 and 375, in **English and Arabic** (48 shots):

- `hyper-e8-*`: `#/hyper` opens on the 240 E8 roots in the Coxeter plane, with 6720 edges in the accent (`#77bcff` dark, `#0b5ed7` light). Beside them: Coxeter element of order 30, the double eigenvalue, 8 rings of 30 roots, and [VERIFIED];
- `hyper-cube-*`: the cube with its faces sorted back to front and shaded in OKLCH from the accent;
- `hyper-tesseract-*`: the tesseract turned 35° in the xw plane, perspective R4 → R3 → R2;
- `hyper-optics-physics-*`: 85 mm at f/1.4 focused at 2.5 m (depth of field, hyperfocal 179 m, EV100 8.94, three lights from their Kelvin), and A* on a 12 × 12 grid equal to breadth-first search, with two particle tracks.
