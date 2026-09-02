// ---- 装备工程：燃料与弹药配方 ----
const AMMO_ENG_RECIPES = [
  { id:"fuel_t1",     name:"标准燃料单元", level:1,  time:15, xp:10, category:"fuel", cost:{"粗制富勒烯":3},            output:{type:"fuel", qty:100} },
  { id:"fuel_t2",     name:"强化燃料单元", level:20, time:25, xp:25, category:"fuel", cost:{"稳定富勒烯":2},            output:{type:"fuel", qty:250} },
  { id:"fuel_t3",     name:"超纯燃料单元", level:55, time:50, xp:150, category:"fuel", cost:{"高纯富勒烯":2,"稀有气体":50}, output:{type:"fuel", qty:550} },
  { id:"ammo_laser",  name:"激光晶体弹药", level:1,  time:10, xp:8,  category:"ammunition", cost:{"三钛合金":4,"稀有气体":3},          output:{type:"ammo", weapon:"laser", qty:50} },
  { id:"ammo_missile",name:"导弹",         level:1,  time:10, xp:8,  category:"ammunition", cost:{"三钛合金":5,"重金属":1}, output:{type:"ammo", weapon:"missile", qty:50} },
  { id:"ammo_cannon", name:"炮台弹药",     level:1,  time:10, xp:8,  category:"ammunition", cost:{"三钛合金":4},          output:{type:"ammo", weapon:"cannon", qty:50} },
  // T2 弹药（time25 = T1 的 2.5×、output30、成本 激光/导弹=三钛10+镓2、炮弹=三钛8+铂2、dmgMult/hitMult ×1.10 独立乘区；默认解锁 level1 便于测试，考古蓝图门控后续再叠）
  { id:"ammo_laser_t2",  name:"聚焦相位激光弹", level:1, time:25, xp:20, category:"ammunition", cost:{"三钛合金":8,"镓":2}, output:{type:"ammo", weapon:"laser",  qty:30, tier:"T2"} },
  { id:"ammo_missile_t2",name:"高爆制导导弹",   level:1, time:25, xp:20, category:"ammunition", cost:{"三钛合金":10,"镓":2}, output:{type:"ammo", weapon:"missile", qty:30, tier:"T2"} },
  { id:"ammo_cannon_t2", name:"重型轨道弹药",   level:1, time:25, xp:20, category:"ammunition", cost:{"三钛合金":8,"铂":2}, output:{type:"ammo", weapon:"cannon",  qty:30, tier:"T2"} },
  // 考古探针（弹药/燃料类，不可安装、不可强化）
  { id:"probe_core_i",    name:"标准考古探针 I",  level:1,  time:15, xp:20, category:"probes", cost:{"三钛合金":40},                output:{type:"probe", itemId:"core_probe_i",    qty:20} },
  { id:"probe_enhanced_ii",name:"强化考古探针 II", level:35, time:35, xp:80, category:"probes", cost:{"三钛合金":200,"类晶体胶矿":60}, output:{type:"probe", itemId:"enhanced_probe_ii", qty:20} },
  { id:"probe_deep_iii",  name:"深空考古探针 III", level:70, time:75, xp:200,category:"probes", cost:{"三钛合金":600,"超噬矿":10,"铷":3}, output:{type:"probe", itemId:"deep_probe_iii",  qty:20} },
  // 势力增强探针：需限次抄本 BPC（"probe:<id>"，功勋商店按流程购买）+ 势力制造许可作材料。
  // 1 流程 = 1 生产周期 = 20 枚；抄本流程耗尽即消失、须重买。语义见 js/core/blueprint-runs.js。
  // 三档分属三势力，命名与许可同源：I=苍穹劫团(D×1) / II=赤誓教团(C×2) / III=静默集群(B×3)。
  { id:"probe_faction_i",   name:"苍穹劫团考古探针·掠空型", level:1,  time:15, xp:20,  category:"probes", requiresBlueprint:true, cost:{"三钛合金":40,  "苍穹劫团装备生产许可D":1}, output:{type:"probe", itemId:"faction_probe_i",   qty:20} },
  { id:"probe_faction_ii",  name:"赤誓教团考古探针·血誓型", level:35, time:35, xp:80,  category:"probes", requiresBlueprint:true, cost:{"三钛合金":200, "类晶体胶矿":60, "赤誓教团装备生产许可C":2}, output:{type:"probe", itemId:"faction_probe_ii",  qty:20} },
  { id:"probe_faction_iii", name:"静默集群考古探针·同化型", level:70, time:75, xp:200, category:"probes", requiresBlueprint:true, cost:{"三钛合金":600, "超噬矿":10, "铷":3, "静默集群装备生产许可B":3}, output:{type:"probe", itemId:"faction_probe_iii", qty:20} }
];

const EQUIPMENT_ENGINEERING_CATEGORIES = [
  { id:"mining", name:"采矿装备", icon:"fa-solid fa-gem" },
  { id:"gas", name:"采气装备", icon:"fa-solid fa-cloud" },
  { id:"smelting", name:"冶炼装备", icon:"fa-solid fa-fire" },
  { id:"collect_boost", name:"采集增益", icon:"fa-solid fa-arrow-up" },
  { id:"drones", name:"无人机", icon:"fa-solid fa-satellite-dish" },
  { id:"weapons", name:"武器系统", icon:"fa-solid fa-crosshairs" },
  { id:"defense", name:"防御维修", icon:"fa-solid fa-shield-halved" },
  { id:"fuel", name:"燃料", icon:"fa-solid fa-gas-pump" },
  { id:"ammunition", name:"弹药", icon:"fa-solid fa-burst" },
  { id:"archaeology", name:"考古装备", icon:"fa-solid fa-satellite-dish" },
  { id:"probes", name:"考古探针", icon:"fa-solid fa-crosshairs" },
  { id:"rigs", name:"改装件", icon:"fa-solid fa-microchip" }
];

// 装备工程三级标签：仅下列四个二级分类启用；其余（采矿/采气/无人机/改装件/燃料/弹药/探针）保持单级。
// 子标签 id 须与 getEquipEngSubtabId(recipe) 的返回值一致。用户 2026-08-23 调整：武器系统不含旗舰分类；
// 采集增益拆采矿增益/采气增益/打捞臂；考古拆遗迹分析仪/信号稳定器/文物译码器。
const EQUIPMENT_ENGINEERING_SUBTABS = {
  weapons: [
    { id:"all", name:"全部" },
    { id:"laser", name:"激光炮" },
    { id:"missile", name:"导弹发射器" },
    { id:"cannon", name:"射弹炮" }
  ],
  defense: [
    { id:"all", name:"全部" },
    { id:"shield", name:"护盾" },
    { id:"armor", name:"装甲" },
    { id:"structure", name:"结构" },
    { id:"damageControl", name:"损伤控制" }
  ],
  collect_boost: [
    { id:"all", name:"全部" },
    { id:"mining", name:"采矿增益" },
    { id:"gas", name:"采气增益" },
    { id:"salvage", name:"打捞臂" }
  ],
  archaeology: [
    { id:"all", name:"全部" },
    { id:"analyzer", name:"遗迹分析仪" },
    { id:"stabilizer", name:"信号稳定器" },
    { id:"decoder", name:"文物译码器" }
  ]
};

// 改装件二级筛选改为「按 9 个系列单选」（护盾容量/装甲容量/结构容量/采矿速度/采气速度/冶炼速度/扫描强度/考古燃料效率/考古干扰缩短），
// 每个系列 5 档（I~V），点开即一排 5 张卡。数据直接复用 equipment.js 的 RIG_SERIES（label/rigCategory/stackGroup），避免中文名写两遍。
const RIG_ENGINEERING_SERIES = RIG_SERIES.map(s => ({ id:s.stackGroup, name:s.label, rigCategory:s.rigCategory }));

// 装备工程统一配方：可装配装备、燃料和弹药都走同一制造技能与队列。
const EQUIPMENT_ENGINEERING_RECIPES = [
  ...EQUIPMENT_RECIPES.map(recipe => ({
    ...recipe,
    productType: "equipment",
    output: { type: "equipment", itemId: recipe.id, qty: 1 }
  })),
  ...AMMO_ENG_RECIPES.map(recipe => ({
    ...recipe,
    productType: recipe.output.type
  }))
];

function getEquipmentEngineeringRecipe(recipeId) {
  return EQUIPMENT_ENGINEERING_RECIPES.find(recipe => recipe.id === recipeId) ||
    EQUIPMENT_ENGINEERING_RECIPES[0];
}
