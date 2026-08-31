/* ================================================================
   增强剂系统数据层 — Phase 2A
   普通 <script> 全局加载（非 ES Module）。
   数据严格来自 BOOSTER_SYSTEM_IMPLEMENTATION_PLAN.md §4 表 A / B / C，
   逐条静态声明 30 件增强剂与配方，禁止运行时程序化隐藏。

   本阶段（Phase 2A）范围：数据 / 制造 / 库存。
   不实装：六槽装备操作、180 秒计时消耗、效果应用。
   ================================================================ */

// 每瓶持续时间（硬规则，Phase 2B 才消耗；本阶段仅作为元数据固化）。
const BOOSTER_DURATION_MS = 180000;

// 三品质（普通 / 精工 / 传奇），后缀 n / r / l。
const BOOSTER_QUALITIES = Object.freeze({
  n: { id:"n", name:"普通" },
  r: { id:"r", name:"精工" },
  l: { id:"l", name:"传奇" }
});

// 10 系列（§2）。category 用于 UI 分类标签：mining / archaeology / combatWeapon / combatRepair。
const BOOSTER_SERIES = Object.freeze({
  mining_lubricant:{ id:"mining_lubricant", name:"纳米采掘润滑剂", category:"mining",        slot:"miningSpeed",      effectType:"miningSpeed" },
  ore_resonance:   { id:"ore_resonance",    name:"富矿共振催化剂", category:"mining",        slot:"miningYield",      effectType:"doubleMineral" },
  relic_solver:    { id:"relic_solver",     name:"遗迹解析液",     category:"archaeology",   slot:"archaeologySpeed", effectType:"archaeologySpeed" },
  artifact_tracer: { id:"artifact_tracer",  name:"文物示踪剂",     category:"archaeology",   slot:"archaeologyRare",  effectType:"rareShift" },
  laser_coolant:   { id:"laser_coolant",    name:"激光炮冷却剂",   category:"combatWeapon",  slot:"combatWeapon",     effectType:"damageMultiplier", weaponType:"laser" },
  missile_catalyst:{ id:"missile_catalyst", name:"导弹燃烧催化剂", category:"combatWeapon",  slot:"combatWeapon",     effectType:"damageMultiplier", weaponType:"missile" },
  cannon_booster:  { id:"cannon_booster",   name:"火炮增压药",     category:"combatWeapon",  slot:"combatWeapon",     effectType:"damageMultiplier", weaponType:"cannon" },
  shield_recharge: { id:"shield_recharge",  name:"护盾回充液",     category:"combatRepair",  slot:"combatRepair",     effectType:"repairAmount", repairTarget:"shield" },
  armor_nano:      { id:"armor_nano",       name:"装甲纳米修复剂", category:"combatRepair",  slot:"combatRepair",     effectType:"repairAmount", repairTarget:"armor" },
  structure_gel:   { id:"structure_gel",    name:"结构再生胶",     category:"combatRepair",  slot:"combatRepair",     effectType:"repairAmount", repairTarget:"structure" },
  // —— 考古重做 · 8 系列（§9）覆盖采气/冶炼/舰船工程/增幅剂制造两槽 ——
  gas_rheology:            { id:"gas_rheology",            name:"气云流变剂",     category:"gas",      slot:"gasSpeed",    effectType:"gasSpeed" },
  fullerene_nucleation:    { id:"fullerene_nucleation",    name:"富勒烯成核剂",   category:"gas",      slot:"gasYield",    effectType:"gasDouble" },
  high_temp_flux:          { id:"high_temp_flux",          name:"高温助熔剂",     category:"refining", slot:"smeltSpeed",  effectType:"smeltSpeed" },
  lattice_proliferation:   { id:"lattice_proliferation",   name:"晶格增殖剂",     category:"refining", slot:"smeltYield",  effectType:"smeltDouble" },
  assembly_coordinator:    { id:"assembly_coordinator",    name:"装配协调剂",     category:"ship",     slot:"shipSpeed",   effectType:"shipSpeed" },
  precision_rationing:     { id:"precision_rationing",     name:"精密配给剂",     category:["ship","equipment"], slot:"shipYield",   effectType:"shipMaterialDiscount" },
  // 装备总装协调剂：装备工程提速（直解锁；耗时统一 180s；镜像舰船装配协调剂）
  equipment_assembly:      { id:"equipment_assembly",      name:"装备总装协调剂", category:"equipment", slot:"equipmentSpeed", effectType:"equipmentSpeed" },
  reaction_accelerant:     { id:"reaction_accelerant",     name:"反应加速介质",   category:"booster",  slot:"boosterSpeed", effectType:"boosterSpeed" },
  reaction_chain_proliferation: { id:"reaction_chain_proliferation", name:"反应链增殖剂", category:"booster", slot:"boosterYield", effectType:"boosterDouble" },
  // —— 技能训练 · 神经训练催化器（经验茶模型：通用件 universal，可装入任意类别槽，只加成该槽对应类别的技能经验；effectType:skillXpMultiplier）——
  // —— 技能训练 · 神经训练催化器（经验茶模型：通用件 universal，可装入任意类别槽，只加成该槽对应类别的技能经验）——
  neural_booster: { id:"neural_booster", name:"神经训练催化器", category:"training", slot:"any", effectType:"skillXpMultiplier" },
  // —— 技能超载催化器（通用件 universal，可装入任意类别槽）：临时提升全部采集/制造技能等级，起效期间可制造/采集更高级道具，离线同样生效；归入「技能训练」标签，直解锁（无蓝图）——
  skill_overdrive: { id:"skill_overdrive", name:"技能超载催化器", category:"training", slot:"any", effectType:"skillLevelBonus" }
});

const BOOSTER_CATEGORY_META = Object.freeze([
  { id:"mining",       name:"采矿" },
  { id:"archaeology",  name:"考古" },
  { id:"gas",          name:"采气" },
  { id:"refining",     name:"冶炼" },
  { id:"ship",         name:"舰船工程" },
  { id:"equipment",    name:"装备制造" },
  { id:"booster",      name:"增幅剂制造" },
  { id:"combatWeapon", name:"战斗武器" },
  { id:"combatRepair", name:"战斗维修" },
  { id:"training",     name:"技能训练" }
]);

// 高频战斗掉落材料 5 档（§7）。securityLayer 映射到 COMBAT_FORMATION_POOLS 的层级键。
const TACTICAL_MATERIALS = Object.freeze([
  { id:"战术残液",       name:"战术残液",       tier:"T1", securityLayer:"highsec",  unlockLevel:1 },
  { id:"活性战术凝胶",   name:"活性战术凝胶",   tier:"T2", securityLayer:"bordersec", unlockLevel:20 },
  { id:"高能战术萃取物", name:"高能战术萃取物", tier:"T3", securityLayer:"lowsec",   unlockLevel:40 },
  { id:"极化战术介质",   name:"极化战术介质",   tier:"T4", securityLayer:"deepsec",  unlockLevel:60 },
  { id:"深层适应性样本", name:"深层适应性样本", tier:"T5", securityLayer:"nullsec",  unlockLevel:80 }
]);

// 星带安全层 → 战术材料（deepnull 复用 T5，高级不掉低级）。§6.4 / §7.1。
const TACTICAL_MATERIAL_BY_LAYER = Object.freeze({
  highsec:"战术残液",
  bordersec:"活性战术凝胶",
  lowsec:"高能战术萃取物",
  deepsec:"极化战术介质",
  nullsec:"深层适应性样本",
  deepnull:"深层适应性样本"
});

/* ----------------------------------------------------------------
   30 条增强剂唯一事实来源（§4 表 A/B/C 逐字段静态声明）。
   字段顺序：[series, quality, level, time, xp,
             planetName, planetQty, secondKey, secondQty,
             effectType, effectValue, slot]
   - planet 恒为 planetary:<产物名>，数量 planetQty。
   - secondKey 为完整资源键（special:<战术材料> 或 gas:<气体名>）。
   - outputQty 恒为 1，durationMs 恒为 180000。
   ---------------------------------------------------------------- */
const BOOSTER_DEFS = [
  // ---- 普通档（解锁 1/4/7/10/13/16/20/24/28/32）----
  ["mining_lubricant","n", 1,18,  5,"重金属",2,"special:战术残液",2,"miningSpeed",0.08,"miningSpeed"],
  ["shield_recharge","n",  4,18,  6,"稀有气体",2,"gas:粗制富勒烯",1,"repairAmount",0.10,"combatRepair"],
  ["ore_resonance","n",    7,19,  7,"重金属",2,"special:战术残液",2,"doubleMineral",0.10,"miningYield"],
  ["laser_coolant","n",   10,19,  8,"稀有气体",2,"gas:氦同位素",1,"damageMultiplier",0.06,"combatWeapon"],
  ["relic_solver","n",    13,20,  9,"稀有气体",2,"special:战术残液",2,"archaeologySpeed",-0.08,"archaeologySpeed"],
  ["armor_nano","n",      16,20, 10,"稀有气体",2,"gas:氦同位素",1,"repairAmount",0.10,"combatRepair"],
  ["missile_catalyst","n",20,21, 11,"同位素",2,"gas:稳定富勒烯",1,"damageMultiplier",0.06,"combatWeapon"],
  ["artifact_tracer","n", 24,21, 12,"同位素",2,"special:战术残液",2,"rareShift",1.25,"archaeologyRare"],
  ["cannon_booster","n",  28,22, 13,"同位素",2,"gas:稳定富勒烯",1,"damageMultiplier",0.06,"combatWeapon"],
  ["structure_gel","n",   32,22, 14,"同位素",2,"gas:稳定富勒烯",1,"repairAmount",0.10,"combatRepair"],
  // ---- 精工档（解锁 35/39/43/47/51/55/59/63/67/71）----
  ["mining_lubricant","r",35,56, 50,"同位素",3,"special:活性战术凝胶",4,"miningSpeed",0.18,"miningSpeed"],
  ["shield_recharge","r", 39,58, 53,"稀有气体",3,"gas:稳定富勒烯",2,"repairAmount",0.25,"combatRepair"],
  ["ore_resonance","r",   43,60, 56,"等离子体",3,"special:高能战术萃取物",4,"doubleMineral",0.20,"miningYield"],
  ["laser_coolant","r",   47,62, 59,"等离子体",3,"gas:氢同位素",2,"damageMultiplier",0.14,"combatWeapon"],
  ["relic_solver","r",    51,64, 62,"等离子体",3,"special:高能战术萃取物",4,"archaeologySpeed",-0.16,"archaeologySpeed"],
  ["armor_nano","r",      55,66, 65,"等离子体",3,"gas:高纯富勒烯",2,"repairAmount",0.25,"combatRepair"],
  ["missile_catalyst","r",59,68, 68,"等离子体",3,"gas:高纯富勒烯",2,"damageMultiplier",0.14,"combatWeapon"],
  ["artifact_tracer","r", 63,70, 71,"生物质",3,"special:极化战术介质",4,"rareShift",1.60,"archaeologyRare"],
  ["cannon_booster","r",  67,72, 74,"等离子体",3,"gas:高纯富勒烯",2,"damageMultiplier",0.14,"combatWeapon"],
  ["structure_gel","r",   71,74, 77,"生物质",3,"special:极化战术介质",4,"repairAmount",0.25,"combatRepair"],
  // ---- 传奇档（解锁 60/64/68/72/76/80/84/88/92/96）----
  ["mining_lubricant","l",60,128,306,"生物质",5,"special:极化战术介质",7,"miningSpeed",0.30,"miningSpeed"],
  ["shield_recharge","l", 64,131,315,"生物质",5,"gas:高纯富勒烯",3,"repairAmount",0.45,"combatRepair"],
  ["ore_resonance","l",   68,135,326,"等离子体",5,"special:极化战术介质",7,"doubleMineral",0.30,"miningYield"],
  ["laser_coolant","l",   72,138,335,"生物质",5,"gas:聚合气体",3,"damageMultiplier",0.24,"combatWeapon"],
  ["relic_solver","l",    76,142,346,"生物质",5,"special:极化战术介质",7,"archaeologySpeed",-0.25,"archaeologySpeed"],
  ["armor_nano","l",      80,146,356,"磁场聚合物",5,"gas:聚合气体",3,"repairAmount",0.45,"combatRepair"],
  ["missile_catalyst","l",84,149,365,"磁场聚合物",5,"gas:聚合气体",3,"damageMultiplier",0.24,"combatWeapon"],
  ["artifact_tracer","l", 88,153,376,"磁场聚合物",5,"special:深层适应性样本",7,"rareShift",2.20,"archaeologyRare"],
  ["cannon_booster","l",  92,156,385,"磁场聚合物",5,"gas:超纯聚合气体",3,"damageMultiplier",0.24,"combatWeapon"],
  ["structure_gel","l",   96,160,396,"磁场聚合物",5,"gas:超纯聚合气体",3,"repairAmount",0.45,"combatRepair"],
  // ---- 考古新增增幅剂（8 系列 × 3 品质，默认锁定，需对应蓝图解锁）----
  // 气云流变剂：采气速度
  ["gas_rheology","n",  33, 64,  5,"同位素",3,"special:活性战术凝胶",4,"gasSpeed",0.08,"gasSpeed",true],
  ["gas_rheology","r",  73,124, 70,"等离子体",3,"special:高能战术萃取物",4,"gasSpeed",0.18,"gasSpeed",true],
  ["gas_rheology","l",  89,148,322,"生物质",5,"special:极化战术介质",7,"gasSpeed",0.30,"gasSpeed",true],
  // 富勒烯成核剂：采气产量翻倍概率
  ["fullerene_nucleation","n",34, 65,  6,"同位素",3,"special:活性战术凝胶",4,"gasDouble",0.10,"gasYield",true],
  ["fullerene_nucleation","r",74,125, 71,"等离子体",3,"special:高能战术萃取物",4,"gasDouble",0.20,"gasYield",true],
  ["fullerene_nucleation","l",90,149,326,"生物质",5,"special:极化战术介质",7,"gasDouble",0.30,"gasYield",true],
  // 高温助熔剂：冶炼速度
  ["high_temp_flux","n", 35, 67,  8,"同位素",3,"special:活性战术凝胶",4,"smeltSpeed",0.08,"smeltSpeed",true],
  ["high_temp_flux","r", 75,127, 73,"等离子体",3,"special:高能战术萃取物",4,"smeltSpeed",0.18,"smeltSpeed",true],
  ["high_temp_flux","l", 91,151,330,"生物质",5,"special:极化战术介质",7,"smeltSpeed",0.30,"smeltSpeed",true],
  // 晶格增殖剂：冶炼产量翻倍概率
  ["lattice_proliferation","n",36, 68,  9,"同位素",3,"special:活性战术凝胶",4,"smeltDouble",0.10,"smeltYield",true],
  ["lattice_proliferation","r",76,128, 74,"等离子体",3,"special:高能战术萃取物",4,"smeltDouble",0.20,"smeltYield",true],
  ["lattice_proliferation","l",92,152,334,"生物质",5,"special:极化战术介质",7,"smeltDouble",0.30,"smeltYield",true],
  // 装配协调剂：舰船工程速度
  ["assembly_coordinator","n",37, 70, 10,"同位素",3,"special:活性战术凝胶",4,"shipSpeed",0.08,"shipSpeed",true],
  ["assembly_coordinator","r",77,130, 75,"等离子体",3,"special:高能战术萃取物",4,"shipSpeed",0.18,"shipSpeed",true],
  ["assembly_coordinator","l",93,154,338,"生物质",5,"special:极化战术介质",7,"shipSpeed",0.30,"shipSpeed",true],
  // 精密配给剂：舰船/装备制造通用材料减料（普通-10%/门槛+5、精工-12%/门槛+7、传奇-15%/门槛+10；耗时70/130/154s，需蓝图递增）
  ["precision_rationing","n",38, 70, 12,"同位素",3,"special:活性战术凝胶",4,"shipMaterialDiscount",0.10,"shipYield",true,null,       0,5],
  ["precision_rationing","r",78,130, 76,"等离子体",3,"special:高能战术萃取物",4,"shipMaterialDiscount",0.12,"shipYield",true,null,0,7],
  ["precision_rationing","l",94,154,342,"生物质",5,"special:极化战术介质",7,"shipMaterialDiscount",0.15,"shipYield",true,null,0,10],
  // 装备总装协调剂：装备工程速度（直解锁；耗时 70/130/154s；镜像舰船装配协调剂 +8%/+18%/+30%）
  ["equipment_assembly","n",38, 70, 11,"同位素",3,"special:活性战术凝胶",4,"equipmentSpeed",0.08,"equipmentSpeed",false],
  ["equipment_assembly","r",78,130, 76,"等离子体",3,"special:高能战术萃取物",4,"equipmentSpeed",0.18,"equipmentSpeed",false],
  ["equipment_assembly","l",94,154,342,"生物质",5,"special:极化战术介质",7,"equipmentSpeed",0.30,"equipmentSpeed",false],
  // 反应加速介质：增幅剂制造速度
  ["reaction_accelerant","n",39, 73, 13,"同位素",3,"special:活性战术凝胶",4,"boosterSpeed",0.08,"boosterSpeed",true],
  ["reaction_accelerant","r",79,133, 78,"等离子体",3,"special:高能战术萃取物",4,"boosterSpeed",0.18,"boosterSpeed",true],
  ["reaction_accelerant","l",95,157,346,"生物质",5,"special:极化战术介质",7,"boosterSpeed",0.30,"boosterSpeed",true],
  // 反应链增殖剂：增幅剂产量翻倍概率
  ["reaction_chain_proliferation","n",40, 74, 14,"同位素",3,"special:活性战术凝胶",4,"boosterDouble",0.10,"boosterYield",true],
  ["reaction_chain_proliferation","r",80,134, 79,"等离子体",3,"special:高能战术萃取物",4,"boosterDouble",0.20,"boosterYield",true],
  ["reaction_chain_proliferation","l",96,158,350,"生物质",5,"special:极化战术介质",7,"boosterDouble",0.30,"boosterYield",true],
  // ---- 技能训练（神经训练催化器，全局技能经验获取增强；普通直解锁，精工/传奇需货柜蓝图）----
  // 普通：直解锁（requiresBlueprint:false），不进任何考古/货柜蓝图池
  ["neural_booster","n",42,64,16,"同位素",3,"special:活性战术凝胶",4,"skillXpMultiplier",0.05,"any",false,"gas:氦同位素",4],
  // 精工：需蓝图，M/L/XL 货柜掉落
  ["neural_booster","r",82,124,82,"等离子体",3,"special:高能战术萃取物",4,"skillXpMultiplier",0.10,"any",true,"gas:氢同位素",4],
  // 传奇：需蓝图，L/XL 货柜掉落
  ["neural_booster","l",98,148, 358,"生物质",5,"special:极化战术介质",7,"skillXpMultiplier",0.15,"any",true,"gas:聚合气体",2],
  // ---- 技能超载催化器（通用件 universal，全部采集/制造技能临时 +等级；直解锁；归入技能训练；180s）----
  ["skill_overdrive","n",30,180, 18,"同位素",3,"special:活性战术凝胶",4,"skillLevelBonus",3,"any",false,null,0,0],
  ["skill_overdrive","r",70,180, 88,"等离子体",3,"special:高能战术萃取物",4,"skillLevelBonus",5,"any",false,null,0,0],
  ["skill_overdrive","l",92,180,376,"生物质",5,"special:极化战术介质",7,"skillLevelBonus",7,"any",false,null,0,0]
];

// 由唯一事实来源展开为 BOOSTER_ITEMS（map）与 BOOSTER_RECIPES（array），二者一一对应 30 条。
const BOOSTER_ITEMS = {};
const BOOSTER_RECIPES = [];
(function buildBoosterTables() {
  for (const def of BOOSTER_DEFS) {
    const [seriesKey, qualityKey, level, time, xp, planetName, planetQty, secondKey, secondQty, effectType, effectValue, slot, requiresBlueprint=false, thirdKey=null, thirdQty=0, levelGateBonus=0] = def;
    const series = BOOSTER_SERIES[seriesKey];
    const quality = BOOSTER_QUALITIES[qualityKey];
    const id = seriesKey + "_" + qualityKey;               // 例：mining_lubricant_n
    const itemId = "booster:" + id;                          // 资源命名空间键
    const name = series.name + "·" + quality.name;
    const item = {
      id,
      itemId,
      name,
      series:seriesKey,
      seriesName:series.name,
      category:series.category,
      quality:qualityKey,
      qualityName:quality.name,
      level,
      durationMs:BOOSTER_DURATION_MS,
      slot: (slot === "any" ? null : slot),
      universal: (slot === "any"),
      effectType,
      effectValue,
      levelGate: levelGateBonus,
      weaponType:series.weaponType || null,
      repairTarget:series.repairTarget || null,
      description:name + "：" + describeBoosterEffect(effectType, effectValue, series.repairTarget, levelGateBonus)
    };
    BOOSTER_ITEMS[id] = item;
    BOOSTER_RECIPES.push({
      id,
      itemId,
      // 正式中文名称：与 BOOSTER_ITEMS[id].name 同源（系列名·品质名），
      // 是 UI 唯一允许的显示字段；id 仅作稳定内部键与调试用，禁止外泄到界面。
      name,
      series:seriesKey,
      // 分类标签（UI 自动线下拉 <optgroup> 分组用）：与 BOOSTER_ITEMS 同源，取自 series.category。
      // 之前漏带此字段，导致所有增强剂配方 category 为 undefined、下拉无法分组。
      category:series.category,
      quality:qualityKey,
      level,
      time,
      xp,
      cost:{
        ["planetary:" + planetName]:planetQty,
        [secondKey]:secondQty,
        ...(thirdKey ? { [thirdKey]: thirdQty } : {})
      },
      output:{ type:"booster", itemId, qty:1 },
      durationMs:BOOSTER_DURATION_MS,
      effect:{ type:effectType, value:effectValue, slot, repairTarget:series.repairTarget || null },
      levelGateBonus:Math.max(0, Number(levelGateBonus) || 0),
      requiresBlueprint: !!requiresBlueprint
    });
  }
})();

function describeBoosterEffect(effectType, value, repairTarget, levelGateBonus, slotSkill) {
  switch (effectType) {
    case "miningSpeed":       return "采矿速度 +" + Math.round(value * 100) + "%";
    case "doubleMineral":     return "矿物翻倍概率 " + Math.round(value * 100) + "%";
    case "archaeologySpeed":  return "考古周期 " + Math.round(value * 100) + "%";
    case "rareShift":         return "稀有发现 ×" + value.toFixed(2);
    case "damageMultiplier":  return "武器伤害 +" + Math.round(value * 100) + "%";
    case "repairAmount": {
      const targetNames = { shield:"护盾", armor:"装甲", structure:"结构" };
      return (targetNames[repairTarget] || "维修") + "维修量 +" + Math.round(value * 100) + "%";
    }
    case "gasSpeed":          return "采气速度 +" + Math.round(value * 100) + "%";
    case "gasDouble":         return "采气产量翻倍概率 " + Math.round(value * 100) + "%";
    case "smeltSpeed":        return "冶炼速度 +" + Math.round(value * 100) + "%";
    case "smeltDouble":       return "冶炼产量翻倍概率 " + Math.round(value * 100) + "%";
    case "shipSpeed":         return "舰船工程速度 +" + Math.round(value * 100) + "%";
    case "equipmentSpeed":     return "装备工程速度 +" + Math.round(value * 100) + "%";
    case "shipMaterialDiscount": return "制造材料减免（舰船工程与装备制造通用） -" + Math.round(value * 100) + "%（激活期间舰船/装备制造配方等级门槛各 +" + (Number(levelGateBonus) || 0) + "）";
    case "boosterSpeed":      return "增幅剂制造速度 +" + Math.round(value * 100) + "%";
    case "boosterDouble":     return "增幅剂产量翻倍概率 " + Math.round(value * 100) + "%";
    case "skillXpMultiplier": return "对应类别技能经验 +" + Math.round(value * 100) + "%（按装备槽位作用域化）";
  case "skillLevelBonus":   return (slotSkill || "装备槽对应技能") + "等级 +" + Math.round(value) + "（临时，离线生效）";
    default:                  return effectType + " " + value;
  }
}

const BOOSTER_SLOTS = Object.freeze([
  "miningSpeed", "miningYield",
  "archaeologySpeed", "archaeologyRare",
  "gasSpeed", "gasYield",
  "smeltSpeed", "smeltYield",
  "shipSpeed", "shipYield",
  "equipmentSpeed", "equipmentYield",
  "boosterSpeed", "boosterYield",
  "combatWeapon", "combatRepair"
]);

function getBoosterItem(id) {
  if (!id) return null;
  const key = String(id).startsWith("booster:") ? String(id).slice("booster:".length) : String(id);
  return BOOSTER_ITEMS[key] || null;
}

function getBoosterRecipe(id) {
  if (!id) return null;
  const key = String(id).startsWith("booster:") ? String(id).slice("booster:".length) : String(id);
  return BOOSTER_RECIPES.find(recipe => recipe.id === key) || null;
}

// 考古重做：增幅剂蓝图与装备蓝图共用 state.ownedBlueprints 唯一事实源。
// 蓝图键前缀 "booster:" 与装备 "equipment:" 区分，互不冲突。
function getBoosterBlueprintOwnershipKey(recipeId) {
  return "booster:" + recipeId;
}
function hasBoosterBlueprintFromState(state, recipeId) {
  return Array.isArray(state && state.ownedBlueprints) &&
    state.ownedBlueprints.includes(getBoosterBlueprintOwnershipKey(recipeId));
}
function boosterRecipeHasRequiredBlueprint(state, recipe) {
  return !recipe || !recipe.requiresBlueprint || hasBoosterBlueprintFromState(state, recipe.id);
}

// 显式挂 window（普通 script 全局加载约定）。
window.BOOSTER_DURATION_MS = BOOSTER_DURATION_MS;
window.BOOSTER_QUALITIES = BOOSTER_QUALITIES;
window.BOOSTER_SERIES = BOOSTER_SERIES;
window.BOOSTER_CATEGORY_META = BOOSTER_CATEGORY_META;
window.BOOSTER_ITEMS = BOOSTER_ITEMS;
window.BOOSTER_RECIPES = BOOSTER_RECIPES;
window.BOOSTER_SLOTS = BOOSTER_SLOTS;
window.TACTICAL_MATERIALS = TACTICAL_MATERIALS;
window.TACTICAL_MATERIAL_BY_LAYER = TACTICAL_MATERIAL_BY_LAYER;
window.getBoosterItem = getBoosterItem;
window.getBoosterRecipe = getBoosterRecipe;
window.getBoosterBlueprintOwnershipKey = getBoosterBlueprintOwnershipKey;
window.hasBoosterBlueprintFromState = hasBoosterBlueprintFromState;
window.boosterRecipeHasRequiredBlueprint = boosterRecipeHasRequiredBlueprint;
