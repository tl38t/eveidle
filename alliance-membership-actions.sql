-- 退出/解散联盟所需权限（当前匿名测试架构使用；正式上线建议改为云函数校验身份）。
grant delete on table public.alliance_members, public.alliances to anon, authenticated;
grant update on table public.alliances to anon, authenticated;

drop policy if exists alliance_members_delete on public.alliance_members;
create policy alliance_members_delete on public.alliance_members
  for delete to anon, authenticated using (true);

drop policy if exists alliances_delete on public.alliances;
create policy alliances_delete on public.alliances
  for delete to anon, authenticated using (true);

drop policy if exists alliances_transfer on public.alliances;
create policy alliances_transfer on public.alliances
  for update to anon, authenticated using (true)
  with check (owner_player_id is not null);

-- 成员退出后自动按实际成员关系重算人数。
create or replace function public.sync_alliance_member_count()
returns trigger language plpgsql security definer as $$
begin
  update public.alliances
     set member_count = (select count(*) from public.alliance_members m
                         where m.alliance_id = coalesce(new.alliance_id, old.alliance_id))
   where id = coalesce(new.alliance_id, old.alliance_id);
  return coalesce(new, old);
end;
$$;

drop trigger if exists alliance_member_count_sync on public.alliance_members;
create trigger alliance_member_count_sync
after insert or delete on public.alliance_members
for each row execute function public.sync_alliance_member_count();

-- 普通成员退出联盟：通过 SECURITY DEFINER 原子执行，避免客户端直接 DELETE 被 RLS 拒绝。
-- 盟主不能自行退出，必须先转让盟主或解散联盟。
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
