# ADR-099: Deploy the public site to the existing gh-pages branch

Date: 2026-10-20 · Status: Accepted (Ahmad asked on 2026-10-20 to make the public link work without his intervention, via a gh-pages branch if needed)

## Context
ADR-098's deploy job used `actions/deploy-pages`, which needs Settings → Pages → Source set to "GitHub Actions". It failed twice within two seconds, with no log. The repository already publishes Pages from the `gh-pages` branch (ADR-071, NABD landing page, 2026-10-15). The Pages settings API is not reachable from the cloud session.

## Decision
- The site built from main 1be3975 by `scripts/build-pages.mjs` was committed to `gh-pages` (832c872). The allowlist and checks were the same, and SkillSpector strict on the built site gave 0 critical and 0 high. GitHub's own "pages build and deployment" then publishes it.
- `deploy-pages.yml` keeps the build job: whole-repo scan, allowlisted build, built-site scan. The build job hands the site to the deploy job as an artifact.
- The deploy job now checks out `gh-pages`, replaces its contents with the built site and pushes a commit when something changed. It uses `contents: write`, no third-party action and no `pages`/`id-token` permissions.

## Consequences
- No settings change is needed. Each merge to main republishes `https://ahmed974x.github.io/giant-core/` once the scans pass.
- `gh-pages` history keeps each published version, so a bad publish can be reverted with one commit.
