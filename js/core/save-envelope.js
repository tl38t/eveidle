/* ================================================================
   统一存档信封（平台无关）

   职责：
   - 生成 / 校验跨平台统一的存档信封。
   - checksum 使用规范化序列化（键序无关），不依赖对象键枚举偶然顺序。
   - 不把任何平台字段（TapTap archiveUUID / SteamID 等）写进 gameState。
   - 解码失败 / 格式错误 / 校验失败 → 抛错，调用方不得覆盖本地档。
   - 旧版纯 gameState JSON 由调用方识别（isEnvelope=false），不在此强制迁移。
   - revision 仅在“真实保存成功后”由调用方递增，本模块不擅自 +1。
   - deviceId 存在于信封顶层与本地同步元数据中，绝不进入玩家业务状态。

   两层版本号（见第一阶段交付决定）：
   - SAVE_ENVELOPE_VERSION：只表示外层信封格式。
   - GAME_SAVE_SCHEMA_VERSION：只在 gameState 出现不向后兼容的结构升级时递增。
     普通 RC 版本 / 数值调整 / UI 修改不得递增。现有 migrations 标志与迁移函数
     继续作为真实迁移依据，不因加入版本号而删除。
   ================================================================ */
(function (root) {
  "use strict";

  const SAVE_ENVELOPE_VERSION = 1;
  const GAME_SAVE_SCHEMA_VERSION = 1;
  const ENVELOPE_FORMAT = "deep-space-idle-save";

  // 递归键序无关的稳定序列化：保证相同逻辑内容产生相同字符串，
  // 不依赖 Object.keys 的枚举偶然顺序（不同引擎 / 不同插入顺序可能不同）。
  function stableStringify(value) {
    if (value === null || typeof value !== "object") {
      // 数字 / 字符串 / 布尔 / undefined 统一经 JSON 处理（undefined → 不输出，由调用方保证结构稳定）。
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      const items = new Array(value.length);
      for (let i = 0; i < value.length; i++) items[i] = stableStringify(value[i]);
      return "[" + items.join(",") + "]";
    }
    const keys = Object.keys(value).sort();
    const parts = new Array(keys.length);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      parts[i] = JSON.stringify(k) + ":" + stableStringify(value[k]);
    }
    return "{" + parts.join(",") + "}";
  }

  // checksum 仅基于规范化 payload，与 envelope 其他字段无关。
  function checksum(payload) {
    return stableStringify(payload);
  }

  function isEnvelope(obj) {
    return !!obj && typeof obj === "object" && obj.format === ENVELOPE_FORMAT;
  }

  // 构造信封。revision 由调用方传入（已是“将要写入”的版本号）。
  function create(opts) {
    const o = opts || {};
    const payload = o.payload;
    const revision = o.revision;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("SaveEnvelope.create: payload 必填且为普通对象");
    }
    if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 1) {
      throw new Error("SaveEnvelope.create: revision 必须为正整数");
    }
    const savedAt = (typeof o.savedAt === "number" && o.savedAt > 0) ? o.savedAt : Date.now();
    const deviceId = (typeof o.deviceId === "string" && o.deviceId) ? o.deviceId : "";
    return {
      format: ENVELOPE_FORMAT,
      envelopeVersion: SAVE_ENVELOPE_VERSION,
      gameSaveVersion: (typeof o.gameSaveVersion === "number") ? o.gameSaveVersion : GAME_SAVE_SCHEMA_VERSION,
      revision: revision,
      savedAt: savedAt,
      deviceId: deviceId,
      payload: payload,
      checksum: checksum(payload)
    };
  }

  function encode(envelope) {
    return JSON.stringify(envelope);
  }

  function decode(json) {
    if (typeof json !== "string") throw new Error("SaveEnvelope.decode: 需要字符串");
    let obj;
    try {
      obj = JSON.parse(json);
    } catch (e) {
      throw new Error("SaveEnvelope.decode: JSON 解析失败");
    }
    return verify(obj);
  }

  // 校验信封结构与 checksum。失败抛错（调用方据此 fail closed）。
  // 遇到高于当前支持版本的信封 → 抛 ENVELOPE_VERSION_TOO_NEW，不得强行加载。
  function verify(obj) {
    if (!isEnvelope(obj)) throw new Error("SaveEnvelope.verify: 非信封格式");
    if (typeof obj.envelopeVersion !== "number") throw new Error("SaveEnvelope.verify: 缺少 envelopeVersion");
    if (obj.envelopeVersion > SAVE_ENVELOPE_VERSION) {
      const err = new Error(
        "存档来自更新版本（envelopeVersion " + obj.envelopeVersion +
        " > 本机支持 " + SAVE_ENVELOPE_VERSION + "），无法加载"
      );
      err.code = "ENVELOPE_VERSION_TOO_NEW";
      throw err;
    }
    if (typeof obj.revision !== "number" || !Number.isInteger(obj.revision) || obj.revision < 1) {
      throw new Error("SaveEnvelope.verify: revision 非法");
    }
    if (!obj.payload || typeof obj.payload !== "object" || Array.isArray(obj.payload)) {
      throw new Error("SaveEnvelope.verify: payload 非法");
    }
    if (typeof obj.checksum !== "string") throw new Error("SaveEnvelope.verify: checksum 缺失");
    if (obj.checksum !== checksum(obj.payload)) {
      const err = new Error("SaveEnvelope.verify: checksum 校验失败（存档可能损坏或被篡改）");
      err.code = "CHECKSUM_MISMATCH";
      throw err;
    }
    return obj;
  }

  const api = {
    SAVE_ENVELOPE_VERSION,
    GAME_SAVE_SCHEMA_VERSION,
    ENVELOPE_FORMAT,
    create,
    encode,
    decode,
    verify,
    isEnvelope,
    checksum,
    stableStringify
  };

  root.SaveEnvelope = api;
  if (typeof window !== "undefined") window.SaveEnvelope = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
