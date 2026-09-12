-- 联盟每日建设任务与建筑数据结构
-- 任务由服务器/云函数生成；客户端只读取任务并提交，不直接修改建设点余额。

create table if not exists public.alliance_daily_tasks (
  id bigint generated always as identity primary key,
  player_id varchar(100) not null,
  server_date date not null,
  slot smallint not null check (slot between 1 and 10),
  category varchar(32) not null,
  skill varchar(64) not null,
  material_id varchar(120) not null,
  material_name varchar(120) not null,
  required_amount numeric(18,3) not null check (required_amount > 0),
  submitted_amount numeric(18,3) not null default 0 check (submitted_amount >= 0 and submitted_amount <= required_amount),
  difficulty char(1) not null check (difficulty in ('S','A','B','C','D')),
  reward_points integer not null check (reward_points > 0),
  material_value numeric(6,2) not null default 0,
  standard_time_sec numeric(12,2) not null default 0,
  status varchar(16) not null default 'open' check (status in ('open','completed','expired')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (player_id, server_date, slot)
);

create index if not exists alliance_daily_tasks_player_day
  on public.alliance_daily_tasks (player_id, server_date);

-- 任务大厅升级后每日任务可扩展到 6～10 条；兼容早期已建表的旧约束。
alter table public.alliance_daily_tasks drop constraint if exists alliance_daily_tasks_slot_check;
alter table public.alliance_daily_tasks add constraint alliance_daily_tasks_slot_check check (slot between 1 and 10);

-- 兼容已经执行过旧版脚本的环境：补充任务对应技能字段。
alter table public.alliance_daily_tasks
  add column if not exists skill varchar(64);

create table if not exists public.alliance_task_submissions (
  id bigint generated always as identity primary key,
  task_id bigint not null references public.alliance_daily_tasks(id),
  alliance_id bigint not null references public.alliances(id),
  player_id varchar(100) not null,
  amount numeric(18,3) not null check (amount > 0),
  points integer not null check (points > 0),
  server_date date not null,
  created_at timestamptz not null default now(),
  unique (task_id, player_id)
);

create table if not exists public.alliance_construction (
  alliance_id bigint primary key references public.alliances(id) on delete cascade,
  points_balance integer not null default 0 check (points_balance >= 0),
  total_points_earned bigint not null default 0 check (total_points_earned >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.alliance_contribution_log (
  id bigint generated always as identity primary key,
  alliance_id bigint not null references public.alliances(id) on delete cascade,
  player_id varchar(100) not null,
  task_id bigint references public.alliance_daily_tasks(id),
  points integer not null check (points > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.alliance_buildings (
  alliance_id bigint not null references public.alliances(id) on delete cascade,
  building_type varchar(40) not null,
  level integer not null default 0 check (level >= 0),
  points_spent bigint not null default 0 check (points_spent >= 0),
  updated_at timestamptz not null default now(),
  primary key (alliance_id, building_type)
);

-- 服务器端提交接口应使用事务完成：写 submission、更新 task、增加 construction、写 log。
-- 不在这里给 anon 开放 construction/submission 的写权限，避免客户端伪造建设点。
alter table public.alliance_daily_tasks enable row level security;
alter table public.alliance_task_submissions enable row level security;
alter table public.alliance_construction enable row level security;
alter table public.alliance_contribution_log enable row level security;
alter table public.alliance_buildings enable row level security;

grant select on public.alliance_daily_tasks, public.alliance_construction, public.alliance_buildings to anon, authenticated;

-- 联盟大厅需要展示建设点和建筑等级；任务提交仍只走云函数。
drop policy if exists alliance_construction_read on public.alliance_construction;
create policy alliance_construction_read on public.alliance_construction
  for select to anon, authenticated using (true);
drop policy if exists alliance_buildings_read on public.alliance_buildings;
create policy alliance_buildings_read on public.alliance_buildings
  for select to anon, authenticated using (true);

-- 原子完成任务：校验当日任务、联盟成员资格和重复提交，然后一次性写入
-- submission / task / construction / contribution_log。云函数只调用此函数，
-- 不要从网页直接写建设点余额。
create or replace function public.submit_alliance_task(
  p_task_id bigint,
  p_alliance_id bigint,
  p_player_id varchar(100),
  p_amount numeric(18,3)
)
returns table (task_id bigint, points_earned integer, points_balance integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  task_row public.alliance_daily_tasks%rowtype;
  balance integer;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception '提交数量必须大于 0';
  end if;

  select * into task_row
    from public.alliance_daily_tasks
   where id = p_task_id
   for update;
  if not found then raise exception '任务不存在'; end if;
  if task_row.server_date <> (now() at time zone 'Asia/Shanghai')::date then
    raise exception '任务已过期';
  end if;
  if task_row.status <> 'open' then raise exception '任务已完成或不可提交'; end if;
  if task_row.player_id <> p_player_id then raise exception '任务不属于当前玩家'; end if;
  if not exists (
    select 1 from public.alliance_members m
     where m.alliance_id = p_alliance_id and m.player_id = p_player_id
  ) then raise exception '玩家不是该联盟成员'; end if;
  if p_amount < task_row.required_amount - task_row.submitted_amount then
    raise exception '提交数量不足';
  end if;

  insert into public.alliance_task_submissions(task_id, alliance_id, player_id, amount, points, server_date)
  values (task_row.id, p_alliance_id, p_player_id, task_row.required_amount - task_row.submitted_amount,
          task_row.reward_points, task_row.server_date);

  update public.alliance_daily_tasks
     set submitted_amount = required_amount,
         status = 'completed', completed_at = now()
   where id = task_row.id;

  insert into public.alliance_construction(alliance_id, points_balance, total_points_earned)
  values (p_alliance_id, task_row.reward_points, task_row.reward_points)
  on conflict (alliance_id) do update
    set points_balance = public.alliance_construction.points_balance + excluded.points_balance,
        total_points_earned = public.alliance_construction.total_points_earned + excluded.total_points_earned,
        updated_at = now();

  insert into public.alliance_contribution_log(alliance_id, player_id, task_id, points)
  values (p_alliance_id, p_player_id, task_row.id, task_row.reward_points);

  select c.points_balance into balance from public.alliance_construction c
   where c.alliance_id = p_alliance_id;
  return query select task_row.id, task_row.reward_points, balance;
exception
  when unique_violation then
    raise exception '任务已经提交过';
end;
$$;

revoke all on function public.submit_alliance_task(bigint, bigint, varchar, numeric) from public;

-- 最小建筑系统：联盟后勤中继站。创建人才能升级，费用从联盟建设点余额扣除。
-- 当前建筑只保存等级，后续可把建筑效果接到联盟空间站加成；费用集中在此处便于平衡调整。
create or replace function public.upgrade_alliance_building(
  p_alliance_id bigint,
  p_player_id varchar(100),
  p_building_type varchar(40)
)
returns table (building_type varchar(40), level integer, cost integer, points_balance integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_level integer;
  next_cost integer;
  balance integer;
begin
  if p_building_type <> 'logistics_hub' then raise exception '未知联盟建筑'; end if;
  if not exists (
    select 1 from public.alliances a
     where a.id = p_alliance_id and a.owner_player_id = p_player_id
  ) then raise exception '只有联盟创建人可以升级建筑'; end if;

  insert into public.alliance_construction(alliance_id)
  values (p_alliance_id)
  on conflict (alliance_id) do nothing;
  select coalesce(b.level, 0) into current_level
    from public.alliance_buildings b
   where b.alliance_id = p_alliance_id and b.building_type = p_building_type;
  current_level := coalesce(current_level, 0);
  if current_level >= 5 then raise exception '建筑已达到最高等级'; end if;
  next_cost := case current_level when 0 then 100 when 1 then 250 when 2 then 500 when 3 then 1000 else 2000 end;

  select c.points_balance into balance from public.alliance_construction c
   where c.alliance_id = p_alliance_id for update;
  if balance < next_cost then raise exception '联盟建设点不足'; end if;
  update public.alliance_construction
     set points_balance = points_balance - next_cost, updated_at = now()
   where alliance_id = p_alliance_id;
  insert into public.alliance_buildings(alliance_id, building_type, level, points_spent)
  values (p_alliance_id, p_building_type, current_level + 1, next_cost)
  on conflict (alliance_id, building_type) do update
    set level = excluded.level,
        points_spent = public.alliance_buildings.points_spent + excluded.points_spent,
        updated_at = now();
  select c.points_balance into balance from public.alliance_construction c where c.alliance_id = p_alliance_id;
  return query select p_building_type, current_level + 1, next_cost, balance;
end;
$$;

revoke all on function public.upgrade_alliance_building(bigint, varchar, varchar) from public;
