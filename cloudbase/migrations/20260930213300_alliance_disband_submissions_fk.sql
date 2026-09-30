-- ============================================================================
-- 修复：解散联盟被外键约束卡死（2026-09-30 玩家实测，联盟 178「BT」）
--
-- 现象：盟主点「解散联盟」报错（且前端裸露英文）：
--   update or delete on table "alliances" violates foreign key constraint
--   "alliance_task_submissions_alliance_id_fkey" on table "alliance_task_submissions"
--
-- 根因：alliance-construction-schema.sql 建表时，四张联盟子表里只有
--   alliance_task_submissions 的 alliance_id 外键 **漏了 on delete cascade**：
--     alliance_construction      -> on delete cascade OK
--     alliance_contribution_log  -> on delete cascade OK
--     alliance_buildings         -> on delete cascade OK
--     alliance_task_submissions  -> 无 cascade (本文件修复对象)
--   解散链路 disband_alliance 删空成员后由 prune_empty_alliance 触发器删
--   alliances 本体；只要该盟有过任务提交记录，删 alliances 就违反 FK，整个事务回滚。
--
-- 修复：把该外键改为 on delete cascade（drop + add，幂等可重复执行）。
--   cascade 覆盖所有删除路径（disband_alliance、prune_empty_alliance 触发器、
--   任何外部直接删盟），无需改动 disband_alliance 函数本身。
-- ============================================================================

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
    raise notice '已修复：alliance_task_submissions.alliance_id -> on delete cascade';
  end if;
end;
$$;
