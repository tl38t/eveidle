"use strict";

/*
 * 聊天云函数（CHAT_SYSTEM_SPEC.md v0.2 §3 配套）。
 *
 * 职责：会话鉴权 + 入参校验 + 词库过滤 + 转发 DB RPC。
 *       数据正确性（成员/禁言/冷却）全部在 chat-schema.sql 的 SECURITY DEFINER RPC 里。
 *
 * 鉴权：与 alliance-identity 完全同源 —— HMAC-SHA256 验签 x-alliance-session，
 *       只认 steam/taptap 平台身份。聊天是 Steam 端专属功能（MVP），无会话一律拒绝。
 *
 * 动作：
 *   send          发消息（禁言/成员/冷却校验在 RPC 侧；词库过滤在本函数侧）
 *   list          拉历史（游标分页：before_id 倒序，客户端正序渲染）
 *   report        举报消息
 *   admin_reports 盟主拉举报列表（DB 侧校验盟主身份）
 *   admin_action  盟主处置：dismiss / delete_msg / mute
 */

const crypto = require("crypto");
const words = require("./banned-words");

const API_BASE = String(process.env.CLOUDBASE_API_BASE || "").replace(/\/$/, "");
const SERVER_API_KEY = process.env.CLOUDBASE_SERVER_API_KEY || "";
const SESSION_SECRET = process.env.ALLIANCE_SESSION_SECRET || "";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

const MAX_CONTENT = 280;
const DEFAULT_LIST_LIMIT = 30;

function reply(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": ALLOWED_ORIGIN,
      "access-control-allow-headers": "content-type, x-alliance-session",
      "access-control-allow-methods": "POST, OPTIONS"
    },
    body: JSON.stringify(body)
  };
}

function bodyOf(event) {
  if (!event || event.body == null) return {};
  if (typeof event.body === "object") return event.body;
  try { return JSON.parse(event.body); } catch (_) { return {}; }
}

// 与 alliance-identity 完全同源：HMAC-SHA256 验签 sessionToken，取 sub 作为平台身份。
function playerFromSession(event) {
  const headers = event && event.headers || {};
  const token = String(headers["x-alliance-session"] || headers["X-Alliance-Session"] || "");
  const parts = token.split(".");
  if (!SESSION_SECRET || parts.length !== 3 || parts[0] !== "v1") return "";
  try {
    const expected = Buffer.from(crypto.createHmac("sha256", SESSION_SECRET).update(parts[1]).digest("base64url"));
    const actual = Buffer.from(parts[2]);
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return "";
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return (payload.platform === "steam" || payload.platform === "taptap") && payload.sub && Number(payload.exp) > Math.floor(Date.now() / 1000) ? String(payload.sub) : "";
  } catch (_) { return ""; }
}

function validChannel(value) {
  // 世界频道（world）：公开匿名，Steam 首发。平台收口在前端 chat-api.js，此处不做平台判断。
  if (value === "world") return true;
  return typeof value === "string" && /^alliance:[0-9]+$/.test(value);
}

function validId(value) {
  return typeof value === "string" && value.length >= 1 && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value);
}

async function db(path, options) {
  if (!API_BASE || !SERVER_API_KEY) throw new Error("聊天服务数据库配置缺失");
  const response = await fetch(API_BASE + path, {
    ...options,
    headers: {
      "content-type": "application/json",
      Authorization: "Bearer " + SERVER_API_KEY,
      ...(options && options.headers || {})
    }
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { raw: text }; }
  if (!response.ok) {
    const detail = data && (data.message || data.error || data.code || data.details || data.hint);
    console.error("chat-service database rejected", { status: response.status, detail: detail || "unknown" });
    // DB 的中文业务错误直接透出，前端原样展示（同 alliance-identity 约定）
    const message = detail ? String(detail).replace(/^.*?(?:ERROR|error)\s*:\s*/i, "") : "";
    throw new Error(message || "数据库请求失败：HTTP " + response.status);
  }
  return data;
}

function rpc(name, body) {
  return db("/v1/rdb/rest/rpc/" + name, { method: "POST", body: JSON.stringify(body) });
}

function firstRow(rows) {
  return Array.isArray(rows) ? (rows[0] || null) : (rows || null);
}

// ---------------------------------------------------------------- 动作 ----

async function actionSend(body, player) {
  if (!validChannel(body.channel)) throw new Error("频道无效");
  const raw = String(body.content == null ? "" : body.content).trim();
  if (!raw) throw new Error("消息不能为空");
  if (raw.length > MAX_CONTENT) throw new Error("消息过长（最多 " + MAX_CONTENT + " 字）");
  const filtered = words.apply(raw);
  if (filtered.blocked) throw new Error("消息包含不允许发布的内容");
  const masked = filtered.masked.trim();
  if (!masked) throw new Error("消息不能为空");
  const rows = await rpc("chat_send_message", {
    p_channel: body.channel,
    p_sender: player,
    p_content: masked
  });
  return { message: firstRow(rows) };
}

async function actionList(body, player) {
  if (!validChannel(body.channel)) throw new Error("频道无效");
  const limit = Number(body.limit);
  const beforeId = Number(body.beforeId);
  const rows = await rpc("chat_list_messages", {
    p_channel: body.channel,
    p_player: player,
    p_before_id: Number.isSafeInteger(beforeId) && beforeId > 0 ? beforeId : null,
    p_limit: Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 50) : DEFAULT_LIST_LIMIT
  });
  return { messages: Array.isArray(rows) ? rows : [] };
}

async function actionReport(body, player) {
  if (!validId(String(body.targetId == null ? "" : body.targetId))) throw new Error("举报目标无效");
  const rows = await rpc("chat_create_report", {
    p_reporter: player,
    p_target_type: "message",
    p_target_id: String(body.targetId),
    p_reason: String(body.reason || "other"),
    p_detail: String(body.detail || "").slice(0, 200)
  });
  return { reported: firstRow(rows) !== false };
}

async function actionAdminReports(body, player) {
  const rows = await rpc("chat_admin_list_reports", {
    p_admin: player,
    p_status: String(body.status || "pending"),
    p_limit: Number.isSafeInteger(Number(body.limit)) && Number(body.limit) > 0 ? Number(body.limit) : 50
  });
  return { reports: Array.isArray(rows) ? rows : [] };
}

async function actionAdminAction(body, player) {
  const reportId = Number(body.reportId);
  if (!Number.isSafeInteger(reportId) || reportId <= 0) throw new Error("举报 ID 无效");
  if (["dismiss", "delete_msg", "mute"].indexOf(body.action) < 0) throw new Error("未知处置动作");
  const hours = Number(body.muteHours);
  const rows = await rpc("chat_admin_handle_report", {
    p_admin: player,
    p_report_id: reportId,
    p_action: body.action,
    p_mute_scope: body.action === "mute" ? (body.muteScope === "global" ? "global" : "channel") : null,
    p_mute_hours: body.action === "mute" && Number.isSafeInteger(hours) && hours > 0 ? hours : null,
    p_mute_reason: String(body.muteReason || "").slice(0, 200) || null
  });
  return { handled: firstRow(rows) !== false };
}

// ---------------------------------------------------------------- 入口 ----

exports.main = async function main(event) {
  const method = String(event && (event.httpMethod || event.requestContext && event.requestContext.http && event.requestContext.http.method) || "POST").toUpperCase();
  if (method === "OPTIONS") return reply(204, {});
  if (method !== "POST") return reply(405, { ok: false, error: "method_not_allowed" });
  try {
    const body = bodyOf(event);
    if (body.action === "health") return reply(200, { ok: true, service: "chat-service" });

    // 聊天是 Steam 端专属功能（MVP）：除 health 外所有动作必须持平台会话
    const player = playerFromSession(event);
    if (!player) return reply(401, { ok: false, error: "需要登录（平台会话缺失或已过期）" });

    if (body.action === "send") return reply(200, { ok: true, action: "send", ...(await actionSend(body, player)) });
    if (body.action === "list") return reply(200, { ok: true, action: "list", ...(await actionList(body, player)) });
    if (body.action === "report") return reply(200, { ok: true, action: "report", ...(await actionReport(body, player)) });
    if (body.action === "admin_reports") return reply(200, { ok: true, action: "admin_reports", ...(await actionAdminReports(body, player)) });
    if (body.action === "admin_action") return reply(200, { ok: true, action: "admin_action", ...(await actionAdminAction(body, player)) });
    return reply(400, { ok: false, error: "unknown_chat_action" });
  } catch (error) {
    console.error("chat-service", error);
    return reply(400, { ok: false, error: error.message || "chat_action_failed" });
  }
};
