(function (root) {
  "use strict";

  // Shared presentation/rule constants for alliance co-building.
  // Server-side RPCs must remain authoritative; this file is for client
  // display and preflight checks only.
  var BUILDINGS = {
    frontier_hq: {
      id: "frontier_hq", legacyId: "logistics_hub", name: "边疆联合总部",
      maxLevel: 5, levels: [
        { level: 1, cost: 100, memberCap: 10 },
        { level: 2, cost: 250, memberCap: 15 },
        { level: 3, cost: 500, memberCap: 20 },
        { level: 4, cost: 1000, memberCap: 25 },
        { level: 5, cost: 2000, memberCap: 30 }
      ]
    },
    mission_hall: {
      id: "mission_hall", name: "联合任务大厅", maxLevel: 5,
      levels: [1, 2, 3, 4, 5].map(function (level) {
        return { level: level, cost: [100, 250, 500, 1000, 2000][level - 1], dailyTasks: [5, 6, 7, 8, 10][level - 1] };
      })
    },
    combat_command: {
      id: "combat_command", name: "前线作战指挥部", maxLevel: 5,
      levels: [1, 2, 3, 4, 5].map(function (level) {
        return { level: level, cost: [100, 250, 500, 1000, 2000][level - 1], combatDamageBonus: level * 0.02 };
      })
    },
    refining_core: {
      id: "refining_core", name: "联合冶炼中枢", maxLevel: 5,
      levels: [1, 2, 3, 4, 5].map(function (level) {
        return { level: level, cost: [100, 250, 500, 1000, 2000][level - 1], refiningEfficiencyBonus: level * 0.05 };
      })
    }
  };

  function normalizeId(id) { return id === "logistics_hub" ? "frontier_hq" : String(id || ""); }
  function levelOf(buildingRows, id) {
    var wanted = normalizeId(id);
    var row = (buildingRows || []).find(function (item) { return normalizeId(item.building_type) === wanted; });
    return Math.max(0, Math.min(5, Number(row && row.level) || 0));
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
    return {
      combatDamageBonus: combatLevel ? BUILDINGS.combat_command.levels[combatLevel - 1].combatDamageBonus : 0,
      refiningEfficiencyBonus: refiningLevel ? BUILDINGS.refining_core.levels[refiningLevel - 1].refiningEfficiencyBonus : 0
    };
  }

  root.AllianceBuildingConfig = {
    BUILDINGS: BUILDINGS,
    normalizeId: normalizeId,
    levelOf: levelOf,
    memberCap: memberCap,
    dailyTaskCount: dailyTaskCount,
    effects: effects
  };
})(typeof window !== "undefined" ? window : globalThis);
