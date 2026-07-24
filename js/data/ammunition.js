// ---- 装备工程：燃料与弹药配方 ----
const AMMO_ENG_RECIPES = [
  { id:"fuel_t1",     name:"标准燃料单元", level:1,  time:15, xp:10, category:"fuel", cost:{"粗制富勒烯":3},        output:{type:"fuel", qty:100} },
  { id:"fuel_t2",     name:"强化燃料单元", level:20, time:25, xp:25, category:"fuel", cost:{"稳定富勒烯":2},        output:{type:"fuel", qty:200} },
  { id:"ammo_laser",  name:"激光晶体弹药", level:1,  time:10, xp:8,  category:"ammunition", cost:{"三钛合金":5},          output:{type:"ammo", weapon:"laser", qty:50} },
  { id:"ammo_missile",name:"导弹",         level:1,  time:10, xp:8,  category:"ammunition", cost:{"三钛合金":5,"类银超金属":2}, output:{type:"ammo", weapon:"missile", qty:50} },
  { id:"ammo_cannon", name:"炮台弹药",     level:1,  time:10, xp:8,  category:"ammunition", cost:{"三钛合金":5,"类晶体胶矿":2}, output:{type:"ammo", weapon:"cannon", qty:50} },
  // 考古探针（弹药/燃料类，不可安装、不可强化）
  { id:"probe_core_i",    name:"标准考古探针 I",  level:1,  time:15, xp:20, category:"probes", cost:{"三钛合金":40},                output:{type:"probe", itemId:"core_probe_i",    qty:20} },
  { id:"probe_enhanced_ii",name:"强化考古探针 II", level:35, time:35, xp:80, category:"probes", cost:{"三钛合金":200,"类晶体胶矿":60}, output:{type:"probe", itemId:"enhanced_probe_ii", qty:20} },
  { id:"probe_deep_iii",  name:"深空考古探针 III", level:70, time:75, xp:200,category:"probes", cost:{"三钛合金":600,"超噬矿":10,"铷":3}, output:{type:"probe", itemId:"deep_probe_iii",  qty:20} }
];

const EQUIPMENT_ENGINEERING_CATEGORIES = [
  { id:"industry", name:"工业采集", icon:"fa-solid fa-gem" },
  { id:"drones", name:"无人机", icon:"fa-solid fa-satellite-dish" },
  { id:"weapons", name:"武器系统", icon:"fa-solid fa-crosshairs" },
  { id:"defense", name:"防御维修", icon:"fa-solid fa-shield-halved" },
  { id:"fuel", name:"燃料", icon:"fa-solid fa-gas-pump" },
  { id:"ammunition", name:"弹药", icon:"fa-solid fa-burst" },
  { id:"archaeology", name:"考古装备", icon:"fa-solid fa-satellite-dish" },
  { id:"probes", name:"考古探针", icon:"fa-solid fa-crosshairs" },
  { id:"rigs", name:"改装件", icon:"fa-solid fa-microchip" }
];

// 改装件子分类（战斗 / 工业 / 考古）与档位过滤（I~V），供装备工程 UI 二级筛选。
const RIG_ENGINEERING_SUBCATEGORIES = [
  { id:"combat", name:"战斗" },
  { id:"industry", name:"工业" },
  { id:"archaeology", name:"考古" }
];
const RIG_ENGINEERING_TIERS = ["I", "II", "III", "IV", "V"];

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
