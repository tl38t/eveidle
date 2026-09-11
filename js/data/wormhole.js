/* ================================================================
   虫洞系统 —— 数据与配置（唯一真值）
   ----------------------------------------------------------------
   - 规格真值：docs/WORMHOLE_DESIGN_SPEC_v0.1.md（§2/§3/§4/§6/§13）
   - 本文件只放配置与常量，逻辑在 js/systems/wormhole.js
   - 奖励 = 星图同环带一次性奖励 × 1/10，<1 转概率（spec §6）
   - 词条 = 节点字段覆盖器（spec §4），数值集中于此
   ================================================================ */
(() => {
  "use strict";

  const WORMHOLE_CONFIG = Object.freeze({
    TOKEN_ID: "虫洞印记",                 // special: 池资源（combat.js COMBAT_SPECIAL_MATERIALS 注册）
    SIZES: [9, 13, 17],
    SIZE_NAMES: { 9: "稳定裂隙", 13: "深层裂隙", 17: "先驱回响" },   // 用户 2026-09-07 拍板启用
    DAILY_COUNT: 3,
    RING_MIX: {                            // 可占节点环带占比（小=外+中）
      9:  { outer: 0.55, middle: 0.45, inner: 0 },
      13: { outer: 0, middle: 0.75, inner: 0.25 },
      17: { outer: 0, middle: 0.25, inner: 0.75 }
    },
    TREASURE_MAX: { 9: 1, 13: 2, 17: 4 },
    ELITE_CHANCE: 0.20,                    // 战斗试炼精英概率（2026-09-07 用户拍板：30%→20% 压日产出）
    ELITE_CHANCE: 0.20,                    // 战斗试炼精英概率（2026-09-07 用户拍板：30%→20% 压日产出）
    TRIAL_RATIO: { battle: 1, collection: 1, archaeology: 1 },  // 余数按 战→采→考
    TRIAL_RATIO_ORDER: ["battle", "collection", "archaeology"],
    TRAVEL_SECONDS: 10,                    // 节点间移动（在线离线统一）
    NODE_LIMIT_SECONDS: 180,               // 节点时限基准（星图同源 LIMIT_SECONDS）
    TREASURE_NODE_SECONDS: 20,             // 宝藏节点耗时
    RUN_LIMIT_SECONDS: 86400,              // 单次 run 24h 上限
    HISTORY_LIMIT: 20,
    REFRESH_OFFSET_MS: 8 * 3600 * 1000,    // 北京时间 0:00 = UTC+8
  });

  // —— 奖励：星图同环带一次性 ×1/10 ——
  const WORMHOLE_REWARDS = Object.freeze({
    battle: {   // 单杀 ISK ×15 × 0.1 = ×1.5（已折算）
      isk: { outer: { normal: 7500, elite: 37500 }, middle: { normal: 18000, elite: 54000 }, inner: { normal: 48000, elite: 120000 } },
      extraChance: 0.5,                        // 货柜 / 许可各 50% ×1
      cargoByRing: { outer: "货柜M", middle: "货柜L", inner: "货柜XL" },
      licenseTierByRing: { outer: "A", middle: "S", inner: "S" }
    },
    collection: {                              // 泰坦材料（spec §6.3，中环取 28）
      qty: { outer: 10, middle: 28, inner: 10 },
      byKind: {
        ore:  { outer: "星骸钛晶",     middle: "星骸钛晶",     inner: "相位铱核" },
        gas:  { outer: "赫利昂冷凝气", middle: "赫利昂冷凝气", inner: "虚境裂流" }
      }
    },
    archaeology: {                             // 高 tier = 低概率；统一 15%（用户 14:25 拍板：30%→15%）
      outer: { tier: "iii", chance: 0.15 },
      middle:{ tier: "iv",  chance: 0.15 },
      inner: { tier: "v",   chance: 0.15 }
    },
    token: { trial: 1, treasure: 5, clear: { 9: 10, 13: 20, 17: 35 } }
  });

  // —— 负面词条 ×14（spec §4；数值集中于此） ——
  // 字段语义：
  //   timeMult      试炼时限乘数 {battle,collection,archaeology}（缺省 1）
  //   successDelta  考古扫描成功率加值（负数削弱）
  //   enemyCountAdd 战斗敌人数量加值
  //   targetAdd     考古目标进度加值
  //   interferenceMult 考古干扰时长乘数
  //   cycleMult     考古扫描周期乘数
  //   collectionAmountMult 采集需求量乘数
  //   collectionEffMult    采集效率乘数
  //   fuelMult / ammoMult  战斗燃料/弹药消耗乘数
  //   repairSuppress 玩家维修量压制（复用 combat.js repairSuppr 范式，0.35 = -35%）
  const WORMHOLE_AFFIXES = Object.freeze([
    { id: "collapse", name: "时空坍缩", desc: "全部试炼时限 -30%", timeMult: { battle: 0.7, collection: 0.7, archaeology: 0.7 } },
    { id: "entropy",  name: "熵增湍流", desc: "采集时限 -40%", timeMult: { collection: 0.6 } },
    { id: "ruin",     name: "遗迹塌缩", desc: "考古时限 -40%", timeMult: { archaeology: 0.6 } },
    { id: "window",   name: "交战窗口", desc: "战斗时限 -40%", timeMult: { battle: 0.6 } },
    { id: "escort",   name: "护卫密集", desc: "战斗敌人数量 +2", enemyCountAdd: 2 },
    { id: "repair",   name: "维修抑制", desc: "维修量 -35%（维修耗时 +55%）", repairSuppress: 0.35 },
    { id: "depleted", name: "矿脉枯竭", desc: "采集效率 -25%", collectionEffMult: 0.75 },
    { id: "enriched", name: "储量富集", desc: "采集需求产量 +30%", collectionAmountMult: 1.3 },
    { id: "jamming",  name: "信号干扰", desc: "考古扫描成功率 -12%", successDelta: -0.12 },
    { id: "backlash", name: "反噬增强", desc: "考古干扰时长 ×2", interferenceMult: 2 },
    { id: "seal",     name: "深层封锁", desc: "考古目标进度 +4", targetAdd: 4 },
    { id: "lag",      name: "扫描迟滞", desc: "考古扫描周期 +25%", cycleMult: 1.25 },
    { id: "fuel",     name: "燃料翻倍", desc: "虫洞内燃料消耗 ×2（run 期间全局）", fuelMult: 2 },
    { id: "ammo",     name: "弹药翻倍", desc: "战斗弹药消耗 ×2", ammoMult: 2 }
  ]);

  // —— 商店（spec §13）——
  const WORMHOLE_SHOP = Object.freeze({
    upgrades: {
      travel:     { name: "空间折叠", desc: "节点间移动 -1s（最低 4s）", base: 150, inc: 150, max: 6 },
      affix:      { name: "深空适应", desc: "词条影响 -8%", base: 300, inc: 200, max: 5 },
      retryCost:  { name: "重试等待时间", desc: "重试等待时间 -10%", base: 200, inc: 150, max: 5 },
      tokenChance:{ name: "印记谐振", desc: "每节点 +5% 概率额外 +1 Token", base: 250, inc: 250, max: 6 },
      archSuccess:{ name: "扫描阵列", desc: "虫洞内考古成功率 +1.5%", base: 250, inc: 200, max: 6 },
      collectEff: { name: "采集矩阵", desc: "虫洞内采集效率 +2%", base: 250, inc: 200, max: 6 },
      dailyCount: { name: "裂隙导航", desc: "每日虫洞 +1（3→5）", base: 1500, inc: 1500, max: 2 },
      guaranteeBig:{ name: "出货保底", desc: "每日必出一个大洞（17）", base: 3000, inc: 0, max: 1 }
    },
    items: {
      reroll:    { name: "裂隙重析", desc: "重新生成今日全部虫洞；已完成裂隙将被替换，进行中的远征保留。每日限购 2 次，购买后可在虫洞界面使用；未用库存跨日保留，不会过期。", price: 80, perDay: 2 },
      purify:    { name: "词条净化器", desc: "出发前移除本洞负面词条", price: 60, perRun: 1 },
    },
    goods: {
      catalystPack:   { name: "暗流体助熔触媒 ×1000", desc: "暗流体精炼泵专用燃料；每台泵每个冶炼周期消耗 1 个。", price: 50, grant: { "special:暗流体助熔触媒": 1000 } },
      titanPack:      { name: "泰坦材料自选包（四选一）", price: 100, byChoice: {
        "special:星骸钛晶": { name: "星骸钛晶", qty: 1000 },
        "special:赫利昂冷凝气": { name: "赫利昂冷凝气", qty: 1000 },
        "special:相位铱核": { name: "相位铱核", qty: 50 },
        "special:虚境裂流": { name: "虚境裂流", qty: 50 }
      } },
      calibrationV:   { name: "校准基体 V ×1", price: 180, grant: { "calibration:art_v_calib": 1 } },
      licensePick:    { name: "生产许可（自选势力+档位）", price: 20,
        licenseFactions: ["苍穹劫团", "赤誓教团", "静默集群"],
        byTier: { D: 20, C: 30, B: 50, A: 80, S: 120 }
      },
      cargoPick:      { name: "货柜（自选尺寸）", desc: "购买后获得 1 个所选尺寸货柜，可在货柜页面开启。", price: 20, byId: { "货柜S": 20, "货柜M": 40, "货柜L": 90, "货柜XL": 180 } },
      shipDataPick:   { name: "深层舰船数据自选包 ×10", desc: "三种深层舰船数据任选一种，每次获得 10 个；用于深层舰船与泰坦组件制造。", price: 100, qty: 10, options: ["天穹深层舰船数据", "重垒深层舰船数据", "裂界深层舰船数据"] },
      stationCore:    { name: "空间站核心（四选一）", price: 3000, options: ["空间站冶炼核心", "空间站船坞核心", "空间站装备制造核心", "空间站增强剂制造核心"] },
      darkPumpBlueprint: { name: "暗流体精炼泵图纸", price: 1400, once: true, effect: "grantDarkPumpBlueprint" },
      implantVoidTravel: { name: "脑插·裂隙折跃（节点移动 -2s）", price: 1200, once: true, effect: "implant", implantId: "implant_void_travel" },
      implantVoidAffix:  { name: "脑插·裂隙屏蔽（词条影响 -5%）", price: 1800, once: true, effect: "implant", implantId: "implant_void_affix" },
      implantVoidToken:  { name: "脑插·裂隙谐振（印记获取 +10%）", price: 2500, once: true, effect: "implant", implantId: "implant_void_token" },
      implantVoidCollect:{ name: "脑插·虚空丰饶（矿气增效 +3%）", price: 2000, once: true, effect: "implant", implantId: "implant_void_collect" },
      implantVoidRefine: { name: "脑插·虚空熔炉（冶炼增效 +5%）", price: 2200, once: true, effect: "implant", implantId: "implant_void_refine" },
      implantVoidShip:   { name: "脑插·虚空舰构（舰船制造 +5%）", price: 2200, once: true, effect: "implant", implantId: "implant_void_ship" },
      implantVoidScan:   { name: "脑插·虚空深瞳（考古扫描 +8%）", price: 2000, once: true, effect: "implant", implantId: "implant_void_scan" },
      meltCore8:  { name: "虚空熔核·标准（8h 冶炼 +10%）", desc: "购买后立即生效：全局冶炼效率 +10%，持续 8 小时；同类效果不叠加，再次购买会覆盖剩余时间。", price: 50, effect: "smeltBuff", hours: 8, mult: 1.10 },
      meltCore24: { name: "虚空熔核·深空（24h 冶炼 +12%）", desc: "购买后立即生效：全局冶炼效率 +12%，持续 24 小时；同类效果不叠加，再次购买会覆盖剩余时间。", price: 100, effect: "smeltBuff", hours: 24, mult: 1.12 },
      researchHoursS: { name: "认知萃取注入器·小", desc: "立即获得 1 小时研究工时，注入科研工时池（直接进度，非加速）。", price: 30, effect: "researchHours", hours: 1 },
      researchHoursM: { name: "认知萃取注入器·中", desc: "立即获得 3 小时研究工时，注入科研工时池（直接进度，非加速）。", price: 80, effect: "researchHours", hours: 3 },
      researchHoursL: { name: "认知萃取注入器·大", desc: "立即获得 6 小时研究工时，注入科研工时池（直接进度，非加速）。", price: 150, effect: "researchHours", hours: 6 }
    }
  });

  // —— 暗流体泵（装备定义见 js/data/equipment.js，此处仅商店/触媒常量） ——
  const WORMHOLE_DARK_PUMP = Object.freeze({
    equipmentId: "refinery_pump_dark",
    blueprintName: "暗流体精炼泵图纸",
    catalystId: "special:暗流体助熔触媒",
    catalystPerCycle: 1
  });

  // —— 退役道具原价表（2026-09-10 「应急舱体」下架） ——
  // 该道具从未接线（run.emergency 恒为 false，购买只扣印记不产生任何效果），确认退役。
  // 此处保留原价，仅供 normalizeWormholeState 对旧档「已购未用」库存做一次性退款清算，
  // 不参与任何 UI 展示与购买流程。
  const WORMHOLE_RETIRED_ITEMS = Object.freeze({
    emergency: 100   // 应急舱体（本次 run 重试上限 +3）原始售价
  });

  window.WORMHOLE_CONFIG = WORMHOLE_CONFIG;
  // —— 真实引擎集成（2026-09-07 用户拍板：虫洞试炼 = 星图同款真实引擎） ——
  // 战区映射照抄星图 legion-starmap-pure.html battleTrialZoneByRing；
  // 考古站点档位整体上移一档（外 III / 中 IV / 内 V，对齐奖励表）；
  // 敌舰数量照抄 battleTrialEnemyCountByRing。
  const WORMHOLE_REAL_TRIAL = Object.freeze({
    zonesByRing: Object.freeze({
      outer:  ["angel_warfront", "blood_iron_basilica", "sansha_command_matrix"],
      middle: ["angel_outer_reach", "blood_outer_reliquary", "sansha_outer_array"],
      inner:  ["angel_deep_domain", "blood_deep_reliquary", "sansha_deep_nexus"]
    }),
    enemyCount: Object.freeze({
      outer:  { normal: 5, elite: 4 },
      middle: { normal: 3, elite: 4 },
      inner:  { normal: 4, elite: 3 }
    }),
    archSiteByRing:  Object.freeze({ outer: "iii", middle: "iv", inner: "v" }),
    archDifficulty:  Object.freeze({ iii: 121, iv: 207, v: 300 }),   // ARCHAEOLOGY_SITES 同值
    artifactTierByRing: Object.freeze({ outer: "iii", middle: "iv", inner: "v" })
  });

  window.WORMHOLE_REWARDS = WORMHOLE_REWARDS;
  window.WORMHOLE_REAL_TRIAL = WORMHOLE_REAL_TRIAL;
  window.WORMHOLE_AFFIXES = WORMHOLE_AFFIXES;
  window.WORMHOLE_SHOP = WORMHOLE_SHOP;
  window.WORMHOLE_DARK_PUMP = WORMHOLE_DARK_PUMP;
  window.WORMHOLE_RETIRED_ITEMS = WORMHOLE_RETIRED_ITEMS;
})();
