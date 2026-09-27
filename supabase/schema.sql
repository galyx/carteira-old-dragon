-- Carteira do Dragão — schema da mesa online (plano free / teste)
-- Cole este arquivo no SQL Editor do Supabase e execute.

create table if not exists mesas (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  master_key text not null,
  story jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists mesa_codigos (
  code text primary key,
  mesa_id uuid not null references mesas(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists mesa_codigos_mesa_id_idx on mesa_codigos(mesa_id);

create table if not exists mesa_membros (
  id uuid primary key default gen_random_uuid(),
  mesa_id uuid not null references mesas(id) on delete cascade,
  character_id text not null,
  character_name text not null,
  transactions jsonb not null default '[]'::jsonb,
  joined_at timestamptz not null default now(),
  unique (mesa_id, character_id)
);

create index if not exists mesa_membros_mesa_id_idx on mesa_membros(mesa_id);

create table if not exists mesa_mensagens (
  id uuid primary key default gen_random_uuid(),
  mesa_id uuid not null references mesas(id) on delete cascade,
  kind text not null,
  payload jsonb not null,
  target_character_id text,
  created_at timestamptz not null default now(),
  consumed boolean not null default false
);

create index if not exists mesa_mensagens_mesa_pending_idx
  on mesa_mensagens(mesa_id, consumed, created_at);

alter table mesas enable row level security;
alter table mesa_codigos enable row level security;
alter table mesa_membros enable row level security;
alter table mesa_mensagens enable row level security;

drop policy if exists "mesas_anon_all" on mesas;
create policy "mesas_anon_all" on mesas for all using (true) with check (true);

drop policy if exists "codigos_anon_all" on mesa_codigos;
create policy "codigos_anon_all" on mesa_codigos for all using (true) with check (true);

drop policy if exists "membros_anon_all" on mesa_membros;
create policy "membros_anon_all" on mesa_membros for all using (true) with check (true);

drop policy if exists "mensagens_anon_all" on mesa_mensagens;
create policy "mensagens_anon_all" on mesa_mensagens for all using (true) with check (true);

-- Realtime (ignore erro se já estiver na publication)
do $$
begin
  alter publication supabase_realtime add table mesas;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table mesa_membros;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table mesa_mensagens;
exception when duplicate_object then null;
end $$;
