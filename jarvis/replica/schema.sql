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
