(function (root) {
  "use strict";

  // Shared presentation/rule constants for alliance co-building.
  // Server-side RPCs must remain authoritative; this file is for client
  // display and preflight checks only.
  var BUILDINGS = {
    frontier_hq: {
      id: "frontier_hq", legacyId: "logistics_hub", name: "边疆联合总部",
      desc: "提升联盟成员上限，解锁更高规模的协同作战。",
      maxLevel: 7, levels: [
        { level: 1, cost: 100, memberCap: 10 },
        { level: 2, cost: 250, memberCap: 15 },
        { level: 3, cost: 500, memberCap: 20 },
        { level: 4, cost: 1000, memberCap: 25 },
        { level: 5, cost: 2000, memberCap: 30 },
        { level: 6, cost: 4000, memberCap: 35 },
        { level: 7, cost: 8000, memberCap: 40 }
      ]
    },
    mission_hall: {
      id: "mission_hall", name: "联合任务大厅",
      desc: "增加每日联盟任务数量，提升建设点获取速度。",
      maxLevel: 7,
      levels: [1, 2, 3, 4, 5, 6, 7].map(function (level) {
        return { level: level, cost: [100, 250, 500, 1000, 2000, 4000, 8000][level - 1], dailyTasks: [5, 6, 7, 8, 10, 11, 12][level - 1] };
      })
    },
    combat_command: {
      id: "combat_command", name: "前线作战指挥部",
      desc: "每级提升全队战斗伤害 +2%。",
      maxLevel: 7,
      levels: [1, 2, 3, 4, 5, 6, 7].map(function (level) {
        return { level: level, cost: [100, 250, 500, 1000, 2000, 4000, 8000][level - 1], combatDamageBonus: level * 0.02 };
      })
    },
    refining_core: {
      id: "refining_core", name: "联合冶炼中枢",
      desc: "每级提升冶炼效率 +5%。",
      maxLevel: 7,
      levels: [1, 2, 3, 4, 5, 6, 7].map(function (level) {
        return { level: level, cost: [100, 250, 500, 1000, 2000, 4000, 8000][level - 1], refiningEfficiencyBonus: level * 0.05 };
      })
    },
    wormhole_resonance: {
      id: "wormhole_resonance", name: "虫洞谐振信标",
      desc: "每级提升虫洞试炼与宝藏节点额外掉落代币的概率 +3%。",
      maxLevel: 7,
      levels: [1, 2, 3, 4, 5, 6, 7].map(function (level) {
        return { level: level, cost: [100, 250, 500, 1000, 2000, 4000, 8000][level - 1], tokenChanceBonus: level * 0.03 };
      })
    },
    research_council: {
      id: "research_council", name: "科研议会",
      desc: "每级为联盟成员每日提供额外科研工时 +0.5 小时（Lv7 每日 +3.5 小时）。领取后存入科研工时银行，离线也能累积投入。",
      maxLevel: 7,
      levels: [1, 2, 3, 4, 5, 6, 7].map(function (level) {
        return { level: level, cost: [100, 250, 500, 1000, 2000, 4000, 8000][level - 1], dailyResearchHours: level * 0.5 };
      })
    }
  };

  function normalizeId(id) { return id === "logistics_hub" ? "frontier_hq" : String(id || ""); }
  function levelOf(buildingRows, id) {
    var wanted = normalizeId(id);
    var row = (buildingRows || []).find(function (item) { return normalizeId(item.building_type) === wanted; });
    var def = BUILDINGS[wanted];
    var cap = def ? def.maxLevel : 5;
    return Math.max(0, Math.min(cap, Number(row && row.level) || 0));
  }
  function memberCap(buildingRows) {
    var level = levelOf(buildingRows, "frontier_hq");
    return level ? BUILDINGS.frontier_hq.levels[level - 1].memberCap : 10;
  }
  function dailyTaskCount(buildingRows) {
    var level = levelOf(buildingRows, "mission_hall");
    return level ? BUILDINGS.mission_hall.levels[level - 1].dailyTasks : 5;
  }
  function effects(buildingRows) {
    var combatLevel = levelOf(buildingRows, "combat_command");
    var refiningLevel = levelOf(buildingRows, "refining_core");
    var tokenLevel = levelOf(buildingRows, "wormhole_resonance");
    var researchLevel = levelOf(buildingRows, "research_council");
    return {
      combatDamageBonus: combatLevel ? BUILDINGS.combat_command.levels[combatLevel - 1].combatDamageBonus : 0,
      refiningEfficiencyBonus: refiningLevel ? BUILDINGS.refining_core.levels[refiningLevel - 1].refiningEfficiencyBonus : 0,
      tokenChanceBonus: tokenLevel ? BUILDINGS.wormhole_resonance.levels[tokenLevel - 1].tokenChanceBonus : 0,
      dailyResearchHours: researchLevel ? BUILDINGS.research_council.levels[researchLevel - 1].dailyResearchHours : 0
    };
  }
  // 单级效果文案（level: 1-based；0 或越界返回 ""）。供「建造/升级预览」复用，保证与
  // 当前等级效果渲染口径一致（百分比走 Math.round 规避浮点精度，如 0.05*3*100=15.000000000000002）。
  function effectText(def, level) {
    if (!def || !level || level < 1 || level > def.maxLevel) return "";
    var lv = def.levels[level - 1];
    if (def.id === "frontier_hq") return "成员上限 " + lv.memberCap + " 人";
    if (def.id === "mission_hall") return "每日任务 " + lv.dailyTasks + " 个";
    if (def.id === "combat_command") return "全队战斗伤害 +" + Math.round(lv.combatDamageBonus * 100) + "%";
    if (def.id === "refining_core") return "冶炼效率 +" + Math.round(lv.refiningEfficiencyBonus * 100) + "%";
    if (def.id === "wormhole_resonance") return "虫洞代币概率 +" + Math.round(lv.tokenChanceBonus * 100) + "%";
    if (def.id === "research_council") return "每日科研工时 +" + lv.dailyResearchHours + " 小时";
    return "";
  }
  function getDesc(id) {
    var def = BUILDINGS[normalizeId(id)];
    return def ? (def.desc || "") : "";
  }

  root.AllianceBuildingConfig = {
    BUILDINGS: BUILDINGS,
    normalizeId: normalizeId,
    levelOf: levelOf,
    memberCap: memberCap,
    dailyTaskCount: dailyTaskCount,
    effects: effects,
    effectText: effectText,
    getDesc: getDesc
  };
})(typeof window !== "undefined" ? window : globalThis);
