-- Alliance building upgrade rules v2. Execute once in CloudBase SQL console.
create or replace function public.upgrade_alliance_building(
  p_alliance_id bigint,
  p_player_id varchar(100),
  p_building_type varchar(40)
)
returns table (building_type varchar(40), level integer, cost integer, points_balance integer)
language plpgsql security definer set search_path = public
as $$
declare
  requested_type varchar(40) := lower(trim(p_building_type));
  canonical_type varchar(40);
  current_level integer;
  next_cost integer;
  balance integer;
begin
  canonical_type := case when requested_type = 'frontier_hq' then 'logistics_hub' else requested_type end;
  if canonical_type not in ('logistics_hub', 'mission_hall', 'combat_command', 'refining_core') then
    raise exception 'unknown alliance building';
  end if;
  if not exists (select 1 from public.alliances a where a.id = p_alliance_id and a.owner_player_id = p_player_id) then
    raise exception 'only alliance owner can upgrade buildings';
  end if;
  insert into public.alliance_construction(alliance_id) values (p_alliance_id) on conflict (alliance_id) do nothing;
  select c.points_balance into balance from public.alliance_construction c where c.alliance_id = p_alliance_id for update;
  select coalesce(b.level, 0) into current_level
    from public.alliance_buildings b
   where b.alliance_id = p_alliance_id and b.building_type = canonical_type;
  current_level := coalesce(current_level, 0);
  if current_level >= 5 then raise exception 'building is already max level'; end if;
  next_cost := case current_level when 0 then 100 when 1 then 250 when 2 then 500 when 3 then 1000 else 2000 end;
  if coalesce(balance, 0) < next_cost then raise exception 'not enough alliance construction points'; end if;
  update public.alliance_construction c set points_balance = c.points_balance - next_cost, updated_at = now()
   where c.alliance_id = p_alliance_id;
  insert into public.alliance_buildings(alliance_id, building_type, level, points_spent)
  values (p_alliance_id, canonical_type, current_level + 1, next_cost)
  on conflict on constraint alliance_buildings_pkey do update
    set level = excluded.level,
        points_spent = public.alliance_buildings.points_spent + excluded.points_spent,
        updated_at = now();
  select c.points_balance into balance from public.alliance_construction c where c.alliance_id = p_alliance_id;
  return query select canonical_type, current_level + 1, next_cost, balance;
end;
$$;
revoke all on function public.upgrade_alliance_building(bigint, varchar, varchar) from public;
grant execute on function public.upgrade_alliance_building(bigint, varchar, varchar) to anon, authenticated;
