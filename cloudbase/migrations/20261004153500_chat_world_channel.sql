-- =============================================================================
-- 世界频道（world）支持 —— 2026-10-04
--
-- 背景：chat_alliance_id_of() 只识别 '^alliance:[0-9]+$'，对 'world' 返回 null。
--       而 chat_send_message / chat_list_messages 在**成员校验之前**就用这个 null
--       raise '频道无效' ⇒ 世界频道在数据库层完全不可用。
--
-- 口径（已拍板）：
--   * 仅 Steam 端开放（前端门控，云函数对 taptap 也接受 world —— 平台收口在前端）；
--   * 审核后置：敏感词预过滤（云函数 chat-send）+ 举报留底（chat_reports）
--     + 全局禁言（chat_mutes.scope='global' 对 world 天然生效）；
--   * 不做处置面板 ⇒ chat_admin_handle_report 对 world 消息保持 raise
--     （它依赖 chat_alliance_id_of 返回 null 来拒绝盟主处置，正合需要)。
--
-- 🔴 铁律：不修改已部署的 chat-schema.sql 正文（与远端 checksum 绑定，且其权限段
--    与线上已分叉 —— 线上 chat_* 只授权 service_role）。
--    本迁移用 create or replace 重建函数（签名不变），并显式把 execute 收回到
--    service_role，与线上现状对齐，详见第 4 节。
-- =============================================================================


-- ---------------------------------------------------------------------
-- 1. 频道合法性判定（新增）
--    ⚠️ chat_alliance_id_of **刻意不改**：它的语义是「取联盟 id」，
--       world 没有联盟，必须让它继续返回 null —— chat_admin_handle_report
--       （chat-schema.sql:310-315）正靠这个 null 拒绝盟主处置世界频道举报。
--       改它会让世界频道举报被误当作公会举报处置。
-- ---------------------------------------------------------------------

create or replace function public.chat_is_valid_channel(p_channel varchar)
returns boolean
language plpgsql
immutable
as $$
begin
  if p_channel = 'world' then
    return true;
  end if;
  return p_channel is not null and p_channel ~ '^alliance:[0-9]+$';
end;
$$;

comment on function public.chat_is_valid_channel(varchar) is
  '聊天频道合法性：world（世界频道，公开）或 alliance:<id>（联盟频道，成员制）';


-- ---------------------------------------------------------------------
-- 2. 发送：world 跳过联盟成员校验；禁言 / 字数 / 2s 冷却 / 落库全部沿用
-- ---------------------------------------------------------------------

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
  v_is_world    boolean := (p_channel = 'world');
  v_text        varchar := btrim(coalesce(p_content, ''));
begin
  if not public.chat_is_valid_channel(p_channel) then
    raise exception '频道无效';
  end if;

  -- 联盟频道：必须是本联盟在册成员（读 alliance_members，成员退出即失去发言权）。
  -- 世界频道：无联盟归属，任何已鉴权玩家均可发言（仅受禁言/冷却/词库约束）。
  if not v_is_world then
    if not exists (select 1 from public.alliance_members m
                    where m.alliance_id = v_alliance_id and m.player_id = p_sender) then
      raise exception '只有联盟成员才能在联盟频道发言';
    end if;
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


-- ---------------------------------------------------------------------
-- 3. 拉取：world 跳过成员校验；游标分页逻辑不变
-- ---------------------------------------------------------------------

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
  v_is_world    boolean := (p_channel = 'world');
  v_limit       integer := greatest(1, least(coalesce(p_limit, 30), 50));
begin
  if not public.chat_is_valid_channel(p_channel) then
    raise exception '频道无效';
  end if;

  -- 联盟频道读取同样要求成员身份：非成员不能窥视公会频道。
  -- 世界频道公开可读（这正是它的定位：全服可读）。
  if not v_is_world then
    if not exists (select 1 from public.alliance_members m
                    where m.alliance_id = v_alliance_id and m.player_id = p_player) then
      raise exception '只有联盟成员才能读取联盟频道';
    end if;
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


-- ---------------------------------------------------------------------
-- 4. 执行权限
--
-- 🔴 线上实测（2026-10-04）：chat_* 全部对象线上 `proacl` **只有 service_role + owner**，
--   `anon` / `authenticated` 已被剔除——前端一律走 `chat-service` 云函数，不直连 PostgREST。
--   ⚠️ 因此**照抄 `chat-schema.sql:358-360` 的 `grant ... to anon, authenticated`
--   会把线上已收口的权限重新打开**（安全回退，且 chat_send_message 收 p_sender 参数
--   ⇒ 放开 anon 等于允许冒名代发消息）。本迁移只保留 service_role，与线上现状一致。
--   （chat-schema.sql 正文是初始版本，与线上已分叉；此处刻意不与它对齐。）
-- ---------------------------------------------------------------------

revoke all on function public.chat_is_valid_channel(varchar) from public, anon, authenticated;
grant  execute on function public.chat_is_valid_channel(varchar) to service_role;

revoke all on function public.chat_send_message(varchar, varchar, varchar) from public, anon, authenticated;
grant  execute on function public.chat_send_message(varchar, varchar, varchar) to service_role;

revoke all on function public.chat_list_messages(varchar, varchar, bigint, integer) from public, anon, authenticated;
grant  execute on function public.chat_list_messages(varchar, varchar, bigint, integer) to service_role;


-- ---------------------------------------------------------------------
-- 5. 索引：**无需新建**
--    线上已有 `idx_chat_messages_channel_id ON chat_messages (channel, id DESC)`
--    （2026-10-04 只读取证确认），正好覆盖 list 的 channel 过滤 + 倒序分页，
--    以及 2s 冷却判定的 (sender_uid, channel) 前缀用法。不重复建。
-- ---------------------------------------------------------------------
