/* ================================================================
   IP 去相似化 Batch L · 统一显示名称层（纯读，绝不参与业务判断）

   - 保存「内部旧键 → 原创显示名」的冻结映射；
   - 只提供纯读 API；不读取 / 不修改 gameState；
   - 找不到映射时返回调用方提供的 fallback；无 fallback 时返回原值；
   - 内部稳定键（存档 / 库存 / 配方 / 蓝图 / 队列 / 统计 / 事件 payload）
     永久保持原值，绝不迁移、绝不改名。

   风格基调：冷峻工业科幻 + 边疆殖民 + 深空考古。
   ================================================================ */
(function () {
  "use strict";

  // ---- A. 货币（内部键 isk / lp 保持）----
  const CURRENCY_NAMES = Object.freeze({ isk: "星币", lp: "功勋" });
  const CURRENCY_ABBREVIATIONS = Object.freeze({ isk: "SC", lp: "MR" });

  // ---- B. 三个战斗势力（内部 faction ID angel / blood / sansha 保持）----
  const FACTION_NAMES = Object.freeze({
    angel: "苍穹劫团",
    blood: "赤誓教团",
    sansha: "静默集群",
    alliance: "银河联盟"
  });
  const FACTION_EN_NAMES = Object.freeze({
    angel: "Skybreak Marauders",
    blood: "Crimson Covenant",
    sansha: "Silent Assembly"
  });

  // 势力加密数据（内部 special 库存键保持；显示统一为「势力简称 + 阶位 + 密钥」）
  const FACTION_SHORT = Object.freeze({ angel: "劫团", blood: "赤誓", sansha: "静默" });
  const ENCRYPTED_DATA_TIERS = Object.freeze({ 初级: "初阶", 低级: "低阶", 中级: "中阶", 高级: "高阶" });
  // 旧势力名前缀（用于任意以势力名开头的特殊材料键：加密数据 / 死亡空间门票 / 战利品 / 旗舰数据）
  const FACTION_LEGACY_PREFIX = Object.freeze({ angel: "天使", blood: "血袭者", sansha: "萨沙" });
  const FACTION_DISPLAY_PREFIX = Object.freeze({ angel: "苍穹劫团", blood: "赤誓教团", sansha: "静默集群" });
  // 死亡空间核心 / 协议材料中的旧势力前缀（吉斯特=苍穹劫团 / 科尔普斯=赤誓教团 / 森屠斯=静默集群）。
  // 采用与 DED 装备名前缀一致的缩写（劫团 / 赤誓 / 静默），仅作显示层替换，内部材料键永久保持原值。
  const FACTION_MATERIAL_LEGACY_PREFIX = Object.freeze({ 吉斯特: "劫团", 科尔普斯: "赤誓", 森屠斯: "静默" });

  // ---- C. 七类矿石（内部库存键为旧中文键，保持）----
  const ORE_NAMES = Object.freeze({
    "凡晶石": "铁硅原矿",
    "灼烧岩": "赤镍矿",
    "水硼砂": "蓝硼晶",
    "斜长岩": "同位晶簇",
    "干焦岩": "诺瓦矿",
    "灰岩": "重锆岩",
    "艾克诺岩": "极星矿"
  });

  // ---- D. 八类矿物（内部库存键为旧中文键，保持）----
  const MINERAL_NAMES = Object.freeze({
    "三钛合金": "标准钛材",
    "类银超金属": "银镍合金",
    "类晶体胶矿": "晶格聚合物",
    "同位聚合体": "同位复材",
    "超新星诺克石": "诺瓦陶金",
    "基腹断岩": "重锆晶材",
    "超噬矿": "奇点合金",
    "莫尔石": "暗质晶核"
  });

  // ---- E. 明确来自 EVE 的舰船显示名（内部 shipId / recipeId / blueprintId 保持）----
  const SHIP_NAMES = Object.freeze({
    rookie_corvette: "启程级",
    rifter: "星矛级",
    kestrel: "铁卫级",
    atron: "闪刃级",
    miner_frigate: "拓岩级",
    gas_frigate: "捕云级",
    miner_destroyer: "凿岩级",
    miner_cruiser: "岩脊级",
    gas_cruiser: "云舶级",
    dolphin: "驮星级",
    orca: "山海级",
    heron: "觅迹级"
  });
  // 旧中文显示名 → 新显示名（兜底；正式数据 name 已改为新名）
  const LEGACY_SHIP_DISPLAY = Object.freeze({
    "裂谷级": "星矛级",
    "茶隼级": "铁卫级",
    "阿特龙级": "闪刃级",
    "冲锋者级": "拓岩级",
    "勘探者级": "捕云级",
    "妄想级": "凿岩级",
    "霍克级": "岩脊级",
    "奋进级": "云舶级",
    "海豚级": "驮星级",
    "逆戟鲸级": "山海级",
    "苍鹭级": "觅迹级"
  });

  // ---- F. 库存键物品显示名（特殊材料 / 势力加密数据 / 死亡空间门票 / 战利品等）----
  // 以旧势力名开头的任何 special 键：加密数据走「简称+阶位+密钥」，其余前缀替换为势力显示名。
  const ITEM_NAMES = Object.freeze({});

  function getSpecialItemDisplayName(key) {
    if (typeof key !== "string" || !key) return null;
    // 1) 旧势力名前缀（天使/血袭者/萨沙）→ 替换为新势力显示名；加密数据单独映射为「简称+阶位+密钥」。
    for (const factionKey of Object.keys(FACTION_LEGACY_PREFIX)) {
      const legacy = FACTION_LEGACY_PREFIX[factionKey];
      if (!key.startsWith(legacy)) continue;
      const tierMatch = key.match(/^(?:天使|血袭者|萨沙)(初级|低级|中级|高级)加密数据$/);
      if (tierMatch) {
        return FACTION_SHORT[factionKey] + ENCRYPTED_DATA_TIERS[tierMatch[1]] + "密钥";
      }
      return FACTION_DISPLAY_PREFIX[factionKey] + key.slice(legacy.length);
    }
    // 2) 新势力显示名前缀（苍穹劫团/赤誓教团/静默集群）→ key 本身已经是显示名，直接返回。
    for (const displayPrefix of Object.values(FACTION_DISPLAY_PREFIX)) {
      if (key.startsWith(displayPrefix)) return key;
    }
    // 3) 死亡空间核心 / 协议材料旧势力前缀（吉斯特/科尔普斯/森屠斯）→ 对齐 DED 装备名缩写（劫团/赤誓/静默）。
    for (const factionKey of Object.keys(FACTION_MATERIAL_LEGACY_PREFIX)) {
      const legacy = FACTION_MATERIAL_LEGACY_PREFIX[factionKey];
      if (key.startsWith(factionKey)) return legacy + key.slice(factionKey.length);
    }
    return null;
  }

  // ---- 采矿星带显示名（内部 MINING_AREAS.name 是 action.area / queue target 逻辑键，保持；显示转换）----
  const AREA_NAMES = Object.freeze({
    "凡晶石带": "铁硅原矿带",
    "灼烧岩带": "赤镍矿带",
    "水硼砂带": "蓝硼晶带",
    "斜长岩带": "同位晶簇带",
    "干焦岩带": "诺瓦矿带",
    "灰岩带": "重锆岩带",
    "艾克诺岩带": "极星矿带"
  });

  // ---- F. 游戏正式总标题（工作标题，3 个候选见 IP_DECOUPLING_PLAN）----
  const GAME_TITLE = Object.freeze({
    zh: "深空放置：边疆纪元",
    en: "Deep Space Idle: Frontier Era"
  });

  // ---- 纯读工具 ----
  function useFallback(value, fb) {
    return (value !== undefined && value !== null) ? value : fb;
  }

  function getCurrencyName(currencyId) {
    return CURRENCY_NAMES[currencyId] || currencyId;
  }
  function getCurrencyAbbreviation(currencyId) {
    return CURRENCY_ABBREVIATIONS[currencyId] || currencyId;
  }
  function getFactionName(factionId) {
    return FACTION_NAMES[factionId] || factionId;
  }
  function getFactionEnName(factionId) {
    return FACTION_EN_NAMES[factionId] || factionId;
  }
  function getShipName(shipId, fallbackName) {
    return SHIP_NAMES[shipId] || useFallback(fallbackName, shipId);
  }

  // 按 namespace + internalKey 取显示名；未知命名空间或未映射返回 fallback / 原值
  function getResourceName(namespace, internalKey, fallbackName) {
    const key = String(internalKey);
    if (namespace === "ore") return ORE_NAMES[key] || useFallback(fallbackName, internalKey);
    if (namespace === "mineral") return MINERAL_NAMES[key] || useFallback(fallbackName, internalKey);
    if (namespace === "special") return getSpecialItemDisplayName(key) || useFallback(fallbackName, internalKey);
    if (namespace === "currency") return CURRENCY_NAMES[key] || useFallback(fallbackName, internalKey);
    return useFallback(fallbackName, internalKey);
  }

  // 按 ref（namespace:key 或裸键）取显示名
  function getResourceRefName(ref, fallbackName) {
    if (typeof ref !== "string" || !ref) return useFallback(fallbackName, ref);
    const idx = ref.indexOf(":");
    if (idx <= 0) {
      return getSpecialItemDisplayName(ref) || LEGACY_SHIP_DISPLAY[ref] || ORE_NAMES[ref] || MINERAL_NAMES[ref] || useFallback(fallbackName, ref);
    }
    return getResourceName(ref.slice(0, idx), ref.slice(idx + 1), fallbackName);
  }

  // 通用物品显示名（加密数据 / 死亡空间门票 / 旧舰船中文名等）
  function getItemName(itemId, fallbackName) {
    if (typeof itemId !== "string" || !itemId) return useFallback(fallbackName, itemId);
    return getSpecialItemDisplayName(itemId) || LEGACY_SHIP_DISPLAY[itemId] || useFallback(fallbackName, itemId);
  }

  // 采矿星带显示名（内部 area name 是逻辑键）
  function getAreaName(areaName, fallbackName) {
    return AREA_NAMES[areaName] || useFallback(fallbackName, areaName);
  }

  // 战斗星带 / 死亡空间显示名：数据 name 已直接改为原创名，此 API 仅作兜底（未映射返回 fallback / 原值）
  function getCombatZoneName(zoneId, fallbackName) {
    return useFallback(fallbackName, zoneId);
  }

  // 格式化资源数量：显示名 + 千分位数量
  function formatResourceAmount(namespace, internalKey, amount) {
    const name = getResourceName(namespace, internalKey);
    const n = Number(amount);
    return name + (Number.isFinite(n) ? " " + n.toLocaleString("zh-CN") : "");
  }

  const DisplayNames = Object.freeze({
    CURRENCY_NAMES,
    CURRENCY_ABBREVIATIONS,
    FACTION_NAMES,
    FACTION_EN_NAMES,
    FACTION_SHORT,
    ENCRYPTED_DATA_TIERS,
    ORE_NAMES,
    MINERAL_NAMES,
    SHIP_NAMES,
    LEGACY_SHIP_DISPLAY,
    ITEM_NAMES,
    AREA_NAMES,
    GAME_TITLE,
    getCurrencyName,
    getCurrencyAbbreviation,
    getFactionName,
    getFactionEnName,
    getShipName,
    getResourceName,
    getResourceRefName,
    getItemName,
    getAreaName,
    getCombatZoneName,
    formatResourceAmount
  });

  if (typeof window !== "undefined") window.DisplayNames = DisplayNames;
  if (typeof globalThis !== "undefined") globalThis.DisplayNames = DisplayNames;
})();
