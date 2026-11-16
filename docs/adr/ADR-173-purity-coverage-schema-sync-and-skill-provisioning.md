# ADR-173: The purity gate reads every screen it opens, an existing database catches up with the schema, and each skill's provisioning

Date: 2026-11-16 · Status: Proposed. PR #59 left three findings, and Ahmad's message of 2026-11-16 asked for each to be closed, with a provisioning report for the skills:

- two lock lines stayed in English in Arabic mode, and the bilingual purity gate (ADR-151) did not report them;

- an existing PostgreSQL database did not get the `architect_campaigns` table without running `schema.sql` by hand;

- the mutation run stopped once because the search corpus was taken before the security review's hashes were written.

## Why the gate missed the lines

The rule did catch them. Put back on the screen, `· Moving the probe to a new host` in Arabic mode is reported as English words.

The gap was coverage. The gate reads the screen a step ends on. ADR-172's "bundle export" step opened `#/release`, then `#/architect`, then `#/impact`, so only `#/impact` was read. The "campaign" step did the same.

Two smaller gaps sat in the rule:

- one English word after a list mark (`· Publishing`) passed, because a piece needed a space to count as prose;

- one English word in the same text as Arabic (`قيد الموافقة · Publishing`) passed for the same reason.

## Decision

1. **Purity gate** (`jarvis/scripts/bilingual-purity.mjs`):

   - each extra step names the screen it ends on (`[name, open, "#/route"]`); a step that ends anywhere else is a violation, so no screen goes unchecked;

   - the two steps of ADR-172 are split into one step per screen (release export, architect export, impact hybrid, architect campaign, impact offload), and all 31 steps in `test-app.mjs` and 27 in `test-live.mjs` name their screen;

   - in Arabic, a line that starts with `·`, `•`, `-`, `–` or `—` breaks the rule with even one English word after it, and so does an English word in the same text as Arabic; names and identifiers kept by the existing list still pass;

   - `test-app.mjs` F54 puts such lines on the page and checks that each is caught and that `· replica-release-gate` is not, and runs a step that ends on another screen and checks that it is reported.

2. **The schema at start** (`jarvis/server/lib/schema-sync.mjs`, `db.mjs`):

   - a fresh PostgreSQL database still gets `schema.sql` whole;

   - an existing one gets each statement made safe to run again, in one transaction: tables and indexes with `if not exists`, functions and triggers with `or replace`;

   - the file is split with quotes, comments and `$$` bodies kept whole (82 statements);

   - the 22 indexes the schema leaves unnamed get the name PostgreSQL gives them (`table_columns_idx`), so a second start finds them instead of adding copies;

   - nothing is dropped or rewritten: rows stay, and a table that exists keeps its columns and constraints as they are;

   - SQLite already used `if not exists` everywhere, and a test now proves it on an existing file.

3. **Skill provisioning** (`skillProvisionReport` in release readiness and its twin; the architect studio's mode `provision`):

   - for each skill, the chosen ones or all 64 in the snapshot: `SKILL.md`, `tests/`, `tests/golden.json` (the twin gives the server's answers), a page route, and a SkillSpector scan with no critical or high finding;

   - each skill is `provisioned` or `incomplete` with the missing file or field named; a name not in the snapshot is missing its `SKILL.md`;

   - the release and architect exports carry the report for their skills, and the architect's `provision` exports it for all, as key-sorted JSON and Markdown with their SHA-256;

   - nothing is installed or run; installing or changing a skill stays a locked step;

   - `#/architect` shows the table, the locked line and the export.

4. **Order of work.** The code, this record and the review's hashes come first. The search corpus and the knowledge page are generated after that, and the full mutation run starts last.

## Not done

- **Columns or constraints added later to a table that already exists.** Catching up adds what is missing. It does not alter a table, which would need a reviewed migration.

- **Running or installing anything from the provisioning report.** It reads files only.

- **The proposal's `schema-bootstrapper.mjs`.** It split the schema on every `;`, which breaks the `$$` function bodies, and it hid errors. Its `better-sqlite3` test added a dependency the server does not use (it runs on `node:sqlite`).

## Consequences

- A new purity step must name its screen.

- A new table in `schema.sql` reaches existing PostgreSQL databases at the next start.

- The mutation run covers `skillProvision`, `skillProvisionReport` and `provisionPlan`, and their Python twins.
