-- =====================================================================
-- 聊天系统 schema（CHAT_SYSTEM_SPEC.md v0.2 §2/§12 配套）
-- 范围：仅 Steam 端 MVP，仅公会频道（channel = 'alliance:<allianceId>'）。
-- 幂等：全部 IF NOT EXISTS / CREATE OR REPLACE，重复执行安全。
--
-- ⚠️ 本文件 = 迁移 20261001120000_chat_schema 的**已上线原始内容**，请勿改动正文：
--    内容一经 applyMigration 即与远端 history 的 checksum 绑定，
--    改动会让「仓库文件」与「远端历史」分叉（LOCAL_MIGRATION_FILE_MISMATCH）。
--
-- 🔴 下方「鉴权分层」第 3、4 条（已就地标注 ❌）**在当时并不成立 / 事后被推翻**：
--    CloudBase 对 public schema 配了 ALTER DEFAULT PRIVILEGES，
--    新建对象会自动带上 anon / authenticated 授权。
--    实际访问控制由两个后续迁移收口（全新环境按版本顺序应用即得正确终态）：
--      20261001120001_chat_schema_acl —— chat_messages/chat_reports/chat_mutes
--                                       + 三个 bigserial 序列：revoke anon/authenticated
--      20261001120002_chat_rpc_acl    —— 7 个 chat_* 函数：revoke anon/authenticated，
--                                       仅保留 service_role（云函数用 CLOUDBASE_SERVER_API_KEY）
--    证据与取证方式记于 CHAT_SYSTEM_SPEC.md §12.7。
-- =====================================================================
--
-- 鉴权分层：
--   * 云函数 chat-service 负责 x-alliance-session 会话校验（HMAC，同 alliance-identity）
--   * 本文件 RPC 一律 SECURITY DEFINER，负责数据正确性（成员/禁言/冷却/长度）
--   * ❌ 无效承诺（CloudBase 默认权限自动放行，已由 20261001120001 收口）：
--     chat_* 表不 grant 给 anon/authenticated：发布密钥（anon）无法绕过云函数直读直写
--   * ❌ 已被推翻（聊天前端从不直连 PostgREST，已由 20261001120002 只留 service_role）：
--     RPC 照 alliance-membership-actions.sql 模式 revoke public + grant anon,authenticated
--     （云函数用 SERVER_API_KEY 以高权限角色连接，执行 RPC 不受影响，与现有联盟 RPC 一致）
--
-- 屏蔽（chat_blocks）按定稿为客户端本地 localStorage 实现，本文件不含该表。
-- =====================================================================

-- ---------------------------------------------------------------- -----
-- 1. 表
-- ---------------------------------------------------------------- -----

create table if not exists public.chat_messages (
  id          bigserial primary key,
  channel     varchar(120) not null,              -- 目前仅 'alliance:<id>'
  sender_uid  varchar(100) not null,
  sender_name varchar(64)  not null,              -- 服务端从 players.username 解析，防伪造
  content     varchar(280) not null,
  created_at  timestamptz  not null default now(),
  deleted     boolean      not null default false  -- 审核软删，前端不渲染
);
create index if not exists idx_chat_messages_channel_id on public.chat_messages(channel, id desc);

create table if not exists public.chat_reports (
  id           bigserial primary key,
  reporter_uid varchar(100) not null,
  target_type  varchar(20)  not null default 'message',  -- MVP 仅 'message'
  target_id    varchar(100) not null,                    -- 被举报消息 id
  reason       varchar(20)  not null,                    -- spam | harass | hate | other
  detail       varchar(200),
  status       varchar(20)  not null default 'pending',  -- pending|reviewed|actioned|dismissed
  handled_by   varchar(100),
  handled_at   timestamptz,
  created_at   timestamptz  not null default now()
);
create index if not exists idx_chat_reports_status on public.chat_reports(status);
create index if not exists idx_chat_reports_target on public.chat_reports(target_type, target_id);

create table if not exists public.chat_mutes (
  id          bigserial primary key,
  target_uid  varchar(100) not null,
  scope       varchar(120) not null default 'global',   -- 'global' | 具体频道
  reason      varchar(200),
  expires_at  timestamptz,                              -- NULL = 永久
  by_admin    varchar(100),
  created_at  timestamptz  not null default now()
);
create index if not exists idx_chat_mutes_target on public.chat_mutes(target_uid, scope);

-- ---------------------------------------------------------------- -----
-- 2. 辅助函数
-- ---------------------------------------------------------------- -----

-- 'alliance:42' -> 42；其他格式一律 null（MVP 只认公会频道）
create or replace function public.chat_alliance_id_of(p_channel varchar)
returns bigint
language plpgsql
immutable
as $$
begin
  if p_channel is null or p_channel !~ '^alliance:[0-9]+$' then
    return null;
  end if;
  return substring(p_channel from 10)::bigint;
end;
$$;

-- 禁言判定：global 或精确频道命中即禁言；expires_at 为空表示永久
create or replace function public.chat_is_muted(p_uid varchar, p_channel varchar)
returns boolean
language plpgsql
stable
as $$
begin
  return exists (
    select 1 from public.chat_mutes m
     where m.target_uid = p_uid
       and (m.scope = 'global' or m.scope = p_channel)
       and (m.expires_at is null or m.expires_at > now())
  );
end;
$$;

-- ---------------------------------------------------------------- -----
-- 3. RPC：发送
-- ---------------------------------------------------------------- -----

create or replace function public.chat_send_message(
  p_channel varchar,
  p_sender  varchar,
  p_content varchar
)
returns table (id bigint, sender_uid varchar, sender_name varchar, content varchar, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alliance_id bigint := public.chat_alliance_id_of(p_channel);
  v_text        varchar := btrim(coalesce(p_content, ''));
begin
  if v_alliance_id is null then
    raise exception '频道无效';
  end if;
  -- 必须是本联盟在册成员（读 alliance_members，成员退出即失去发言权）
  if not exists (select 1 from public.alliance_members m
                  where m.alliance_id = v_alliance_id and m.player_id = p_sender) then
    raise exception '只有联盟成员才能在联盟频道发言';
  end if;
  if public.chat_is_muted(p_sender, p_channel) then
    raise exception '你已被禁言';
  end if;
  if v_text = '' or char_length(v_text) > 280 then
    raise exception '消息内容无效（1~280 字）';
  end if;
  -- 同频道同发送者 2 秒冷却：挡手滑双发 + 基础刷屏
  if exists (select 1 from public.chat_messages c
              where c.sender_uid = p_sender and c.channel = p_channel
                and c.created_at > now() - interval '2 seconds') then
    raise exception '发送太快，请稍候';
  end if;

  return query
    insert into public.chat_messages(channel, sender_uid, sender_name, content)
    values (p_channel, p_sender,
            coalesce((select p.username from public.players p
                       where p.player_id = p_sender limit 1), '指挥官'),
            v_text)
    returning chat_messages.id,
              chat_messages.sender_uid,
              chat_messages.sender_name,
              chat_messages.content,
              chat_messages.created_at;
end;
$$;

-- ---------------------------------------------------------------- -----
-- 4. RPC：拉取（游标分页：id 严格小于 before_id，倒序取，客户端自行正序渲染）
-- ---------------------------------------------------------------- -----

create or replace function public.chat_list_messages(
  p_channel   varchar,
  p_player    varchar,
  p_before_id bigint default null,
  p_limit     integer default 30
)
returns table (id bigint, sender_uid varchar, sender_name varchar, content varchar, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alliance_id bigint := public.chat_alliance_id_of(p_channel);
  v_limit       integer := greatest(1, least(coalesce(p_limit, 30), 50));
begin
  if v_alliance_id is null then
    raise exception '频道无效';
  end if;
  -- 读取同样要求成员身份：非成员不能窥视公会频道
  if not exists (select 1 from public.alliance_members m
                  where m.alliance_id = v_alliance_id and m.player_id = p_player) then
    raise exception '只有联盟成员才能读取联盟频道';
  end if;

  return query
    select c.id, c.sender_uid, c.sender_name, c.content, c.created_at
      from public.chat_messages c
     where c.channel = p_channel
       and c.deleted = false
       and (p_before_id is null or c.id < p_before_id)
     order by c.id desc
     limit v_limit;
end;
$$;

-- ---------------------------------------------------------------- -----
-- 5. RPC：举报（MVP 仅支持举报消息；对玩家整体举报二期随私聊一起评估）
-- ---------------------------------------------------------------- -----

create or replace function public.chat_create_report(
  p_reporter    varchar,
  p_target_type varchar,
  p_target_id   varchar,
  p_reason      varchar,
  p_detail      varchar
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_target_type is distinct from 'message' then
    raise exception '当前仅支持举报消息';
  end if;
  if p_target_id !~ '^[0-9]+$' then
    raise exception '被举报消息无效';
  end if;
  if p_reason not in ('spam', 'harass', 'hate', 'other') then
    raise exception '举报原因无效';
  end if;
  if not exists (select 1 from public.chat_messages m where m.id = p_target_id::bigint) then
    raise exception '被举报消息不存在';
  end if;

  insert into public.chat_reports(reporter_uid, target_type, target_id, reason, detail)
  values (p_reporter, 'message', p_target_id, p_reason, left(coalesce(p_detail, ''), 200));
  return true;
end;
$$;

-- ---------------------------------------------------------------- -----
-- 6. RPC：管理员侧（处置权限 = 被举报消息所在联盟的盟主，DB 侧校验）
-- ---------------------------------------------------------------- -----

create or replace function public.chat_admin_list_reports(
  p_admin  varchar,
  p_status varchar default 'pending',
  p_limit  integer default 50
)
returns table (report_id  bigint,
               status     varchar,
               reason     varchar,
               detail     varchar,
               reporter_uid varchar,
               message_id bigint,
               channel    varchar,
               sender_uid varchar,
               sender_name varchar,
               content    varchar,
               reported_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    select r.id,
           r.status,
           r.reason,
           r.detail,
           r.reporter_uid,
           m.id,
           m.channel,
           m.sender_uid,
           m.sender_name,
           m.content,
           r.created_at
      from public.chat_reports r
      join public.chat_messages m on m.id = r.target_id::bigint
     where r.target_type = 'message'
       and r.status = coalesce(nullif(btrim(coalesce(p_status, '')), ''), 'pending')
       and exists (select 1 from public.alliances a
                    where a.id = public.chat_alliance_id_of(m.channel)
                      and a.owner_player_id = p_admin)
     order by r.id desc
     limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

create or replace function public.chat_admin_handle_report(
  p_admin       varchar,
  p_report_id   bigint,
  p_action      varchar,               -- 'dismiss' | 'delete_msg' | 'mute'
  p_mute_scope  varchar default null,  -- 'global' | 'channel'（仅 mute 用）
  p_mute_hours  integer default null,  -- null/<=0 = 永久（仅 mute 用）
  p_mute_reason varchar default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg              public.chat_messages%rowtype;
  v_channel_alliance bigint;
begin
  select m.* into v_msg
    from public.chat_messages m
    join public.chat_reports r on r.target_id::bigint = m.id
   where r.id = p_report_id and r.target_type = 'message';
  if v_msg.id is null then
    raise exception '举报或被举报消息不存在';
  end if;

  v_channel_alliance := public.chat_alliance_id_of(v_msg.channel);
  if v_channel_alliance is null or not exists (
       select 1 from public.alliances a
        where a.id = v_channel_alliance and a.owner_player_id = p_admin) then
    raise exception '只有联盟盟主可以处置本联盟的举报';
  end if;

  if p_action = 'dismiss' then
    update public.chat_reports
       set status = 'dismissed', handled_by = p_admin, handled_at = now()
     where id = p_report_id;
  elsif p_action = 'delete_msg' then
    update public.chat_messages set deleted = true where id = v_msg.id;
    update public.chat_reports
       set status = 'actioned', handled_by = p_admin, handled_at = now()
     where id = p_report_id;
  elsif p_action = 'mute' then
    insert into public.chat_mutes(target_uid, scope, reason, expires_at, by_admin)
    values (v_msg.sender_uid,
            case when p_mute_scope = 'global' then 'global' else v_msg.channel end,
            left(coalesce(p_mute_reason, '违反联盟聊天规范'), 200),
            case when coalesce(p_mute_hours, 0) > 0
                 then now() + make_interval(hours => p_mute_hours)
                 else null end,
            p_admin);
    update public.chat_reports
       set status = 'actioned', handled_by = p_admin, handled_at = now()
     where id = p_report_id;
  else
    raise exception '未知处置动作';
  end if;
  return true;
end;
$$;

-- ---------------------------------------------------------------- -----
-- 7. 执行权限（照 alliance-membership-actions.sql 模式：
--    revoke public 后 grant anon/authenticated，云函数以高权限角色调用不受影响）
-- ---------------------------------------------------------------------

revoke all on function public.chat_alliance_id_of(varchar) from public;
revoke all on function public.chat_is_muted(varchar, varchar) from public;
revoke all on function public.chat_send_message(varchar, varchar, varchar) from public;
revoke all on function public.chat_list_messages(varchar, varchar, bigint, integer) from public;
revoke all on function public.chat_create_report(varchar, varchar, varchar, varchar, varchar) from public;
revoke all on function public.chat_admin_list_reports(varchar, varchar, integer) from public;
revoke all on function public.chat_admin_handle_report(varchar, bigint, varchar, varchar, integer, varchar) from public;

grant execute on function public.chat_alliance_id_of(varchar) to anon, authenticated;
grant execute on function public.chat_is_muted(varchar, varchar) to anon, authenticated;
grant execute on function public.chat_send_message(varchar, varchar, varchar) to anon, authenticated;
grant execute on function public.chat_list_messages(varchar, varchar, bigint, integer) to anon, authenticated;
grant execute on function public.chat_create_report(varchar, varchar, varchar, varchar, varchar) to anon, authenticated;
grant execute on function public.chat_admin_list_reports(varchar, varchar, integer) to anon, authenticated;
grant execute on function public.chat_admin_handle_report(varchar, bigint, varchar, varchar, integer, varchar) to anon, authenticated;
