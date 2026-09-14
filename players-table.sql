-- 联盟显示名。player_id 仍是内部身份，username 只用于展示。
create table if not exists public.players (
  player_id varchar(100) primary key,
  username varchar(12) not null,
  created_at timestamptz not null default now(),
  last_online_at timestamptz
);

alter table public.players enable row level security;

grant usage on schema public to anon, authenticated;
grant select, insert, update on table public.players to anon, authenticated;

drop policy if exists players_read on public.players;
create policy players_read on public.players
  for select to anon, authenticated using (true);

drop policy if exists players_write on public.players;
create policy players_write on public.players
  for insert to anon, authenticated with check (char_length(player_id) between 1 and 100 and username ~ '^[一-龥A-Za-z0-9_]{2,12}$');

drop policy if exists players_update on public.players;
create policy players_update on public.players
  for update to anon, authenticated
  using (true)
  with check (char_length(player_id) between 1 and 100 and username ~ '^[一-龥A-Za-z0-9_]{2,12}$');

-- 每个用户名唯一，避免联盟列表出现重名。
create unique index if not exists players_username_unique on public.players (username);
