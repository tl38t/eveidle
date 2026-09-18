"use strict";

/*
 * 联盟身份云函数：设备密钥登记 / 身份转移码 / 身份合并。
 *
 * 背景：联盟 player_id 对无平台身份的环境是设备级 local_xxx，换设备即多一条成员记录。
 * 本函数是「身份自证 + 转移码认领 + 身份归并」的唯一入口，敏感 RPC 全部只对
 * service role 开放（DB 侧已 revoke all from public），anon 无法直接调用。
 *
 * 授权模型：
 *   * local_ / dev_ 设备身份 → 由设备密钥自证（DB 侧还会校验派生关系，防止抢注）
 *   * taptap_ / steam / SteamID64 平台身份 → 由 x-alliance-session 会话令牌自证
 *   * 盟主合并成员 → 由会话令牌 + DB 侧盟主校验双重把关
 */

const crypto = require("crypto");

const API_BASE = String(process.env.CLOUDBASE_API_BASE || "").replace(/\/$/, "");
const SERVER_API_KEY = process.env.CLOUDBASE_SERVER_API_KEY || "";
const SESSION_SECRET = process.env.ALLIANCE_SESSION_SECRET || "";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const DEFAULT_TTL_SECONDS = 900;

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

// 与 alliance-admin 完全同源：HMAC-SHA256 验签 sessionToken，取 sub 作为平台身份。
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

// Steam ID 为纯数字，TapTap openid 解码后可能含 / 与 =。只做长度与控制字符约束。
function validId(value) {
  return typeof value === "string" && value.length >= 1 && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value);
}

function isDeviceId(value) {
  return /^local_/.test(String(value)) || /^dev_/.test(String(value));
}

function validSecret(value) {
  return typeof value === "string" && /^[0-9a-f]{32,64}$/.test(value);
}

function validCode(value) {
  return typeof value === "string" && /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/.test(value);
}

async function db(path, options) {
  if (!API_BASE || !SERVER_API_KEY) throw new Error("身份服务数据库配置缺失");
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
    console.error("alliance-identity database rejected", { status: response.status, detail: detail || "unknown" });
    // 把 DB 的中文业务错误直接透出，前端 friendlyAllianceError 会原样展示
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

// 登记设备密钥。设备身份自证即可；平台身份必须由会话令牌证明「这个 id 是我的」。
async function register(body, sessionPlayer) {
  if (!validId(body.playerId)) throw new Error("玩家身份无效");
  if (!validSecret(body.secret)) throw new Error("设备密钥格式无效");
  if (!isDeviceId(body.playerId) && sessionPlayer !== body.playerId) {
    throw new Error("平台身份需要先完成账号登录");
  }
  const rows = await rpc("register_device_secret", { p_player_id: body.playerId, p_secret: body.secret });
  return { registered: firstRow(rows) !== false };
}

async function createCode(body) {
  if (!validId(body.playerId)) throw new Error("玩家身份无效");
  if (!validSecret(body.secret)) throw new Error("设备密钥格式无效");
  const ttl = Number(body.ttlSeconds);
  const rows = await rpc("create_identity_handoff", {
    p_player_id: body.playerId,
    p_secret: body.secret,
    p_ttl_seconds: Number.isFinite(ttl) && ttl > 0 ? Math.min(Math.floor(ttl), 86400) : DEFAULT_TTL_SECONDS
  });
  const row = firstRow(rows);
  if (!row || !row.code) throw new Error("转移码签发失败");
  return { code: row.code, expiresAt: row.expires_at };
}

async function redeemCode(body) {
  if (!validId(body.playerId)) throw new Error("玩家身份无效");
  if (!validSecret(body.secret)) throw new Error("设备密钥格式无效");
  if (!validCode(String(body.code || "").toUpperCase())) throw new Error("转移码格式不正确");
  // 新设备的身份往往刚生成、还没登记密钥；先补登记（已登记不同密钥时会被后续校验拦下）
  await rpc("register_device_secret", { p_player_id: body.playerId, p_secret: body.secret });
  const rows = await rpc("redeem_identity_handoff", {
    p_code: String(body.code).toUpperCase(),
    p_from_player_id: body.playerId,
    p_from_secret: body.secret
  });
  const row = firstRow(rows);
  if (!row || !row.keeper_player_id) throw new Error("转移码兑换失败");
  return { keeperPlayerId: row.keeper_player_id, merged: row.merged !== false };
}

// A 路线：平台身份晚于 local_ 就绪时，把设备身份并入平台身份，而不是把设备身份丢掉。
async function mergeLocal(body, sessionPlayer) {
  if (!validId(body.devicePlayerId) || !validId(body.platformPlayerId)) throw new Error("玩家身份无效");
  if (!validSecret(body.secret)) throw new Error("设备密钥格式无效");
  if (sessionPlayer !== body.platformPlayerId) throw new Error("平台身份校验失败，请重新登录");
  // 设备身份必须先登记密钥，才允许被并入（防他人拿设备 id 抢身份）
  await rpc("register_device_secret", { p_player_id: body.devicePlayerId, p_secret: body.secret });
  const rows = await rpc("merge_legacy_device_identity", {
    p_device_player_id: body.devicePlayerId,
    p_platform_player_id: body.platformPlayerId
  });
  return { merged: firstRow(rows) !== false };
}

async function adminMerge(body, sessionPlayer) {
  const allianceId = Number(body.allianceId);
  if (!Number.isSafeInteger(allianceId) || allianceId <= 0) throw new Error("联盟 ID 无效");
  if (!validId(body.fromPlayerId) || !validId(body.toPlayerId)) throw new Error("玩家身份无效");
  if (!sessionPlayer) throw new Error("需要盟主登录状态");
  const rows = await rpc("admin_merge_alliance_members", {
    p_owner_player_id: sessionPlayer,
    p_alliance_id: allianceId,
    p_from: body.fromPlayerId,
    p_to: body.toPlayerId
  });
  return { merged: firstRow(rows) !== false };
}

exports.main = async function main(event) {
  const method = String(event && (event.httpMethod || event.requestContext && event.requestContext.http && event.requestContext.http.method) || "POST").toUpperCase();
  if (method === "OPTIONS") return reply(204, {});
  if (method !== "POST") return reply(405, { ok: false, error: "method_not_allowed" });
  try {
    const body = bodyOf(event);
    const sessionPlayer = playerFromSession(event);
    if (body.action === "health") return reply(200, { ok: true, service: "alliance-identity" });
    if (body.action === "register") return reply(200, { ok: true, action: "register", ...(await register(body, sessionPlayer)) });
    if (body.action === "create_code") return reply(200, { ok: true, action: "create_code", ...(await createCode(body)) });
    if (body.action === "redeem_code") return reply(200, { ok: true, action: "redeem_code", ...(await redeemCode(body)) });
    if (body.action === "merge_local") return reply(200, { ok: true, action: "merge_local", ...(await mergeLocal(body, sessionPlayer)) });
    if (body.action === "admin_merge") return reply(200, { ok: true, action: "admin_merge", ...(await adminMerge(body, sessionPlayer)) });
    return reply(400, { ok: false, error: "unknown_identity_action" });
  } catch (error) {
    console.error("alliance-identity", error);
    return reply(400, { ok: false, error: error.message || "identity_action_failed" });
  }
};
