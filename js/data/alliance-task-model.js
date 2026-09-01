/*
 * 联盟每日建设任务模型（第一阶段）
 * 纯函数模块：不读取存档、不联网，供云端任务生成器和游戏预览共用。
 */
(function (root) {
  "use strict";

  var CATEGORIES = Object.freeze([
    { id: "refining", label: "冶炼材料", skill: "refining", levelField: "level" },
    { id: "booster", label: "增强剂制造", skill: "boosterEngineering", levelField: "level" },
    { id: "mineral", label: "矿物采集", skill: "mining", levelField: "level" },
    { id: "gas", label: "气体采集", skill: "gasHarvesting", levelField: "level" },
    { id: "planetary", label: "行星资源", skill: "planetaryIndustry", levelField: "level" },
    { id: "equipment", label: "装备制造", skill: "equipmentEngineering", levelField: "level" },
    { id: "ship-component", label: "舰船组件制造", skill: "shipEngineering", levelField: "level" }
  ]);

  var TIERS = Object.freeze({
    D: Object.freeze({ min: 2, max: 4, label: "D" }),
    C: Object.freeze({ min: 5, max: 8, label: "C" }),
    B: Object.freeze({ min: 9, max: 13, label: "B" }),
    A: Object.freeze({ min: 15, max: 21, label: "A" }),
    S: Object.freeze({ min: 24, max: 32, label: "S" })
  });

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

  // value 与 time 均为 0～100 的标准化评分；同档任务仍会因投入不同而给出不同点数。
  function rewardPoints(tier, materialValue, standardTimeSec, category) {
    var range = TIERS[tier];
    if (!range) throw new Error("未知任务难度：" + tier);
    var material = clamp(Number(materialValue) || 0, 0, 100) / 100;
    var time = clamp((Number(standardTimeSec) || 0) / 900, 0, 1);
    var effort = material * 0.6 + time * 0.4;
    var base = range.min + Math.round(effort * (range.max - range.min));
    var multiplier = category === "refining" ? 2 : (category === "equipment" || category === "ship-component" ? 4 : 1);
    return base * multiplier;
  }

  function skillLevel(state, skillKey) {
    var skill = state && state.skills && state.skills[skillKey];
    return Math.max(0, Number(skill && (skill.lvl == null ? skill.level : skill.lvl)) || 0);
  }

  function eligible(item, state) {
    if (!item || !item.category || !item.skill) return false;
    if (item.excluded === true || item.faction === true || item.deathspace === true || item.isShip === true) return false;
    return skillLevel(state, item.skill) >= (Number(item.requiredLevel) || 1);
  }

  // 用于每日固定随机：同一 player/day 反复刷新得到同一结果，正式生成仍应在服务器保存。
  function seedFor(playerId, serverDate) {
    var text = String(playerId || "") + "|" + String(serverDate || "");
    var hash = 2166136261;
    for (var i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return hash >>> 0;
  }

  function random(seed) {
    var value = seed >>> 0;
    return function () { value = (Math.imul(1664525, value) + 1013904223) >>> 0; return value / 4294967296; };
  }

  function chooseTier(rand, skillCeiling) {
    var max = Math.max(1, Number(skillCeiling) || 1);
    var weights = max < 20 ? [55, 30, 12, 3, 0] : max < 50 ? [25, 35, 27, 11, 2] : [10, 20, 30, 27, 13];
    var roll = rand() * 100, sum = 0;
    for (var i = 0; i < weights.length; i++) { sum += weights[i]; if (roll < sum) return ["D", "C", "B", "A", "S"][i]; }
    return "D";
  }

  function generateFive(playerId, serverDate, state, catalog) {
    var rand = random(seedFor(playerId, serverDate));
    var pool = (catalog || []).filter(function (item) { return eligible(item, state); });
    if (!pool.length) return [];
    var tasks = [], available = pool.slice(), categoryCounts = {};
    for (var i = 0; i < 5; i++) {
      // 材料池够用时不重复派发；低等级导致候选不足时才允许回填重复。
      if (!available.length) available = pool.slice();
      var balanced = available.filter(function (candidate) {
        return (categoryCounts[candidate.category] || 0) < 2;
      });
      var candidates = balanced.length ? balanced : available;
      var itemIndex = Math.floor(rand() * candidates.length);
      var item = candidates[itemIndex];
      var availableIndex = available.indexOf(item);
      if (pool.length >= 5 && availableIndex >= 0) available.splice(availableIndex, 1);
      categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1;
      var tier = chooseTier(rand, skillLevel(state, item.skill));
      tasks.push({
        taskKey: String(serverDate || "") + ":" + String(i + 1) + ":" + String(item.materialId),
        slot: i + 1, category: item.category, skill: item.skill, materialId: item.materialId,
        materialName: item.materialName, requiredAmount: item.amount, requiredLevel: item.requiredLevel,
        standardTimeSec: item.standardTimeSec, materialValue: item.materialValue, difficulty: tier,
        rewardPoints: item.fixedRewardPoints == null ? rewardPoints(tier, item.materialValue, item.standardTimeSec, item.category) : Number(item.fixedRewardPoints),
        tacticalTier: item.tacticalTier == null ? null : Number(item.tacticalTier)
      });
    }
    return tasks;
  }

  root.AllianceTaskModel = { CATEGORIES: CATEGORIES, TIERS: TIERS, rewardPoints: rewardPoints, eligible: eligible, seedFor: seedFor, generateFive: generateFive };
})(typeof window !== "undefined" ? window : globalThis);
