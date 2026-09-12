"use strict";


/*
 * 联盟每日任务 HTTP 云函数（第一版）
 *
 * 这个函数只负责两件事：用上海时区的服务器日期固定当天任务，并把任务写入
 * alliance_daily_tasks。客户端传来的任务只作为“游戏侧任务预览”输入，服务端
 * 会重新检查字段、难度和奖励范围；正式上线前仍应把任务目录随函数一起固化，
 * 不应长期信任客户端传来的 materialValue/standardTimeSec。
 */

const API_BASE = String(process.env.CLOUDBASE_API_BASE || "").replace(/\/$/, "");
const SERVER_API_KEY = process.env.CLOUDBASE_SERVER_API_KEY || "";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const CATEGORIES = new Set(["mineral", "refining", "gas", "planetary", "booster", "equipment", "ship-component"]);
const CATEGORY_SKILLS = {
  mineral: "mining",
  refining: "refining",
  gas: "gasHarvesting",
  planetary: "planetaryIndustry",
  booster: "boosterEngineering",
  equipment: "equipmentEngineering",
  "ship-component": "shipEngineering"
};
const CATEGORY_MATERIAL_PREFIX = {
  mineral: "ore:",
  refining: "mineral:",
  gas: "gas:",
  planetary: "planetary:",
  booster: "booster:",
  equipment: "equipment:",
  "ship-component": "component:"
};
const TIERS = {
  D: [2, 4], C: [5, 8], B: [9, 13], A: [15, 21], S: [24, 32]
};

function reply(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": ALLOWED_ORIGIN,
      "access-control-allow-headers": "content-type, authorization",
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

function serverDate() {
  // Node.js 18 may format en-CA as MM/DD/YYYY in this runtime. Build the
  // database date explicitly so PostgreSQL always receives YYYY-MM-DD.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const values = {};
  parts.forEach(part => { values[part.type] = part.value; });
  return `${values.year}-${values.month}-${values.day}`;
}

function validPlayerId(value) {
  // Steam IDs are decimal strings, while TapTap openids are commonly
  // base64-like and may contain '/' and '=' (for example taptap_xxx==).
  // Keep the value bounded and reject control/whitespace characters, but do
  // not reject valid platform identifiers before they reach PostgREST.
  return typeof value === "string" && value.length >= 1 && value.length <= 200 && !/[\u0000-\u0020\u007f]/.test(value);
}

function rewardPoints(tier, materialValue, standardTimeSec, category) {
  const range = TIERS[tier];
  const material = Math.max(0, Math.min(100, Number(materialValue) || 0)) / 100;
  const time = Math.max(0, Math.min(1, (Number(standardTimeSec) || 0) / 900));
  const base = range[0] + Math.round((material * 0.6 + time * 0.4) * (range[1] - range[0]));
  const multiplier = category === "refining" ? 2 : (category === "equipment" || category === "ship-component" ? 4 : 1);
  return base * multiplier;
}

function normalizeTasks(input, expectedCount) {
  const count = Math.max(5, Math.min(10, Number(expectedCount) || 5));
  if (!Array.isArray(input) || input.length !== count) throw new Error("每日任务数量与任务大厅等级不匹配");
  return input.map((task, index) => {
    if (!task || Number(task.slot) !== index + 1) throw new Error("任务槽位无效");
    if (!CATEGORIES.has(task.category) || !TIERS[task.difficulty] || task.skill !== CATEGORY_SKILLS[task.category]) throw new Error("任务类别、技能或难度无效");
    const amount = Number(task.requiredAmount);
    const level = Number(task.requiredLevel);
    const time = Number(task.standardTimeSec);
    const value = Number(task.materialValue == null ? 0 : task.materialValue);
    const tacticalTier = task.category === "booster" ? Number(task.tacticalTier) : null;
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1000000) throw new Error("任务数量无效");
    if (!Number.isInteger(level) || level < 1 || level > 100) throw new Error("技能门槛无效");
    if (!Number.isFinite(time) || time <= 0 || time > 864000) throw new Error("任务时间无效");
    if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error("材料价值无效");
    if (task.category === "booster" && (!Number.isInteger(tacticalTier) || tacticalTier < 1 || tacticalTier > 5 || amount < 5 || amount % 5 !== 0)) throw new Error("增强剂协议参数无效");
    const materialId = String(task.materialId || "").trim();
    if (!materialId || !String(task.materialName || materialId).trim() || !materialId.startsWith(CATEGORY_MATERIAL_PREFIX[task.category])) throw new Error("任务材料无效");
    const reward = task.category === "booster" ? tacticalTier * (amount / 5) : rewardPoints(task.difficulty, value, time, task.category);
    if (Number(task.rewardPoints) !== reward) throw new Error("任务奖励校验失败");
    return {
      slot: index + 1,
      category: task.category,
      skill: String(task.skill || "").slice(0, 64),
      materialId: materialId.slice(0, 120),
      materialName: String(task.materialName || materialId).slice(0, 120),
      requiredAmount: amount,
      requiredLevel: level,
      standardTimeSec: time,
      materialValue: value,
      difficulty: task.difficulty,
      rewardPoints: reward,
      tacticalTier
    };
  });
}

async function db(path, options) {
  if (!API_BASE || !SERVER_API_KEY) throw new Error("云函数未配置 CLOUDBASE_API_BASE 或 CLOUDBASE_SERVER_API_KEY");
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
    const detail = data && (data.message || data.error || data.hint || data.details);
    throw new Error("数据库请求失败 HTTP " + response.status + (detail ? ": " + String(detail).slice(0, 240) : ""));
  }
  return data;
}

async function readTasks(playerId, date) {
  return db("/v1/rdb/rest/alliance_daily_tasks?select=*&player_id=eq." + encodeURIComponent(playerId) +
    "&server_date=eq." + encodeURIComponent(date) + "&order=slot.asc", { method: "GET" });
}

async function taskCountForPlayer(playerId) {
  const memberships = await db("/v1/rdb/rest/alliance_members?select=alliance_id&player_id=eq." + encodeURIComponent(playerId) + "&limit=1", { method: "GET" });
  if (!memberships || !memberships[0]) return 5;
  const buildings = await db("/v1/rdb/rest/alliance_buildings?select=building_type,level&alliance_id=eq." + encodeURIComponent(memberships[0].alliance_id) + "&building_type=in.(mission_hall)&limit=1", { method: "GET" });
  const level = Math.max(0, Math.min(5, Number(buildings && buildings[0] && buildings[0].level) || 0));
  return [5, 6, 7, 8, 10][Math.max(0, level - 1)] || 5;
}

async function ensureTasks(playerId, date, preview) {
  const expectedCount = await taskCountForPlayer(playerId);
  const existing = await readTasks(playerId, date);
  if (existing.length === expectedCount) return { tasks: existing, created: false };
  const tasks = normalizeTasks(preview, expectedCount);
  const existingSlots = new Set(existing.map(task => Number(task.slot)));
  const rows = tasks.map(task => ({
    player_id: playerId, server_date: date, slot: task.slot,
    category: task.category, skill: task.skill, material_id: task.materialId,
    material_name: task.materialName, required_amount: task.requiredAmount,
    submitted_amount: 0, difficulty: task.difficulty, reward_points: task.rewardPoints,
    material_value: task.materialValue, standard_time_sec: task.standardTimeSec,
    tactical_tier: task.tacticalTier, status: "open"
  })).filter(row => !existingSlots.has(Number(row.slot)));
  if (rows.length) {
    await db("/v1/rdb/rest/alliance_daily_tasks", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(rows)
    });
  }
  return { tasks: await readTasks(playerId, date), created: true };
}

async function submitTask(body) {
  const allianceId = Number(body.allianceId);
  const taskId = Number(body.taskId);
  const amount = Number(body.amount);
  if (!Number.isSafeInteger(allianceId) || allianceId <= 0) throw new Error("联盟 ID 无效");
  if (!Number.isSafeInteger(taskId) || taskId <= 0) throw new Error("任务 ID 无效");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("提交数量无效");
  const rows = await db("/v1/rdb/rest/rpc/submit_alliance_task", {
    method: "POST",
    body: JSON.stringify({
      p_task_id: taskId,
      p_alliance_id: allianceId,
      p_player_id: body.playerId,
      p_amount: amount
    })
  });
  const row = Array.isArray(rows) ? rows[0] : rows;
  return { taskId: row && (row.task_id == null ? row.taskId : row.task_id),
    pointsEarned: row && (row.points_earned == null ? row.pointsEarned : row.points_earned),
    pointsBalance: row && (row.points_balance == null ? row.pointsBalance : row.points_balance) };
}

async function upgradeBuilding(body) {
  const allianceId = Number(body.allianceId);
  if (!Number.isSafeInteger(allianceId) || allianceId <= 0) throw new Error("联盟 ID 无效");
  const buildingType = String(body.buildingType || "").trim().toLowerCase();
  const allowedBuildingTypes = ["logistics_hub", "frontier_hq", "mission_hall", "combat_command", "refining_core"];
  if (allowedBuildingTypes.indexOf(buildingType) < 0) throw new Error("未知联盟建筑");
  const rows = await db("/v1/rdb/rest/rpc/upgrade_alliance_building", {
    method: "POST",
    body: JSON.stringify({ p_alliance_id: allianceId, p_player_id: body.playerId, p_building_type: buildingType })
  });
  const row = Array.isArray(rows) ? rows[0] : rows;
  return { buildingType: row && (row.building_type == null ? row.buildingType : row.building_type),
    level: row && row.level, cost: row && row.cost,
    pointsBalance: row && (row.points_balance == null ? row.pointsBalance : row.points_balance) };
}

exports.main = async function main(event) {
  const method = String(event && (event.httpMethod || event.requestContext && event.requestContext.http && event.requestContext.http.method) || "POST").toUpperCase();
  if (method === "OPTIONS") return reply(204, {});
  if (method !== "POST") return reply(405, { ok: false, error: "method_not_allowed" });
  try {
    const body = bodyOf(event);
    if (!validPlayerId(body.playerId)) return reply(400, { ok: false, error: "player_id_invalid" });
    if (body.action === "health") {
      return reply(200, { ok: true, service: "alliance-daily-tasks", serverDate: serverDate() });
    }
    if (body.action === "submit") {
      const result = await submitTask(body);
      return reply(200, { ok: true, serverDate: serverDate(), ...result });
    }
    if (body.action === "upgrade_building") {
      const result = await upgradeBuilding(body);
      return reply(200, { ok: true, serverDate: serverDate(), ...result });
    }
    const date = serverDate();
    const result = await ensureTasks(body.playerId, date, body.taskPreview);
    return reply(200, { ok: true, serverDate: date, created: result.created, tasks: result.tasks });
  } catch (error) {
    console.error("alliance-daily-tasks", error);
    return reply(400, { ok: false, error: error.message || "daily_task_failed" });
  }
};
