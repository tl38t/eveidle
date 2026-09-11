-- 联盟任务规则 v2：增强剂按战术材料等级与数量固定计分；改装件不入任务池。
-- 只增加字段，不删除联盟、成员或建设点数据。

alter table public.alliance_daily_tasks
  add column if not exists tactical_tier smallint;

alter table public.alliance_daily_tasks
  drop constraint if exists alliance_daily_tasks_tactical_tier_check;

alter table public.alliance_daily_tasks
  add constraint alliance_daily_tasks_tactical_tier_check
  check (tactical_tier is null or tactical_tier between 1 and 5);

-- 旧日期任务不会自动变成新规则。正式切换前执行下面三行，清理旧任务记录。
-- 不会清理联盟、成员、建设点余额或建筑。
-- delete from public.alliance_task_submissions;
-- delete from public.alliance_contribution_log;
-- delete from public.alliance_daily_tasks;
