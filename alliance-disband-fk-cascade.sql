-- ============================================================================
-- 修复：解散联盟被外键约束卡死（2026-09-30 玩家实测，联盟 178「BT」）
--
-- 现象：盟主点「解散联盟」报错（且前端裸露英文）：
--   update or delete on table "alliances" violates foreign key constraint
--   "alliance_task_submissions_alliance_id_fkey" on table "alliance_task_submissions"
--
-- 根因：alliance-construction-schema.sql 建表时，四张联盟子表里只有
--   alliance_task_submissions 的 alliance_id 外键 **漏了 on delete cascade**：
--     alliance_construction      → on delete cascade ✓
--     alliance_contribution_log  → on delete cascade ✓
--     alliance_buildings         → on delete cascade ✓
--     alliance_task_submissions  → 无 cascade ✗（本文件修复对象）
--   解散链路 disband_alliance（alliance-lifecycle-actions.sql）删空成员后由
--   prune_empty_alliance 触发器删 alliances 本体；只要该盟有过任务提交记录，
--   删 alliances 就违反 FK，整个事务回滚 ⇒ 所有有提交历史的盟都解散不了。
--
-- 修复：把该外键改为 on delete cascade（drop + add，幂等可重复执行）。
--   cascade 覆盖所有删除路径（disband_alliance、prune_empty_alliance 触发器、
--   任何外部直接删盟），无需改动 disband_alliance 函数本身。
-- 附带收益：解散后 alliance_task_submissions 里的 unique(task_id, player_id)
--   残留一并清除，玩家重新建盟/入盟后当日任务提交不再撞唯一约束。
--
-- 执行前取证（零写入）：
--   select conname, confdeltype from pg_constraint
--    where conrelid = 'public.alliance_task_submissions'::regclass and contype = 'f';
--   confdeltype = 'a'（NO ACTION）= 带病版本；'c'（CASCADE）= 已修复。
-- ============================================================================

-- 幂等保护：仅当约束存在且仍是无 cascade 的旧定义时才重建
do $$
declare
  v_deltype char;
begin
  select confdeltype into v_deltype
    from pg_constraint
   where conname = 'alliance_task_submissions_alliance_id_fkey'
     and conrelid = 'public.alliance_task_submissions'::regclass;
  if v_deltype is null then
    raise notice '约束不存在，跳过（表可能未建）';
  elsif v_deltype = 'c' then
    raise notice '已是 on delete cascade，无需修复';
  else
    alter table public.alliance_task_submissions
      drop constraint alliance_task_submissions_alliance_id_fkey;
    alter table public.alliance_task_submissions
      add constraint alliance_task_submissions_alliance_id_fkey
      foreign key (alliance_id) references public.alliances(id) on delete cascade;
    raise notice '已修复：alliance_task_submissions.alliance_id → on delete cascade';
  end if;
end;
$$;

-- 同步修正仓库内的建表语句（alliance-construction-schema.sql），防止新环境再建出旧定义；
-- 建表脚本修正后，本 do 块对老环境做就地修复，两者配合覆盖新旧环境。

-- 执行后验证（零写入）：
--   select confdeltype from pg_constraint
--    where conname = 'alliance_task_submissions_alliance_id_fkey';  -- 期望 'c'
