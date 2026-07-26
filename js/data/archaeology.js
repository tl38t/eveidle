/* ================================================================
   考古系统第二阶段 — 静态数据表
   ================================================================ */

// ---- 考古舰船类型（仅考古舰可装备考古装备，定义在 ships.js 中，此处仅引用） ----

// ---- 五档掉落/经济配置 ----
const ARCHAEOLOGY_TIERS = Object.freeze({
  I:   { tier:"I",   level:1,  ship:"heron",      difficulty:21,  time:30,  fuel:2,  xp:50,   commonISK:[600, 900, 1200],     uniqueISK:[3000, 4500, 6000],     lpValue:50,   calibrationRate:0.020,  calibrationAmount:1, uniqueRate:0.010, lpBase:0.0005, siteMultipliers:[0.8, 1.0, 1.3], economyCostISK:250  },
  II:  { tier:"II",  level:15, ship:"tracer",      difficulty:64,  time:60,  fuel:5,  xp:150,  commonISK:[1800, 2700, 3600],    uniqueISK:[9000, 13500, 18000],    lpValue:150,  calibrationRate:0.015,  calibrationAmount:1, uniqueRate:0.008, lpBase:0.0007, siteMultipliers:[0.8, 1.0, 1.3], economyCostISK:1500 },
  III: { tier:"III", level:35, ship:"starmap",     difficulty:121, time:120, fuel:10, xp:400,  commonISK:[4500, 6750, 9000],    uniqueISK:[22500, 33750, 45000],   lpValue:400,  calibrationRate:0.010,  calibrationAmount:2, uniqueRate:0.006, lpBase:0.0010, siteMultipliers:[0.8, 1.0, 1.3], economyCostISK:4500 },
  IV:  { tier:"IV",  level:55, ship:"farscope",    difficulty:207, time:180, fuel:20, xp:900,  commonISK:[9000, 13500, 18000],  uniqueISK:[45000, 67500, 90000],   lpValue:1000, calibrationRate:0.0075, calibrationAmount:2, uniqueRate:0.004, lpBase:0.0015, siteMultipliers:[0.8, 1.0, 1.3], economyCostISK:12000 },
  V:   { tier:"V",   level:80, ship:"illuminator", difficulty:300, time:300, fuel:35, xp:2000, commonISK:[18000, 27000, 36000], uniqueISK:[90000, 135000, 180000], lpValue:2500, calibrationRate:0.005,  calibrationAmount:3, uniqueRate:0.002, lpBase:0.0020, siteMultipliers:[0.8, 1.0, 1.3], economyCostISK:7800 }
});

// ---- 三类遗迹 profile 定义 ----
// 每档三个遗迹分别使用：salvage(安全打捞) / research(科研) / treasure(危险秘藏)
// 通过 getSiteEffectiveProfile 计算实际反噬/权重/倍率
const SITE_PROFILES = Object.freeze({
  salvage:  Object.freeze({ type:"salvage",  label:"安全打捞", desc:"低风险稳收普通文物",
    backlashMultiplier:0.70, commonWeights:[0.45,0.35,0.20], calibrationMultiplier:0.5, uniqueMultiplier:0.5, lpMultiplier:0.5 }),
  research: Object.freeze({ type:"research", label:"科研遗迹", desc:"校准材料概率最高",
    backlashMultiplier:1.0,  commonWeights:[0.60,0.30,0.10], calibrationMultiplier:2.0, uniqueMultiplier:1.0, lpMultiplier:1.0 }),
  treasure: Object.freeze({ type:"treasure", label:"危险秘藏", desc:"高风险高回报独特与LP",
    backlashMultiplier:1.40, commonWeights:[0.70,0.20,0.10], calibrationMultiplier:0.5, uniqueMultiplier:2.0, lpMultiplier:2.0 })
});

// ---- 15 个遗迹（5 档 × 3 变体） — lpMultiplier统一为1.0（profile提供绝对倍率）----
const ARCHAEOLOGY_SITES = Object.freeze([
  { id:"site_i_a", tier:"I", profile:"salvage",  name:"失落信标残骸", level:1,  difficulty:21,  time:30,  fuel:2,  xp:50,   lpMultiplier:1.0, backlashDamage:18 },
  { id:"site_i_b", tier:"I", profile:"research", name:"远古殖民舱",   level:1,  difficulty:21,  time:30,  fuel:2,  xp:50,   lpMultiplier:1.0, backlashDamage:18 },
  { id:"site_i_c", tier:"I", profile:"treasure", name:"漂流货柜群",   level:1,  difficulty:21,  time:30,  fuel:2,  xp:50,   lpMultiplier:1.0, backlashDamage:18 },
  { id:"site_ii_a", tier:"II", profile:"salvage",  name:"破碎巡防站", level:15, difficulty:64,  time:60,  fuel:5,  xp:150,  lpMultiplier:1.0, backlashDamage:34 },
  { id:"site_ii_b", tier:"II", profile:"research", name:"废弃采矿平台", level:15, difficulty:64,  time:60,  fuel:5,  xp:150,  lpMultiplier:1.0, backlashDamage:34 },
  { id:"site_ii_c", tier:"II", profile:"treasure", name:"星图中继塔", level:15, difficulty:64,  time:60,  fuel:5,  xp:150,  lpMultiplier:1.0, backlashDamage:34 },
  { id:"site_iii_a", tier:"III", profile:"salvage",  name:"沉睡战列残骸", level:35, difficulty:121, time:120, fuel:10, xp:400,  lpMultiplier:1.0, backlashDamage:70 },
  { id:"site_iii_b", tier:"III", profile:"research", name:"湮灭实验室",   level:35, difficulty:121, time:120, fuel:10, xp:400,  lpMultiplier:1.0, backlashDamage:70 },
  { id:"site_iii_c", tier:"III", profile:"treasure", name:"深空方尖碑",   level:35, difficulty:121, time:120, fuel:10, xp:400,  lpMultiplier:1.0, backlashDamage:70 },
  { id:"site_iv_a", tier:"IV", profile:"salvage",  name:"湮灭旗舰坟场", level:55, difficulty:207, time:180, fuel:20, xp:900,  lpMultiplier:1.0, backlashDamage:149 },
  { id:"site_iv_b", tier:"IV", profile:"research", name:"虚空研究所",   level:55, difficulty:207, time:180, fuel:20, xp:900,  lpMultiplier:1.0, backlashDamage:149 },
  { id:"site_iv_c", tier:"IV", profile:"treasure", name:"远古跃迁枢纽", level:55, difficulty:207, time:180, fuel:20, xp:900,  lpMultiplier:1.0, backlashDamage:149 },
  { id:"site_v_a", tier:"V", profile:"salvage",  name:"失落文明圣殿", level:80, difficulty:300, time:300, fuel:35, xp:2000, lpMultiplier:1.0, backlashDamage:343 },
  { id:"site_v_b", tier:"V", profile:"research", name:"湮灭母舰核心", level:80, difficulty:300, time:300, fuel:35, xp:2000, lpMultiplier:1.0, backlashDamage:343 },
  { id:"site_v_c", tier:"V", profile:"treasure", name:"深渊观测站",   level:80, difficulty:300, time:300, fuel:35, xp:2000, lpMultiplier:1.0, backlashDamage:343 }
]);

function getArchaeologySite(siteId) {
  return ARCHAEOLOGY_SITES.find(site => site.id === siteId) || null;
}
function getArchaeologyTierConfig(tier) {
  return ARCHAEOLOGY_TIERS[tier] || null;
}
function getArchaeologyProfile(profileId) {
  return SITE_PROFILES[profileId] || null;
}
function getSiteEffectiveProfile(site, tier) {
  if (!site || !tier) return null;
  const profile = SITE_PROFILES[site.profile];
  if (!profile) return null;
  return {
    type: profile.type, label: profile.label, desc: profile.desc,
    backlashMultiplier: profile.backlashMultiplier,
    commonWeights: profile.commonWeights,
    effectiveCalibrationRate: Math.min(0.99, tier.calibrationRate * profile.calibrationMultiplier),
    effectiveUniqueRate: Math.min(0.99, tier.uniqueRate * profile.uniqueMultiplier),
    effectiveLpMultiplier: profile.lpMultiplier    // 绝对倍率，不再乘 site.lpMultiplier
  };
}

// ---- 40 种考古产物（每档 8 件：3 普通 ISK + 3 独特 + 1 LP + 1 校准材料） ----
const ARCHAEOLOGY_ARTIFACTS = Object.freeze([
  // ===== Tier I =====
  { id:"art_i_common_a", name:"锈蚀数据核心",  tier:"I", category:"common_isk", iskValue:600 },
  { id:"art_i_common_b", name:"远古合金板",    tier:"I", category:"common_isk", iskValue:900 },
  { id:"art_i_common_c", name:"残缺导航矩阵",  tier:"I", category:"common_isk", iskValue:1200 },
  { id:"art_i_unique_a", name:"信标碎片",      tier:"I", category:"unique", iskValue:3000 },
  { id:"art_i_unique_b", name:"殖民徽记",      tier:"I", category:"unique", iskValue:4500 },
  { id:"art_i_unique_c", name:"货柜残片",      tier:"I", category:"unique", iskValue:6000 },
  { id:"art_i_lp",       name:"远古文明信标",  tier:"I", category:"lp", lpValue:50 },
  { id:"art_i_calib",    name:"校准基体 I 型", tier:"I", category:"calibration" },
  // ===== Tier II =====
  { id:"art_ii_common_a", name:"巡防站黑匣",   tier:"II", category:"common_isk", iskValue:1800 },
  { id:"art_ii_common_b", name:"精炼同位素",   tier:"II", category:"common_isk", iskValue:2700 },
  { id:"art_ii_common_c", name:"平台主控核",   tier:"II", category:"common_isk", iskValue:3600 },
  { id:"art_ii_unique_a", name:"巡防站徽记",   tier:"II", category:"unique", iskValue:9000 },
  { id:"art_ii_unique_b", name:"采掘图谱",     tier:"II", category:"unique", iskValue:13500 },
  { id:"art_ii_unique_c", name:"中继塔核心",   tier:"II", category:"unique", iskValue:18000 },
  { id:"art_ii_lp",       name:"远古文明信标 II", tier:"II", category:"lp", lpValue:150 },
  { id:"art_ii_calib",    name:"校准基体 II 型", tier:"II", category:"calibration" },
  // ===== Tier III =====
  { id:"art_iii_common_a", name:"战列装甲片",  tier:"III", category:"common_isk", iskValue:4500 },
  { id:"art_iii_common_b", name:"湮灭实验录",  tier:"III", category:"common_isk", iskValue:6750 },
  { id:"art_iii_common_c", name:"方尖碑铭文",  tier:"III", category:"common_isk", iskValue:9000 },
  { id:"art_iii_unique_a", name:"战列徽记",    tier:"III", category:"unique", iskValue:22500 },
  { id:"art_iii_unique_b", name:"湮灭图谱",    tier:"III", category:"unique", iskValue:33750 },
  { id:"art_iii_unique_c", name:"观测者残片",  tier:"III", category:"unique", iskValue:45000 },
  { id:"art_iii_lp",       name:"远古文明信标 III", tier:"III", category:"lp", lpValue:400 },
  { id:"art_iii_calib",    name:"校准基体 III 型", tier:"III", category:"calibration" },
  // ===== Tier IV =====
  { id:"art_iv_common_a", name:"旗舰装甲残片", tier:"IV", category:"common_isk", iskValue:9000 },
  { id:"art_iv_common_b", name:"虚空研究录",   tier:"IV", category:"common_isk", iskValue:13500 },
  { id:"art_iv_common_c", name:"跃迁日志",     tier:"IV", category:"common_isk", iskValue:18000 },
  { id:"art_iv_unique_a", name:"旗舰徽记",     tier:"IV", category:"unique", iskValue:45000 },
  { id:"art_iv_unique_b", name:"虚空图谱",     tier:"IV", category:"unique", iskValue:67500 },
  { id:"art_iv_unique_c", name:"枢纽核心",     tier:"IV", category:"unique", iskValue:90000 },
  { id:"art_iv_lp",       name:"远古文明信标 IV", tier:"IV", category:"lp", lpValue:1000 },
  { id:"art_iv_calib",    name:"校准基体 IV 型", tier:"IV", category:"calibration" },
  // ===== Tier V =====
  { id:"art_v_common_a", name:"圣殿圣物",     tier:"V", category:"common_isk", iskValue:18000 },
  { id:"art_v_common_b", name:"母舰主控核",   tier:"V", category:"common_isk", iskValue:27000 },
  { id:"art_v_common_c", name:"观测站日志",   tier:"V", category:"common_isk", iskValue:36000 },
  { id:"art_v_unique_a", name:"文明圣徽",     tier:"V", category:"unique", iskValue:90000 },
  { id:"art_v_unique_b", name:"母舰图谱",     tier:"V", category:"unique", iskValue:135000 },
  { id:"art_v_unique_c", name:"观测者核心",   tier:"V", category:"unique", iskValue:180000 },
  { id:"art_v_lp",       name:"远古文明信标 V", tier:"V", category:"lp", lpValue:2500 },
  { id:"art_v_calib",    name:"校准基体 V 型", tier:"V", category:"calibration" }
]);

function getArchaeologyArtifact(artifactId) {
  return ARCHAEOLOGY_ARTIFACTS.find(artifact => artifact.id === artifactId) || null;
}
function getArchaeologyArtifactsByTier(tier) {
  return ARCHAEOLOGY_ARTIFACTS.filter(artifact => artifact.tier === tier);
}

// ---- 3 种探针（弹药/燃料类，不可安装、不可强化） ----
const ARCHAEOLOGY_PROBES = Object.freeze([
  { id:"core_probe_i",    name:"标准考古探针 I",  level:1,  scanBonus:0,  batchSize:20, craftTime:15,  economyCostISK:250,   cost:{ "三钛合金":40 } },
  { id:"enhanced_probe_ii", name:"强化考古探针 II", level:35, scanBonus:10, batchSize:20, craftTime:35,  economyCostISK:1500,  cost:{ "三钛合金":200, "类晶体胶矿":60 } },
  { id:"deep_probe_iii",  name:"深空考古探针 III", level:70, scanBonus:20, batchSize:20, craftTime:75,  economyCostISK:7800,  cost:{ "三钛合金":600, "超噬矿":10, "铷":3 } }
]);

function getArchaeologyProbe(probeId) {
  return ARCHAEOLOGY_PROBES.find(probe => probe.id === probeId) || null;
}

// ---- 普通 ISK 文物抽取权重（低/中/高 60/30/10） ----
const ARCHAEOLOGY_COMMON_WEIGHTS = Object.freeze([0.6, 0.3, 0.1]);

// ---- 稳定器/译码器上限 ----
const ARCHAEOLOGY_STABILIZER_CAP = 0.60;   // 信号稳定器减免总和上限
const ARCHAEOLOGY_DECODER_CAP = 0.75;      // 文物译码器额外普通文物概率上限

// ---- 反噬信号干扰最短时长 ----
const ARCHAEOLOGY_SIGNAL_MIN_SECONDS = 3;

// ---- 舰船损毁后强制自动维修时长 ----
const ARCHAEOLOGY_REPAIR_SECONDS = 180;

window.ARCHAEOLOGY_SHIP_TYPES = ARCHAEOLOGY_SHIP_TYPES;
window.ARCHAEOLOGY_TIERS = ARCHAEOLOGY_TIERS;
window.ARCHAEOLOGY_SITES = ARCHAEOLOGY_SITES;
window.ARCHAEOLOGY_ARTIFACTS = ARCHAEOLOGY_ARTIFACTS;
window.ARCHAEOLOGY_PROBES = ARCHAEOLOGY_PROBES;
window.SITE_PROFILES = SITE_PROFILES;
window.ARCHAEOLOGY_COMMON_WEIGHTS = ARCHAEOLOGY_COMMON_WEIGHTS;
window.ARCHAEOLOGY_STABILIZER_CAP = ARCHAEOLOGY_STABILIZER_CAP;
window.ARCHAEOLOGY_DECODER_CAP = ARCHAEOLOGY_DECODER_CAP;
window.ARCHAEOLOGY_SIGNAL_MIN_SECONDS = ARCHAEOLOGY_SIGNAL_MIN_SECONDS;
window.ARCHAEOLOGY_REPAIR_SECONDS = ARCHAEOLOGY_REPAIR_SECONDS;
window.getArchaeologySite = getArchaeologySite;
window.getArchaeologyTierConfig = getArchaeologyTierConfig;
window.getArchaeologyProfile = getArchaeologyProfile;
window.getSiteEffectiveProfile = getSiteEffectiveProfile;
window.getArchaeologyArtifact = getArchaeologyArtifact;
window.getArchaeologyArtifactsByTier = getArchaeologyArtifactsByTier;
window.getArchaeologyProbe = getArchaeologyProbe;
