var MINING_AREAS = [
  { name: "凡晶石带",   ore: "凡晶石", mode:"normal", level: 1,  baseTime: 15,   baseXP: 10,  color:"#b5a37d" },
  { name: "灼烧岩带",   ore: "灼烧岩", mode:"normal", level: 10, baseTime: 30,   baseXP: 30,  color:"#b66b47" },
  { name: "水硼砂带",   ore: "水硼砂", mode:"normal", level: 20, baseTime: 52.5, baseXP: 70,  color:"#79b4ca" },
  { name: "斜长岩带",   ore: "斜长岩", mode:"normal", level: 40, baseTime: 90,   baseXP: 140, color:"#8f95ad" },
  { name: "干焦岩带",   ore: "干焦岩", mode:"normal", level: 55, baseTime: 135,  baseXP: 230, color:"#b56b3f" },
  { name: "灰岩带",     ore: "灰岩",   mode:"normal", level: 70, baseTime: 195,  baseXP: 370, color:"#8d9aa2" },
  { name: "艾克诺岩带", ore: "艾克诺岩", mode:"normal", level: 85, baseTime: 285,  baseXP: 580, color:"#56bba8" }
];

const MOON_MINING_AREAS = [
  { name:"镓月岩带", ore:"镓", mode:"moon", level:20, baseTime:90,  baseXP:100, color:"#67c9dc" },
  { name:"铂月岩带", ore:"铂", mode:"moon", level:20, baseTime:90,  baseXP:100, color:"#d8e1e8" },
  { name:"铪月岩带", ore:"铪", mode:"moon", level:40, baseTime:180, baseXP:240, color:"#72a7ee" },
  { name:"锇月岩带", ore:"锇", mode:"moon", level:40, baseTime:180, baseXP:240, color:"#ad8ade" },
  { name:"钷月岩带", ore:"钷", mode:"moon", level:55, baseTime:315, baseXP:450, color:"#ef777c" },
  { name:"铷月岩带", ore:"铷", mode:"moon", level:70, baseTime:540, baseXP:870, color:"#dfad58" }
];
const ALL_MINING_AREAS = [...MINING_AREAS, ...MOON_MINING_AREAS];

const ITEM_CATEGORIES = {
  ore:       ["凡晶石","灼烧岩","水硼砂","斜长岩","干焦岩","灰岩","艾克诺岩"],
  mineral:   ["三钛合金","类银超金属","类晶体胶矿","同位聚合体","超新星诺克石","基腹断岩","超噬矿","莫尔石"],
  planetary: ["重金属","稀有气体","同位素","行星内核产物","等离子体","生物质","磁场聚合物"],
  gases:      ["粗制富勒烯","氦同位素","稳定富勒烯","氢同位素","高纯富勒烯","聚合气体","超纯聚合气体"],
  moon:       ["镓","铂","铪","锇","钷","铷"],
  consumable: ["燃料单元","激光晶体弹药","导弹","炮台弹药","纳米维修膏"],
  special: COMBAT_SPECIAL_MATERIALS.slice(),
  equipment: SHIP_COMPONENT_RECIPES.map(recipe => recipe.name)
};
ITEM_CATEGORIES.equipment.push(...Object.values(EQUIPMENT_DB).map(equipment => equipment.name));
const ITEM_ICONS = {
  "凡晶石":"🪨","灼烧岩":"🪨","水硼砂":"🪨","斜长岩":"🪨","干焦岩":"🪨","灰岩":"🪨","艾克诺岩":"💎","莫尔石":"💠",
  "三钛合金":"🧱","类银超金属":"🧱","类晶体胶矿":"🧱","同位聚合体":"🧱","超新星诺克石":"🧱","基腹断岩":"🧱","超噬矿":"🧱",
  "重金属":"🪨","稀有气体":"💨","同位素":"❄️","行星内核产物":"🌋","等离子体":"🌌","生物质":"🌿","磁场聚合物":"🧲",
  "粗制富勒烯":"☁️","氦同位素":"☁️","稳定富勒烯":"☁️","氢同位素":"☁️","高纯富勒烯":"☁️","聚合气体":"☁️","超纯聚合气体":"☁️",
  "镓":"🌙","铂":"🌙","铪":"🌙","锇":"🌙","钷":"🌙","铷":"🌙",
   "晶体弹药":"💥","纳米维修膏":"🧴","跃迁燃料":"⛽",
   "燃料单元":"⛽","激光晶体弹药":"🔫","聚焦相位激光弹":"🔫","导弹":"🚀","高爆制导导弹":"🚀","炮台弹药":"💣","重型轨道弹药":"💣",
  "船体骨架":"🏗️","推进系统":"⚙️","核心系统":"🔮","护盾发生器":"🛡️","装甲镀层":"🔩","武器挂架":"🔧","外置货舱":"📦","工业挂架":"🏗️","T1采矿激光器":"🔴","T1气云采集器":"🟢","T1无人机控制单元":"🤖","小型护盾扩展":"🛡️","T1采矿提升器":"⬆️","T1采气提升器":"⬆️",
  "小型激光炮 I":"⚡","轻型导弹发射器 I":"🚀","小型射弹炮 I":"💥","小型护盾回充器 I":"🛡️","小型装甲维修器 I":"🔧","小型结构修理器 I":"⚒️"
};
// 原矿图标以显示名映射；内部库存键和玩家可见名都指向同一张图。
const ORE_ICON_ASSETS = Object.freeze({
  "铁硅原矿":"铁硅原矿-iron-silicate-ore.webp",
  "赤镍矿":"赤镍矿-red-nickel-ore.webp",
  "蓝硼晶":"蓝硼晶-blue-boron-crystal.webp",
  "同位晶簇":"同位晶簇-isotope-crystal-cluster.webp",
  "诺瓦矿":"诺瓦矿-nova-ore.webp",
  "重锆岩":"重锆岩-heavy-zircon-rock.webp",
  "极星矿":"极星矿-polar-star-ore.webp"
});
for (const [internalName, displayName] of Object.entries(DisplayNames.ORE_NAMES)) {
  const asset = ORE_ICON_ASSETS[displayName];
  if (!asset) continue;
  const iconMarkup = `<img class="item-icon-image" src="./assets/icons/ores/${asset}?v=2" alt="" loading="lazy" decoding="async">`;
  ITEM_ICONS[displayName] = iconMarkup;
  ITEM_ICONS[internalName] = iconMarkup;
}
// 月矿图标按矿种显示名映射；已制作的图标同时用于仓库物品卡和月矿带卡片。
const MOON_ICON_ASSETS = Object.freeze({
  "镓":"镓-gallium-moon-ore.webp",
  "铂":"铂-platinum-moon-ore.webp",
  "铪":"铪-hafnium-moon-ore.webp",
  "锇":"锇-osmium-moon-ore.webp",
  "钷":"钷-promethium-moon-ore.webp",
  "铷":"铷-rubidium-moon-ore.webp"
});
for (const [moonOre, asset] of Object.entries(MOON_ICON_ASSETS)) {
  const iconMarkup = `<img class="item-icon-image" src="./assets/icons/moon-ores/${asset}?v=1" alt="" loading="lazy" decoding="async">`;
  ITEM_ICONS[moonOre] = iconMarkup;
  ITEM_ICONS[`moon:${moonOre}`] = iconMarkup;
}
// 精炼矿物图标按显示名映射，文件名也使用中英双语。
const MINERAL_ICON_ASSETS = Object.freeze({
  "标准钛材":"标准钛材-standard-titanium.webp",
  "银镍合金":"银镍合金-silver-nickel-alloy.webp",
  "晶格聚合物":"晶格聚合物-lattice-polymer.webp",
  "同位复材":"同位复材-isotope-composite.webp",
  "诺瓦陶金":"诺瓦陶金-nova-cerametal.webp",
  "重锆晶材":"重锆晶材-heavy-zircon-material.webp",
  "奇点合金":"奇点合金-singularity-alloy.webp",
  "暗质晶核":"暗质晶核-dark-matter-core.webp"
});
for (const [internalName, displayName] of Object.entries(DisplayNames.MINERAL_NAMES)) {
  const asset = MINERAL_ICON_ASSETS[displayName];
  const iconMarkup = asset
    ? `<img class="item-icon-image" src="./assets/icons/minerals/${asset}?v=1" alt="" loading="lazy" decoding="async">`
    : ITEM_ICONS[internalName];
  if (!iconMarkup) continue;
  ITEM_ICONS[displayName] = iconMarkup;
  ITEM_ICONS[internalName] = iconMarkup;
}
// 行星资源按仓库显示名映射，图像保持透明底并沿用统一的 160px WebP 规格。
const PLANETARY_ICON_ASSETS = Object.freeze({
  "重金属":"重金属-heavy-metals.webp",
  "稀有气体":"稀有气体-noble-gases.webp",
  "同位素":"同位素-isotopes.webp",
  "行星内核产物":"行星内核产物-planetary-core-products.webp",
  "等离子体":"等离子体-plasma.webp",
  "生物质":"生物质-biomass.webp",
  "磁场聚合物":"磁场聚合物-magnetic-polymers.webp"
});
for (const [displayName, asset] of Object.entries(PLANETARY_ICON_ASSETS)) {
  ITEM_ICONS[displayName] = `<img class="item-icon-image" src="./assets/icons/planetary/${asset}?v=1" alt="" loading="lazy" decoding="async">`;
}
// 气体资源同样直接按显示名匹配，避免同类物品回退到通用云朵符号。
const GAS_ICON_ASSETS = Object.freeze({
  "粗制富勒烯":"粗制富勒烯-crude-fullerene.webp",
  "氦同位素":"氦同位素-helium-isotopes.webp",
  "稳定富勒烯":"稳定富勒烯-stable-fullerene.webp",
  "氢同位素":"氢同位素-hydrogen-isotopes.webp",
  "高纯富勒烯":"高纯富勒烯-high-purity-fullerene.webp",
  "聚合气体":"聚合气体-polymerized-gas.webp",
  "超纯聚合气体":"超纯聚合气体-ultra-pure-polymerized-gas.webp"
});
for (const [displayName, asset] of Object.entries(GAS_ICON_ASSETS)) {
  ITEM_ICONS[displayName] = `<img class="item-icon-image" src="./assets/icons/gases/${asset}?v=1" alt="" loading="lazy" decoding="async">`;
}
const STAR_BELT_DATA_ICON_ASSETS = Object.freeze({
  "天使初级加密数据":"天使初级加密数据-angel-basic-encrypted-data.webp",
  "血袭者初级加密数据":"血袭者初级加密数据-blood-raider-basic-encrypted-data.webp",
  "萨沙初级加密数据":"萨沙初级加密数据-sansha-basic-encrypted-data.webp",
  "天使低级加密数据":"天使低级加密数据-angel-low-grade-encrypted-data.webp",
  "血袭者低级加密数据":"血袭者低级加密数据-blood-raider-low-grade-encrypted-data.webp",
  "萨沙低级加密数据":"萨沙低级加密数据-sansha-low-grade-encrypted-data.webp",
  "天使中级加密数据":"天使中级加密数据-angel-medium-grade-encrypted-data.webp",
  "血袭者中级加密数据":"血袭者中级加密数据-blood-raider-medium-grade-encrypted-data.webp",
  "萨沙中级加密数据":"萨沙中级加密数据-sansha-medium-grade-encrypted-data.webp",
  "天使高级加密数据":"天使高级加密数据-angel-high-grade-encrypted-data.webp",
  "血袭者高级加密数据":"血袭者高级加密数据-blood-raider-high-grade-encrypted-data.webp",
  "萨沙高级加密数据":"萨沙高级加密数据-sansha-high-grade-encrypted-data.webp"
});
for (const [displayName, asset] of Object.entries(STAR_BELT_DATA_ICON_ASSETS)) {
  const iconMarkup = `<img class="item-icon-image" src="./assets/icons/star-belt-data/${asset}?v=1" alt="" loading="lazy" decoding="async">`;
  ITEM_ICONS[displayName] = iconMarkup;
  ITEM_ICONS[`special:${displayName}`] = iconMarkup;
}
const GEAR_DATA_ICON_ASSETS = Object.freeze({
  "苍穹劫团装备生产许可D":"苍穹劫团装备生产许可D-celestial-guristas-equipment-production-license-d.webp",
  "苍穹劫团装备生产许可C":"苍穹劫团装备生产许可C-celestial-guristas-equipment-production-license-c.webp",
  "苍穹劫团装备生产许可B":"苍穹劫团装备生产许可B-celestial-guristas-equipment-production-license-b.webp",
  "苍穹劫团装备生产许可A":"苍穹劫团装备生产许可A-celestial-guristas-equipment-production-license-a.webp",
  "苍穹劫团装备生产许可S":"苍穹劫团装备生产许可S-celestial-guristas-equipment-production-license-s.webp",
  "赤誓教团装备生产许可D":"赤誓教团装备生产许可D-red-oath-sect-equipment-production-license-d.webp",
  "赤誓教团装备生产许可C":"赤誓教团装备生产许可C-red-oath-sect-equipment-production-license-c.webp",
  "赤誓教团装备生产许可B":"赤誓教团装备生产许可B-red-oath-sect-equipment-production-license-b.webp",
  "赤誓教团装备生产许可A":"赤誓教团装备生产许可A-red-oath-sect-equipment-production-license-a.webp",
  "赤誓教团装备生产许可S":"赤誓教团装备生产许可S-red-oath-sect-equipment-production-license-s.webp",
  "静默集群装备生产许可D":"静默集群装备生产许可D-silent-cluster-equipment-production-license-d.webp",
  "静默集群装备生产许可C":"静默集群装备生产许可C-silent-cluster-equipment-production-license-c.webp",
  "静默集群装备生产许可B":"静默集群装备生产许可B-silent-cluster-equipment-production-license-b.webp",
  "静默集群装备生产许可A":"静默集群装备生产许可A-silent-cluster-equipment-production-license-a.webp",
  "静默集群装备生产许可S":"静默集群装备生产许可S-silent-cluster-equipment-production-license-s.webp"
});
for (const [displayName, asset] of Object.entries(GEAR_DATA_ICON_ASSETS)) {
  const iconMarkup = `<img class="item-icon-image" src="./assets/icons/gear-permits/${asset}?v=1" alt="" loading="lazy" decoding="async">`;
  ITEM_ICONS[displayName] = iconMarkup;
  ITEM_ICONS[`special:${displayName}`] = iconMarkup;
}
const STATION_CORE_ICON_ASSETS = Object.freeze({
  "空间站冶炼核心":"空间站冶炼核心-station-smelting-core.webp",
  "空间站船坞核心":"空间站船坞核心-station-shipyard-core.webp",
  "空间站装备制造核心":"空间站装备制造核心-station-equipment-manufacturing-core.webp",
  "空间站增强剂制造核心":"空间站增强剂制造核心-station-booster-manufacturing-core.webp",
  "空间站先驱核心":"空间站先驱核心-station-precursor-core.webp"
});
for (const [displayName, asset] of Object.entries(STATION_CORE_ICON_ASSETS)) {
  const iconMarkup = `<img class="item-icon-image" src="./assets/icons/station-cores/${asset}?v=1" alt="" loading="lazy" decoding="async">`;
  ITEM_ICONS[displayName] = iconMarkup;
  ITEM_ICONS[`special:${displayName}`] = iconMarkup;
}
const CARGO_CONTAINER_ICON_ASSETS = Object.freeze({
  "货柜S":"货柜S-small-cargo-container.webp",
  "货柜M":"货柜M-medium-cargo-container.webp",
  "货柜L":"货柜L-large-cargo-container.webp",
  "货柜XL":"货柜XL-extra-large-cargo-container.webp"
});
for (const [displayName, asset] of Object.entries(CARGO_CONTAINER_ICON_ASSETS)) {
  const iconMarkup = `<img class="item-icon-image" src="./assets/icons/cargo-containers/${asset}?v=1" alt="" loading="lazy" decoding="async">`;
  ITEM_ICONS[displayName] = iconMarkup;
  ITEM_ICONS[`special:${displayName}`] = iconMarkup;
}
const NEURAL_IMPLANT_ICON_ASSETS = Object.freeze({
  "神经植入体·攻击":"神经植入体·攻击-neural-implant-attack.webp",
  "神经植入体·防御":"神经植入体·防御-neural-implant-defense.webp",
  "神经植入体·工程":"神经植入体·工程-neural-implant-engineering.webp",
  "神经植入体·指挥":"神经植入体·指挥-neural-implant-command.webp"
});
for (const [displayName, asset] of Object.entries(NEURAL_IMPLANT_ICON_ASSETS)) {
  const iconMarkup = `<img class="item-icon-image" src="./assets/icons/neural-implants/${asset}?v=1" alt="" loading="lazy" decoding="async">`;
  ITEM_ICONS[displayName] = iconMarkup;
  ITEM_ICONS[`special:${displayName}`] = iconMarkup;
}
const CONSUMABLE_ICON_ASSETS = Object.freeze({
  "标准燃料单元":"标准燃料单元-standard-fuel-cell.webp",
  "强化燃料单元":"强化燃料单元-reinforced-fuel-cell.webp",
  "超纯燃料单元":"超纯燃料单元-ultra-pure-fuel-cell.webp",
  "跃迁燃料":"跃迁燃料-warp-fuel.webp",
  "纳米维修膏":"纳米维修膏-nano-repair-paste.webp"
});
for (const [displayName, asset] of Object.entries(CONSUMABLE_ICON_ASSETS)) {
  ITEM_ICONS[displayName] = `<img class="item-icon-image" src="./assets/icons/consumables/${asset}?v=1" alt="" loading="lazy" decoding="async">`;
}
ITEM_ICONS["燃料单元"] = ITEM_ICONS["标准燃料单元"];
// 战术材料按解锁档位使用独立图标，仓库与制造材料栏共用。
const TACTICAL_MATERIAL_ICON_ASSETS = Object.freeze({
  "战术残液":"战术残液-tactical-residue.webp",
  "活性战术凝胶":"活性战术凝胶-reactive-tactical-gel.webp",
  "高能战术萃取物":"高能战术萃取物-high-energy-tactical-extract.webp",
  "极化战术介质":"极化战术介质-polarized-tactical-medium.webp",
  "深层适应性样本":"深层适应性样本-deep-layer-adaptive-sample.webp"
});
for (const [displayName, asset] of Object.entries(TACTICAL_MATERIAL_ICON_ASSETS)) {
  const iconMarkup = `<img class="item-icon-image" src="./assets/icons/tactical-materials/${asset}?v=1" alt="" loading="lazy" decoding="async">`;
  ITEM_ICONS[displayName] = iconMarkup;
  ITEM_ICONS[`special:${displayName}`] = iconMarkup;
}
// 虫洞通行凭证与暗流体泵助熔触媒使用独立的透明材料图标。
const WORMHOLE_MATERIAL_ICON_ASSETS = Object.freeze({
  "虫洞印记":"虫洞印记-wormhole-mark.webp",
  "暗流体助熔触媒":"暗流体助熔触媒-dark-fluid-fusion-catalyst.webp"
});
for (const [displayName, asset] of Object.entries(WORMHOLE_MATERIAL_ICON_ASSETS)) {
  const iconMarkup = `<img class="item-icon-image" src="./assets/icons/wormhole-materials/${asset}?v=1" alt="" loading="lazy" decoding="async">`;
  ITEM_ICONS[displayName] = iconMarkup;
  ITEM_ICONS[`special:${displayName}`] = iconMarkup;
}
// 增强剂图标按玩家可见名称映射；同系列不同品质保留递进外形。
const BOOSTER_ICON_ASSETS = Object.freeze({
  "纳米采掘润滑剂·普通":"纳米采掘润滑剂·普通-mining-nanofriction-lubricant-standard.webp",
  "纳米采掘润滑剂·精工":"纳米采掘润滑剂·精工-mining-nanofriction-lubricant-refined.webp",
  "纳米采掘润滑剂·传奇":"纳米采掘润滑剂·传奇-mining-nanofriction-lubricant-legendary.webp",
  "富矿共振催化剂·普通":"富矿共振催化剂·普通-ore-resonance-catalyst-standard.webp",
  "富矿共振催化剂·精工":"富矿共振催化剂·精工-ore-resonance-catalyst-refined.webp",
  "富矿共振催化剂·传奇":"富矿共振催化剂·传奇-ore-resonance-catalyst-legendary.webp",
  "遗迹解析液·普通":"遗迹解析液·普通-relic-solver-standard.webp",
  "遗迹解析液·精工":"遗迹解析液·精工-relic-solver-refined.webp",
  "遗迹解析液·传奇":"遗迹解析液·传奇-relic-solver-legendary.webp",
  "文物示踪剂·普通":"文物示踪剂·普通-artifact-tracer-standard.webp",
  "文物示踪剂·精工":"文物示踪剂·精工-artifact-tracer-refined.webp",
  "文物示踪剂·传奇":"文物示踪剂·传奇-artifact-tracer-legendary.webp",
  "激光炮冷却剂·普通":"激光炮冷却剂·普通-laser-cannon-coolant-standard.webp",
  "激光炮冷却剂·精工":"激光炮冷却剂·精工-laser-cannon-coolant-refined.webp",
  "激光炮冷却剂·传奇":"激光炮冷却剂·传奇-laser-cannon-coolant-legendary.webp",
  "导弹燃烧催化剂·普通":"导弹燃烧催化剂·普通-missile-combustion-catalyst-standard.webp",
  "导弹燃烧催化剂·精工":"导弹燃烧催化剂·精工-missile-combustion-catalyst-refined.webp",
  "导弹燃烧催化剂·传奇":"导弹燃烧催化剂·传奇-missile-combustion-catalyst-legendary.webp",
  "火炮增压药·普通":"火炮增压药·普通-cannon-pressure-booster-standard.webp",
  "火炮增压药·精工":"火炮增压药·精工-cannon-pressure-booster-refined.webp",
  "火炮增压药·传奇":"火炮增压药·传奇-cannon-pressure-booster-legendary.webp",
  "护盾回充液·普通":"护盾回充液·普通-shield-recharge-fluid-standard.webp",
  "护盾回充液·精工":"护盾回充液·精工-shield-recharge-fluid-refined.webp",
  "护盾回充液·传奇":"护盾回充液·传奇-shield-recharge-fluid-legendary.webp",
  "装甲纳米修复剂·普通":"装甲纳米修复剂·普通-armor-nano-repair-agent-standard.webp",
  "装甲纳米修复剂·精工":"装甲纳米修复剂·精工-armor-nano-repair-agent-refined.webp",
  "装甲纳米修复剂·传奇":"装甲纳米修复剂·传奇-armor-nano-repair-agent-legendary.webp",
  "结构再生胶·普通":"结构再生胶·普通-structure-regeneration-gel-standard.webp",
  "结构再生胶·精工":"结构再生胶·精工-structure-regeneration-gel-refined.webp",
  "结构再生胶·传奇":"结构再生胶·传奇-structure-regeneration-gel-legendary.webp",
  "气云流变剂·普通":"气云流变剂·普通-gas-cloud-rheology-agent-standard.webp",
  "气云流变剂·精工":"气云流变剂·精工-gas-cloud-rheology-agent-refined.webp",
  "气云流变剂·传奇":"气云流变剂·传奇-gas-cloud-rheology-agent-legendary.webp",
  "富勒烯成核剂·普通":"富勒烯成核剂·普通-fullerene-nucleation-agent-standard.webp",
  "富勒烯成核剂·精工":"富勒烯成核剂·精工-fullerene-nucleation-agent-refined.webp",
  "富勒烯成核剂·传奇":"富勒烯成核剂·传奇-fullerene-nucleation-agent-legendary.webp",
  "高温助熔剂·普通":"高温助熔剂·普通-high-temperature-smelting-flux-standard.webp",
  "高温助熔剂·精工":"高温助熔剂·精工-high-temperature-smelting-flux-refined.webp",
  "高温助熔剂·传奇":"高温助熔剂·传奇-high-temperature-smelting-flux-legendary.webp",
  "晶格增殖剂·普通":"晶格增殖剂·普通-lattice-proliferation-agent-standard.webp",
  "晶格增殖剂·精工":"晶格增殖剂·精工-lattice-proliferation-agent-refined.webp",
  "晶格增殖剂·传奇":"晶格增殖剂·传奇-lattice-proliferation-agent-legendary.webp",
  "装配协调剂·普通":"装配协调剂·普通-assembly-coordinator-standard.webp",
  "装配协调剂·精工":"装配协调剂·精工-assembly-coordinator-refined.webp",
  "装配协调剂·传奇":"装配协调剂·传奇-assembly-coordinator-legendary.webp",
  "精密配给剂·普通":"精密配给剂·普通-precision-rationing-agent-standard.webp",
  "精密配给剂·精工":"精密配给剂·精工-precision-rationing-agent-refined.webp",
  "精密配给剂·传奇":"精密配给剂·传奇-precision-rationing-agent-legendary.webp",
  "装备总装协调剂·普通":"装备总装协调剂·普通-equipment-assembly-coordinator-standard.webp",
  "装备总装协调剂·精工":"装备总装协调剂·精工-equipment-assembly-coordinator-refined.webp",
  "装备总装协调剂·传奇":"装备总装协调剂·传奇-equipment-assembly-coordinator-legendary.webp",
  "反应加速介质·普通":"反应加速介质·普通-reaction-acceleration-medium-standard.webp",
  "反应加速介质·精工":"反应加速介质·精工-reaction-acceleration-medium-refined.webp",
  "反应加速介质·传奇":"反应加速介质·传奇-reaction-acceleration-medium-legendary.webp",
  "反应链增殖剂·普通":"反应链增殖剂·普通-reaction-chain-proliferator-standard.webp",
  "反应链增殖剂·精工":"反应链增殖剂·精工-reaction-chain-proliferator-refined.webp",
  "反应链增殖剂·传奇":"反应链增殖剂·传奇-reaction-chain-proliferator-legendary.webp",
  "神经训练催化器·普通":"神经训练催化器·普通-neural-training-catalyst-standard.webp",
  "神经训练催化器·精工":"神经训练催化器·精工-neural-training-catalyst-refined.webp",
  "神经训练催化器·传奇":"神经训练催化器·传奇-neural-training-catalyst-legendary.webp",
  "技能超载催化器·普通":"技能超载催化器·普通-skill-overload-catalyst-standard.webp",
  "技能超载催化器·精工":"技能超载催化器·精工-skill-overload-catalyst-refined.webp",
  "技能超载催化器·传奇":"技能超载催化器·传奇-skill-overload-catalyst-legendary.webp"
});
for (const [displayName, asset] of Object.entries(BOOSTER_ICON_ASSETS)) {
  ITEM_ICONS[displayName] = `<img class="item-icon-image" src="./assets/icons/boosters/${asset}?v=1" alt="" loading="lazy" decoding="async">`;
}
// 死亡空间图标：通行密钥按据点主题区分；核心与协议采用阵营色和品质递进。
const DEATHSPACE_TICKET_ICON_ASSETS = Object.freeze({
  "天使秘密补给站通行密钥":"天使秘密补给站通行密钥-angel-secret-supply-depot-key.webp",
  "血袭者仪式地窖通行密钥":"血袭者仪式地窖通行密钥-blood-raider-ritual-cellar-key.webp",
  "萨沙控制哨所通行密钥":"萨沙控制哨所通行密钥-sansha-control-outpost-key.webp",
  "天使劫掠者船坞通行密钥":"天使劫掠者船坞通行密钥-angel-raider-shipyard-key.webp",
  "血袭者献祭圣所通行密钥":"血袭者献祭圣所通行密钥-blood-raider-sacrificial-sanctuary-key.webp",
  "萨沙同步节点通行密钥":"萨沙同步节点通行密钥-sansha-synchronization-node-key.webp",
  "天使舰队集结区通行密钥":"天使舰队集结区通行密钥-angel-fleet-rally-point-key.webp",
  "血袭者深红修道院通行密钥":"血袭者深红修道院通行密钥-blood-raider-crimson-monastery-key.webp",
  "萨沙同化中枢通行密钥":"萨沙同化中枢通行密钥-sansha-assimilation-hub-key.webp",
  "天使军事复合体通行密钥":"天使军事复合体通行密钥-angel-military-complex-key.webp",
  "血袭者海军造船厂通行密钥":"血袭者海军造船厂通行密钥-blood-raider-naval-shipyard-key.webp",
  "萨沙战争设施通行密钥":"萨沙战争设施通行密钥-sansha-war-facility-key.webp",
  "劫团边疆堡垒通行密钥":"劫团边疆堡垒通行密钥-guristas-frontier-fortress-key.webp",
  "赤誓深红圣所通行密钥":"赤誓深红圣所通行密钥-red-oath-crimson-sanctum-key.webp",
  "静默战争设施通行密钥":"静默战争设施通行密钥-silent-war-facility-key.webp",
  "先驱深渊回响通行密钥":"先驱深渊回响通行密钥-precursor-abyss-echo-key.webp"
});
for (const [displayName, asset] of Object.entries(DEATHSPACE_TICKET_ICON_ASSETS)) {
  const iconMarkup = `<img class="item-icon-image" src="./assets/icons/deathspace-tickets/${asset}?v=1" alt="" loading="lazy" decoding="async">`;
  ITEM_ICONS[displayName] = iconMarkup;
  ITEM_ICONS[`special:${displayName}`] = iconMarkup;
}
const DEATHSPACE_CORE_ICON_ASSETS = Object.freeze({
  "吉斯特试制校准核心":"吉斯特试制校准核心-gist-prototype-calibration-core.webp",
  "科尔普斯试制校准核心":"科尔普斯试制校准核心-corpum-prototype-calibration-core.webp",
  "森屠斯试制校准核心":"森屠斯试制校准核心-centus-prototype-calibration-core.webp",
  "吉斯特强化校准核心":"吉斯特强化校准核心-gist-reinforced-calibration-core.webp",
  "科尔普斯强化校准核心":"科尔普斯强化校准核心-corpum-reinforced-calibration-core.webp",
  "森屠斯强化校准核心":"森屠斯强化校准核心-centus-reinforced-calibration-core.webp",
  "吉斯特精锐校准核心":"吉斯特精锐校准核心-gist-elite-calibration-core.webp",
  "科尔普斯精锐校准核心":"科尔普斯精锐校准核心-corpum-elite-calibration-core.webp",
  "森屠斯精锐校准核心":"森屠斯精锐校准核心-centus-elite-calibration-core.webp",
  "吉斯特A型校准核心":"吉斯特A型校准核心-gist-a-type-calibration-core.webp",
  "科尔普斯A型校准核心":"科尔普斯A型校准核心-corpum-a-type-calibration-core.webp",
  "森屠斯A型校准核心":"森屠斯A型校准核心-centus-a-type-calibration-core.webp",
  "劫团X型校准核心":"劫团X型校准核心-guristas-x-type-calibration-core.webp",
  "赤誓X型校准核心":"赤誓X型校准核心-red-oath-x-type-calibration-core.webp",
  "静默X型校准核心":"静默X型校准核心-silent-x-type-calibration-core.webp"
});
for (const [displayName, asset] of Object.entries(DEATHSPACE_CORE_ICON_ASSETS)) {
  const iconMarkup = `<img class="item-icon-image" src="./assets/icons/deathspace-cores/${asset}?v=1" alt="" loading="lazy" decoding="async">`;
  ITEM_ICONS[displayName] = iconMarkup;
  ITEM_ICONS[`special:${displayName}`] = iconMarkup;
}
const DEATHSPACE_PROTOCOL_ICON_ASSETS = Object.freeze({
  "吉斯特试制协议":"吉斯特试制协议-gist-prototype-protocol.webp",
  "科尔普斯试制协议":"科尔普斯试制协议-corpum-prototype-protocol.webp",
  "森屠斯试制协议":"森屠斯试制协议-centus-prototype-protocol.webp",
  "吉斯特强化协议":"吉斯特强化协议-gist-reinforced-protocol.webp",
  "科尔普斯强化协议":"科尔普斯强化协议-corpum-reinforced-protocol.webp",
  "森屠斯强化协议":"森屠斯强化协议-centus-reinforced-protocol.webp",
  "吉斯特精锐协议":"吉斯特精锐协议-gist-elite-protocol.webp",
  "科尔普斯精锐协议":"科尔普斯精锐协议-corpum-elite-protocol.webp",
  "森屠斯精锐协议":"森屠斯精锐协议-centus-elite-protocol.webp",
  "吉斯特改良协议":"吉斯特改良协议-gist-improved-protocol.webp",
  "科尔普斯改良协议":"科尔普斯改良协议-corpum-improved-protocol.webp",
  "森屠斯改良协议":"森屠斯改良协议-centus-improved-protocol.webp",
  "劫团X型改良协议":"劫团X型改良协议-guristas-x-type-improved-protocol.webp",
  "赤誓X型改良协议":"赤誓X型改良协议-red-oath-x-type-improved-protocol.webp",
  "静默X型改良协议":"静默X型改良协议-silent-x-type-improved-protocol.webp"
});
for (const [displayName, asset] of Object.entries(DEATHSPACE_PROTOCOL_ICON_ASSETS)) {
  const iconMarkup = `<img class="item-icon-image" src="./assets/icons/deathspace-protocols/${asset}?v=1" alt="" loading="lazy" decoding="async">`;
  ITEM_ICONS[displayName] = iconMarkup;
  ITEM_ICONS[`special:${displayName}`] = iconMarkup;
}
for (const material of SUPERCAPITAL_DATA_MATERIALS) ITEM_ICONS[material] = "🧬";
const SUPERCAPITAL_DATA_ICON_ASSETS = Object.freeze({
  "天穹深层舰船数据":"天穹深层舰船数据-celestial-deep-ship-data.webp",
  "重垒深层舰船数据":"重垒深层舰船数据-bastion-deep-ship-data.webp",
  "裂界深层舰船数据":"裂界深层舰船数据-rift-deep-ship-data.webp"
});
for (const [displayName, asset] of Object.entries(SUPERCAPITAL_DATA_ICON_ASSETS)) {
  ITEM_ICONS[displayName] = `<img class="item-icon-image" src="./assets/icons/supercapital-data/${asset}?v=1" alt="" loading="lazy" decoding="async">`;
}
for (const material of STARMAP_TITAN_MATERIALS) ITEM_ICONS[material] = "⚛️";
// 泰坦材料统一采用暗绿古代金属主题；覆盖星图材料的通用符号，也用于精炼产物。
const TITAN_MATERIAL_ICON_ASSETS = Object.freeze({
  "星骸钛晶":"星骸钛晶-starward-titanium-crystal.webp",
  "赫利昂冷凝气":"赫利昂冷凝气-helion-condensate.webp",
  "相位铱核":"相位铱核-phase-iridium-core.webp",
  "虚境裂流":"虚境裂流-voidrift-flux.webp",
  "锻星合金":"锻星合金-forgestar-alloy.webp",
  "熔虚晶体":"熔虚晶体-meltvoid-crystal.webp"
});
for (const [displayName, asset] of Object.entries(TITAN_MATERIAL_ICON_ASSETS)) {
  ITEM_ICONS[displayName] = `<img class="item-icon-image" src="./assets/icons/titan-materials/${asset}?v=1" alt="" loading="lazy" decoding="async">`;
}
// 校准基体按 I–V 档显示独立的递进图标。
const CALIBRATION_MATRIX_ICON_ASSETS = Object.freeze({
  "校准基体 I 型":"校准基体-I型-calibration-matrix-i.webp",
  "校准基体 II 型":"校准基体-II型-calibration-matrix-ii.webp",
  "校准基体 III 型":"校准基体-III型-calibration-matrix-iii.webp",
  "校准基体 IV 型":"校准基体-IV型-calibration-matrix-iv.webp",
  "校准基体 V 型":"校准基体-V型-calibration-matrix-v.webp"
});
for (const [displayName, asset] of Object.entries(CALIBRATION_MATRIX_ICON_ASSETS)) {
  ITEM_ICONS[displayName] = `<img class="item-icon-image" src="./assets/icons/calibration-matrices/${asset}?v=1" alt="" loading="lazy" decoding="async">`;
}
// 精英难度独占掉落：未知的潜能芯片。
const UNKNOWN_POTENTIAL_CHIP_ICON = `<img class="item-icon-image" src="./assets/icons/potential-chips/未知的潜能芯片-unknown-potential-chip.webp?v=1" alt="" loading="lazy" decoding="async">`;
ITEM_ICONS["未知的潜能芯片"] = UNKNOWN_POTENTIAL_CHIP_ICON;
ITEM_ICONS["special:未知的潜能芯片"] = UNKNOWN_POTENTIAL_CHIP_ICON;
// 已解码潜能芯片：技能模块、改装件词条与强化催化芯片使用独立的透明图标。
const POTENTIAL_CHIP_ICON_ASSETS = Object.freeze({
  "潜能芯片 · 采矿":"潜能芯片-采矿-potential-chip-mining.webp",
  "潜能芯片 · 行星工业":"潜能芯片-行星工业-potential-chip-planetary-industry.webp",
  "潜能芯片 · 冶炼":"潜能芯片-冶炼-potential-chip-refining.webp",
  "潜能芯片 · 气体采集":"潜能芯片-气体采集-potential-chip-gas-harvesting.webp",
  "潜能芯片 · 舰船工程":"潜能芯片-舰船工程-potential-chip-ship-engineering.webp",
  "潜能芯片 · 装备工程":"潜能芯片-装备工程-potential-chip-equipment-engineering.webp",
  "潜能芯片 · 增效剂工程":"潜能芯片-增效剂工程-potential-chip-booster-engineering.webp",
  "潜能芯片 · 激光操作":"潜能芯片-激光操作-potential-chip-laser-ops.webp",
  "潜能芯片 · 炮台操作":"潜能芯片-炮台操作-potential-chip-cannon-ops.webp",
  "潜能芯片 · 导弹操作":"潜能芯片-导弹操作-potential-chip-missile-operations.webp",
  "潜能芯片 · 防御":"潜能芯片-防御-potential-chip-defense.webp",
  "潜能芯片 · 护盾操作":"潜能芯片-护盾操作-potential-chip-shield-operation.webp",
  "潜能芯片 · 装甲强化":"潜能芯片-装甲强化-potential-chip-armor-reinforcement.webp",
  "潜能芯片 · 舰体工程":"潜能芯片-舰体工程-potential-chip-hull-engineering.webp",
  "潜能芯片 · 索敌":"潜能芯片-索敌-potential-chip-targeting.webp",
  "潜能芯片 · 驾驶":"潜能芯片-驾驶-potential-chip-piloting.webp",
  "潜能芯片 · 电容管理":"潜能芯片-电容管理-potential-chip-capacitor-management.webp",
  "潜能芯片 · 考古":"潜能芯片-考古-potential-chip-archaeology.webp",
  "护盾容量词条芯片":"护盾容量词条芯片-shield-capacity-affix-chip.webp",
  "装甲容量词条芯片":"装甲容量词条芯片-armor-capacity-affix-chip.webp",
  "结构容量词条芯片":"结构容量词条芯片-structure-capacity-affix-chip.webp",
  "采矿速度词条芯片":"采矿速度词条芯片-mining-speed-affix-chip.webp",
  "采气速度词条芯片":"采气速度词条芯片-gas-harvesting-speed-affix-chip.webp",
  "冶炼速度词条芯片":"冶炼速度词条芯片-refining-speed-affix-chip.webp",
  "伴生矿物采集词条芯片":"伴生矿物采集词条芯片-bonus-ore-harvesting-affix-chip.webp",
  "伴生气云采集词条芯片":"伴生气云采集词条芯片-bonus-gas-harvesting-affix-chip.webp",
  "扫描强度词条芯片":"扫描强度词条芯片-scan-strength-affix-chip.webp",
  "电容回充词条芯片":"电容回充词条芯片-capacitor-recharge-affix-chip.webp",
  "考古干扰缩短词条芯片":"考古干扰缩短词条芯片-archaeology-interference-reduction-affix-chip.webp",
  "遗迹速掘词条芯片":"遗迹速掘词条芯片-relic-hacking-speed-affix-chip.webp",
  "神经训练词条芯片":"神经训练词条芯片-neural-training-affix-chip.webp",
  "强化催化芯片":"强化催化芯片-reinforcement-catalyst-chip.webp"
});
const POTENTIAL_CHIP_SKILL_KEYS = Object.freeze({
  "潜能芯片 · 采矿":"mining", "潜能芯片 · 行星工业":"planetaryIndustry", "潜能芯片 · 冶炼":"refining",
  "潜能芯片 · 气体采集":"gasHarvesting", "潜能芯片 · 舰船工程":"shipEngineering", "潜能芯片 · 装备工程":"equipmentEngineering",
  "潜能芯片 · 增效剂工程":"boosterEngineering", "潜能芯片 · 激光操作":"laserOps", "潜能芯片 · 炮台操作":"cannonOps",
  "潜能芯片 · 导弹操作":"missileOperations", "潜能芯片 · 防御":"defense", "潜能芯片 · 护盾操作":"shieldOperation",
  "潜能芯片 · 装甲强化":"armorReinforcement", "潜能芯片 · 舰体工程":"hullEngineering", "潜能芯片 · 索敌":"targeting",
  "潜能芯片 · 驾驶":"piloting", "潜能芯片 · 电容管理":"capacitorManagement", "潜能芯片 · 考古":"archaeology"
});
for (const [displayName, asset] of Object.entries(POTENTIAL_CHIP_ICON_ASSETS)) {
  const iconMarkup = `<img class="item-icon-image" src="./assets/icons/potential-chips/${asset}?v=1" alt="" loading="lazy" decoding="async">`;
  ITEM_ICONS[displayName] = iconMarkup;
  ITEM_ICONS[`special:${displayName}`] = iconMarkup;
  const skillKey = POTENTIAL_CHIP_SKILL_KEYS[displayName];
  if (skillKey) ITEM_ICONS[`special:潜能芯片_${skillKey}`] = iconMarkup;
}
for (const series of RIG_SERIES) {
  const displayName = `${series.label}词条芯片`;
  const iconMarkup = ITEM_ICONS[displayName];
  if (iconMarkup) ITEM_ICONS[`special:affixchip_${series.stackGroup}`] = iconMarkup;
}
SHIP_COMPONENT_RECIPES.forEach(recipe => {
  if (recipe.id.includes("integrated_hull")) ITEM_ICONS[recipe.name] = "🏗️";
  else if (recipe.id.includes("power_core")) ITEM_ICONS[recipe.name] = "⚙️";
  else ITEM_ICONS[recipe.name] = "🔧";
});
// 舰船工程组件按舰级与部件显示名映射，仓库和部件车间复用同一组图标。
const SHIP_COMPONENT_ICON_ASSETS = Object.freeze({
  "综合舰体组件":"综合舰体组件-integrated-hull-component.webp",
  "驱逐舰综合舰体组件":"驱逐舰综合舰体组件-destroyer-integrated-hull-component.webp",
  "巡洋舰综合舰体组件":"巡洋舰综合舰体组件-cruiser-integrated-hull-component.webp",
  "战列舰综合舰体组件":"战列舰综合舰体组件-battleship-integrated-hull-component.webp",
  "旗舰综合舰体组件":"旗舰综合舰体组件-capital-integrated-hull-component.webp",
  "超级旗舰综合舰体组件":"超级旗舰综合舰体组件-supercapital-integrated-hull-component.webp",
  "动力控制核心":"动力控制核心-power-control-core.webp",
  "驱逐舰动力控制核心":"驱逐舰动力控制核心-destroyer-power-control-core.webp",
  "巡洋舰动力控制核心":"巡洋舰动力控制核心-cruiser-power-control-core.webp",
  "战列舰动力控制核心":"战列舰动力控制核心-battleship-power-control-core.webp",
  "旗舰动力控制核心":"旗舰动力控制核心-capital-power-control-core.webp",
  "超级旗舰动力控制核心":"超级旗舰动力控制核心-supercapital-power-control-core.webp",
  "舰船功能组件":"舰船功能组件-ship-functional-system-component.webp",
  "驱逐舰舰船功能组件":"驱逐舰舰船功能组件-destroyer-functional-system-component.webp",
  "巡洋舰舰船功能组件":"巡洋舰舰船功能组件-cruiser-functional-system-component.webp",
  "战列舰舰船功能组件":"战列舰舰船功能组件-battleship-functional-system-component.webp",
  "旗舰舰船功能组件":"旗舰舰船功能组件-capital-functional-system-component.webp",
  "超级旗舰舰船功能组件":"超级旗舰舰船功能组件-supercapital-functional-system-component.webp"
});
for (const [displayName, asset] of Object.entries(SHIP_COMPONENT_ICON_ASSETS)) {
  ITEM_ICONS[displayName] = `<img class="item-icon-image" src="./assets/icons/ship-components/${asset}?v=1" alt="" loading="lazy" decoding="async">`;
}
// 泰坦舰体 / 武器 / 核心组件在 titans.js 晚于本文件注册，故按稳定配方 ID 预先映射。
const TITAN_COMPONENT_ICON_ASSETS = Object.freeze({
  "泰坦舰体组件·天穹壁垒":["titan-hull-component-aegis.webp","titan_component_hull_aegis"],
  "泰坦舰体组件·铁幕堡垒":["titan-hull-component-bulwark.webp","titan_component_hull_bulwark"],
  "泰坦舰体组件·裂骨方舟":["titan-hull-component-keelbreaker.webp","titan_component_hull_keelbreaker"],
  "泰坦武器组件·曙光长矛":["titan-weapon-component-dawn-spear.webp","titan_component_weapon_dawn_spear"],
  "泰坦武器组件·天火齐射":["titan-weapon-component-skyfire-salvo.webp","titan_component_weapon_skyfire_salvo"],
  "泰坦武器组件·震荡王座":["titan-weapon-component-throne-quake.webp","titan_component_weapon_throne_quake"],
  "泰坦核心组件·统御矩阵":["titan-core-component-command-matrix.webp","titan_component_core_command_matrix"],
  "泰坦核心组件·天罚裁决":["titan-core-component-doom-judgment.webp","titan_component_core_doom_judgment"],
  "泰坦核心组件·裂界侵蚀":["titan-core-component-rift-erosion.webp","titan_component_core_rift_erosion"]
});
for (const [displayName, [asset, recipeId]] of Object.entries(TITAN_COMPONENT_ICON_ASSETS)) {
  const iconMarkup = `<img class="item-icon-image" src="./assets/icons/titan-components/${displayName}-${asset}?v=1" alt="" loading="lazy" decoding="async">`;
  ITEM_ICONS[displayName] = iconMarkup;
  ITEM_ICONS[`component:${recipeId}`] = iconMarkup;
}
// 弹药与考古探针图标按玩家可见的 displayName 映射，仓库、制造和考古卡片共用。
const AMMUNITION_ICON_ASSETS = Object.freeze({
  "激光晶体弹药":"激光晶体弹药-laser-crystal-ammunition.webp",
  "导弹":"导弹-missile.webp",
  "炮台弹药":"炮台弹药-turret-ammunition.webp",
  "聚焦相位激光弹":"聚焦相位激光弹-focused-phase-laser-ammo.webp",
  "高爆制导导弹":"高爆制导导弹-high-explosive-guided-missile.webp",
  "重型轨道弹药":"重型轨道弹药-heavy-orbital-ammunition.webp"
});
for (const [displayName, asset] of Object.entries(AMMUNITION_ICON_ASSETS)) {
  ITEM_ICONS[displayName] = `<img class="item-icon-image" src="./assets/icons/ammunition/${asset}?v=2" alt="" loading="lazy" decoding="async">`;
}
const ARCHAEOLOGY_PROBE_ICON_ASSETS = Object.freeze({
  "标准考古探针 I":"标准考古探针-I-standard-archaeological-probe-i.webp",
  "强化考古探针 II":"强化考古探针-II-enhanced-archaeological-probe-ii.webp",
  "深空考古探针 III":"深空考古探针-III-deep-space-archaeological-probe-iii.webp",
  "苍穹劫团考古探针·掠空型":"苍穹劫团考古探针-掠空型-skybreak-marauders-sky-skimming-probe.webp",
  "赤誓教团考古探针·血誓型":"赤誓教团考古探针-血誓型-crimson-covenant-blood-oath-probe.webp",
  "静默集群考古探针·同化型":"静默集群考古探针-同化型-silent-assembly-assimilation-probe.webp",
  "复原强化考古探针 II":"复原强化考古探针-II-restored-enhanced-archaeological-probe-ii.webp",
  "复原深空考古探针 III":"复原深空考古探针-III-restored-deep-space-archaeological-probe-iii.webp",
  "深层先驱遗迹探针 IV":"深层先驱遗迹探针-IV-deep-layer-pioneer-ruins-probe-iv.webp"
});
for (const [displayName, asset] of Object.entries(ARCHAEOLOGY_PROBE_ICON_ASSETS)) {
  ITEM_ICONS[displayName] = `<img class="item-icon-image" src="./assets/icons/probes/${asset}?v=2" alt="" loading="lazy" decoding="async">`;
}
const PROBE_BLUEPRINT_ICON_ASSETS = Object.freeze({
  "苍穹劫团考古探针·掠空型 抄本":"苍穹劫团考古探针·掠空型 抄本-angel-cartel-sky-skimmer-probe-blueprint-copy.webp",
  "赤誓教团考古探针·血誓型 抄本":"赤誓教团考古探针·血誓型 抄本-blood-raider-blood-oath-probe-blueprint-copy.webp",
  "静默集群考古探针·同化型 抄本":"静默集群考古探针·同化型 抄本-sansha-assimilation-probe-blueprint-copy.webp"
});
for (const [displayName, asset] of Object.entries(PROBE_BLUEPRINT_ICON_ASSETS)) {
  ITEM_ICONS[displayName] = `<img class="item-icon-image" src="./assets/icons/probe-blueprints/${asset}?v=1" alt="" loading="lazy" decoding="async">`;
}
// 舰船蓝图商店图标：不同舰体用独立剪影呈现在统一的数据板上。
const SHIP_BLUEPRINT_ICON_ASSETS = Object.freeze({
  rifter:"星矛级蓝图-star-spear-blueprint.webp",
  kestrel:"铁卫级蓝图-iron-guard-blueprint.webp",
  atron:"闪刃级蓝图-flash-blade-blueprint.webp",
  miner_frigate:"拓岩级蓝图-rockbreaker-blueprint.webp",
  gas_frigate:"捕云级蓝图-cloud-catcher-blueprint.webp",
  heron:"觅迹级蓝图-tracefinder-blueprint.webp",
  gale:"疾风级蓝图-gale-blueprint.webp",
  bloodthorn:"血刺级蓝图-bloodthorn-blueprint.webp",
  umbra:"暗影级蓝图-umbra-blueprint.webp",
  thunder:"雷霆级蓝图-thunder-blueprint.webp",
  crimson:"猩红级蓝图-crimson-blueprint.webp",
  nether:"幽冥级蓝图-nether-blueprint.webp",
  dawnbreaker:"破晓级蓝图-dawnbreaker-blueprint.webp",
  crimson_bastion:"赤垒级蓝图-crimson-bastion-blueprint.webp",
  spectre_frame:"幽构级蓝图-spectre-frame-blueprint.webp",
  starcrown:"星冕级蓝图-starcrown-blueprint.webp",
  eternal_fortress:"恒城级蓝图-eternal-fortress-blueprint.webp",
  arbiter:"裁决级蓝图-arbiter-blueprint.webp"
});
for (const blueprint of SHIP_BLUEPRINTS) {
  const asset = SHIP_BLUEPRINT_ICON_ASSETS[blueprint.id];
  if (!asset) continue;
  ITEM_ICONS[`${blueprint.name}蓝图`] = `<img class="item-icon-image" src="./assets/icons/ship-blueprints/${asset}?v=1" alt="" loading="lazy" decoding="async">`;
}
// 银河联盟装备蓝图：统一使用数据板图标，并以蓝图轮廓区分制造项目。
const EQUIPMENT_BLUEPRINT_ICON_ASSETS = Object.freeze({
  "银河联盟采矿激光器蓝图":"银河联盟采矿激光器蓝图-alliance-mining-laser-blueprint.webp",
  "银河联盟气云采集器蓝图":"银河联盟气云采集器蓝图-alliance-gas-harvester-blueprint.webp",
  "银河联盟无人机指挥链路蓝图":"银河联盟无人机指挥链路蓝图-alliance-drone-command-link-blueprint.webp",
  "银河联盟矿物同化注入器蓝图":"银河联盟矿物同化注入器蓝图-alliance-mineral-assimilation-injector-blueprint.webp",
  "银河联盟气体同化注入器蓝图":"银河联盟气体同化注入器蓝图-alliance-gas-assimilation-injector-blueprint.webp",
  "银河联盟残骸打捞注入器蓝图":"银河联盟残骸打捞注入器蓝图-alliance-wreck-salvage-injector-blueprint.webp"
});
for (const [displayName, asset] of Object.entries(EQUIPMENT_BLUEPRINT_ICON_ASSETS)) {
  ITEM_ICONS[displayName] = `<img class="item-icon-image" src="./assets/icons/equipment-blueprints/${asset}?v=1" alt="" loading="lazy" decoding="async">`;
}
// 考古装备模块按仓库显示名映射；分析仪、稳定器、译码器共用独立装备图标。
const ARCHAEOLOGY_EQUIPMENT_ICON_ASSETS = Object.freeze({
  "遗迹分析仪 I":"遗迹分析仪-I-ruins-analyzer-i.webp",
  "遗迹分析仪 II":"遗迹分析仪-II-ruins-analyzer-ii.webp",
  "遗迹分析仪 III":"遗迹分析仪-III-ruins-analyzer-iii.webp",
  "遗迹分析仪 IV":"遗迹分析仪-IV-ruins-analyzer-iv.webp",
  "遗迹分析仪 V":"遗迹分析仪-V-ruins-analyzer-v.webp",
  "信号稳定器 I":"信号稳定器-I-signal-stabilizer-i.webp",
  "信号稳定器 II":"信号稳定器-II-signal-stabilizer-ii.webp",
  "信号稳定器 III":"信号稳定器-III-signal-stabilizer-iii.webp",
  "信号稳定器 IV":"信号稳定器-IV-signal-stabilizer-iv.webp",
  "信号稳定器 V":"信号稳定器-V-signal-stabilizer-v.webp",
  "文物译码器 I":"文物译码器-I-artifact-decoder-i.webp",
  "文物译码器 II":"文物译码器-II-artifact-decoder-ii.webp",
  "文物译码器 III":"文物译码器-III-artifact-decoder-iii.webp",
  "文物译码器 IV":"文物译码器-IV-artifact-decoder-iv.webp",
  "文物译码器 V":"文物译码器-V-artifact-decoder-v.webp",
  "边疆遗迹分析仪 I":"边疆遗迹分析仪-I-frontier-relic-analyzer-i.webp",
  "禁区遗迹分析仪 IV":"禁区遗迹分析仪-IV-forbidden-zone-relic-analyzer-iv.webp",
  "先驱遗迹分析仪 V":"先驱遗迹分析仪-V-pioneer-relic-analyzer-v.webp",
  "环站信号稳定器 II":"环站信号稳定器-II-station-signal-stabilizer-ii.webp",
  "先驱信号稳定器 V":"先驱信号稳定器-V-pioneer-signal-stabilizer-v.webp",
  "舰墓文物译码器 III":"舰墓文物译码器-III-fleet-wreck-artifact-decoder-iii.webp",
  "先驱文物译码器 V":"先驱文物译码器-V-pioneer-artifact-decoder-v.webp"
});
for (const [displayName, asset] of Object.entries(ARCHAEOLOGY_EQUIPMENT_ICON_ASSETS)) {
  ITEM_ICONS[displayName] = `<img class="item-icon-image" src="./assets/icons/archaeology-equipment/${asset}?v=1" alt="" loading="lazy" decoding="async">`;
}
// 考古遗迹掉落物（35 件非校准文物）逐件使用独立图标；校准基体沿用上方 I–V 专属图。
const ARCHAEOLOGY_ARTIFACT_ICON_ASSETS = Object.freeze({
  "锈蚀数据核心":["锈蚀数据核心-rusted-data-core.webp","art_i_common_a"],
  "远古合金板":["远古合金板-ancient-alloy-plate.webp","art_i_common_b"],
  "残缺导航矩阵":["残缺导航矩阵-damaged-navigation-matrix.webp","art_i_common_c"],
  "信标碎片":["信标碎片-beacon-fragment.webp","art_i_unique_a"],
  "殖民徽记":["殖民徽记-colonist-emblem.webp","art_i_unique_b"],
  "货柜残片":["货柜残片-cargo-fragment.webp","art_i_unique_c"],
  "远古文明信标":["远古文明信标-ancient-civilization-beacon-i.webp","art_i_lp"],
  "巡防站黑匣":["巡防站黑匣-patrol-station-black-box.webp","art_ii_common_a"],
  "精炼同位素":["精炼同位素-refined-isotope.webp","art_ii_common_b"],
  "平台主控核":["平台主控核-platform-control-core.webp","art_ii_common_c"],
  "巡防站徽记":["巡防站徽记-patrol-station-insignia.webp","art_ii_unique_a"],
  "采掘图谱":["采掘图谱-mining-atlas.webp","art_ii_unique_b"],
  "中继塔核心":["中继塔核心-relay-tower-core.webp","art_ii_unique_c"],
  "远古文明信标 II":["远古文明信标-II-ancient-civilization-beacon-ii.webp","art_ii_lp"],
  "战列装甲片":["战列装甲片-battleship-armor-fragment.webp","art_iii_common_a"],
  "湮灭实验录":["湮灭实验录-annihilation-lab-record.webp","art_iii_common_b"],
  "方尖碑铭文":["方尖碑铭文-obelisk-inscription.webp","art_iii_common_c"],
  "战列徽记":["战列徽记-battleship-insignia.webp","art_iii_unique_a"],
  "湮灭图谱":["湮灭图谱-annihilation-atlas.webp","art_iii_unique_b"],
  "观测者残片":["观测者残片-observer-fragment.webp","art_iii_unique_c"],
  "远古文明信标 III":["远古文明信标-III-ancient-civilization-beacon-iii.webp","art_iii_lp"],
  "旗舰装甲残片":["旗舰装甲残片-capital-armor-fragment.webp","art_iv_common_a"],
  "虚空研究录":["虚空研究录-void-research-log.webp","art_iv_common_b"],
  "跃迁日志":["跃迁日志-warp-transit-log.webp","art_iv_common_c"],
  "旗舰徽记":["旗舰徽记-capital-insignia.webp","art_iv_unique_a"],
  "虚空图谱":["虚空图谱-void-atlas.webp","art_iv_unique_b"],
  "枢纽核心":["枢纽核心-hub-core.webp","art_iv_unique_c"],
  "远古文明信标 IV":["远古文明信标-IV-ancient-civilization-beacon-iv.webp","art_iv_lp"],
  "圣殿圣物":["圣殿圣物-temple-relic.webp","art_v_common_a"],
  "母舰主控核":["母舰主控核-mothership-control-core.webp","art_v_common_b"],
  "观测站日志":["观测站日志-observatory-log.webp","art_v_common_c"],
  "文明圣徽":["文明圣徽-civilization-holy-emblem.webp","art_v_unique_a"],
  "母舰图谱":["母舰图谱-mothership-atlas.webp","art_v_unique_b"],
  "观测者核心":["观测者核心-observer-core.webp","art_v_unique_c"],
  "远古文明信标 V":["远古文明信标-V-ancient-civilization-beacon-v.webp","art_v_lp"]
});
for (const [displayName, [asset, artifactId]] of Object.entries(ARCHAEOLOGY_ARTIFACT_ICON_ASSETS)) {
  const iconMarkup = `<img class="item-icon-image" src="./assets/icons/archaeology-artifacts/${asset}?v=2" alt="" loading="lazy" decoding="async">`;
  ITEM_ICONS[displayName] = iconMarkup;
  ITEM_ICONS[`artifact:${artifactId}`] = iconMarkup;
}
// 采矿与气云采集设备按装备 displayName 映射，供仓库和装备制造界面共用。
const MINING_EQUIPMENT_ICON_ASSETS = Object.freeze({
  "T1采矿激光器":"T1采矿激光器-t1-mining-laser.webp",
  "中型采矿激光器":"中型采矿激光器-medium-mining-laser.webp",
  "银河联盟采矿激光器":"银河联盟采矿激光器-alliance-mining-laser.webp",
  "苍穹劫团联合采矿激光器":"苍穹劫团联合采矿激光器-angel-cartel-mining-laser.webp",
  "重型采矿激光器":"重型采矿激光器-heavy-mining-laser.webp",
  "大型采矿激光器":"大型采矿激光器-large-mining-laser.webp",
  "旗舰采矿激光器":"旗舰采矿激光器-capital-mining-laser.webp",
  "T1气云采集器":"T1气云采集器-t1-gas-harvester.webp",
  "中型气云采集器":"中型气云采集器-medium-gas-harvester.webp",
  "银河联盟气云采集器":"银河联盟气云采集器-alliance-gas-harvester.webp",
  "苍穹劫团联合气云采集器":"苍穹劫团联合气云采集器-angel-cartel-gas-harvester.webp",
  "重型气云采集器":"重型气云采集器-heavy-gas-harvester.webp",
  "大型气云采集器":"大型气云采集器-large-gas-harvester.webp",
  "旗舰气云采集器":"旗舰气云采集器-capital-gas-harvester.webp"
});
for (const [displayName, asset] of Object.entries(MINING_EQUIPMENT_ICON_ASSETS)) {
  ITEM_ICONS[displayName] = `<img class="item-icon-image" src="./assets/icons/mining-equipment/${asset}?v=1" alt="" loading="lazy" decoding="async">`;
}
const INDUSTRIAL_SUPPORT_ICON_ASSETS = Object.freeze({
  "T1采矿提升器":"T1采矿提升器-t1-mining-yield-booster.webp",
  "中型采矿提升器":"中型采矿提升器-medium-mining-yield-booster.webp",
  "重型采矿提升器":"重型采矿提升器-heavy-mining-yield-booster.webp",
  "大型采矿提升器":"大型采矿提升器-large-mining-yield-booster.webp",
  "旗舰采矿提升核心":"旗舰采矿提升核心-capital-mining-yield-core.webp",
  "T1采气提升器":"T1采气提升器-t1-gas-yield-booster.webp",
  "中型采气提升器":"中型采气提升器-medium-gas-yield-booster.webp",
  "重型采气提升器":"重型采气提升器-heavy-gas-yield-booster.webp",
  "大型采气提升器":"大型采气提升器-large-gas-yield-booster.webp",
  "旗舰采气提升核心":"旗舰采气提升核心-capital-gas-yield-core.webp",
  "T1同位素标记打捞臂":"T1同位素标记打捞臂-t1-isotope-marking-salvage-arm.webp",
  "中型同位素标记打捞臂":"中型同位素标记打捞臂-medium-isotope-marking-salvage-arm.webp",
  "重型同位素标记打捞臂":"重型同位素标记打捞臂-heavy-isotope-marking-salvage-arm.webp",
  "大型同位素标记打捞臂":"大型同位素标记打捞臂-large-isotope-marking-salvage-arm.webp",
  "旗舰同位素标记打捞核心":"旗舰同位素标记打捞核心-capital-isotope-marking-salvage-core.webp"
});
for (const [displayName, asset] of Object.entries(INDUSTRIAL_SUPPORT_ICON_ASSETS)) {
  ITEM_ICONS[displayName] = `<img class="item-icon-image" src="./assets/icons/industrial-support/${asset}?v=1" alt="" loading="lazy" decoding="async">`;
}
const INDUSTRIAL_INJECTOR_ICON_ASSETS = Object.freeze({
  "矿物同化注入器":"矿物同化注入器-standard-mineral-assimilation-injector.webp",
  "静默气体同化注入器":"静默气体同化注入器-sansha-basic-gas-assimilation-injector.webp",
  "静默残骸打捞注入器":"静默残骸打捞注入器-sansha-basic-wreck-salvage-injector.webp",
  "苍穹劫团矿物同化注入器·前哨型":"苍穹劫团矿物同化注入器·前哨型-angel-cartel-outpost-mineral-injector.webp",
  "苍穹劫团气体同化注入器·前哨型":"苍穹劫团气体同化注入器·前哨型-angel-cartel-outpost-gas-injector.webp",
  "苍穹劫团残骸打捞注入器·前哨型":"苍穹劫团残骸打捞注入器·前哨型-angel-cartel-outpost-salvage-injector.webp",
  "赤誓矿物同化注入器·枢纽型":"赤誓矿物同化注入器·枢纽型-blood-raider-nexus-mineral-injector.webp",
  "赤誓气体同化注入器·枢纽型":"赤誓气体同化注入器·枢纽型-blood-raider-nexus-gas-injector.webp",
  "赤誓残骸打捞注入器·枢纽型":"赤誓残骸打捞注入器·枢纽型-blood-raider-nexus-salvage-injector.webp",
  "矿物同化注入器·节点型":"矿物同化注入器·节点型-sansha-node-mineral-injector.webp",
  "静默气体同化注入器·节点型":"静默气体同化注入器·节点型-sansha-node-gas-injector.webp",
  "静默残骸打捞注入器·节点型":"静默残骸打捞注入器·节点型-sansha-node-salvage-injector.webp",
  "银河联盟矿物同化注入器":"银河联盟矿物同化注入器-galactic-alliance-mineral-injector.webp",
  "银河联盟气体同化注入器":"银河联盟气体同化注入器-galactic-alliance-gas-injector.webp",
  "银河联盟残骸打捞注入器":"银河联盟残骸打捞注入器-galactic-alliance-salvage-injector.webp",
  "赤誓矿物同化注入器·终焉型":"赤誓矿物同化注入器·终焉型-blood-raider-apocalypse-mineral-injector.webp",
  "静默集群气体同化注入器·终焉型":"静默集群气体同化注入器·终焉型-sansha-apocalypse-gas-injector.webp",
  "赤誓残骸打捞注入器·终焉型":"赤誓残骸打捞注入器·终焉型-blood-raider-apocalypse-salvage-injector.webp"
});
for (const [displayName, asset] of Object.entries(INDUSTRIAL_INJECTOR_ICON_ASSETS)) {
  ITEM_ICONS[displayName] = `<img class="item-icon-image" src="./assets/icons/industrial-injectors/${asset}?v=1" alt="" loading="lazy" decoding="async">`;
}
const INDUSTRIAL_SPECIALTY_ICON_ASSETS = Object.freeze({
  "苍穹劫团采矿激光器·前哨型":"苍穹劫团采矿激光器·前哨型-angel-outpost-mining-laser.webp",
  "赤誓采矿激光器·猎杀型":"赤誓采矿激光器·猎杀型-blood-raider-hunt-mining-laser.webp",
  "静默采矿激光器·破阵型":"静默采矿激光器·破阵型-sansha-war-mining-laser.webp",
  "赤誓气云采集器·铁血型":"赤誓气云采集器·铁血型-blood-raider-iron-gas-harvester.webp",
  "静默气云采集器·枢纽型":"静默气云采集器·枢纽型-sansha-nexus-gas-harvester.webp",
  "苍穹劫团采矿·气云采集器·终焉型":"苍穹劫团采矿·气云采集器·终焉型-angel-apocalypse-mining-gas-harvester.webp",
  "外接大型精炼泵":"外接大型精炼泵-external-large-refinery-pump.webp",
  "暗流体精炼泵":"暗流体精炼泵-dark-fluid-refinery-pump.webp"
});
for (const [displayName, asset] of Object.entries(INDUSTRIAL_SPECIALTY_ICON_ASSETS)) {
  ITEM_ICONS[displayName] = `<img class="item-icon-image" src="./assets/icons/industrial-specialty/${asset}?v=1" alt="" loading="lazy" decoding="async">`;
}
// 舰载武器依 displayName 映射；仓库、装备制造和战斗配装复用同一图标。
const SHIP_WEAPON_ICON_ASSETS = Object.freeze({
  "小型激光炮 I":"小型激光炮 I-small-laser-cannon-i.webp",
  "中型激光炮 I":"中型激光炮 I-medium-laser-cannon-i.webp",
  "大型激光炮 I":"大型激光炮 I-large-laser-cannon-i.webp",
  "旗舰级聚焦激光炮 I":"旗舰级聚焦激光炮 I-capital-focused-laser-cannon-i.webp",
  "轻型导弹发射器 I":"轻型导弹发射器 I-light-missile-launcher-i.webp",
  "重型导弹发射器 I":"重型导弹发射器 I-heavy-missile-launcher-i.webp",
  "巡航导弹发射器 I":"巡航导弹发射器 I-cruise-missile-launcher-i.webp",
  "旗舰级巡航导弹阵列 I":"旗舰级巡航导弹阵列 I-capital-cruise-missile-array-i.webp",
  "小型射弹炮 I":"小型射弹炮 I-small-projectile-cannon-i.webp",
  "中型射弹炮 I":"中型射弹炮 I-medium-projectile-cannon-i.webp",
  "大型射弹炮 I":"大型射弹炮 I-large-projectile-cannon-i.webp",
  "旗舰级攻城射弹炮 I":"旗舰级攻城射弹炮 I-capital-siege-projectile-cannon-i.webp"
});
for (const [displayName, asset] of Object.entries(SHIP_WEAPON_ICON_ASSETS)) {
  ITEM_ICONS[displayName] = `<img class="item-icon-image" src="./assets/icons/ship-weapons/${asset}?v=2" alt="" loading="lazy" decoding="async">`;
}
// 防御与维修装备按仓库 displayName 映射；仓库、制造与配装界面共用。
const DEFENSE_REPAIR_ICON_ASSETS = Object.freeze({
  "小型护盾扩展":"小型护盾扩展-small-shield-extender.webp",
  "小型护盾回充器 I":"小型护盾回充器-I-small-shield-booster-i.webp",
  "中型护盾回充器 I":"中型护盾回充器-I-medium-shield-booster-i.webp",
  "大型护盾回充器 I":"大型护盾回充器-I-large-shield-booster-i.webp",
  "旗舰级护盾回充阵列 I":"旗舰级护盾回充阵列-I-capital-shield-booster-array-i.webp",
  "小型装甲维修器 I":"小型装甲维修器-I-small-armor-repairer-i.webp",
  "中型装甲维修器 I":"中型装甲维修器-I-medium-armor-repairer-i.webp",
  "大型装甲维修器 I":"大型装甲维修器-I-large-armor-repairer-i.webp",
  "旗舰级装甲维修阵列 I":"旗舰级装甲维修阵列-I-capital-armor-repair-array-i.webp",
  "小型结构修理器 I":"小型结构修理器-I-small-structure-repairer-i.webp",
  "中型结构修理器 I":"中型结构修理器-I-medium-structure-repairer-i.webp",
  "大型结构修理器 I":"大型结构修理器-I-large-structure-repairer-i.webp",
  "旗舰级结构修复阵列 I":"旗舰级结构修复阵列-I-capital-structure-repair-array-i.webp",
  "小型损伤控制单元 I":"小型损伤控制单元-I-small-damage-control-unit-i.webp",
  "中型损伤控制单元 I":"中型损伤控制单元-I-medium-damage-control-unit-i.webp",
  "大型损伤控制单元 I":"大型损伤控制单元-I-large-damage-control-unit-i.webp",
  "旗舰级损伤控制阵列 I":"旗舰级损伤控制阵列-I-capital-damage-control-array-i.webp",
  "苍穹劫团损伤控制单元":"苍穹劫团损伤控制单元-angel-cartel-damage-control-unit.webp",
  "赤誓教团损伤控制单元":"赤誓教团损伤控制单元-crimson-covenant-damage-control-unit.webp"
});
for (const [displayName, asset] of Object.entries(DEFENSE_REPAIR_ICON_ASSETS)) {
  ITEM_ICONS[displayName] = `<img class="item-icon-image" src="./assets/icons/defense-repair/${asset}?v=1" alt="" loading="lazy" decoding="async">`;
}
// 战斗型舰船改装件：按 displayName 映射，I–V 档使用逐级扩展的独立图标。
const COMBAT_RIG_ICON_ASSETS = Object.freeze({
  "护盾容量改装件 I":"护盾容量改装件-I-shield-capacity-rig-i.webp",
  "护盾容量改装件 II":"护盾容量改装件-II-shield-capacity-rig-ii.webp",
  "护盾容量改装件 III":"护盾容量改装件-III-shield-capacity-rig-iii.webp",
  "护盾容量改装件 IV":"护盾容量改装件-IV-shield-capacity-rig-iv.webp",
  "护盾容量改装件 V":"护盾容量改装件-V-shield-capacity-rig-v.webp",
  "装甲容量改装件 I":"装甲容量改装件-I-armor-capacity-rig-i.webp",
  "装甲容量改装件 II":"装甲容量改装件-II-armor-capacity-rig-ii.webp",
  "装甲容量改装件 III":"装甲容量改装件-III-armor-capacity-rig-iii.webp",
  "装甲容量改装件 IV":"装甲容量改装件-IV-armor-capacity-rig-iv.webp",
  "装甲容量改装件 V":"装甲容量改装件-V-armor-capacity-rig-v.webp",
  "结构容量改装件 I":"结构容量改装件-I-structure-capacity-rig-i.webp",
  "结构容量改装件 II":"结构容量改装件-II-structure-capacity-rig-ii.webp",
  "结构容量改装件 III":"结构容量改装件-III-structure-capacity-rig-iii.webp",
  "结构容量改装件 IV":"结构容量改装件-IV-structure-capacity-rig-iv.webp",
  "结构容量改装件 V":"结构容量改装件-V-structure-capacity-rig-v.webp"
});
for (const [displayName, asset] of Object.entries(COMBAT_RIG_ICON_ASSETS)) {
  ITEM_ICONS[displayName] = `<img class="item-icon-image" src="./assets/icons/ship-rigs/${asset}?v=1" alt="" loading="lazy" decoding="async">`;
}
// 工业型舰船改装件：效率、伴生矿物与伴生气云系列各自使用独立轮廓。
const INDUSTRIAL_RIG_ICON_ASSETS = Object.freeze({
  "采矿速度改装件 I":"采矿速度改装件-I-mining-speed-rig-i.webp",
  "采矿速度改装件 II":"采矿速度改装件-II-mining-speed-rig-ii.webp",
  "采矿速度改装件 III":"采矿速度改装件-III-mining-speed-rig-iii.webp",
  "采矿速度改装件 IV":"采矿速度改装件-IV-mining-speed-rig-iv.webp",
  "采矿速度改装件 V":"采矿速度改装件-V-mining-speed-rig-v.webp",
  "采气速度改装件 I":"采气速度改装件-I-gas-speed-rig-i.webp",
  "采气速度改装件 II":"采气速度改装件-II-gas-speed-rig-ii.webp",
  "采气速度改装件 III":"采气速度改装件-III-gas-speed-rig-iii.webp",
  "采气速度改装件 IV":"采气速度改装件-IV-gas-speed-rig-iv.webp",
  "采气速度改装件 V":"采气速度改装件-V-gas-speed-rig-v.webp",
  "冶炼速度改装件 I":"冶炼速度改装件-I-smelting-speed-rig-i.webp",
  "冶炼速度改装件 II":"冶炼速度改装件-II-smelting-speed-rig-ii.webp",
  "冶炼速度改装件 III":"冶炼速度改装件-III-smelting-speed-rig-iii.webp",
  "冶炼速度改装件 IV":"冶炼速度改装件-IV-smelting-speed-rig-iv.webp",
  "冶炼速度改装件 V":"冶炼速度改装件-V-smelting-speed-rig-v.webp",
  "伴生矿物采集改装件 I":"伴生矿物采集改装件-I-mineral-yield-rig-i.webp",
  "伴生矿物采集改装件 II":"伴生矿物采集改装件-II-mineral-yield-rig-ii.webp",
  "伴生矿物采集改装件 III":"伴生矿物采集改装件-III-mineral-yield-rig-iii.webp",
  "伴生矿物采集改装件 IV":"伴生矿物采集改装件-IV-mineral-yield-rig-iv.webp",
  "伴生矿物采集改装件 V":"伴生矿物采集改装件-V-mineral-yield-rig-v.webp",
  "伴生气云采集改装件 I":"伴生气云采集改装件-I-gas-yield-rig-i.webp",
  "伴生气云采集改装件 II":"伴生气云采集改装件-II-gas-yield-rig-ii.webp",
  "伴生气云采集改装件 III":"伴生气云采集改装件-III-gas-yield-rig-iii.webp",
  "伴生气云采集改装件 IV":"伴生气云采集改装件-IV-gas-yield-rig-iv.webp",
  "伴生气云采集改装件 V":"伴生气云采集改装件-V-gas-yield-rig-v.webp"
});
for (const [displayName, asset] of Object.entries(INDUSTRIAL_RIG_ICON_ASSETS)) {
  ITEM_ICONS[displayName] = `<img class="item-icon-image" src="./assets/icons/ship-rigs/${asset}?v=1" alt="" loading="lazy" decoding="async">`;
}
// 考古、辅助与神经训练改装件：五个系列均以实际 displayName 映射独立图标。
const ARCHAEOLOGY_SUPPORT_RIG_ICON_ASSETS = Object.freeze({
  "扫描强度改装件 I":"扫描强度改装件-I-scan-strength-rig-i.webp",
  "扫描强度改装件 II":"扫描强度改装件-II-scan-strength-rig-ii.webp",
  "扫描强度改装件 III":"扫描强度改装件-III-scan-strength-rig-iii.webp",
  "扫描强度改装件 IV":"扫描强度改装件-IV-scan-strength-rig-iv.webp",
  "扫描强度改装件 V":"扫描强度改装件-V-scan-strength-rig-v.webp",
  "电容回充改装件 I":"电容回充改装件-I-capacitor-recharge-rig-i.webp",
  "电容回充改装件 II":"电容回充改装件-II-capacitor-recharge-rig-ii.webp",
  "电容回充改装件 III":"电容回充改装件-III-capacitor-recharge-rig-iii.webp",
  "电容回充改装件 IV":"电容回充改装件-IV-capacitor-recharge-rig-iv.webp",
  "电容回充改装件 V":"电容回充改装件-V-capacitor-recharge-rig-v.webp",
  "考古干扰缩短改装件 I":"考古干扰缩短改装件-I-archaeology-interference-rig-i.webp",
  "考古干扰缩短改装件 II":"考古干扰缩短改装件-II-archaeology-interference-rig-ii.webp",
  "考古干扰缩短改装件 III":"考古干扰缩短改装件-III-archaeology-interference-rig-iii.webp",
  "考古干扰缩短改装件 IV":"考古干扰缩短改装件-IV-archaeology-interference-rig-iv.webp",
  "考古干扰缩短改装件 V":"考古干扰缩短改装件-V-archaeology-interference-rig-v.webp",
  "遗迹速掘改装件 I":"遗迹速掘改装件-I-relic-excavation-rig-i.webp",
  "遗迹速掘改装件 II":"遗迹速掘改装件-II-relic-excavation-rig-ii.webp",
  "遗迹速掘改装件 III":"遗迹速掘改装件-III-relic-excavation-rig-iii.webp",
  "遗迹速掘改装件 IV":"遗迹速掘改装件-IV-relic-excavation-rig-iv.webp",
  "遗迹速掘改装件 V":"遗迹速掘改装件-V-relic-excavation-rig-v.webp",
  "神经训练改装件 I":"神经训练改装件-I-neural-training-rig-i.webp",
  "神经训练改装件 II":"神经训练改装件-II-neural-training-rig-ii.webp",
  "神经训练改装件 III":"神经训练改装件-III-neural-training-rig-iii.webp",
  "神经训练改装件 IV":"神经训练改装件-IV-neural-training-rig-iv.webp",
  "神经训练改装件 V":"神经训练改装件-V-neural-training-rig-v.webp"
});
for (const [displayName, asset] of Object.entries(ARCHAEOLOGY_SUPPORT_RIG_ICON_ASSETS)) {
  ITEM_ICONS[displayName] = `<img class="item-icon-image" src="./assets/icons/ship-rigs/${asset}?v=1" alt="" loading="lazy" decoding="async">`;
}
// 无人机指挥链路与控制核心：通用等级、势力型和旗舰型按装备 displayName 映射。
const DRONE_LINK_ICON_ASSETS = Object.freeze({
  "T1无人机控制单元":"T1无人机控制单元-t1-drone-control-unit.webp",
  "协同无人机指挥链路":"协同无人机指挥链路-cooperative-drone-command-link.webp",
  "高级无人机指挥链路":"高级无人机指挥链路-advanced-drone-command-link.webp",
  "赤誓仆从无人机指挥链路":"赤誓仆从无人机指挥链路-crimson-covenant-servitor-drone-link.webp",
  "赤誓仆从无人机指挥链路·献祭型":"赤誓仆从无人机指挥链路·献祭型-crimson-covenant-sacrificial-drone-link.webp",
  "银河联盟无人机指挥链路":"银河联盟无人机指挥链路-galactic-alliance-drone-link.webp",
  "深空无人机指挥链路":"深空无人机指挥链路-deep-space-drone-command-link.webp",
  "旗舰无人机指挥核心":"旗舰无人机指挥核心-capital-drone-command-core.webp",
  "苍穹劫团无人机指挥链路·破阵型":"苍穹劫团无人机指挥链路·破阵型-angel-cartel-warbreaker-drone-link.webp",
  "静默无人机指挥链路·前哨型":"静默无人机指挥链路·前哨型-sansha-outpost-drone-link.webp",
  "苍穹劫团无人机指挥链路·终焉型":"苍穹劫团无人机指挥链路·终焉型-angel-cartel-apocalypse-drone-link.webp"
});
for (const [displayName, asset] of Object.entries(DRONE_LINK_ICON_ASSETS)) {
  ITEM_ICONS[displayName] = `<img class="item-icon-image" src="./assets/icons/drone-links/${asset}?v=1" alt="" loading="lazy" decoding="async">`;
}

function xpForLevel(lv) { return Math.floor(100 * Math.pow(1.1, lv - 1)); }

function checkLevelUpFromState(state, skillKey, eventMeta) {
  const s = state.skills[skillKey];
  // 无等级上限：经验足够就一直升级，直到 XP 不足。
  // 守卫 Number.isFinite 防止异常 XP（Infinity/NaN）造成死循环。
  while (Number.isFinite(s.xp) && s.xp >= xpForLevel(s.lvl + 1)) {
    const need = xpForLevel(s.lvl + 1);
    if (s.xp < need) break;
    s.xp -= need;
    const previousLevel = s.lvl;
    s.lvl++;
    GameEvents.emit("skill:levelUp", { skill:skillKey, previousLevel, level:s.lvl }, eventMeta);
  }
}

function addSkillXpToState(state, skillKey, amount, eventMeta) {
  if (!state || !state.skills || !state.skills[skillKey]) return 0;
  const meta = eventMeta || {};
  let gained = Math.max(0, Number(amount) || 0);
  // 经验改装件（rig_skill_xp）：仅加成该船被指派的工作（job），不外溢到其他船/其他工作。
  // job 为 shipAssignments 的键（mining/gasHarvesting/refining/archaeology/combat）；无 job 则 rig 不生效。
  if (meta.job && typeof getAssignedShipState === "function" && typeof getRigModifiers === "function") {
    const assigned = getAssignedShipState(state, meta.job);
    if (assigned && assigned.instance) {
      const mods = getRigModifiers(state, assigned.instance) || {};
      const rigBonus = Number(mods.skillXpBonus) || 0;
      if (rigBonus) gained = gained * (1 + rigBonus);
    }
  }
  // 神经训练催化器（全局增强剂）：所有技能经验共用同一乘区（与 rig 独立相乘）。
  // 2026-09-04：meta.skipBooster === true 时跳过本乘区（仅自动拆解使用）。
  //   背景：增强剂消耗是按【当前活动】分槽计时的（见 boosters.js tickBoosterTimers），
  //   而加成是按【技能桶】发放的（skillXpMultBySkill[skillKey]）。自动拆解归在熔炼下，
  //   只消耗熔炼槽，却同时发放舰船工程经验——若舰船那份也吃加成，就成了
  //   「享受加成却不消耗」的白嫖。故舰船工程那份传 skipBooster，保持「谁消耗谁加成」。
  if (!meta.skipBooster && typeof getBoosterEffectState === "function") {
    const eff = getBoosterEffectState(state);
    const booster = (eff && eff.skillXpMultBySkill) ? (Number(eff.skillXpMultBySkill[skillKey]) || 1) : 1;
    if (booster && booster !== 1) gained = gained * booster;
  }
  gained = Math.max(0, gained);
  // 军团 NPC「薪资统筹」之外的「训练教范(xpGain)」：玩家经验加成（不影响 NPC 等级曲线）。
  if (typeof LEGION_NPC !== "undefined" && typeof LEGION_NPC.getLegionContributionSnapshot === "function") {
    const lp = LEGION_NPC.getLegionContributionSnapshot(state).multipliers.playerXp;
    if (lp && lp !== 1) gained = gained * lp;
  }
  // 脑突触加速剂（广告激励增益）：独立乘区 ×1.3，仅增益激活时作用于【战斗技能经验】。
  // 判定：战斗经验统一经 addStationModifiedCombatXp 入口，其 meta.source === "station-combat-command"；
  // 生产/考古/制造等非战斗技能经验（mining/refining/gasHarvesting/archaeology/装备工程…）不享受该增益。
  const adbm = (typeof getAdBuffMultiplier === "function") ? getAdBuffMultiplier(state) : 1;
  if (adbm && adbm !== 1 && meta && meta.source === "station-combat-command") gained = gained * adbm;
  state.skills[skillKey].xp = (Number(state.skills[skillKey].xp) || 0) + gained;
  checkLevelUpFromState(state, skillKey, eventMeta);
  state._dirty = true;
  return gained;
}

function checkLevelUp(skillKey, eventMeta) {
  return checkLevelUpFromState(gameState, skillKey, eventMeta);
}

function getMiningAreaByName(name) { return ALL_MINING_AREAS.find(a => a.name === name || a.ore === name) || null; }
function getMiningArea() { return getMiningAreaByName(gameState.currentAction.area) || MINING_AREAS[0]; }
function getRunningMiningArea() { return getMiningAreaByName(gameState.currentAction.startedArea || gameState.currentAction.area) || MINING_AREAS[0]; }
function getMiningAreasForMode(mode) { return mode === "moon" ? MOON_MINING_AREAS : MINING_AREAS; }
function getBestMiningArea(mode) {
  const areas = getMiningAreasForMode(mode || "normal"); const lv = getEffectiveSkillLevel(gameState, "mining");
  let best = areas[0]; for (const area of areas) { if (lv >= area.level) best = area; else break; } return best;
}

var SMELTING_RECIPES = [
  { name: "凡晶石带",   consumeOre: "凡晶石", outputMineral: "三钛合金",     level: 1,  baseTime: 10,   baseOutput: 1, baseXP: 10  },
  { name: "灼烧岩带",   consumeOre: "灼烧岩", outputMineral: "类银超金属",   level: 10, baseTime: 20,   baseOutput: 1, baseXP: 30  },
  { name: "水硼砂带",   consumeOre: "水硼砂", outputMineral: "类晶体胶矿",   level: 20, baseTime: 35,   baseOutput: 1, baseXP: 70  },
  { name: "斜长岩带",   consumeOre: "斜长岩", outputMineral: "同位聚合体",   level: 40, baseTime: 60,   baseOutput: 1, baseXP: 140 },
  { name: "干焦岩带",   consumeOre: "干焦岩", outputMineral: "超新星诺克石", level: 55, baseTime: 90,   baseOutput: 1, baseXP: 230 },
  { name: "灰岩带",     consumeOre: "灰岩",   outputMineral: "基腹断岩",     level: 70, baseTime: 130,  baseOutput: 1, baseXP: 370 },
  { name: "艾克诺岩带", consumeOre: "艾克诺岩", outputMineral: "超噬矿",     level: 85, baseTime: 190,  baseOutput: 1, baseXP: 580 }
];

// ---- 气体采集区域配置表 ----
var GAS_AREAS = [
  { name: "富勒烯云团",     gas: "粗制富勒烯",   level: 1,  baseTime: 22.5, baseXP: 10  },
  { name: "氦同位素云团",   gas: "氦同位素",     level: 10, baseTime: 45,   baseXP: 40  },
  { name: "稳定富勒烯云团", gas: "稳定富勒烯",   level: 20, baseTime: 75,   baseXP: 80  },
  { name: "氢同位素云团",   gas: "氢同位素",     level: 40, baseTime: 112.5, baseXP: 140 },
  { name: "高纯富勒烯云团", gas: "高纯富勒烯",   level: 55, baseTime: 165,  baseXP: 220 },
  { name: "聚合气体云团",   gas: "聚合气体",     level: 70, baseTime: 240,  baseXP: 350 },
  { name: "超纯聚合气体云团", gas: "超纯聚合气体", level: 85, baseTime: 337.5, baseXP: 520 }
];

function getAssignedShip(actionKey) { const ship = getAssignedShipInstance(actionKey); return ship ? getShipConfig(ship.shipId) : null; }
function getAssignedShipFitting(actionKey) { const ship = getAssignedShipInstance(actionKey); return ship ? getShipFitting(ship.instanceId) : createEmptyFitting(); }
function getActiveIndustrialShip() {
  const id = gameState.activeIndustrialShip;
  if (!id || !INDUSTRIAL_SHIPS || !INDUSTRIAL_SHIPS[id]) return null;
  return INDUSTRIAL_SHIPS[id];
}

function getProductionEfficiencyBreakdown(actionKey) {
  const display = getProductionEfficiencyState(gameState, actionKey);
  return { ...display, lvl:display.level, ship:display.ship ? getShipConfigById(display.ship.id) : null };
}

function getProductionEfficiencyTooltip(actionKey, targetName, baseTime) {
  return buildProductionEfficiencyTooltip(getProductionEfficiencyState(gameState, actionKey), targetName, baseTime);
}

function getMiningEfficiency() {
  let base = getProductionEfficiencyBreakdown("mining").total; // 已含脑突触加速剂(adBuffMult，注入于 getProductionEfficiencyState.total)
  if (typeof LEGION_NPC !== "undefined" && typeof LEGION_NPC.getLegionContributionSnapshot === "function") {
    base = base * LEGION_NPC.getLegionContributionSnapshot(gameState).multipliers.mining;
  }
  return base;
}
function getSmeltingEfficiency() { return getSmeltingDisplayState(gameState, Date.now()).efficiency; }
function getGasEfficiency() {
  let base = getProductionEfficiencyBreakdown("gasHarvesting").total; // 已含脑突触加速剂(adBuffMult，注入于 getProductionEfficiencyState.total)
  if (typeof LEGION_NPC !== "undefined" && typeof LEGION_NPC.getLegionContributionSnapshot === "function") {
    base = base * LEGION_NPC.getLegionContributionSnapshot(gameState).multipliers.gas;
  }
  return base;
}
function getShipEngineeringEfficiency() { const lvl = getEffectiveSkillLevel(gameState, "shipEngineering"); return 1 * (1 + lvl * 0.02); }

function getGasArea() { const name = gameState.currentAction.gasArea; return GAS_AREAS.find(a => a.name === name) || GAS_AREAS[0]; }
function getBestGasArea() { const lv = getEffectiveSkillLevel(gameState, "gasHarvesting"); let best = GAS_AREAS[0]; for (const a of GAS_AREAS) { if (lv >= a.level) best = a; else break; } return best; }

// 伴生富集改装件（rig_mining_rich / rig_gas_rich）：采集周期结算的概率性基准矿奖励。
// 在线（tick.js）与离线（offline.js）共用：读装配舰 rig 聚合几率（miningRichChance/gasRichChance）掷骰，
// 命中则额外发放基准矿（采矿=铁硅原矿 ore:凡晶石 / 采气=粗制富勒烯 gas:粗制富勒烯），
// 数量 = max(1, round(当前区域 baseTime ÷ 基准区域 baseTime))。
// 奖励独立：不参与双倍矿/脑插双生/调度加成，不给 XP。返回发放数量（未触发为 0）。
const RIG_RICH_BASE_AREA_TIME = { mining: 15, gasHarvesting: 22.5 }; // 凡晶石带 15s / 富勒烯云团 22.5s
function rollRigRichBonus(state, actionKey, area) {
  const baseTime = RIG_RICH_BASE_AREA_TIME[actionKey];
  if (!baseTime || !state || !area || !(Number(area.baseTime) > 0)) return 0;
  const chanceKey = actionKey === "mining" ? "miningRichChance" : "gasRichChance";
  const bonusResId = actionKey === "mining" ? "ore:凡晶石" : "gas:粗制富勒烯";
  let instance = null;
  if (typeof getAssignedShipInstance === "function") {
    try { instance = getAssignedShipInstance(actionKey); } catch (e) { instance = null; }
  }
  if (!instance || typeof getRigModifiers !== "function") return 0;
  if (typeof ResourceRegistry === "undefined" || typeof ResourceRegistry.add !== "function") return 0;
  const mods = getRigModifiers(state, instance) || {};
  const chance = Number(mods[chanceKey]) || 0;
  if (!(chance > 0) || Math.random() >= chance) return 0;
  const qty = Math.max(1, Math.round(Number(area.baseTime) / baseTime));
  ResourceRegistry.add(state, bonusResId, qty);
  return qty;
}

function getSmeltingRecipe() { const name = gameState.currentAction.smeltingArea; return SMELTING_RECIPES.find(r => r.name === name) || SMELTING_RECIPES[0]; }

// ---- 冶炼配方通用消耗/产出解析（P1 泰坦双材料 2026-09-10）----
// 旧配方：单输入 consumeOre（ore: 池，每周期 1）；泰坦配方：inputs{材料名:每周期用量}（inputPool 缺省 special:）。
// 三个执行侧（tick 手动 / offline 离线追算 / station 自动线）与 selectors 库存显示统一经此解析，
// 单输入旧配方逐位等价（consumeList=[{refId:"ore:X",qty:1}]，cyclesAvailable=floor(库存)）。
function getSmeltingConsumeList(recipe) {
  if (!recipe) return [];
  if (recipe.consumeOre) return [{ refId: "ore:" + recipe.consumeOre, qty: 1 }];
  if (recipe.inputs) return Object.keys(recipe.inputs).map(name => ({ refId: (recipe.inputPool || "special") + ":" + name, qty: Math.max(1, Number(recipe.inputs[name]) || 1) }));
  return [];
}
function getSmeltingOutputRefId(recipe) { return (recipe.outputPool || "mineral") + ":" + recipe.outputMineral; }
// 按当前库存可完成的周期数（多输入取各 min(floor(库存/用量))）
function getSmeltingCyclesAvailable(state, recipe) {
  const list = getSmeltingConsumeList(recipe);
  if (list.length === 0) return 0;
  let min = Infinity;
  for (const c of list) {
    const stock = (typeof ResourceRegistry !== "undefined" && ResourceRegistry.get) ? ResourceRegistry.get(state, c.refId) : 0;
    min = Math.min(min, Math.floor(Math.max(0, stock) / c.qty));
  }
  return min === Infinity ? 0 : min;
}
function hasMoonMiningEquipment() {
  return getMoonMiningAccessState(gameState).hasEquipment;
}
function canMineArea(area) {
  return getMiningRequirementState(gameState, area).available;
}
function getMiningRequirementText(area) {
  return getMiningRequirementState(gameState, area).text;
}

// 双模式出口（微信小游戏 CommonJS 适配）：本文件 23 个顶层声明被 js/core/actions.js、js/core/offline.js、js/core/persistence.js 等 跨文件消费，
// 在小游戏的模块包裹下不显式导出即不可见；浏览器侧为幂等赋值，行为零变化。
// 写法与 js/data/ships.js 等已上线的同款出口一致。
if (typeof window !== "undefined") window.SMELTING_RECIPES = SMELTING_RECIPES;
if (typeof window !== "undefined") window.addSkillXpToState = addSkillXpToState;
if (typeof window !== "undefined") window.xpForLevel = xpForLevel;
if (typeof window !== "undefined") window.ITEM_ICONS = ITEM_ICONS;
if (typeof window !== "undefined") window.checkLevelUp = checkLevelUp;
if (typeof window !== "undefined") window.GAS_AREAS = GAS_AREAS;
if (typeof window !== "undefined") window.ITEM_CATEGORIES = ITEM_CATEGORIES;
if (typeof window !== "undefined") window.getMiningEfficiency = getMiningEfficiency;
if (typeof window !== "undefined") window.getGasEfficiency = getGasEfficiency;
if (typeof window !== "undefined") window.rollRigRichBonus = rollRigRichBonus;
if (typeof window !== "undefined") window.getMiningAreaByName = getMiningAreaByName;
if (typeof window !== "undefined") window.getSmeltingConsumeList = getSmeltingConsumeList;
if (typeof window !== "undefined") window.getSmeltingCyclesAvailable = getSmeltingCyclesAvailable;
if (typeof window !== "undefined") window.canMineArea = canMineArea;
if (typeof window !== "undefined") window.MINING_AREAS = MINING_AREAS;
if (typeof window !== "undefined") window.ALL_MINING_AREAS = ALL_MINING_AREAS;
if (typeof window !== "undefined") window.getRunningMiningArea = getRunningMiningArea;
if (typeof window !== "undefined") window.getSmeltingOutputRefId = getSmeltingOutputRefId;
if (typeof window !== "undefined") window.checkLevelUpFromState = checkLevelUpFromState;
if (typeof window !== "undefined") window.MOON_MINING_AREAS = MOON_MINING_AREAS;
if (typeof window !== "undefined") window.getMiningArea = getMiningArea;
if (typeof window !== "undefined") window.getGasArea = getGasArea;
if (typeof window !== "undefined") window.getSmeltingRecipe = getSmeltingRecipe;
if (typeof module !== "undefined" && module.exports) module.exports = { SMELTING_RECIPES: SMELTING_RECIPES, addSkillXpToState: addSkillXpToState, xpForLevel: xpForLevel, ITEM_ICONS: ITEM_ICONS, checkLevelUp: checkLevelUp, GAS_AREAS: GAS_AREAS, ITEM_CATEGORIES: ITEM_CATEGORIES, getMiningEfficiency: getMiningEfficiency, getGasEfficiency: getGasEfficiency, rollRigRichBonus: rollRigRichBonus, getMiningAreaByName: getMiningAreaByName, getSmeltingConsumeList: getSmeltingConsumeList, getSmeltingCyclesAvailable: getSmeltingCyclesAvailable, canMineArea: canMineArea, MINING_AREAS: MINING_AREAS, ALL_MINING_AREAS: ALL_MINING_AREAS, getRunningMiningArea: getRunningMiningArea, getSmeltingOutputRefId: getSmeltingOutputRefId, checkLevelUpFromState: checkLevelUpFromState, MOON_MINING_AREAS: MOON_MINING_AREAS, getMiningArea: getMiningArea, getGasArea: getGasArea, getSmeltingRecipe: getSmeltingRecipe };
