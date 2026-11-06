-- Jarvis schema for the zero-setup mode (ADR-134): Node's built-in SQLite (node:sqlite).
-- Same tables, columns and named constraints as jarvis/replica/schema.sql (PostgreSQL), so the same
-- rules hold in both modes: a locked approval can never be approved, only a member decides, a
-- rejection needs a reason, one active run per agent, and the event log is append-only.
-- Ids are UUIDs made by the server; times are ISO 8601 UTC strings; json columns hold JSON text.
pragma foreign_keys = on;

create table if not exists workspaces (
  id text primary key,
  name text not null check (length(name) between 1 and 80),
  slug text not null unique check (length(slug) between 1 and 40 and slug not glob '*[^a-z0-9-]*'),
  created_at text not null,
  updated_at text not null
);

create table if not exists members (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  email text not null,
  role text not null check (role in ('owner', 'admin', 'operator', 'viewer')),
  created_at text not null,
  updated_at text not null,
  unique (workspace_id, email)
);
create index if not exists members_ws on members (workspace_id);

create table if not exists agents (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  role_prompt text not null default '',
  model text not null,
  tools text not null default '[]' check (json_valid(tools)),
  skills text not null default '[]' check (json_valid(skills)),
  limits text not null default '{"max_steps": 20}' check (json_valid(limits)),
  status text not null default 'idle' check (status in ('idle', 'running', 'paused', 'failed', 'archived')),
  created_at text not null,
  updated_at text not null,
  unique (workspace_id, name)
);
create index if not exists agents_ws_status on agents (workspace_id, status);

create table if not exists workflows (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  graph text not null default '{"nodes": [], "edges": []}' check (json_valid(graph)),
  version integer not null default 1 check (version > 0),
  created_at text not null,
  updated_at text not null
);
create index if not exists workflows_ws on workflows (workspace_id);

create table if not exists runs (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  agent_id text references agents(id) on delete set null,
  workflow_id text references workflows(id) on delete set null,
  trigger text not null default 'manual' check (trigger in ('manual', 'schedule', 'workflow')),
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  cost_micro_usd integer not null default 0 check (cost_micro_usd >= 0),
  input text not null default '{}' check (json_valid(input)),
  log text not null default '[]' check (json_valid(log)),
  started_at text,
  finished_at text,
  created_at text not null,
  updated_at text not null,
  constraint runs_has_target check (agent_id is not null or workflow_id is not null),
  constraint runs_times check (finished_at is null or started_at is null or finished_at >= started_at)
);
create index if not exists runs_ws_created on runs (workspace_id, created_at);
create index if not exists runs_agent on runs (agent_id);
create unique index if not exists runs_one_active_per_agent on runs (agent_id)
  where status in ('queued', 'running') and agent_id is not null;

create table if not exists steps (
  id text primary key,
  run_id text not null references runs(id) on delete cascade,
  idx integer not null check (idx >= 0),
  agent_id text references agents(id) on delete set null,
  tool text not null,
  input text not null default '{}' check (json_valid(input)),
  output text check (output is null or json_valid(output)),
  status text not null default 'queued' check (status in ('queued', 'running', 'ok', 'failed', 'skipped')),
  ms integer check (ms >= 0),
  tries integer not null default 0 check (tries between 0 and 10),
  created_at text not null,
  updated_at text not null,
  unique (run_id, idx)
);

create table if not exists approvals (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  run_id text references runs(id) on delete set null,
  step_id text references steps(id) on delete set null,
  category text not null check (category in ('sandbox', 'file_write', 'outbound', 'publish', 'permissions', 'install', 'money')),
  action text not null,
  payload text not null default '{}' check (json_valid(payload)),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired')),
  decided_by text references members(id) on delete set null,
  reason text,
  decided_at text,
  created_at text not null,
  updated_at text not null,
  constraint approvals_locked_never_approved
    check (not (status = 'approved' and category in ('money', 'publish', 'permissions', 'install', 'outbound'))),
  constraint approvals_decided_by_member
    check (status not in ('approved', 'rejected') or decided_by is not null),
  constraint approvals_reject_has_reason
    check (status <> 'rejected' or length(coalesce(reason, '')) > 0)
);
create index if not exists approvals_ws_status on approvals (workspace_id, status, created_at);
create index if not exists approvals_run on approvals (run_id);

create table if not exists events (
  id integer primary key autoincrement,
  workspace_id text not null references workspaces(id) on delete cascade,
  actor text not null,
  kind text not null,
  target text,
  data text not null default '{}' check (json_valid(data)),
  at text not null
);
create index if not exists events_ws_at on events (workspace_id, at);

create trigger if not exists events_no_update before update on events
  begin select raise(abort, 'jarvis.events is append-only'); end;
create trigger if not exists events_no_delete before delete on events
  begin select raise(abort, 'jarvis.events is append-only'); end;

create table if not exists sites (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  lang_default text not null default 'en' check (lang_default in ('en', 'ar')),
  theme text not null default '{}' check (json_valid(theme)),
  blocks text not null default '[]' check (json_valid(blocks)),
  created_at text not null,
  updated_at text not null
);

create table if not exists skills (
  name text primary key,
  description text not null,
  source text not null check (source in ('project', 'vendored', 'reviewed')),
  review_doc text,
  findings text not null default '{}' check (json_valid(findings)),
  scanned_at text not null
);

create table if not exists mixes (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  skills text not null check (json_valid(skills) and json_array_length(skills) between 1 and 20),
  created_at text not null,
  updated_at text not null
);


-- Long-horizon missions (ADR-135); same tables and named constraints as schema.sql.
create table if not exists missions (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  agent_id text references agents(id) on delete set null,
  title text not null check (length(title) between 1 and 120),
  goal text not null default '',
  template text not null,
  status text not null default 'draft' check (status in ('draft', 'running', 'awaiting_approval', 'succeeded', 'failed', 'paused')),
  capsule_every integer not null default 1 check (capsule_every between 1 and 10),
  planner text check (planner is null or json_valid(planner)),
  started_at text,
  finished_at text,
  created_at text not null,
  updated_at text not null
);
create index if not exists missions_ws on missions (workspace_id, created_at);

create table if not exists mission_steps (
  id text primary key,
  mission_id text not null references missions(id) on delete cascade,
  idx integer not null check (idx >= 0),
  phase integer not null check (phase >= 1),
  title text not null,
  kind text not null check (kind in ('tool', 'gate', 'approval')),
  tool text,
  category text check (category is null or category in ('file_write', 'outbound', 'publish', 'permissions', 'install', 'money')),
  input text not null default '{}' check (json_valid(input)),
  depends_on text not null default '[]' check (json_valid(depends_on)),
  criteria text not null default '[]' check (json_valid(criteria)),
  approval_id text references approvals(id) on delete set null,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'blocked', 'skipped')),
  gate_status text not null default 'none' check (gate_status in ('none', 'pass', 'fail')),
  output text check (output is null or json_valid(output)),
  ms integer check (ms >= 0),
  created_at text not null,
  updated_at text not null,
  unique (mission_id, idx),
  constraint mission_steps_gate_before_done check (status <> 'done' or kind <> 'gate' or gate_status = 'pass'),
  constraint mission_steps_locked_never_done
    check (not (status = 'done' and kind = 'approval' and category in ('money', 'publish', 'permissions', 'install', 'outbound')))
);
create index if not exists mission_steps_m on mission_steps (mission_id, phase, idx);

create table if not exists capsules (
  id text primary key,
  mission_id text not null references missions(id) on delete cascade,
  seq integer not null check (seq >= 1),
  label text not null,
  state text not null check (json_valid(state)),
  prev_hash text not null check (length(prev_hash) = 64),
  hash text not null check (length(hash) = 64),
  created_at text not null,
  unique (mission_id, seq)
);
create trigger if not exists capsules_no_update before update on capsules
  begin select raise(abort, 'jarvis.capsules is append-only'); end;
create trigger if not exists capsules_no_delete before delete on capsules
  begin select raise(abort, 'jarvis.capsules is append-only'); end;

create table if not exists gate_results (
  id text primary key,
  mission_id text not null references missions(id) on delete cascade,
  step_id text not null references mission_steps(id) on delete cascade,
  check_name text not null,
  status text not null check (status in ('pass', 'fail')),
  detail text not null default '',
  evidence text,
  created_at text not null
);
create index if not exists gate_results_m on gate_results (mission_id, step_id);


-- ADR-137; same tables and named constraints as schema.sql.
create unique index if not exists members_one_owner on members (workspace_id) where role = 'owner';

create table if not exists schedules (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  agent_id text not null references agents(id) on delete cascade,
  every_minutes integer not null check (every_minutes between 5 and 10080),
  enabled integer not null default 1 check (enabled in (0, 1)),
  next_at text not null,
  last_run_id text references runs(id) on delete set null,
  last_error text,
  created_at text not null,
  updated_at text not null,
  unique (agent_id)
);

create table if not exists webhooks (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  direction text not null check (direction in ('in', 'out')),
  url text,
  events text not null default '["mission.finished"]' check (json_valid(events)),
  status text not null default 'draft' check (status in ('draft', 'active', 'paused')),
  approval_id text references approvals(id) on delete set null,
  created_at text not null,
  updated_at text not null,
  constraint webhooks_out_has_url check (direction = 'in' or url is not null),
  constraint webhooks_external_out_locked
    check (direction = 'in' or status <> 'active' or (substr(url, 1, 17) = 'http://127.0.0.1:' and instr(substr(url, 18), '/') between 2 and 6 and substr(url, 18, instr(substr(url, 18), '/') - 1) not glob '*[^0-9]*'))
);

create table if not exists webhook_deliveries (
  id text primary key,
  webhook_id text not null references webhooks(id) on delete cascade,
  workspace_id text not null references workspaces(id) on delete cascade,
  direction text not null check (direction in ('in', 'out')),
  status text not null check (status in ('verified', 'rejected', 'sent', 'failed')),
  detail text not null default '',
  body_sha256 text check (body_sha256 is null or length(body_sha256) = 64),
  at text not null
);
create trigger if not exists webhook_deliveries_no_update before update on webhook_deliveries
  begin select raise(abort, 'jarvis.webhook_deliveries is append-only'); end;
create trigger if not exists webhook_deliveries_no_delete before delete on webhook_deliveries
  begin select raise(abort, 'jarvis.webhook_deliveries is append-only'); end;

create table if not exists billing_settings (
  workspace_id text primary key references workspaces(id) on delete cascade,
  creator_zero_token integer not null default 1 check (creator_zero_token in (0, 1)),
  billing_enabled integer not null default 0,
  updated_at text not null,
  constraint billing_settings_billing_locked check (billing_enabled = 0)
);

create table if not exists subscriber_tiers (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  name text not null check (length(name) between 1 and 40),
  monthly_tokens integer not null check (monthly_tokens >= 0),
  price_minor integer not null default 0 check (price_minor >= 0),
  currency text not null default 'USD' check (length(currency) = 3 and currency not glob '*[^A-Z]*'),
  status text not null default 'draft',
  created_at text not null,
  updated_at text not null,
  constraint subscriber_tiers_draft_only check (status = 'draft'),
  unique (workspace_id, name)
);

create table if not exists token_ledger (
  id integer primary key autoincrement,
  workspace_id text not null references workspaces(id) on delete cascade,
  actor text not null,
  engine text not null,
  model text,
  tokens integer not null check (tokens >= 0),
  cost_micro_usd integer not null default 0 check (cost_micro_usd >= 0),
  ref text,
  at text not null,
  constraint token_ledger_creator_free check (actor <> 'creator' or cost_micro_usd = 0)
);
create trigger if not exists token_ledger_no_update before update on token_ledger
  begin select raise(abort, 'jarvis.token_ledger is append-only'); end;
create trigger if not exists token_ledger_no_delete before delete on token_ledger
  begin select raise(abort, 'jarvis.token_ledger is append-only'); end;


-- ADR-138; same tables and named constraints as schema.sql.
create table if not exists agent_memory_episodes (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  kind text not null check (kind in ('plan', 'design', 'answer', 'lesson', 'note', 'search', 'skill')),
  title text not null check (length(title) between 1 and 160),
  body text not null check (length(body) between 1 and 8000),
  tags text not null default '[]' check (json_valid(tags)),
  outcome text not null default '{}' check (json_valid(outcome)),
  source text not null default 'person',
  created_at text not null
);
create index if not exists memory_ws on agent_memory_episodes (workspace_id, created_at);

create table if not exists forged_skills (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  name text not null check (length(name) between 3 and 41 and name not glob '*[^a-z0-9-]*' and substr(name, 1, 1) glob '[a-z]'),
  description text not null,
  kind text not null check (kind in ('checklist', 'python-tool', 'pasted')),
  files text not null check (json_valid(files)),
  scan text not null check (json_valid(scan)),
  status text not null default 'mounted' check (status in ('mounted', 'removed')),
  approval_id text references approvals(id) on delete set null,
  created_at text not null,
  updated_at text not null,
  constraint forged_skills_scan_clean check (status <> 'mounted' or (json_extract(scan, '$.critical') = 0 and json_extract(scan, '$.high') = 0))
);
create unique index if not exists forged_skills_one_mounted_name on forged_skills (workspace_id, name) where status = 'mounted';

-- ADR-141: the access mode is founder-only, and hosted model endpoints are drafts. Both are locks:
-- opening Jarvis to the public is a publish action and a hosted endpoint is an outbound one (AGENTS.md §1).
create table if not exists access_settings (
  id text primary key check (id = 'global'),
  mode text not null default 'founder_private',
  updated_at text not null,
  constraint access_settings_founder_private_locked check (mode = 'founder_private')
);

create table if not exists model_endpoints (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  url text not null check (url like 'https://%'),
  host text not null,
  status text not null default 'draft',
  approval_id text references approvals(id) on delete set null,
  created_at text not null,
  constraint model_endpoints_external_locked check (status = 'draft')
);
create index if not exists model_endpoints_ws on model_endpoints (workspace_id, created_at);

-- ADR-142: the live skill loader. A mounted skill is a row here (text only); nothing is written to disk and
-- nothing runs. A skill with a critical or high audit finding is never mounted.
create table if not exists runtime_skills (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  name text not null check (length(name) between 3 and 41 and name not glob '*[^a-z0-9-]*' and substr(name, 1, 1) glob '[a-z]'),
  description text not null,
  origin text not null check (origin in ('github', 'synthesized', 'derived', 'captured')),
  source_url text check (source_url is null or source_url like 'https://github.com/%'),
  licence text,
  version integer not null default 1 check (version >= 1),
  parent_id text,
  files text not null,
  scan text not null,
  status text not null default 'mounted' check (status in ('mounted', 'removed')),
  approval_id text references approvals(id) on delete set null,
  created_at text not null,
  updated_at text not null,
  constraint runtime_skills_scan_clean check (status <> 'mounted' or (json_extract(scan, '$.critical') = 0 and json_extract(scan, '$.high') = 0))
);
create unique index if not exists runtime_skills_one_mounted_name on runtime_skills (workspace_id, name) where status = 'mounted';

create table if not exists skill_evolution_log (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  skill_id text,
  evolution_type text not null check (evolution_type in ('FIX', 'DERIVED', 'CAPTURED')),
  parent_id text,
  note text not null default '',
  scan text not null,
  created_at text not null
);
create index if not exists skill_evolution_log_ws on skill_evolution_log (workspace_id, created_at);
create trigger if not exists skill_evolution_log_no_update before update on skill_evolution_log
  begin select raise(abort, 'jarvis.skill_evolution_log is append-only'); end;
