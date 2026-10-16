-- 任务大厅支持 5-12 个每日任务（L6=11、L7=12）。
alter table public.alliance_daily_tasks add column if not exists tactical_tier smallint;
alter table public.alliance_daily_tasks drop constraint if exists alliance_daily_tasks_tactical_tier_check;
alter table public.alliance_daily_tasks add constraint alliance_daily_tasks_tactical_tier_check
  check (tactical_tier is null or tactical_tier between 1 and 5);
alter table public.alliance_daily_tasks drop constraint if exists alliance_daily_tasks_slot_check;
alter table public.alliance_daily_tasks add constraint alliance_daily_tasks_slot_check check (slot between 1 and 12);
