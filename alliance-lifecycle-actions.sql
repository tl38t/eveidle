-- 联盟生命周期：真实「解散联盟」+ 事务化建盟 + 空盟清理（唯一实现）
-- 背景（2026-09-13 实测）：relay 页 alliance.html 对盟主显示「解散联盟」按钮，但点击只弹红字
--   「盟主不能直接退出，请先转让盟主」并 return（零网络请求）；后端从未存在 disband 类函数，
--   云函数 alliance-admin 也只有 kick_member / transfer_leader ⇒ 盟主在联盟大厅彻底无路。
--   同时「建立联盟」是非事务两步（先插 alliances 再插成员），配合 alliance_members.UNIQUE(player_id)
--   ⇒ 已在联盟者再建盟会留下 0 成员「孤儿联盟」（线上现存 3 个空壳即由此而来）。
--
-- 本文件提供三段能力（全部幂等，可重复执行）：
--   1) create_alliance_with_owner —— 事务化建盟（一次调用完成建盟 + 入盟），杜绝孤儿联盟
--   2) disband_alliance            —— 真实解散（仅盟主；删全部成员 + 删联盟本体）
--   3) prune_empty_alliance 触发器 —— 空盟清理的**唯一实现**（挂 alliance_members DELETE，覆盖所有路径）
--
-- ⚠️ leave_alliance_member **刻意保持原版**（不带删盟逻辑）：空盟清理若同时写在 RPC 与触发器里
--    就是「同语义逻辑第二份实现」——两处记账必然分叉。清理只由 (3) 的触发器负责，见文末原版定义。
--
-- 依赖：alliance-membership-actions.sql、alliance-membership-cap.sql。

-- ============================================================================
-- 1) 事务化建盟：消掉「孤儿联盟」这个 0 成员来源
-- ============================================================================
create or replace function public.create_alliance_with_owner(
  p_code varchar,
  p_name varchar,
  p_player_id varchar(100)
)
returns table (alliance_id bigint, code varchar, name varchar, owner_player_id varchar(100), member_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
begin
  if p_player_id is null or btrim(p_player_id) = '' then
    raise exception '玩家 ID 无效';
  end if;
  if p_code is null or p_code !~ '^[A-Z]{1,3}$' then
    raise exception '联盟代码需为 1-3 位大写英文字母';
  end if;
  -- 前置校验：一人只能在一个联盟（与 alliance_members.UNIQUE(player_id) 同语义，
  -- 但在这里给出可读错误，而不是让第二步插入失败留下一个 0 成员空壳联盟）
  if exists (select 1 from public.alliance_members m where m.player_id = p_player_id) then
    raise exception '你已经加入了一个联盟，请先退出后再建立';
  end if;
  if exists (select 1 from public.alliances a where a.code = p_code) then
    raise exception '联盟代码已被占用，请换一个';
  end if;
  -- 与成员插入处于同一函数事务：要么都成功，要么都不落盘
  insert into public.alliances (code, name, owner_player_id, member_count)
  values (p_code, coalesce(nullif(btrim(p_name), ''), p_code), p_player_id, 0)
  returning id into v_id;
  insert into public.alliance_members (alliance_id, player_id) values (v_id, p_player_id);
  return query
    select a.id, a.code::varchar, a.name::varchar, a.owner_player_id::varchar, a.member_count
      from public.alliances a where a.id = v_id;
end;
$$;

revoke all on function public.create_alliance_with_owner(varchar, varchar, varchar) from public;
grant execute on function public.create_alliance_with_owner(varchar, varchar, varchar) to anon, authenticated;

-- ============================================================================
-- 2) 解散联盟：仅盟主可调用（删全部成员 + 删联盟本体）
-- ============================================================================
create or replace function public.disband_alliance(
  p_alliance_id bigint,
  p_owner_player_id varchar(100)
)
returns table (disbanded_alliance_id bigint, removed_members integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner varchar(100);
  v_removed integer := 0;
begin
  -- ⚠️ PG 陷阱：plpgsql `select ... into` 无行时置 NULL（不是异常）⇒ 用 null 判「联盟不存在」是正确语义
  select a.owner_player_id into v_owner from public.alliances a where a.id = p_alliance_id;
  if v_owner is null then
    raise exception '联盟不存在或已被解散';
  end if;
  if v_owner <> p_owner_player_id then
    raise exception '只有盟主可以解散联盟';
  end if;
  select count(*) into v_removed from public.alliance_members m where m.alliance_id = p_alliance_id;
  -- 删成员时 (3) 的触发器会顺带把联盟删掉；下面这条 delete 因此是幂等的收尾
  delete from public.alliance_members m where m.alliance_id = p_alliance_id;
  delete from public.alliances a where a.id = p_alliance_id;
  return query select p_alliance_id, coalesce(v_removed, 0);
end;
$$;

revoke all on function public.disband_alliance(bigint, varchar) from public;
grant execute on function public.disband_alliance(bigint, varchar) to anon, authenticated;

-- ============================================================================
-- 3) 空盟清理：唯一实现（触发器，覆盖所有 DELETE 路径）
--    为什么不用「leave_alliance_member 里显式删盟」？因为盟主永远是成员 ⇒ 成员数最小为 1，
--    「最后一员退出后归零」在正常业务里不可达；能产生 0 成员的真实路径是「建盟第二步失败」
--    与「外部直接删成员」。前者已由 (1) 堵死，后者只有挂在成员表的触发器能覆盖。
-- ============================================================================
create or replace function public.prune_empty_alliance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.alliances a
   where a.id = coalesce(new.alliance_id, old.alliance_id)
     and not exists (select 1 from public.alliance_members m where m.alliance_id = a.id);
  return coalesce(new, old);
end;
$$;

-- ⚠️ 显式 drop 旧名：同表多个 AFTER 触发器按名称字母序执行，残留旧名会让规则"看起来没生效"
drop trigger if exists alliance_member_prune_empty on public.alliance_members;
create trigger alliance_member_prune_empty
after delete on public.alliance_members
for each row execute function public.prune_empty_alliance();

-- ============================================================================
-- 4) leave_alliance_member 还原为原版（3 列签名，不含删盟逻辑）
--    仅当线上仍是「带显式删盟」的中间版本时才需要执行；与原版逐字一致 ⇒ 幂等
-- ============================================================================
create or replace function public.leave_alliance_member(
  p_alliance_id bigint,
  p_player_id varchar(100)
)
returns table (alliance_id bigint, player_id varchar(100), left_alliance boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.alliances a where a.id = p_alliance_id and a.owner_player_id = p_player_id) then
    raise exception '盟主不能直接退出联盟，请先转让盟主或解散联盟';
  end if;
  delete from public.alliance_members m where m.alliance_id = p_alliance_id and m.player_id = p_player_id;
  if not found then raise exception '玩家不是该联盟成员'; end if;
  update public.alliances a
     set member_count = (select count(*) from public.alliance_members m where m.alliance_id = p_alliance_id)
   where a.id = p_alliance_id;
  return query select p_alliance_id, p_player_id, true;
end;
$$;

revoke all on function public.leave_alliance_member(bigint, varchar) from public;
grant execute on function public.leave_alliance_member(bigint, varchar) to anon, authenticated;

-- ============================================================================
-- 5) 一次性数据修复：清掉历史 0 成员空壳联盟（含孤儿建盟产物）
--    判据 = member_count = 0 且成员表里确实一行都没有（幂等：重复执行删 0 行）
--    收益：释放被永久占用的联盟代码（alliances.code 有 UNIQUE 约束）
-- ============================================================================
delete from public.alliances a
 where a.member_count = 0
   and not exists (select 1 from public.alliance_members m where m.alliance_id = a.id);
