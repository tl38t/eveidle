create or replace function public.get_alliance_list_summary(
  p_limit integer,
  p_offset integer,
  p_order text,
  p_search text
)
returns table (
  id bigint,
  code text,
  name text,
  owner_player_id text,
  member_count integer,
  created_at timestamptz,
  buildings jsonb,
  points_balance integer,
  total_points_earned bigint
)
language sql
security definer
set search_path = public
as $$
  select
    a.id,
    a.code::text,
    a.name::text,
    a.owner_player_id::text,
    a.member_count,
    a.created_at,
    coalesce(b.buildings, '[]'::jsonb) as buildings,
    coalesce(c.points_balance, 0)::integer as points_balance,
    coalesce(c.total_points_earned, 0) as total_points_earned
  from public.alliances a
  left join (
    select ab.alliance_id,
           jsonb_agg(jsonb_build_object(
             'building_type', ab.building_type,
             'level', ab.level,
             'points_spent', ab.points_spent
           ) order by ab.building_type) as buildings
    from public.alliance_buildings ab
    group by ab.alliance_id
  ) b on b.alliance_id = a.id
  left join public.alliance_construction c on c.alliance_id = a.id
  where (p_search is null or p_search = ''
         or a.name ilike '%' || p_search || '%'
         or a.code ilike '%' || p_search || '%')
  order by
    case when p_order = 'member_count.desc' then a.member_count end desc nulls last,
    a.created_at desc,
    a.id desc
  limit least(greatest(coalesce(p_limit, 100), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.get_alliance_list_summary(integer, integer, text, text) from public;
grant execute on function public.get_alliance_list_summary(integer, integer, text, text) to anon, authenticated;
