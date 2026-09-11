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
