-- alliance_daily_tasks.slot 上限 10 -> 12
--
-- 背景（2026-10-16 定位）：
--   f471dd3（2026-10-03）把联盟建筑等级上限 5 -> 7，任务大厅 L6=11 条、L7=12 条，
--   云端 upgrade_alliance_building 已放开到 7、云函数 normalizeTasks 已放宽到 Math.min(12)、
--   taskCountForPlayer 已返回 [5,6,7,8,10,11,12]。**但本表的 slot CHECK 约束从未同步抬高**，
--   一直是 check (slot between 1 and 10)。
--
-- 现象：
--   大厅升到 L6/L7 的玩家，客户端本地能渲染 11/12 条（"任务能看到了"），但客户端把 11/12 条
--   preview 上行后，云函数 ensureTasks 需要 INSERT slot 11/12 —— 整批 INSERT 违反本约束
--   ⇒ PostgREST 返回 400 ⇒ 客户端 fetch catch ⇒ cloudTaskStatus 退回 "local" ⇒ 面板只显示
--   本地预览徽章（"材料足够，可提交"）、**不再生成提交按钮**，玩家感知为"任务无法完成"。
--
-- 本迁移把槽位上限放开到 12，与服务端条数权威一致。
-- 幂等：可重复执行（drop constraint if exists / add constraint）。
-- 影响：约束放宽，仅新增允许的行，不改动/删除任何历史数据。

alter table public.alliance_daily_tasks
  drop constraint if exists alliance_daily_tasks_slot_check;

alter table public.alliance_daily_tasks
  add constraint alliance_daily_tasks_slot_check
  check (slot between 1 and 12);
