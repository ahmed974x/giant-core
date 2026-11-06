-- Jarvis schema (ADR-133, ADR-134), PostgreSQL 15+. Used by jarvis/server in Postgres mode
-- (JARVIS_DB=postgres); jarvis/server/lib/schema-sqlite.sql is the same model for the zero-setup mode.
-- The repo's local Postgres listens on 127.0.0.1. Times are timestamptz in UTC. Access: one data-layer
-- authorisation check per query in jarvis/server (single local owner); row level security
-- policies are added when a second user exists.

-- gen_random_uuid() is built into PostgreSQL 13+, so no extension is needed.
create schema if not exists jarvis;
set search_path = jarvis, public;

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9-]{1,40}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  email text not null,
  role text not null check (role in ('owner', 'admin', 'operator', 'viewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, email)
);
create index on members (workspace_id);

create table agents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  role_prompt text not null default '',
  model text not null,
  tools jsonb not null default '[]',
  skills jsonb not null default '[]',               -- names of linked .claude/skills
  limits jsonb not null default '{"max_steps": 20}',  -- never secrets: keys live in the vault
  status text not null default 'idle'
    check (status in ('idle', 'running', 'paused', 'failed', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);
create index on agents (workspace_id, status);

create table workflows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  graph jsonb not null default '{"nodes": [], "edges": []}',
  version int not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on workflows (workspace_id);

create table runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  agent_id uuid references agents(id) on delete set null,
  workflow_id uuid references workflows(id) on delete set null,
  trigger text not null default 'manual' check (trigger in ('manual', 'schedule', 'workflow')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  cost_micro_usd bigint not null default 0 check (cost_micro_usd >= 0),  -- model cost estimate, not a payment
  input jsonb not null default '{}',
  log jsonb not null default '[]',
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint runs_has_target check (agent_id is not null or workflow_id is not null),
  constraint runs_times check (finished_at is null or started_at is null or finished_at >= started_at)
);
create index on runs (workspace_id, created_at desc);
create index on runs (agent_id);
create index on runs (workflow_id);
-- Starting the same agent twice at once is a database error, not a UI hope.
create unique index runs_one_active_per_agent on runs (agent_id)
  where status in ('queued', 'running') and agent_id is not null;

create table steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs(id) on delete cascade,
  idx int not null check (idx >= 0),
  agent_id uuid references agents(id) on delete set null,
  tool text not null,
  input jsonb not null default '{}',
  output jsonb,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'ok', 'failed', 'skipped')),
  ms int check (ms >= 0),
  tries int not null default 0 check (tries between 0 and 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, idx)
);

create table approvals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  run_id uuid references runs(id) on delete set null,
  step_id uuid references steps(id) on delete set null,
  category text not null check (category in
    ('sandbox', 'file_write', 'outbound', 'publish', 'permissions', 'install', 'money')),
  action text not null,
  payload jsonb not null default '{}',
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'expired')),
  decided_by uuid references members(id) on delete set null,  -- a person; agents have no member row
  reason text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- AGENTS.md §1: money, publishing, permission changes, installs and outbound messages are
  -- Ahmad's decisions outside Jarvis. Only a migration made after his written approval may relax this.
  constraint approvals_locked_never_approved
    check (not (status = 'approved' and category in ('money', 'publish', 'permissions', 'install', 'outbound'))),
  constraint approvals_decided_by_member
    check (status not in ('approved', 'rejected') or decided_by is not null),
  constraint approvals_reject_has_reason
    check (status <> 'rejected' or length(coalesce(reason, '')) > 0)
);
create index on approvals (workspace_id, status, created_at desc);
create index on approvals (run_id);

create table events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  actor text not null,            -- 'member:<id>' or 'agent:<id>'
  kind text not null,
  target text,
  data jsonb not null default '{}',
  at timestamptz not null default now()
);
create index on events (workspace_id, at desc);
create index on events (workspace_id, kind);

-- The audit log is append-only.
create function events_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'jarvis.events is append-only';
end $$;
create trigger events_no_update before update or delete on events
  for each row execute function events_append_only();

create table sites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  lang_default text not null default 'en' check (lang_default in ('en', 'ar')),
  theme jsonb not null default '{}',
  blocks jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on sites (workspace_id, updated_at desc);

create table skills (
  name text primary key check (name ~ '^[a-z0-9:-]{1,64}$'),
  description text not null,
  source text not null check (source in ('project', 'vendored', 'reviewed')),
  review_doc text,
  findings jsonb not null default '{"critical": 0, "high": 0, "medium": 0, "low": 0}',
  scanned_at timestamptz not null
);

create table mixes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  skills text[] not null check (cardinality(skills) between 1 and 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on mixes (workspace_id);


-- Long-horizon missions (ADR-135): ordered phases of steps with dependencies, evidence gates,
-- approval steps, and SHA-256 chained state capsules. The rules live here, like the approvals ones.
create table missions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  agent_id uuid references agents(id) on delete set null,
  title text not null check (length(title) between 1 and 120),
  goal text not null default '',
  template text not null,
  status text not null default 'draft'
    check (status in ('draft', 'running', 'awaiting_approval', 'succeeded', 'failed', 'paused')),
  capsule_every int not null default 1 check (capsule_every between 1 and 10),
  planner jsonb,                                    -- ADR-136: who planned it (engine, model, thinking); untrusted text
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on missions (workspace_id, created_at desc);

create table mission_steps (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references missions(id) on delete cascade,
  idx int not null check (idx >= 0),
  phase int not null check (phase >= 1),
  title text not null,
  kind text not null check (kind in ('tool', 'gate', 'approval')),
  tool text,
  category text check (category is null or category in ('file_write', 'outbound', 'publish', 'permissions', 'install', 'money')),
  input jsonb not null default '{}',
  depends_on jsonb not null default '[]',
  criteria jsonb not null default '[]',
  approval_id uuid references approvals(id) on delete set null,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'blocked', 'skipped')),
  gate_status text not null default 'none' check (gate_status in ('none', 'pass', 'fail')),
  output jsonb,
  ms int check (ms >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mission_id, idx),
  -- A gate step is done only when its gate passed.
  constraint mission_steps_gate_before_done check (status <> 'done' or kind <> 'gate' or gate_status = 'pass'),
  -- A step that needs money, publishing, permissions, an install or an outbound message is never done here (AGENTS.md §1).
  constraint mission_steps_locked_never_done
    check (not (status = 'done' and kind = 'approval' and category in ('money', 'publish', 'permissions', 'install', 'outbound')))
);
create index on mission_steps (mission_id, phase, idx);

create table capsules (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references missions(id) on delete cascade,
  seq int not null check (seq >= 1),
  label text not null,
  state jsonb not null,
  prev_hash text not null check (length(prev_hash) = 64),
  hash text not null check (length(hash) = 64),
  created_at timestamptz not null default now(),
  unique (mission_id, seq)
);
create function capsules_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'jarvis.capsules is append-only';
end $$;
create trigger capsules_no_update before update or delete on capsules
  for each row execute function capsules_append_only();

create table gate_results (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references missions(id) on delete cascade,
  step_id uuid not null references mission_steps(id) on delete cascade,
  check_name text not null,
  status text not null check (status in ('pass', 'fail')),
  detail text not null default '',
  evidence text,
  created_at timestamptz not null default now()
);
create index on gate_results (mission_id, step_id);


-- ADR-137: one owner per workspace, scheduled runs, webhooks with deliveries, creator mode and the
-- future subscriber plans. Money stays a person's decision outside Jarvis (AGENTS.md §1): billing can
-- never be switched on here, a plan can never be activated here, and the creator's usage costs 0.
create unique index members_one_owner on members (workspace_id) where role = 'owner';

create table schedules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  every_minutes int not null check (every_minutes between 5 and 10080),
  enabled boolean not null default true,
  next_at timestamptz not null,
  last_run_id uuid references runs(id) on delete set null,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agent_id)
);
create index on schedules (enabled, next_at);

create table webhooks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  direction text not null check (direction in ('in', 'out')),
  url text,
  events jsonb not null default '["mission.finished"]',
  status text not null default 'draft' check (status in ('draft', 'active', 'paused')),
  approval_id uuid references approvals(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint webhooks_out_has_url check (direction = 'in' or url is not null),
  -- An outgoing webhook may be active only towards this computer; anything else is an outbound message.
  constraint webhooks_external_out_locked
    check (direction = 'in' or status <> 'active' or url ~ '^http://127\.0\.0\.1:[0-9]{1,5}/')
);
create index on webhooks (workspace_id);

create table webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  webhook_id uuid not null references webhooks(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  direction text not null check (direction in ('in', 'out')),
  status text not null check (status in ('verified', 'rejected', 'sent', 'failed')),
  detail text not null default '',
  body_sha256 text check (body_sha256 is null or length(body_sha256) = 64),
  at timestamptz not null default now()
);
create index on webhook_deliveries (webhook_id, at desc);
create function webhook_deliveries_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'jarvis.webhook_deliveries is append-only';
end $$;
create trigger webhook_deliveries_no_update before update or delete on webhook_deliveries
  for each row execute function webhook_deliveries_append_only();

create table billing_settings (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  creator_zero_token boolean not null default true,
  billing_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint billing_settings_billing_locked check (billing_enabled = false)
);

create table subscriber_tiers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null check (length(name) between 1 and 40),
  monthly_tokens bigint not null check (monthly_tokens >= 0),
  price_minor bigint not null default 0 check (price_minor >= 0),  -- a draft number, never charged here
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriber_tiers_draft_only check (status = 'draft'),
  unique (workspace_id, name)
);

create table token_ledger (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  actor text not null,               -- 'creator' or, later, 'subscriber:<id>'
  engine text not null,              -- 'ollama-local-loopback', 'deterministic-rules', 'fixed-rule-run'
  model text,
  tokens bigint not null check (tokens >= 0),
  cost_micro_usd bigint not null default 0 check (cost_micro_usd >= 0),
  ref text,
  at timestamptz not null default now(),
  constraint token_ledger_creator_free check (actor <> 'creator' or cost_micro_usd = 0)
);
create index on token_ledger (workspace_id, at desc);
create function token_ledger_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'jarvis.token_ledger is append-only';
end $$;
create trigger token_ledger_no_update before update or delete on token_ledger
  for each row execute function token_ledger_append_only();


-- ADR-138: the memory bank (BM25-ranked episodes the local model sees as examples) and the Skill
-- Forge registry. A forged skill is mounted in the workspace only; writing it into .claude/skills is
-- a locked install approval.
create table agent_memory_episodes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  kind text not null check (kind in ('plan', 'design', 'answer', 'lesson', 'note', 'search', 'skill')),
  title text not null check (length(title) between 1 and 160),
  body text not null check (length(body) between 1 and 8000),
  tags jsonb not null default '[]',
  outcome jsonb not null default '{}',
  source text not null default 'person',
  created_at timestamptz not null default now()
);
create index on agent_memory_episodes (workspace_id, created_at desc);

create table forged_skills (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null check (name ~ '^[a-z][a-z0-9-]{2,40}$'),
  description text not null,
  kind text not null check (kind in ('checklist', 'python-tool', 'pasted')),
  files jsonb not null,
  scan jsonb not null,
  status text not null default 'mounted' check (status in ('mounted', 'removed')),
  approval_id uuid references approvals(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A skill with a critical or high SkillSpector finding is never mounted.
  constraint forged_skills_scan_clean check (status <> 'mounted' or ((scan->>'critical')::int = 0 and (scan->>'high')::int = 0))
);
create unique index forged_skills_one_mounted_name on forged_skills (workspace_id, name) where status = 'mounted';

-- ADR-141: the access mode is founder-only, and hosted model endpoints are drafts. Both are locks:
-- opening Jarvis to the public is a publish action and a hosted endpoint is an outbound one (AGENTS.md §1).
create table access_settings (
  id text primary key check (id = 'global'),
  mode text not null default 'founder_private',
  updated_at timestamptz not null default now(),
  constraint access_settings_founder_private_locked check (mode = 'founder_private')
);

create table model_endpoints (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  url text not null check (url like 'https://%'),
  host text not null,
  status text not null default 'draft',
  approval_id uuid references approvals(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint model_endpoints_external_locked check (status = 'draft')
);
create index on model_endpoints (workspace_id, created_at);

-- ADR-142: the live skill loader. A mounted skill is a row here (text only); nothing is written to disk and
-- nothing runs. A skill with a critical or high audit finding is never mounted.
create table runtime_skills (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null check (name ~ '^[a-z][a-z0-9-]{2,40}$'),
  description text not null,
  origin text not null check (origin in ('github', 'synthesized', 'derived', 'captured')),
  source_url text check (source_url is null or source_url like 'https://github.com/%'),
  licence text,
  version integer not null default 1 check (version >= 1),
  parent_id uuid,
  files jsonb not null,
  scan jsonb not null,
  status text not null default 'mounted' check (status in ('mounted', 'removed')),
  approval_id uuid references approvals(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint runtime_skills_scan_clean check (status <> 'mounted' or ((scan->>'critical')::int = 0 and (scan->>'high')::int = 0))
);
create unique index runtime_skills_one_mounted_name on runtime_skills (workspace_id, name) where status = 'mounted';

create table skill_evolution_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  skill_id uuid,
  evolution_type text not null check (evolution_type in ('FIX', 'DERIVED', 'CAPTURED')),
  parent_id uuid,
  note text not null default '',
  scan jsonb not null,
  created_at timestamptz not null default now()
);
create index on skill_evolution_log (workspace_id, created_at);
create function skill_evolution_log_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'jarvis.skill_evolution_log is append-only';
end $$;
create trigger skill_evolution_log_no_update before update on skill_evolution_log
  for each row execute function skill_evolution_log_append_only();

-- ADR-144: the Studio time machine. Each saved state is a row whose hash chains to the previous one.
create table studio_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  seq integer not null check (seq >= 1),
  label text not null check (length(label) between 1 and 80),
  site jsonb not null,
  hash text not null check (length(hash) = 64),
  prev_hash text not null check (length(prev_hash) = 64),
  parent_id uuid,
  created_at timestamptz not null default now(),
  unique (workspace_id, seq)
);
create function studio_snapshots_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'jarvis.studio_snapshots is append-only';
end $$;
create trigger studio_snapshots_no_update before update on studio_snapshots
  for each row execute function studio_snapshots_append_only();
