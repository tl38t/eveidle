-- 联盟管理员操作：由服务端云函数调用，客户端不要直接传 owner 身份。

create or replace function public.kick_alliance_member(
  p_alliance_id bigint,
  p_owner_player_id varchar(100),
  p_target_player_id varchar(100)
)
returns table (alliance_id bigint, player_id varchar(100), removed boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_owner_player_id = p_target_player_id then
    raise exception '盟主不能踢出自己';
  end if;
  if not exists (
    select 1 from public.alliances
     where id = p_alliance_id and owner_player_id = p_owner_player_id
  ) then
    raise exception '只有盟主可以管理成员';
  end if;
  delete from public.alliance_members m
   where m.alliance_id = p_alliance_id and m.player_id = p_target_player_id;
  if not found then raise exception '目标玩家不是联盟成员'; end if;
  return query select p_alliance_id, p_target_player_id, true;
end;
$$;

create or replace function public.transfer_alliance_leader(
  p_alliance_id bigint,
  p_owner_player_id varchar(100),
  p_target_player_id varchar(100)
)
returns table (alliance_id bigint, owner_player_id varchar(100), transferred boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_owner_player_id = p_target_player_id then
    raise exception '不能转让给自己';
  end if;
  if not exists (
    select 1 from public.alliances
     where id = p_alliance_id and owner_player_id = p_owner_player_id
  ) then
    raise exception '只有盟主可以转让联盟';
  end if;
  if not exists (
    select 1 from public.alliance_members m
     where m.alliance_id = p_alliance_id and m.player_id = p_target_player_id
  ) then
    raise exception '只能转让给联盟成员';
  end if;
  update public.alliances
     set owner_player_id = p_target_player_id
   where id = p_alliance_id;
  return query select p_alliance_id, p_target_player_id, true;
end;
$$;

revoke all on function public.kick_alliance_member(bigint, varchar, varchar) from public;
revoke all on function public.transfer_alliance_leader(bigint, varchar, varchar) from public;
