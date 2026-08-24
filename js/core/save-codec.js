/* Clipboard save codec: compact transport, not encryption.
 *
 * 两种码：
 *   - 完整存档码 前缀 DSI1.    ：整份 gameState 快照，导入时整档替换。
 *   - 进度码     前缀 DSI1P.   ：仅抽取「永久进度」白名单子集，导入时合并（不删其余状态）。
 * 两者在支持 CompressionStream 时走 gzip+base64url，否则回退纯 base64url。
 *
 * 注意：这是混淆压缩，不是加密，不能防作弊。
 */
(function (root) {
  "use strict";
  const PREFIX_FULL = "DSI1.";
  const PREFIX_PROFILE = "DSI1P.";

  function b64(bytes) { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }
  function unb64(s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; const raw = atob(s), out = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i); return out; }

  async function encode(payload, opts) {
    opts = opts || {};
    const prefix = opts.profile ? PREFIX_PROFILE : PREFIX_FULL;
    const text = JSON.stringify(payload); // 紧凑序列化（无缩进），比 2 空格缩进省 ~30%
    const bytes = new TextEncoder().encode(text);
    if (typeof CompressionStream !== "undefined") {
      const cs = new CompressionStream("gzip"), w = cs.writable.getWriter(); w.write(bytes); w.close();
      const buf = new Uint8Array(await new Response(cs.readable).arrayBuffer());
      return prefix + "g." + b64(buf);
    }
    return prefix + "j." + b64(bytes);
  }

  async function decode(code) {
    code = String(code || "").trim();
    if (!code) throw new Error("存档文本为空");
    let prefix = null;
    if (code.indexOf(PREFIX_PROFILE) === 0) prefix = PREFIX_PROFILE;
    else if (code.indexOf(PREFIX_FULL) === 0) prefix = PREFIX_FULL;
    if (prefix === null) return { kind: "raw", data: JSON.parse(code) }; // 兼容旧明文 JSON（如文件导出）
    const parts = code.split(".");
    if (parts.length !== 3) throw new Error("存档文本格式错误（段数不对）");
    const tag = parts[1];
    if (tag !== "g" && tag !== "j") throw new Error("存档文本格式错误（压缩标识不支持：" + tag + "）");
    let bytes = unb64(parts[2]);
    if (tag === "g") {
      if (typeof DecompressionStream === "undefined") throw new Error("当前环境不支持压缩存档");
      bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
    }
    const data = JSON.parse(new TextDecoder().decode(bytes));
    return { kind: prefix === PREFIX_PROFILE ? "profile" : "full", data: data };
  }

  function kindOf(code) {
    code = String(code || "").trim();
    if (code.indexOf(PREFIX_PROFILE) === 0) return "profile";
    if (code.indexOf(PREFIX_FULL) === 0) return "full";
    return "raw";
  }

  // ---- 进度码：白名单抽取 + 合并 ----

  // 顶层白名单：仅这些键会被纳入进度码（覆盖账号核心进度，排除纯运行时/可再生的瞬态）。
  // 明确排除：currentAction（当前行动，刷新即重置）、planetary（部署，可重建）、
  //   cargoLoot / resumeAfterRepair / activeIndustrialShip（瞬态缓冲）、
  //   archaeology（无永久解锁，重生即可）、_dirty / lastActiveTime / lastSaveTime（运行时）、
  //   顶层 dlc（平台拥有的 DLC 授权，由平台再授予，不随存档搬运）。
  const PROFILE_TOP_KEYS = [
    "resources", "stationCoresObtained", "ammo", "implants", "skills",
    "inventory", "equipment", "boosters", "station", "shipyard", "corporation", "legion",
    "upgrades", "ownedBlueprints", "tutorial", "research", "achievements",
    "combat", "shipAssignments", "settings", "migrations", "queue"
  ];

  // 顶层明确忽略键：瞬态/运行时/平台授权的字段，本就不该进进度码。
  // 若某顶层键内新增了「永久进度」子字段，请同步更新上方白名单或此处忽略清单。
  const IGNORED_TOP_KEYS = [
    "currentAction", "planetary", "cargoLoot", "resumeAfterRepair",
    "activeIndustrialShip", "archaeology", "_dirty", "lastActiveTime",
    "lastSaveTime", "dlc"
  ];

  // 开发期校验开关：localhost 或 URL 带 ?savecodecdebug 才触发；生产环境恒为 false。
  function isSaveCodecDebug() {
    try {
      if (typeof window === "undefined" || !window.location) return false;
      const h = window.location.hostname;
      if (h === "localhost" || h === "127.0.0.1" || h === "[::1]") return true;
      return /[?&]savecodecdebug\b/.test(window.location.search);
    } catch (_) { return false; }
  }

  // 开发期校验：gameState 里出现「既不在白名单、也不在忽略清单」的顶层键时告警，
  // 提醒开发者新增功能后别忘了把永久进度字段加入 PROFILE_TOP_KEYS。生产环境不触发、不抛错。
  function warnUncapturedTopKeys(state) {
    if (!state || typeof state !== "object") return;
    const known = new Set(PROFILE_TOP_KEYS.concat(IGNORED_TOP_KEYS));
    const missed = Object.keys(state).filter(k => !known.has(k));
    if (missed.length) {
      console.warn(
        "[save-codec] 进度码未捕获的顶层字段（可能是新增功能忘记加入 PROFILE_TOP_KEYS）：\n  " +
        missed.join(", ") +
        "\n如需随进度码导出，请把它加入 save-codec.js 的 PROFILE_TOP_KEYS；" +
        "如确属瞬态/平台字段，请加入 IGNORED_TOP_KEYS。"
      );
    }
  }

  // 白名单对象内仍需剔除的瞬态/平台字段。
  const COMBAT_TRANSIENT = [
    "enemies", "currentEnemy", "wave", "active", "lastLoot", "lastEnemyVolley",
    "queueWavesDone", "queueEntriesDone", "queueWavesTarget", "queueEntriesTarget",
    "runToken", "runSequence", "enemyInstanceSeq", "randomState", "salvageArmActive",
    "repairUntil", "destroyedShip", "lastStatus"
  ];

  function extractProfile(state) {
    if (isSaveCodecDebug()) warnUncapturedTopKeys(state);
    const out = {};
    for (const k of PROFILE_TOP_KEYS) {
      if (state && Object.prototype.hasOwnProperty.call(state, k)) {
        try { out[k] = JSON.parse(JSON.stringify(state[k])); } catch (_) { /* 跳过不可序列化字段 */ }
      }
    }
    if (out.station) delete out.station.dlc;
    if (out.corporation) delete out.corporation.dlc;
    if (out.combat) for (const t of COMBAT_TRANSIENT) delete out.combat[t];
    if (out.queue) delete out.queue.status;
    if (!out.settings) out.settings = {};
    return out;
  }

  // 深合并：遇到普通对象递归合并；遇到数组/基本类型则直接替换（数组无法有意义地合并）。
  function mergeValue(t, s) {
    if (s === null || typeof s !== "object") return s;
    if (Array.isArray(s)) return s;
    if (typeof t !== "object" || t === null || Array.isArray(t)) t = {};
    for (const k of Object.keys(s)) t[k] = mergeValue(t[k], s[k]);
    return t;
  }

  function mergeProfile(target, src) {
    if (!src || typeof src !== "object") return;
    for (const k of PROFILE_TOP_KEYS) {
      if (Object.prototype.hasOwnProperty.call(src, k)) target[k] = mergeValue(target[k], src[k]);
    }
    if (!target.settings || typeof target.settings !== "object") target.settings = {};
  }

  root.ClipboardSaveCodec = { encode, decode, kindOf, extractProfile, mergeProfile, PREFIX_FULL, PREFIX_PROFILE, PROFILE_TOP_KEYS };
  if (typeof module !== "undefined" && module.exports) module.exports = root.ClipboardSaveCodec;
})(typeof window !== "undefined" ? window : globalThis);
