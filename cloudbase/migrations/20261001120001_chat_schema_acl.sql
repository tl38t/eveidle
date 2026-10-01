-- ============================================================================
-- chat_* 敏感表访问控制收口（2026-10-01，紧随 20261001120000_chat_schema）
--
-- 背景（真实缺陷，非设计）：CloudBase 对 public schema 配了
--   ALTER DEFAULT PRIVILEGES，新建表会自动带上
--     anon=r                 （SELECT）
--     authenticated=arwdDxtm （全 DML + TRUNCATE）
--   实测取证（role=anon 直查）：
--     select count(*) from public.chat_messages  -> 成功返回
--   ⇒ 发布密钥（匿名、随前端分发）可绕过 chat-service 云函数，
--     直连 PostgREST 读走全部公会聊天记录，成员身份校验形同虚设。
--   chat-schema.sql 注释里承诺的「chat_* 表不 grant 给 anon」当时并未成立。
--
-- 处置：照项目既有惯例（alliance-identity-merge.sql:495-496 对
--   alliance_identity_secrets / _handoffs 的写法）显式 revoke。
--   云函数以 CLOUDBASE_SERVER_API_KEY（service_role）连库，不受影响；
--   anon / authenticated 一律收回（前端不直连 chat 表，只经云函数）。
--
-- 幂等：重复执行安全（revoke 重复执行无副作用）。
-- ============================================================================

revoke all on table public.chat_messages from public, anon, authenticated;
revoke all on table public.chat_reports  from public, anon, authenticated;
revoke all on table public.chat_mutes    from public, anon, authenticated;

revoke all on sequence public.chat_messages_id_seq from public, anon, authenticated;
revoke all on sequence public.chat_reports_id_seq  from public, anon, authenticated;
revoke all on sequence public.chat_mutes_id_seq    from public, anon, authenticated;
