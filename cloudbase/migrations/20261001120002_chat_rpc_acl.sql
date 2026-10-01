-- ============================================================================
-- chat_* RPC 执行权限收口（2026-10-01，紧随 20261001120001_chat_schema_acl）
--
-- 背景（真实缺陷）：chat-schema.sql 起草时照 alliance-membership-actions.sql 惯例
--   写了 grant execute ... to anon, authenticated。但聊天前端**从不直连 PostgREST**
--   （js/platform/chat-api.js 只有一个入口，全部经 chat-service 云函数），
--   因此该授权纯属多余，且打开了「冒名调用」面：
--     实测 role=anon 直接调用
--       select * from public.chat_send_message('alliance:N','<受害者 player_id>','x')
--     返回业务错误「频道无效」(P0001) 而非权限拒绝 ⇒ EXECUTE 确实放开。
--     把频道参数换成真实频道、player_id 换成真实成员，即可绕过云函数
--     会话校验（HMAC）冒充该成员发言 / 读取公会频道。
--
-- 处置：全部收回 anon / authenticated 的 EXECUTE，聊天 DB 层只认 service_role
--   （云函数用 CLOUDBASE_SERVER_API_KEY）。SECURITY DEFINER 保持不变，
--   函数内部的成员 / 禁言 / 冷却校验照常生效。
--   实测 role=service_role 可正常执行（收到业务错误「频道无效」= 有权限且守卫先触发），
--   故不影响云函数链路。
--
-- 幂等：重复执行安全。
-- ============================================================================

revoke all on function public.chat_alliance_id_of(varchar) from public, anon, authenticated;
revoke all on function public.chat_is_muted(varchar, varchar) from public, anon, authenticated;
revoke all on function public.chat_send_message(varchar, varchar, varchar) from public, anon, authenticated;
revoke all on function public.chat_list_messages(varchar, varchar, bigint, integer) from public, anon, authenticated;
revoke all on function public.chat_create_report(varchar, varchar, varchar, varchar, varchar) from public, anon, authenticated;
revoke all on function public.chat_admin_list_reports(varchar, varchar, integer) from public, anon, authenticated;
revoke all on function public.chat_admin_handle_report(varchar, bigint, varchar, varchar, integer, varchar) from public, anon, authenticated;

grant execute on function public.chat_alliance_id_of(varchar) to service_role;
grant execute on function public.chat_is_muted(varchar, varchar) to service_role;
grant execute on function public.chat_send_message(varchar, varchar, varchar) to service_role;
grant execute on function public.chat_list_messages(varchar, varchar, bigint, integer) to service_role;
grant execute on function public.chat_create_report(varchar, varchar, varchar, varchar, varchar) to service_role;
grant execute on function public.chat_admin_list_reports(varchar, varchar, integer) to service_role;
grant execute on function public.chat_admin_handle_report(varchar, bigint, varchar, varchar, integer, varchar) to service_role;
