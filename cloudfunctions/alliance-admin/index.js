"use strict";

const crypto = require("crypto");
const API_BASE = String(process.env.CLOUDBASE_API_BASE || "").replace(/\/$/, "");
const SERVER_API_KEY = process.env.CLOUDBASE_SERVER_API_KEY || "";
const SESSION_SECRET = process.env.ALLIANCE_SESSION_SECRET || "";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

function reply(statusCode, body) {
  return { statusCode, headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": ALLOWED_ORIGIN, "access-control-allow-headers": "content-type, x-alliance-session", "access-control-allow-methods": "POST, OPTIONS" }, body: JSON.stringify(body) };
}
function bodyOf(event) { if (!event || event.body == null) return {}; if (typeof event.body === "object") return event.body; try { return JSON.parse(event.body); } catch (_) { return {}; } }
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
    return payload.platform === "steam" && payload.sub && Number(payload.exp) > Math.floor(Date.now() / 1000) ? String(payload.sub) : "";
  } catch (_) { return ""; }
}
function validId(value) { return typeof value === "string" && /^[A-Za-z0-9_.-]{1,100}$/.test(value); }
async function db(path, options) {
  if (!API_BASE || !SERVER_API_KEY) throw new Error("admin function database configuration missing");
  const response = await fetch(API_BASE + path, { ...options, headers: { "content-type": "application/json", Authorization: "Bearer " + SERVER_API_KEY, ...(options && options.headers || {}) } });
  const text = await response.text(); let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { raw: text }; }
  if (!response.ok) throw new Error("database request failed: HTTP " + response.status);
  return data;
}
exports.main = async function main(event) {
  const method = String(event && (event.httpMethod || event.requestContext && event.requestContext.http && event.requestContext.http.method) || "POST").toUpperCase();
  if (method === "OPTIONS") return reply(204, {});
  if (method !== "POST") return reply(405, { ok: false, error: "method_not_allowed" });
  try {
    const body = bodyOf(event);
    const owner = playerFromSession(event);
    if (!owner) return reply(401, { ok: false, error: "alliance_session_required" });
    const allianceId = Number(body.allianceId);
    if (!Number.isSafeInteger(allianceId) || allianceId <= 0 || !validId(body.targetPlayerId)) return reply(400, { ok: false, error: "invalid_admin_request" });
    const action = body.action === "kick_member" ? "kick_alliance_member" : body.action === "transfer_leader" ? "transfer_alliance_leader" : "";
    if (!action) return reply(400, { ok: false, error: "unknown_admin_action" });
    const rows = await db("/v1/rdb/rest/rpc/" + action, { method: "POST", body: JSON.stringify({ p_alliance_id: allianceId, p_owner_player_id: owner, p_target_player_id: body.targetPlayerId }) });
    return reply(200, { ok: true, action: body.action, result: Array.isArray(rows) ? rows[0] : rows });
  } catch (error) { console.error("alliance-admin", error); return reply(400, { ok: false, error: error.message || "admin_action_failed" }); }
};
