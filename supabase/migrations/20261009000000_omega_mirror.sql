-- OMEGA cloud mirror on Supabase.
-- The laptop stays the source of truth; cloud-sync copies the public market signals here so they can
-- be read from anywhere (phone, another machine) and streamed with Supabase Realtime.
-- Only the secret/service key (used by cloud-sync) can write. Signed-in users can read.
-- Nothing private goes here: no prompts, no API keys, no wallet ownership beyond public chain data.

-- Tables live in "public" with an omega_ prefix, so the Data API serves them with no extra settings.

create table if not exists public.omega_anomalies (
  id          bigint primary key,
  ts          timestamptz not null,
  symbol      text not null,
  kind        text not null check (kind in ('price_shock', 'volume_spike', 'drawdown_1h')),
  severity    text not null check (severity in ('watch', 'high')),
  price       double precision not null,
  zscore      double precision,
  reason      text not null,
  synced_at   timestamptz not null default now()
);
create index if not exists omega_anomalies_ts_idx on public.omega_anomalies (ts desc);

create table if not exists public.omega_whales (
  id          bigint primary key,
  ts          timestamptz not null,
  chain       text not null check (chain in ('btc', 'eth')),
  asset       text not null,
  amount      double precision not null,
  usd_value   double precision not null,
  from_entity text,
  to_entity   text,
  verdict     text not null,
  severity    text not null check (severity in ('watch', 'high')),
  tx_hash     text not null,
  synced_at   timestamptz not null default now()
);
create index if not exists omega_whales_ts_idx on public.omega_whales (ts desc);

create table if not exists public.omega_news (
  id           bigint primary key,
  published_at timestamptz not null,
  source       text not null,
  title        text not null,
  url          text not null,
  symbols      text[] not null default '{}',
  sentiment    double precision,
  impact       text,
  label        text,
  synced_at    timestamptz not null default now()
);
create index if not exists omega_news_published_idx on public.omega_news (published_at desc);

-- One row per minute per engine: the quant risk snapshot and the neural forecast, as JSON.
create table if not exists public.omega_snapshots (
  engine      text not null check (engine in ('quant', 'neural')),
  at          timestamptz not null,
  source      text not null,
  body        jsonb not null,
  primary key (engine, at)
);
create index if not exists omega_snapshots_latest_idx on public.omega_snapshots (engine, at desc);

-- Row Level Security: read for signed-in users, no client writes at all (the secret key bypasses RLS).
alter table public.omega_anomalies enable row level security;
alter table public.omega_whales    enable row level security;
alter table public.omega_news      enable row level security;
alter table public.omega_snapshots enable row level security;

create policy "signed-in users read anomalies" on public.omega_anomalies for select to authenticated using (true);
create policy "signed-in users read whales"    on public.omega_whales    for select to authenticated using (true);
create policy "signed-in users read news"      on public.omega_news      for select to authenticated using (true);
create policy "signed-in users read snapshots" on public.omega_snapshots for select to authenticated using (true);

grant select on public.omega_anomalies, public.omega_whales, public.omega_news, public.omega_snapshots to authenticated;
revoke all on public.omega_anomalies, public.omega_whales, public.omega_news, public.omega_snapshots from anon;

-- Keep the free tier small: snapshots older than 14 days are dropped by cloud-sync's prune call.
create or replace function public.omega_prune(keep interval default interval '14 days')
returns bigint language sql security definer set search_path = '' as $$
  with d as (delete from public.omega_snapshots where at < now() - keep returning 1) select count(*) from d;
$$;
revoke all on function public.omega_prune(interval) from public, anon, authenticated;
grant execute on function public.omega_prune(interval) to service_role;

-- Live push to subscribed clients.
alter publication supabase_realtime add table public.omega_anomalies, public.omega_whales;
