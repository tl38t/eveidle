/* 联盟任务目录适配器：把现有生产数据转换成统一的任务评分输入。 */
(function (root) {
  "use strict";

  function levelValue(item) { return Math.max(1, Number(item && (item.level == null ? item.requiredLevel : item.level)) || 1); }
  function valueByLevel(level) { return Math.min(100, Math.round(12 + Math.sqrt(level / 90) * 88)); }
  function make(category, skill, item, amount, time) {
    var level = levelValue(item);
    var materialId = item.id || item.materialId || item.ore || item.gas || item.name;
    var rawName = item.materialName || item.name || item.ore || item.gas;
    var materialName = rawName;
    if (root.DisplayNames && typeof root.DisplayNames.getResourceRefName === "function") {
      materialName = root.DisplayNames.getResourceRefName(materialId, rawName);
    }
    return { category: category, skill: skill, materialId: materialId, materialName: materialName, amount: amount, requiredLevel: level, standardTimeSec: Math.max(1, Number(time) || 1) * amount, materialValue: valueByLevel(level), faction: Boolean(item.faction), deathspace: Boolean(item.deathspace || item.sourceZoneId && String(item.sourceZoneId).indexOf("death") >= 0), isShip: Boolean(item.isShip) };
  }

  function buildRuntimeCatalog(env) {
    env = env || root;
    var catalog = [];
    (env.MINING_AREAS || []).forEach(function (area) {
      catalog.push(make("mineral", "mining", { id: "ore:" + area.ore, name: area.ore, level: area.level }, 100, area.baseTime));
    });
    (env.SMELTING_RECIPES || []).forEach(function (recipe) {
      if (!recipe || !recipe.outputMineral) return;
      catalog.push(make("refining", "refining", { id: "mineral:" + recipe.outputMineral, name: recipe.outputMineral, level: recipe.level }, 50, recipe.baseTime));
    });
    (env.GAS_AREAS || []).forEach(function (area) {
      catalog.push(make("gas", "gasHarvesting", { id: "gas:" + area.gas, name: area.gas, level: area.level }, 20, area.baseTime));
    });
    (env.PLANET_TYPES || []).forEach(function (planet) {
      if (!planet.output) return;
      catalog.push(make("planetary", "planetaryIndustry", { id: "planetary:" + planet.output, name: planet.output, level: planet.level || 1 }, 300, planet.baseTime || planet.interval || 60));
    });
    // 只从实际制造配方取装备，不能把 EQUIPMENT_DB 中的商店/展示条目误派成任务。
    (env.BOOSTER_RECIPES || []).forEach(function (recipe) {
      if (!recipe || !recipe.output || !recipe.output.itemId) return;
      var itemId = recipe.output.itemId;
      var itemKey = String(itemId).replace(/^booster:/, "");
      var booster = env.BOOSTER_ITEMS && env.BOOSTER_ITEMS[itemKey];
      var level = recipe.level || (booster && booster.level) || 1;
      var tacticalTier = 1;
      Object.keys(recipe.cost || {}).some(function (key) {
        var material = String(key).replace(/^special:/, "");
        var match = { "战术残液": 1, "活性战术凝胶": 2, "高能战术萃取物": 3, "极化战术介质": 4, "深层适应性样本": 5 }[material];
        if (match) { tacticalTier = match; return true; }
        return false;
      });
      var specialAmount = 0;
      Object.keys(recipe.cost || {}).some(function (key) {
        if (String(key).indexOf("special:") !== 0) return false;
        specialAmount = Math.max(1, Number(recipe.cost[key]) || 0);
        return true;
      });
      // 战术材料任务按 5 个为一个建设点单位，需求量向上取整到 5 的倍数。
      var boosterAmount = Math.max(5, Math.ceil(specialAmount / 5) * 5);
      var boosterTask = make("booster", "boosterEngineering", { id: itemId, name: recipe.name || (booster && booster.name), level: level }, boosterAmount, recipe.time || 180);
      boosterTask.tacticalTier = tacticalTier;
      boosterTask.fixedRewardPoints = tacticalTier * (boosterAmount / 5);
      catalog.push(boosterTask);
    });
    (env.EQUIPMENT_RECIPES || []).forEach(function (recipe) {
      // 普通装备任务不包含势力、死亡空间、考古或莫尔石配方。
      if (!recipe || recipe.slot === "rig" || recipe.rigTier || recipe.faction || recipe.archaeology || recipe.deathspaceTier || recipe.sourceDeathspaceId || recipe.sourceZoneId && String(recipe.sourceZoneId).indexOf("death") >= 0 || recipe.cost && Object.prototype.hasOwnProperty.call(recipe.cost, "莫尔石")) return;
      catalog.push(make("equipment", "equipmentEngineering", { id: "equipment:" + recipe.id, name: recipe.name, level: recipe.level }, 1, recipe.time));
    });
    (env.SHIP_COMPONENT_RECIPES || []).forEach(function (recipe) {
      if (!recipe || recipe.cost && Object.prototype.hasOwnProperty.call(recipe.cost, "莫尔石")) return;
      catalog.push(make("ship-component", "shipEngineering", { id: "component:" + recipe.id, name: recipe.name, level: recipe.level }, 3, recipe.time));
    });
    return catalog;
  }

  root.AllianceTaskCatalog = { buildRuntimeCatalog: buildRuntimeCatalog };
})(typeof window !== "undefined" ? window : globalThis);
