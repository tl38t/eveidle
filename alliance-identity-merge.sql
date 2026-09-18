-- 联盟身份：设备密钥 + 身份转移码 + 身份合并（幂等，可重复执行）
-- 背景：联盟 player_id 对无平台身份的环境是设备级 local_<...>，换设备即产生新身份
--       → 同一人在云端出现多条成员记录（实测 171/187 为设备级）。
-- 本迁移提供「身份可自证（secret）+ 可认领（handoff）+ 可合并（merge）」三件套。
--
-- 安全模型：
--   * 设备身份没有平台 sessionToken，故引入 device secret（客户端生成 ≥128bit，库里只存 sha256）。
--   * 派生型设备身份 id = local_ + 密钥前 12 位 ⇒ 服务端能复算，做到「知道 id ≠ 持有密钥」，
--     防止拿泄露的 player_id 抢注他人身份。
--   * 所有敏感动作（登记密钥 / 签发转移码 / 兑换转移码 / 归并）都经云函数转发，
--     对应 RPC 一律 revoke all from public, anon, authenticated。
--
-- ⚠️⚠️ 权限陷阱（本项目实测，务必照做）：CloudBase 在 public schema 上配了
--   ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS TO anon, authenticated，
--   所以 CREATE FUNCTION 出来的函数**天生带一条显式 anon=X 授权**。
--   `revoke all on function f from public` 只删 PUBLIC 那条，删不掉显式的 anon=X，
--   ⇒ 必须写 `revoke all on function f from public, anon, authenticated;`。
--   验证判据：has_function_privilege('anon', 'public.f(...)', 'execute') 必须为 false。
--   * 合并方向固定为「from 并入 to」，转移码始终绑定 to（被保留方）。
--
-- ⚠️ 合并覆盖面：全库仅 6 处引用 player_id（已核 information_schema 与 FK）
--   alliance_members / players / alliance_contribution_log /
--   alliance_daily_tasks / alliance_task_submissions / alliances.owner_player_id
--   ⚠️ 其中 alliance_daily_tasks 有 UNIQUE(player_id, server_date, slot)、
--      alliance_task_submissions 有 UNIQUE(task_id, player_id) ⇒ 改挂前必须先解冲突，
--      否则同一天双设备会产生「必然触发」的外键/唯一约束报错（详见函数内注释）。
--   ⚠️ 引用 alliance_daily_tasks(id) 的子表只有 2 张（已核 pg_constraint）：
--      alliance_task_submissions.task_id（NOT NULL，删行）与
--      alliance_contribution_log.task_id（可空，改指）。
--
-- ⚠️ 密钥独立成表，不挂 players：players.username 为 NOT NULL 且唯一，
--   给「尚未设昵称」的设备身份插 players 行会直接撞约束，且会污染成员列表昵称。

-- ---------------------------------------------------------------------------
-- 1) 身份密钥表（一身份一行；RLS 打开且不建策略 ⇒ 只有 security definer 函数能读）
-- ---------------------------------------------------------------------------
create table if not exists public.alliance_identity_secrets (
  player_id varchar(100) primary key,
  secret_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.alliance_identity_secrets enable row level security;

-- ---------------------------------------------------------------------------
-- 2) 身份转移码表
-- ---------------------------------------------------------------------------
create table if not exists public.alliance_identity_handoffs (
  code varchar(16) primary key,
  keeper_player_id varchar(100) not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  redeemed_by varchar(100),
  redeemed_at timestamptz
);

create index if not exists alliance_identity_handoffs_keeper
  on public.alliance_identity_handoffs (keeper_player_id, expires_at desc);

alter table public.alliance_identity_handoffs enable row level security;

-- ---------------------------------------------------------------------------
-- 3) register_device_secret：登记设备密钥（首次写入；已有凭证只比对，绝不覆盖）
--    p_secret = 客户端生成的 32~64 位十六进制随机串；哈希只在库内算，
--    客户端与云函数都不复制 sha256 实现。
--
--    ⚠️ 派生校验只在「首次登记」时执行：
--      * 已有凭证 ⇒ 直接比对哈希。这样「本机 playerKey 还在、deviceSecret 丢了」
--        只会得到 false（可预期），而不是被硬拒；
--      * 首次登记派生型身份 ⇒ 必须能由密钥复算出 id，否则 raise（防抢注）。
-- ---------------------------------------------------------------------------
drop function if exists public.register_device_secret(varchar, text);
create or replace function public.register_device_secret(
  p_player_id varchar(100),
  p_secret text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
  v_existing text;
begin
  if p_player_id is null or length(p_player_id) = 0 then raise exception '身份为空'; end if;
  if p_secret is null or p_secret !~ '^[0-9a-f]{32,64}$' then raise exception '密钥格式不合法'; end if;

  v_hash := encode(sha256(p_secret::bytea), 'hex');

  -- ⚠️ 禁裸 SELECT INTO：无行会把变量置 NULL 并覆盖初始值
  v_existing := coalesce((select secret_hash from public.alliance_identity_secrets where player_id = p_player_id), '');

  if v_existing <> '' then
    return v_existing = v_hash;
  end if;

  -- 派生型设备身份：id 必须由密钥前 12 位复算得出（防抢注）
  if p_player_id ~ '^local_[0-9a-f]{12}$' and p_player_id <> 'local_' || left(p_secret, 12) then
    raise exception '设备密钥与该身份不匹配';
  end if;

  insert into public.alliance_identity_secrets(player_id, secret_hash)
  values (p_player_id, v_hash)
  on conflict (player_id) do nothing;
  -- 并发下可能已被抢先写入 ⇒ 复查实际落库值，绝不谎报成功
  return coalesce((select secret_hash from public.alliance_identity_secrets where player_id = p_player_id), '') = v_hash;
end;
$$;

revoke all on function public.register_device_secret(varchar, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) 内部：校验设备密钥（同样只收原始密钥，哈希在库内算）
-- ---------------------------------------------------------------------------
drop function if exists public.assert_device_secret(varchar, text);
create or replace function public.assert_device_secret(
  p_player_id varchar(100),
  p_secret text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing text;
begin
  -- ⚠️ 禁裸 SELECT INTO：无行会把变量置 NULL 并覆盖初始值
  v_existing := coalesce((select secret_hash from public.alliance_identity_secrets where player_id = p_player_id), '');
  if v_existing = '' then raise exception '该身份尚未登记设备密钥'; end if;
  if p_secret is null or v_existing <> encode(sha256(p_secret::bytea), 'hex') then
    raise exception '设备密钥不匹配';
  end if;
end;
$$;

revoke all on function public.assert_device_secret(varchar, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5) create_identity_handoff：签发转移码（绑定「被保留方」= 调用方当前身份）
-- ---------------------------------------------------------------------------
drop function if exists public.create_identity_handoff(varchar, text, integer);
create or replace function public.create_identity_handoff(
  p_player_id varchar(100),
  p_secret text,
  p_ttl_seconds integer default 900
)
returns table (code varchar(16), expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code varchar(16);
  v_expires timestamptz;
  v_ttl integer;
  v_attempt integer := 0;
begin
  perform public.assert_device_secret(p_player_id, p_secret);

  -- ttl 夹在 60s ~ 24h（防止 0 / 负数 / 超长）
  v_ttl := least(greatest(coalesce(p_ttl_seconds, 900), 60), 86400);
  v_expires := now() + make_interval(secs => v_ttl);

  -- 同一身份只保留最新一张有效码
  -- ⚠️ 必须带别名限定列名：OUT 参数名与本表列名（code / expires_at）同名，
  --    裸写列名会让 plpgsql 报 column reference is ambiguous。
  update public.alliance_identity_handoffs h
     set expires_at = now()
   where h.keeper_player_id = p_player_id
     and h.redeemed_at is null
     and h.expires_at > now();

  loop
    v_attempt := v_attempt + 1;
    if v_attempt > 8 then raise exception '转移码生成失败，请重试'; end if;
    -- 32 进制字符表（去掉 0/O/1/I 等易混字符）
    select string_agg(substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', (floor(random() * 32) + 1)::int, 1), '')
      into v_code
      from generate_series(1, 8);
    begin
      insert into public.alliance_identity_handoffs(code, keeper_player_id, expires_at)
      values (v_code, p_player_id, v_expires);
      exit;
    exception when unique_violation then
      -- 撞码重试
    end;
  end loop;

  return query select v_code, v_expires;
end;
$$;

revoke all on function public.create_identity_handoff(varchar, text, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6) merge_alliance_identity：把 from 的一切并入 to（保留 to）
--    前置校验（全部在写库前 raise，便于探针用「必 raise 的入参」零写入验证）：
--      * from/to 不能相同
--      * 两边都有成员行且不在同一联盟时拒绝（一个人只能有一个联盟席位）
--      * 两边分别是不同联盟的盟主时拒绝（owner 归属歧义）
-- ---------------------------------------------------------------------------
create or replace function public.merge_alliance_identity(
  p_from varchar(100),
  p_to varchar(100)
)
returns table (merged boolean, from_alliance_id bigint, to_alliance_id bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from_alliance bigint;
  v_to_alliance bigint;
  v_from_owner bigint;
  v_to_owner bigint;
  v_from_username varchar(12);
  v_from_last_online timestamptz;
begin
  if coalesce(p_from, '') = '' or coalesce(p_to, '') = '' then raise exception '身份为空'; end if;
  if p_from = p_to then raise exception '不能把身份并入自身'; end if;

  -- ⚠️ 一律 coalesce 标量子查询，禁止裸 SELECT INTO
  v_from_alliance := coalesce((select alliance_id from public.alliance_members where player_id = p_from limit 1), null);
  v_to_alliance := coalesce((select alliance_id from public.alliance_members where player_id = p_to limit 1), null);

  if v_from_alliance is not null and v_to_alliance is not null and v_from_alliance <> v_to_alliance then
    raise exception '两个身份分属不同联盟，请先退出其中一个';
  end if;

  v_from_owner := coalesce((select id from public.alliances where owner_player_id = p_from limit 1), null);
  v_to_owner := coalesce((select id from public.alliances where owner_player_id = p_to limit 1), null);

  if v_from_owner is not null and v_to_owner is not null and v_from_owner <> v_to_owner then
    raise exception '两个身份分别是不同联盟的盟主，无法合并';
  end if;

  -- --- 成员行 ---
  if v_from_alliance is not null then
    if v_to_alliance is null then
      -- to 没有成员行 → 直接把 from 的行改挂到 to 名下
      update public.alliance_members set player_id = p_to where player_id = p_from;
    else
      -- 同联盟已有 to 的行 → 删除 from 的重复行
      delete from public.alliance_members where player_id = p_from;
    end if;
  end if;

  -- --- 盟主归属 ---
  if v_from_owner is not null and v_to_owner is null then
    update public.alliances set owner_player_id = p_to where owner_player_id = p_from;
  end if;

  -- --- 贡献日志 ---
  update public.alliance_contribution_log set player_id = p_to where player_id = p_from;

  -- --- 每日任务 + 提交：唯一约束冲突必须先解，否则合并直接撞 UNIQUE 报错 ---
  -- ⚠️ 必需性（实测量级，不是理论边界）：alliance_daily_tasks 由客户端按玩家生成，
  --   slot 恒为 index+1 = 1..5（见 cloudfunctions/alliance-daily-tasks-v4-stage）。
  --   同一人在同一天用两台设备 ⇒ 两个身份各自都有 slot 1..5 的同日任务
  --   ⇒ 直接 update player_id 会逐行撞 UNIQUE(player_id, server_date, slot)。
  --   实测：不加这段，merge 抛 23505，玩家看到的是「服务器错误」。
  -- 规则：保留方（to）优先 —— 来源方与被保留方同 (server_date, slot) 的行整体让位。
  --   alliance_daily_tasks 按玩家生成 ⇒ 两个身份的任务是两份独立存档的任务板，
  --   required_amount / material 未必可比，故不做数值合并，只保留在用身份那一份。
  --   已得建设点不丢：贡献日志的 player_id 已在上一步全量改挂。
  -- ① 解除两张子表对「来源方将被删除的任务行」的外键引用
  --    （alliance_task_submissions.task_id 为 NOT NULL ⇒ 只能删行；
  --      contribution_log.task_id 可空 ⇒ 改指到保留方同槽位任务，保住「任务↔贡献」链路）
  delete from public.alliance_task_submissions ts
   using public.alliance_daily_tasks s, public.alliance_daily_tasks t
   where ts.task_id = s.id
     and s.player_id = p_from
     and t.player_id = p_to
     and t.server_date = s.server_date
     and t.slot = s.slot;

  update public.alliance_contribution_log c
     set task_id = t.id
    from public.alliance_daily_tasks s, public.alliance_daily_tasks t
   where c.task_id = s.id
     and s.player_id = p_from
     and t.player_id = p_to
     and t.server_date = s.server_date
     and t.slot = s.slot;

  -- ② 删除来源方的重复槽位行
  delete from public.alliance_daily_tasks s
   using public.alliance_daily_tasks t
   where s.player_id = p_from
     and t.player_id = p_to
     and t.server_date = s.server_date
     and t.slot = s.slot;

  -- ③ 同 task 双身份都有提交 ⇒ 数值合并进保留方行、删除来源方重复行
  --    防御性：submit_alliance_task 强制 task_row.player_id = 提交者，任务按玩家独占
  --    ⇒ 现实中两个身份不可能同时持有同一 task_id 的提交；此处仍去重，保证任何历史脏数据下不抛错。
  update public.alliance_task_submissions t
     set amount = t.amount + s.amount,
         points = t.points + s.points
    from public.alliance_task_submissions s
   where t.player_id = p_to
     and s.player_id = p_from
     and t.task_id = s.task_id;

  delete from public.alliance_task_submissions s
   where s.player_id = p_from
     and exists (select 1 from public.alliance_task_submissions t
                  where t.player_id = p_to and t.task_id = s.task_id);

  -- ④ 其余行改挂保留方（冲突已全解，不会再撞唯一约束）
  update public.alliance_task_submissions set player_id = p_to where player_id = p_from;
  update public.alliance_daily_tasks set player_id = p_to where player_id = p_from;

  -- --- players 行 ---
  v_from_username := coalesce((select username from public.players where player_id = p_from), null);
  v_from_last_online := coalesce((select last_online_at from public.players where player_id = p_from), null);

  if exists (select 1 from public.players where player_id = p_from) then
    if exists (select 1 from public.players where player_id = p_to) then
      -- 先删 from 行（username 唯一约束要求先让位），再补 to 的空缺
      delete from public.players where player_id = p_from;
      update public.players
         set username = coalesce(username, v_from_username),
             last_online_at = greatest(coalesce(last_online_at, v_from_last_online), coalesce(v_from_last_online, last_online_at))
       where player_id = p_to;
    else
      update public.players set player_id = p_to where player_id = p_from;
    end if;
  end if;

  -- --- 设备密钥 ---
  -- 保留方已有密钥 ⇒ 不动（凭证跟随保留方）；保留方没有 ⇒ 继承来源方的，
  -- 否则被归并的身份会变成谁也管不了的孤儿。
  if exists (select 1 from public.alliance_identity_secrets where player_id = p_from) then
    if exists (select 1 from public.alliance_identity_secrets where player_id = p_to) then
      delete from public.alliance_identity_secrets where player_id = p_from;
    else
      update public.alliance_identity_secrets set player_id = p_to, updated_at = now() where player_id = p_from;
    end if;
  end if;

  -- --- member_count 重算（两处都算，幂等） ---
  update public.alliances a
     set member_count = (select count(*) from public.alliance_members m where m.alliance_id = a.id)
   where a.id in (coalesce(v_from_alliance, -1), coalesce(v_to_alliance, -1));

  return query select true, v_from_alliance, v_to_alliance;
end;
$$;

revoke all on function public.merge_alliance_identity(varchar, varchar) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7) redeem_identity_handoff：新设备凭码认领（from = 新设备当前身份，to = 码绑定的保留方）
--    成功后把保留方的密钥换成新设备的 ⇒ 所有权移交给新设备，旧设备密钥立即失效
--    （符合「换设备」语义）。旧设备仍可正常玩，只是不能再管理该身份。
-- ---------------------------------------------------------------------------
drop function if exists public.redeem_identity_handoff(varchar, varchar, text);
create or replace function public.redeem_identity_handoff(
  p_code varchar(16),
  p_from_player_id varchar(100),
  p_from_secret text
)
returns table (keeper_player_id varchar(100), merged boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_keeper varchar(100);
  v_expires timestamptz;
  v_redeemed timestamptz;
begin
  perform public.assert_device_secret(p_from_player_id, p_from_secret);

  -- ⚠️ 禁裸 SELECT INTO；且必须用别名限定 keeper_player_id（它是本函数的 OUT 参数名，
  --    与表列同名，裸写同样会报 ambiguous）。
  v_keeper := coalesce((select h.keeper_player_id from public.alliance_identity_handoffs h where h.code = p_code), '');
  if v_keeper = '' then raise exception '转移码不存在'; end if;

  v_expires := coalesce((select h.expires_at from public.alliance_identity_handoffs h where h.code = p_code), now());
  if v_expires <= now() then raise exception '转移码已过期'; end if;

  v_redeemed := (select h.redeemed_at from public.alliance_identity_handoffs h where h.code = p_code);
  if v_redeemed is not null then raise exception '转移码已被使用'; end if;

  if v_keeper = p_from_player_id then raise exception '不能认领自身身份'; end if;

  perform public.merge_alliance_identity(p_from_player_id, v_keeper);
  -- merge 已把 from 的密钥行删掉（保留方原本就有密钥），这里落新设备的密钥
  insert into public.alliance_identity_secrets(player_id, secret_hash, updated_at)
  values (v_keeper, encode(sha256(p_from_secret::bytea), 'hex'), now())
  on conflict (player_id) do update
    set secret_hash = excluded.secret_hash, updated_at = now();

  update public.alliance_identity_handoffs h
     set redeemed_by = p_from_player_id, redeemed_at = now()
   where h.code = p_code;

  return query select v_keeper, true;
end;
$$;

revoke all on function public.redeem_identity_handoff(varchar, varchar, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8) 自动归并：平台身份（taptap_/steam/SteamID64）晚于设备身份就绪时，
--    把设备身份并入平台身份。只允许「设备级 → 平台级」方向。
-- ---------------------------------------------------------------------------
create or replace function public.merge_legacy_device_identity(
  p_device_player_id varchar(100),
  p_platform_player_id varchar(100)
)
returns table (merged boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(p_device_player_id, '') = '' or coalesce(p_platform_player_id, '') = '' then
    raise exception '身份为空';
  end if;
  if p_device_player_id = p_platform_player_id then
    return query select false;
    return;
  end if;
  -- 只接受设备级 → 平台级 的归并方向（反向一律拒绝，避免平台身份被设备身份吞掉）
  if p_device_player_id not like 'local\_%' and p_device_player_id not like 'dev\_%' then
    raise exception '仅支持把设备身份并入平台身份';
  end if;
  if p_platform_player_id not like 'taptap\_%' and p_platform_player_id not like 'steam\_%'
     and p_platform_player_id !~ '^[0-9]{5,20}$' then
    raise exception '目标不是有效的平台身份';
  end if;

  -- 合并语义唯一实现在 merge_alliance_identity（含密钥的「保留方优先」规则）
  perform public.merge_alliance_identity(p_device_player_id, p_platform_player_id);
  return query select true;
end;
$$;

revoke all on function public.merge_legacy_device_identity(varchar, varchar) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9) admin_merge_alliance_members：盟主侧把「失联成员的旧身份」并入「在用身份」，
--    用于清理已在库里的重复设备身份；只加授权前置，搬运逻辑仍只在 merge_alliance_identity。
-- ---------------------------------------------------------------------------
create or replace function public.admin_merge_alliance_members(
  p_owner_player_id varchar(100),
  p_alliance_id bigint,
  p_from varchar(100),
  p_to varchar(100)
)
returns table (merged boolean, from_alliance_id bigint, to_alliance_id bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_real_owner varchar(100);
  v_from_in bigint;
  v_to_in bigint;
begin
  if coalesce(p_owner_player_id, '') = '' then raise exception '操作者身份为空'; end if;
  if p_alliance_id is null or p_alliance_id <= 0 then raise exception '联盟 ID 无效'; end if;
  if coalesce(p_from, '') = '' or coalesce(p_to, '') = '' then raise exception '身份为空'; end if;
  if p_from = p_to then raise exception '不能把身份并入自身'; end if;

  -- ⚠️ 一律 coalesce 标量子查询，禁止裸 SELECT INTO
  v_real_owner := coalesce((select owner_player_id from public.alliances where id = p_alliance_id), '');
  if v_real_owner = '' then raise exception '联盟不存在'; end if;
  if v_real_owner <> p_owner_player_id then raise exception '只有盟主可以合并成员身份'; end if;

  v_from_in := coalesce((select alliance_id from public.alliance_members where player_id = p_from limit 1), null);
  v_to_in := coalesce((select alliance_id from public.alliance_members where player_id = p_to limit 1), null);

  if v_to_in is null or v_to_in <> p_alliance_id then raise exception '保留的身份不是本联盟成员'; end if;
  if v_from_in is not null and v_from_in <> p_alliance_id then raise exception '被合并的身份不属于本联盟'; end if;

  return query select * from public.merge_alliance_identity(p_from, p_to);
end;
$$;

revoke all on function public.admin_merge_alliance_members(varchar, bigint, varchar, varchar) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10) 表级权限收口
--     两张表已 enable row level security 且不建任何策略 ⇒ 非属主读不到任何行；
--     但 ACL 层面 CloudBase 的 ALTER DEFAULT PRIVILEGES 仍可能给 anon/authenticated
--     留下 SELECT/INSERT 等显式授权，故必须显式 revoke（只走 security definer 函数访问）。
-- ---------------------------------------------------------------------------
revoke all on table public.alliance_identity_secrets from public, anon, authenticated;
revoke all on table public.alliance_identity_handoffs from public, anon, authenticated;
