// ---- 装备工程：燃料与弹药配方 ----
const AMMO_ENG_RECIPES = [
  { id:"fuel_t1",     name:"标准燃料单元", level:1,  time:15, xp:10, category:"fuel", cost:{"粗制富勒烯":3},        output:{type:"fuel", qty:100} },
  { id:"fuel_t2",     name:"强化燃料单元", level:20, time:25, xp:25, category:"fuel", cost:{"稳定富勒烯":2},        output:{type:"fuel", qty:200} },
  { id:"ammo_laser",  name:"激光晶体弹药", level:1,  time:10, xp:8,  category:"ammunition", cost:{"三钛合金":5},          output:{type:"ammo", weapon:"laser", qty:50} },
  { id:"ammo_missile",name:"导弹",         level:1,  time:10, xp:8,  category:"ammunition", cost:{"三钛合金":5,"类银超金属":2}, output:{type:"ammo", weapon:"missile", qty:50} },
  { id:"ammo_cannon", name:"炮台弹药",     level:1,  time:10, xp:8,  category:"ammunition", cost:{"三钛合金":5,"类晶体胶矿":2}, output:{type:"ammo", weapon:"cannon", qty:50} }
];

const EQUIPMENT_ENGINEERING_CATEGORIES = [
  { id:"industry", name:"工业采集", icon:"fa-solid fa-gem" },
  { id:"drones", name:"无人机", icon:"fa-solid fa-satellite-dish" },
  { id:"weapons", name:"武器系统", icon:"fa-solid fa-crosshairs" },
  { id:"defense", name:"防御维修", icon:"fa-solid fa-shield-halved" },
  { id:"fuel", name:"燃料", icon:"fa-solid fa-gas-pump" },
  { id:"ammunition", name:"弹药", icon:"fa-solid fa-burst" }
];

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
