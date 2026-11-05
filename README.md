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
