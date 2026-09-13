-- 联盟总部人数上限服务端校验
-- 旧联盟没有 frontier_hq/logistics_hub 记录时，兼容为 10 人。
-- 上限表：Lv.1=10 / Lv.2=15 / Lv.3=20 / Lv.4=25 / Lv.5=30（与 js/data/alliance-building-config.js memberCap 一致）
--
-- ⚠️ 本脚本必须与「删除旧触发器」一起执行（见文件末尾的 drop trigger 段）：
--    线上残留的 alliance_member_count_trigger（BEFORE INSERT）内部写死 10 人，
--    与新建的 alliance_member_capacity_guard 同属 BEFORE INSERT，按名称字母序后执行，
--    不删则旧的仍然抛错，本脚本等于没生效。
-- 幂等：可重复执行。
create or replace function public.join_alliance_with_capacity(
  p_alliance_id bigint,
  p_player_id varchar(100)
)
returns table (alliance_id bigint, player_id varchar(100), member_count bigint, member_cap integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_count bigint;
  cap integer := 10;
  hq_level integer := 0;
begin
  if p_alliance_id is null or p_alliance_id <= 0 then
    raise exception '联盟 ID 无效';
  end if;
  if p_player_id is null or length(trim(p_player_id)) = 0 or length(p_player_id) > 100 then
    raise exception '玩家 ID 无效';
  end if;

  -- 锁住联盟行，避免两个成员同时加入时突破上限。
  perform 1 from public.alliances where id = p_alliance_id for update;
  if not found then raise exception '联盟不存在'; end if;

  if exists (select 1 from public.alliance_members m where m.player_id = p_player_id) then
    raise exception '玩家已经加入联盟';
  end if;

  -- ⚠️ 不可用 `select ... into`：联盟没有总部建筑时返回 0 行，plpgsql 会把变量置为 NULL，
  --    而 greatest/least 会忽略 NULL ⇒ least(5,NULL)=5 ⇒ greatest(0,5)=5 ⇒ 上限被误算成 30。
  --    改用标量子查询 + coalesce 兜底，无行时得到 0。（实测：least(5,NULL::int)=5）
  hq_level := coalesce((
    select b.level
      from public.alliance_buildings b
     where b.alliance_id = p_alliance_id
       and b.building_type in ('frontier_hq', 'logistics_hub')
     order by case when b.building_type = 'frontier_hq' then 0 else 1 end
     limit 1
  ), 0);

  cap := case greatest(0, least(5, coalesce(hq_level, 0)))
    when 1 then 10 when 2 then 15 when 3 then 20 when 4 then 25 when 5 then 30
    else 10 end;

  select count(*) into current_count
    from public.alliance_members m
   where m.alliance_id = p_alliance_id;
  if current_count >= cap then
    raise exception '该联盟已满，最多只能有 % 名成员', cap;
  end if;

  insert into public.alliance_members(alliance_id, player_id)
  values (p_alliance_id, p_player_id);

  select count(*) into current_count
    from public.alliance_members m
   where m.alliance_id = p_alliance_id;
  return query select p_alliance_id, p_player_id, current_count, cap;
end;
$$;

revoke all on function public.join_alliance_with_capacity(bigint, varchar) from public;
grant execute on function public.join_alliance_with_capacity(bigint, varchar) to anon, authenticated;

-- 兼容旧版 TapTap 云端页面：即使仍直接 INSERT 成员，也不能绕过总部上限。
create or replace function public.enforce_alliance_member_capacity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_count bigint;
  cap integer := 10;
  hq_level integer := 0;
begin
  perform 1 from public.alliances where id = new.alliance_id for update;
  if not found then raise exception '联盟不存在'; end if;

  -- ⚠️ 同上：不可用 `select ... into`（无行 ⇒ NULL ⇒ least(5,NULL)=5 ⇒ cap 误算成 30）。
  hq_level := coalesce((
    select b.level
      from public.alliance_buildings b
     where b.alliance_id = new.alliance_id
       and b.building_type in ('frontier_hq', 'logistics_hub')
     order by case when b.building_type = 'frontier_hq' then 0 else 1 end
     limit 1
  ), 0);
  cap := case greatest(0, least(5, coalesce(hq_level, 0)))
    when 1 then 10 when 2 then 15 when 3 then 20 when 4 then 25 when 5 then 30
    else 10 end;

  select count(*) into current_count
    from public.alliance_members m
   where m.alliance_id = new.alliance_id;
  if current_count >= cap then
    raise exception '该联盟已满，最多只能有 % 名成员', cap;
  end if;
  return new;
end;
$$;

-- ⚠️⚠️ 必须删除线上遗留的旧触发器（写死 10 人）：
--    它与下面的 alliance_member_capacity_guard 同为 BEFORE INSERT，触发顺序按名称字母序
--    （alliance_member_capacity_guard → alliance_member_count_trigger）⇒ 新 guard 放行后
--    旧触发器照样抛 '联盟已满，最多只能有10名成员'，本脚本等于没生效。
--    旧函数 update_alliance_member_count() 随之成为孤儿，保留不删（回滚余量）；
--    member_count 由 AFTER 触发器 alliance_member_count_sync / sync_alliance_member_count() 全量重算，无缺口。
drop trigger if exists alliance_member_count_trigger on public.alliance_members;

drop trigger if exists alliance_member_capacity_guard on public.alliance_members;
create trigger alliance_member_capacity_guard
before insert on public.alliance_members
for each row execute function public.enforce_alliance_member_capacity();

revoke all on function public.enforce_alliance_member_capacity() from public;

-- ============================================================================
-- ⚠️ 第三处「写死 10」：alliances.member_count 上的 CHECK 约束写死 `member_count <= 10`。
--    Lv.3 联盟上限 20 人 ⇒ AFTER 触发器 sync_alliance_member_count 把 member_count 更新为
--    11..20 时会撞上它，实测报错：
--      new row for relation "alliances" violates check constraint "alliances_member_count_limit"
--    CHECK 无法表达「按总部等级」的动态上限（PG 不允许 CHECK 引用其他表 / 子查询），
--    因此删掉它，容量控制完全交给 enforce_alliance_member_capacity() + join_alliance_with_capacity()。
--    另建一个非负下界约束防脏数据。
--    必须放在文件末尾：等新守卫确认就位后才放开旧上限。
-- ============================================================================
alter table public.alliances drop constraint if exists alliances_member_count_limit;
alter table public.alliances drop constraint if exists alliances_member_count_nonneg;
alter table public.alliances add constraint alliances_member_count_nonneg check (member_count >= 0);

-- 说明：旧函数 public.update_alliance_member_count() 已无任何触发器引用（孤儿），
-- 其内部写死 10，**禁止重新挂载**。member_count 由 alliance_member_count_sync 全量重算。
