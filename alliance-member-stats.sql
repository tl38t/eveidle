-- 联盟成员统计：当日贡献 / 总贡献 / 最后上线时间
-- 幂等迁移脚本，可重复执行。配合原生前端与云端 relay 页共用 get_alliance_member_stats RPC。
-- 日期基准与每日建设任务一致：Asia/Shanghai 服务器日期。

-- 1) alliance_contribution_log 增加 server_date 列（用于「当日贡献」聚合）
alter table public.alliance_contribution_log
  add column if not exists server_date date;

-- 历史数据回填：没有 server_date 的旧记录按创建日期补齐（仅影响当日聚合，缺失则当日贡献记 0）
update public.alliance_contribution_log
   set server_date = created_at::date
 where server_date is null;

create index if not exists alliance_contribution_log_alliance_day
  on public.alliance_contribution_log (alliance_id, server_date);

-- players 表增加最后上线时间。注意：生产环境 players 表已存在，
-- 「create table if not exists」不会补列，必须用 ALTER 幂等补齐（重复执行安全）。
alter table public.players
  add column if not exists last_online_at timestamptz;

-- 2) submit_alliance_task 写入贡献日志时一并写入 server_date（与任务 server_date 同源）
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

  insert into public.alliance_contribution_log(alliance_id, player_id, task_id, points, server_date)
  values (p_alliance_id, p_player_id, task_row.id, task_row.reward_points, task_row.server_date);

  select c.points_balance into balance from public.alliance_construction c
   where c.alliance_id = p_alliance_id;
  return query select task_row.id, task_row.reward_points, balance;
exception
  when unique_violation then
    raise exception '任务已经提交过';
end;
$$;

revoke all on function public.submit_alliance_task(bigint, bigint, varchar, numeric) from public;

-- 3) 聚合 RPC：一次返回联盟每个成员的 总贡献 / 当日贡献 / 最后上线 / 是否盟主
--    原生前端与云端 relay 页共用，保证两侧数据一致。
create or replace function public.get_alliance_member_stats(p_alliance_id bigint)
returns table (
  player_id varchar(100),
  username varchar(12),
  last_online_at timestamptz,
  total_points bigint,
  daily_points bigint,
  is_owner boolean
)
language sql
security definer
set search_path = public
as $$
  select
    m.player_id::varchar as player_id,
    p.username,
    p.last_online_at,
    coalesce(c.total_points, 0) as total_points,
    coalesce(d.daily_points, 0) as daily_points,
    (a.owner_player_id = m.player_id) as is_owner
  from public.alliance_members m
  join public.alliances a on a.id = m.alliance_id
  left join public.players p on p.player_id = m.player_id
  left join (
    select player_id, sum(points) as total_points
    from public.alliance_contribution_log
    where alliance_id = p_alliance_id
    group by player_id
  ) c on c.player_id = m.player_id
  left join (
    select player_id, sum(points) as daily_points
    from public.alliance_contribution_log
    where alliance_id = p_alliance_id
      and server_date = (now() at time zone 'Asia/Shanghai')::date
    group by player_id
  ) d on d.player_id = m.player_id
  where m.alliance_id = p_alliance_id
  order by coalesce(c.total_points, 0) desc, m.player_id;
$$;

revoke all on function public.get_alliance_member_stats(bigint) from public;
grant execute on function public.get_alliance_member_stats(bigint) to anon, authenticated;

-- 4) 心跳 RPC：玩家打开联盟面板时更新最后上线时间（服务端写入，不依赖客户端时钟）
create or replace function public.touch_player_online(p_player_id varchar(100))
returns void
language sql
security definer
set search_path = public
as $$
  update public.players set last_online_at = now() where player_id = p_player_id;
$$;

revoke all on function public.touch_player_online(varchar) from public;
grant execute on function public.touch_player_online(varchar) to anon, authenticated;
