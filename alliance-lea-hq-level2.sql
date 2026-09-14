-- 将 LEA 的边疆联合总部升级到 Lv.2（成员上限 15）。
-- 只修改 LEA 的总部，不修改其它建筑等级。
update public.alliance_buildings b
   set level = 2,
       points_spent = 250
 where b.alliance_id = (select a.id from public.alliances a where a.code = 'LEA' limit 1)
   and b.building_type in ('frontier_hq', 'logistics_hub');

-- 如果 LEA 尚未有旧版总部记录，则创建兼容记录。
insert into public.alliance_buildings(alliance_id, building_type, level, points_spent)
select a.id, 'logistics_hub', 2, 250
  from public.alliances a
 where a.code = 'LEA'
   and not exists (
     select 1 from public.alliance_buildings b
      where b.alliance_id = a.id
        and b.building_type in ('frontier_hq', 'logistics_hub')
   )
on conflict (alliance_id, building_type) do nothing;

select a.id, a.code, b.building_type, b.level, b.points_spent
  from public.alliances a
  join public.alliance_buildings b on b.alliance_id = a.id
 where a.code = 'LEA'
   and b.building_type in ('frontier_hq', 'logistics_hub');
