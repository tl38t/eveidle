"use strict";

const crypto = require("crypto");

const APP_ID = 5193380;
const STEAM_IDENTITY = "deep-space-idle-alliance";
const STEAM_API_KEY = process.env.STEAM_PUBLISHER_API_KEY || "";
const SESSION_SECRET = process.env.ALLIANCE_SESSION_SECRET || "";
const SESSION_TTL_SECONDS = 60 * 60 * 24;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

function reply(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": ALLOWED_ORIGIN,
      "access-control-allow-headers": "content-type",
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

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function signSession(steamId) {
  const payload = { sub: steamId, platform: "steam", exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS };
  const encoded = base64url(JSON.stringify(payload));
  const signature = crypto.createHmac("sha256", SESSION_SECRET).update(encoded).digest("base64url");
  return `v1.${encoded}.${signature}`;
}

async function verifyTicket(ticketBase64) {
  if (!STEAM_API_KEY) throw new Error("Steam 验证服务未配置 API Key");
  if (typeof ticketBase64 !== "string" || !/^[A-Za-z0-9+/=_-]{16,4096}$/.test(ticketBase64)) {
    throw new Error("Steam 认证票据格式无效");
  }
  const ticketHex = Buffer.from(ticketBase64, "base64").toString("hex");
  const query = new URLSearchParams({
    key: STEAM_API_KEY,
    appid: String(APP_ID),
    ticket: ticketHex,
    identity: STEAM_IDENTITY
  });
  const response = await fetch("https://partner.steam-api.com/ISteamUserAuth/AuthenticateUserTicket/v1/?" + query);
  const responseText = await response.text();
  let data = {};
  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch (_) {
    data = {};
  }
  const steamId = data && data.response && data.response.params && data.response.params.steamid;
  if (!response.ok || !steamId) {
    console.error("Steam ticket verification rejected", {
      status: response.status,
      contentType: response.headers.get("content-type") || "",
      response: data && data.response ? data.response : { error: "invalid_response" }
    });
    if (!data || !data.response) {
      console.error("Steam ticket verification body", responseText.slice(0, 500));
    }
    const reason = data && data.response && (data.response.error || data.response.errorcode);
    throw new Error(reason ? "Steam 认证票据验证失败：" + reason : "Steam 认证票据验证失败");
  }
  return String(steamId);
}

exports.main = async function main(event) {
  const method = String(event && (event.httpMethod || event.requestContext && event.requestContext.http && event.requestContext.http.method) || "POST").toUpperCase();
  if (method === "OPTIONS") return reply(204, {});
  if (method !== "POST") return reply(405, { ok: false, error: "method_not_allowed" });
  try {
    if (!SESSION_SECRET) throw new Error("联盟会话服务未配置 SESSION_SECRET");
    const steamId = await verifyTicket(bodyOf(event).ticket);
    return reply(200, { ok: true, platform: "steam", steamId, expiresIn: SESSION_TTL_SECONDS, sessionToken: signSession(steamId) });
  } catch (error) {
    return reply(401, { ok: false, error: error.message || "Steam 身份验证失败" });
  }
};
