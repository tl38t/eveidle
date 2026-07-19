// ---- 舰船工程：T1 部件配方表 ----
const SHIP_COMPONENT_RECIPES = [
  { id:"integrated_hull", name:"综合舰体组件", level:1, time:63, xp:44, cost:{ "三钛合金":40, "类银超金属":6, "重金属":7, "稀有气体":4 } },
  { id:"power_core", name:"动力控制核心", level:1, time:42, xp:30, cost:{ "三钛合金":28, "类银超金属":6, "稀有气体":5 } },
  { id:"functional_system", name:"舰船功能组件", level:1, time:18, xp:12, cost:{ "三钛合金":14, "类银超金属":1, "重金属":2 } },
  { id:"destroyer_integrated_hull", name:"驱逐舰综合舰体组件", level:15, time:93, xp:76, cost:{ "三钛合金":46, "类银超金属":16, "重金属":6, "稀有气体":3 } },
  { id:"destroyer_power_core", name:"驱逐舰动力控制核心", level:15, time:62, xp:50, cost:{ "三钛合金":29, "类银超金属":4, "类晶体胶矿":2, "重金属":3, "稀有气体":3 } },
  { id:"destroyer_functional_system", name:"驱逐舰舰船功能组件", level:15, time:28, xp:22, cost:{ "三钛合金":14, "类银超金属":4, "稀有气体":3 } },
  { id:"cruiser_integrated_hull", name:"巡洋舰综合舰体组件", level:35, time:137, xp:140, cost:{ "三钛合金":43, "类银超金属":16, "同位聚合体":6, "同位素":6, "重金属":4 } },
  { id:"cruiser_power_core", name:"巡洋舰动力控制核心", level:35, time:93, xp:95, cost:{ "三钛合金":27, "类银超金属":4, "类晶体胶矿":3, "同位聚合体":2, "重金属":4, "稀有气体":4 } },
  { id:"cruiser_functional_system", name:"巡洋舰舰船功能组件", level:35, time:42, xp:40, cost:{ "三钛合金":15, "类银超金属":3, "同位聚合体":1, "稀有气体":4 } },
  { id:"battleship_integrated_hull", name:"战列舰综合舰体组件", level:55, time:195, xp:215, cost:{ "三钛合金":40, "同位聚合体":23, "超新星诺克石":20, "同位素":5, "重金属":6, "等离子体":10 } },
  { id:"battleship_power_core", name:"战列舰动力控制核心", level:55, time:133, xp:145, cost:{ "三钛合金":28, "同位聚合体":12, "超新星诺克石":12, "重金属":6, "稀有气体":6, "等离子体":5 } },
  { id:"battleship_functional_system", name:"战列舰舰船功能组件", level:55, time:60, xp:65, cost:{ "三钛合金":10, "同位聚合体":5, "超新星诺克石":7, "稀有气体":6, "等离子体":2 } }
];

// ---- 舰船工程：蓝图商店 ----
const SHIP_BLUEPRINTS = [
  { id: "rifter",  name: "裂谷级",   shipId: "rifter",  costISK: 50000, level: 1  },
  { id: "kestrel", name: "茶隼级",   shipId: "kestrel", costISK: 50000, level: 1  },
  { id: "atron",   name: "阿特龙级", shipId: "atron",   costISK: 50000, level: 1  },
  { id: "miner_frigate",  name: "冲锋者级", shipId: "miner_frigate",  costISK: 50000, level: 1  },
  { id: "gas_frigate",    name: "勘探者级", shipId: "gas_frigate",    costISK: 50000, level: 1  },
  { id: "gale", name: "疾风级", shipId: "gale", costLP: 60, level: 20, sourceZoneId:"angel_corridor" },
  { id: "bloodthorn", name: "血刺级", shipId: "bloodthorn", costLP: 60, level: 20, sourceZoneId:"blood_sacrifice" },
  { id: "umbra", name: "暗影级", shipId: "umbra", costLP: 60, level: 20, sourceZoneId:"sansha_node" }
];

// ---- 舰船工程：舰船合成配方 ----
const SHIP_ASSEMBLY_RECIPES = [
  { id:"rifter", name:"裂谷级", shipId:"rifter", level:1, time:30, xp:30, componentCost:{integrated_hull:2,power_core:2,functional_system:2} },
  { id:"kestrel", name:"茶隼级", shipId:"kestrel", level:1, time:30, xp:30, componentCost:{integrated_hull:2,power_core:2,functional_system:2} },
  { id:"atron", name:"阿特龙级", shipId:"atron", level:1, time:30, xp:30, componentCost:{integrated_hull:2,power_core:2,functional_system:2} },
  { id:"miner_frigate", name:"冲锋者级", shipId:"miner_frigate", level:1, time:30, xp:30, componentCost:{integrated_hull:2,power_core:2,functional_system:2} },
  { id:"gas_frigate", name:"勘探者级", shipId:"gas_frigate", level:1, time:30, xp:30, componentCost:{integrated_hull:2,power_core:2,functional_system:2} },
  { id:"raylight", name:"雷光级", shipId:"raylight", level:15, time:45, xp:60, requiresBlueprint:false, componentCost:{destroyer_integrated_hull:3,destroyer_power_core:3,destroyer_functional_system:4} },
  { id:"spearfalcon", name:"矛隼级", shipId:"spearfalcon", level:15, time:45, xp:60, requiresBlueprint:false, componentCost:{destroyer_integrated_hull:3,destroyer_power_core:3,destroyer_functional_system:4} },
  { id:"swiftblade", name:"疾锋级", shipId:"swiftblade", level:15, time:45, xp:60, requiresBlueprint:false, componentCost:{destroyer_integrated_hull:3,destroyer_power_core:3,destroyer_functional_system:4} },
  { id:"gale", name:"疾风级", shipId:"gale", level:20, time:60, xp:90, componentCost:{destroyer_integrated_hull:4,destroyer_power_core:4,destroyer_functional_system:5}, materialCost:{"镓":10,"铂":8,"天使低级加密数据":15} },
  { id:"bloodthorn", name:"血刺级", shipId:"bloodthorn", level:20, time:60, xp:90, componentCost:{destroyer_integrated_hull:4,destroyer_power_core:4,destroyer_functional_system:5}, materialCost:{"镓":10,"铂":8,"血袭者低级加密数据":15} },
  { id:"umbra", name:"暗影级", shipId:"umbra", level:20, time:60, xp:90, componentCost:{destroyer_integrated_hull:4,destroyer_power_core:4,destroyer_functional_system:5}, materialCost:{"镓":10,"铂":8,"萨沙低级加密数据":15} },
  { id:"dawnlight", name:"曙光级", shipId:"dawnlight", level:35, time:70, xp:100, requiresBlueprint:false, componentCost:{cruiser_integrated_hull:4,cruiser_power_core:5,cruiser_functional_system:4} },
  { id:"warfalcon", name:"战隼级", shipId:"warfalcon", level:35, time:70, xp:100, requiresBlueprint:false, componentCost:{cruiser_integrated_hull:4,cruiser_power_core:5,cruiser_functional_system:4} },
  { id:"stormblade", name:"烈锋级", shipId:"stormblade", level:35, time:70, xp:100, requiresBlueprint:false, componentCost:{cruiser_integrated_hull:4,cruiser_power_core:5,cruiser_functional_system:4} },
  { id:"sunlance", name:"曜光级", shipId:"sunlance", level:55, time:100, xp:160, requiresBlueprint:false, componentCost:{battleship_integrated_hull:6,battleship_power_core:5,battleship_functional_system:5} },
  { id:"fortfalcon", name:"堡隼级", shipId:"fortfalcon", level:55, time:100, xp:160, requiresBlueprint:false, componentCost:{battleship_integrated_hull:6,battleship_power_core:5,battleship_functional_system:5} },
  { id:"thunderblade", name:"震锋级", shipId:"thunderblade", level:55, time:100, xp:160, requiresBlueprint:false, componentCost:{battleship_integrated_hull:6,battleship_power_core:5,battleship_functional_system:5} }
];

// ---- 舰船工程：新手战舰属性表（参照第7节） ----
const STARTER_SHIPS = {
  rifter: {
    id: "rifter", name: "裂谷级", tier: "T1", type: "frigate",
    flavor: "天使集团风格，高护盾、高电容，适配激光武器",
    hp: { shield: 300, armor: 100, structure: 100 }, totalHp: 500,
    dodge: 25, speed: 280, targeting: 120,
    capacitor: { capacity: 120, rechargeRate: 6 },
    fuelEfficiency: 1.0,
    slots: { high: 2, mid: 2, low: 1, rig: 1 },
    bonuses: { shieldCapacity: 0.10, laserDamage: 0.05, capacitorRecharge: 0.08 },
    recommendedWeapon: "laser", counterFaction: "angel",
    unlock: { type: "starter", isDefault: true },
    image: "images/ships/裂谷级.png"
  },
  kestrel: {
    id: "kestrel", name: "茶隼级", tier: "T1", type: "frigate",
    flavor: "血袭者风格，高装甲、高锁定，适配导弹武器",
    hp: { shield: 100, armor: 300, structure: 100 }, totalHp: 500,
    dodge: 22, speed: 250, targeting: 135,
    capacitor: { capacity: 100, rechargeRate: 5 },
    fuelEfficiency: 0.9,
    slots: { high: 2, mid: 1, low: 2, rig: 1 },
    bonuses: { armorCapacity: 0.10, missileDamage: 0.05, targetingSpeed: 0.10 },
    recommendedWeapon: "missile", counterFaction: "blood",
    unlock: { type: "starter", isDefault: true }
  },
  atron: {
    id: "atron", name: "阿特龙级", tier: "T1", type: "frigate",
    flavor: "萨沙共和国风格，高结构、高速度，适配炮台武器",
    hp: { shield: 100, armor: 100, structure: 300 }, totalHp: 500,
    dodge: 30, speed: 320, targeting: 110,
    capacitor: { capacity: 100, rechargeRate: 5 },
    fuelEfficiency: 0.95,
    slots: { high: 2, mid: 1, low: 2, rig: 1 },
    bonuses: { structureCapacity: 0.10, cannonDamage: 0.05, speed: 0.10 },
    recommendedWeapon: "cannon", counterFaction: "sansha",
    unlock: { type: "starter", isDefault: true }
  },
  raylight: {
    id: "raylight", name: "雷光级", tier: "T1", type: "destroyer",
    flavor: "护盾专精驱逐舰，以三门小型激光武器和持续护盾维修承担正面火力",
    hp: { shield: 600, armor: 150, structure: 150 }, totalHp: 900,
    dodge: 18, speed: 230, targeting: 135,
    capacitor: { capacity: 170, rechargeRate: 8 },
    fuelEfficiency: 0.95,
    slots: { high: 3, mid: 3, low: 1, rig: 1 },
    bonuses: { shieldCapacity: 0.15, laserDamage: 0.10, hitBonus: 10 },
    recommendedWeapon: "laser", counterFaction: "angel",
    unlock: { type: "shipEngineering", level: 15 }
  },
  spearfalcon: {
    id: "spearfalcon", name: "矛隼级", tier: "T1", type: "destroyer",
    flavor: "装甲专精驱逐舰，以三门轻型导弹和强化装甲维修应对持久战",
    hp: { shield: 150, armor: 600, structure: 150 }, totalHp: 900,
    dodge: 16, speed: 210, targeting: 155,
    capacitor: { capacity: 160, rechargeRate: 8 },
    fuelEfficiency: 0.85,
    slots: { high: 3, mid: 1, low: 3, rig: 1 },
    bonuses: { armorCapacity: 0.15, missileDamage: 0.10, armorRepair: 0.50, hitBonus: 10 },
    recommendedWeapon: "missile", counterFaction: "blood",
    unlock: { type: "shipEngineering", level: 15 }
  },
  swiftblade: {
    id: "swiftblade", name: "疾锋级", tier: "T1", type: "destroyer",
    flavor: "结构专精驱逐舰，以三门小型炮台、速度和强化结构维修进行高风险作战",
    hp: { shield: 150, armor: 150, structure: 600 }, totalHp: 900,
    dodge: 22, speed: 260, targeting: 125,
    capacitor: { capacity: 160, rechargeRate: 8 },
    fuelEfficiency: 0.90,
    slots: { high: 3, mid: 1, low: 3, rig: 1 },
    bonuses: { structureCapacity: 0.15, cannonDamage: 0.10, speed: 0.15, structureRepair: 2.00, hitBonus: 10 },
    recommendedWeapon: "cannon", counterFaction: "sansha",
    unlock: { type: "shipEngineering", level: 15 }
  },
  gale: {
    id: "gale", name: "疾风级", tier: "混血", type: "destroyer",
    flavor: "天使联合技术驱逐舰，在常规驱逐舰框架上强化护盾与激光火力",
    hp: { shield: 660, armor: 165, structure: 165 }, totalHp: 990,
    dodge: 26, speed: 230, targeting: 135,
    capacitor: { capacity: 170, rechargeRate: 8 },
    fuelEfficiency: 0.95,
    slots: { high: 3, mid: 3, low: 1, rig: 1 },
    bonuses: { shieldCapacity: 0.20, laserDamage: 0.15, hitBonus: 10 },
    recommendedWeapon: "laser", counterFaction: "angel",
    unlock: { type: "blueprint", costLP: 60, level: 20 }
  },
  bloodthorn: {
    id: "bloodthorn", name: "血刺级", tier: "混血", type: "destroyer",
    flavor: "血袭者联合技术驱逐舰，在常规驱逐舰框架上强化装甲与导弹火力",
    hp: { shield: 165, armor: 660, structure: 165 }, totalHp: 990,
    dodge: 12, speed: 210, targeting: 155,
    capacitor: { capacity: 160, rechargeRate: 8 },
    fuelEfficiency: 0.85,
    slots: { high: 3, mid: 1, low: 3, rig: 1 },
    bonuses: { armorCapacity: 0.20, missileDamage: 0.15, armorRepair: 0.50, hitBonus: 10 },
    recommendedWeapon: "missile", counterFaction: "blood",
    unlock: { type: "blueprint", costLP: 60, level: 20 }
  },
  umbra: {
    id: "umbra", name: "暗影级", tier: "混血", type: "destroyer",
    flavor: "萨沙联合技术驱逐舰，在常规驱逐舰框架上强化结构与射弹火力",
    hp: { shield: 165, armor: 165, structure: 660 }, totalHp: 990,
    dodge: 24, speed: 260, targeting: 125,
    capacitor: { capacity: 160, rechargeRate: 8 },
    fuelEfficiency: 0.90,
    slots: { high: 3, mid: 1, low: 3, rig: 1 },
    bonuses: { structureCapacity: 0.20, cannonDamage: 0.15, speed: 0.15, structureRepair: 2.00, hitBonus: 10 },
    recommendedWeapon: "cannon", counterFaction: "sansha",
    unlock: { type: "blueprint", costLP: 60, level: 20 }
  },
  dawnlight: {
    id: "dawnlight", name: "曙光级", tier: "T1", type: "cruiser",
    flavor: "护盾专精巡洋舰，以四门中型激光炮和厚重护盾维持正面火力",
    hp: { shield: 1300, armor: 250, structure: 250 }, totalHp: 1800,
    dodge: 12, speed: 170, targeting: 155,
    capacitor: { capacity: 260, rechargeRate: 12 },
    fuelEfficiency: 0.90,
    slots: { high: 4, mid: 4, low: 2, rig: 2 },
    bonuses: { shieldCapacity: 0.20, laserDamage: 0.15, hitBonus: 15 },
    recommendedWeapon: "laser", counterFaction: "angel",
    unlock: { type: "shipEngineering", level: 35 }
  },
  warfalcon: {
    id: "warfalcon", name: "战隼级", tier: "T1", type: "cruiser",
    flavor: "装甲专精巡洋舰，以四门重型导弹和强化装甲维修进行持久压制",
    hp: { shield: 300, armor: 1200, structure: 300 }, totalHp: 1800,
    dodge: 10, speed: 155, targeting: 180,
    capacitor: { capacity: 240, rechargeRate: 12 },
    fuelEfficiency: 0.80,
    slots: { high: 4, mid: 2, low: 4, rig: 2 },
    bonuses: { armorCapacity: 0.20, missileDamage: 0.15, armorRepair: 0.50, hitBonus: 15 },
    recommendedWeapon: "missile", counterFaction: "blood",
    unlock: { type: "shipEngineering", level: 35 }
  },
  stormblade: {
    id: "stormblade", name: "烈锋级", tier: "T1", type: "cruiser",
    flavor: "结构专精巡洋舰，以四门中型射弹炮、机动和高效结构维修承担高风险突击",
    hp: { shield: 200, armor: 200, structure: 1400 }, totalHp: 1800,
    dodge: 15, speed: 195, targeting: 145,
    capacitor: { capacity: 240, rechargeRate: 12 },
    fuelEfficiency: 0.85,
    slots: { high: 4, mid: 2, low: 4, rig: 2 },
    bonuses: { structureCapacity: 0.20, cannonDamage: 0.15, speed: 0.15, structureRepair: 2.00, hitBonus: 15 },
    recommendedWeapon: "cannon", counterFaction: "sansha",
    unlock: { type: "shipEngineering", level: 35 }
  },
  sunlance: {
    id: "sunlance", name: "曜光级", tier: "T1", type: "battleship",
    flavor: "护盾专精战列舰，以五门大型激光炮和重型护盾阵列维持正面火力",
    hp: { shield: 2600, armor: 500, structure: 500 }, totalHp: 3600,
    dodge: 8, speed: 120, targeting: 180,
    capacitor: { capacity: 420, rechargeRate: 18 },
    fuelEfficiency: 0.85,
    slots: { high: 5, mid: 5, low: 2, rig: 3 },
    bonuses: { shieldCapacity: 0.25, laserDamage: 0.20, hitBonus: 20 },
    recommendedWeapon: "laser", counterFaction: "angel",
    unlock: { type: "shipEngineering", level: 55 }
  },
  fortfalcon: {
    id: "fortfalcon", name: "堡隼级", tier: "T1", type: "battleship",
    flavor: "装甲专精战列舰，以五门大型导弹发射器和强化装甲维修进行持久压制",
    hp: { shield: 550, armor: 2500, structure: 550 }, totalHp: 3600,
    dodge: 6, speed: 110, targeting: 210,
    capacitor: { capacity: 390, rechargeRate: 18 },
    fuelEfficiency: 0.75,
    slots: { high: 5, mid: 2, low: 5, rig: 3 },
    bonuses: { armorCapacity: 0.25, missileDamage: 0.20, armorRepair: 0.50, hitBonus: 20 },
    recommendedWeapon: "missile", counterFaction: "blood",
    unlock: { type: "shipEngineering", level: 55 }
  },
  thunderblade: {
    id: "thunderblade", name: "震锋级", tier: "T1", type: "battleship",
    flavor: "结构专精战列舰，以五门大型射弹炮、机动和高效结构维修实施重装突击",
    hp: { shield: 400, armor: 400, structure: 2800 }, totalHp: 3600,
    dodge: 10, speed: 135, targeting: 165,
    capacitor: { capacity: 390, rechargeRate: 18 },
    fuelEfficiency: 0.80,
    slots: { high: 5, mid: 2, low: 5, rig: 3 },
    bonuses: { structureCapacity: 0.25, cannonDamage: 0.20, speed: 0.15, structureRepair: 2.00, hitBonus: 20 },
    recommendedWeapon: "cannon", counterFaction: "sansha",
    unlock: { type: "shipEngineering", level: 55 }
  }
};

// ---- 工业舰船：属性表（参照20260712细化，效能加成版） ----
const INDUSTRIAL_SHIPS = {
  miner_frigate: {
    id: "miner_frigate", name: "冲锋者级", tier: "T1", type: "industrial_frigate",
    flavor: "采矿专用护卫舰，放大采矿装备效能",
    hp: { shield: 220, armor: 75, structure: 75 }, totalHp: 370,
    dodge: 20, speed: 240, targeting: 90,
    capacitor: { capacity: 100, rechargeRate: 5 },
    fuelEfficiency: 1.0,
    slots: { high: 2, mid: 2, low: 1, rig: 1 },
    bonuses: { miningLaserEfficiency: 1.0 },
    unlock: { type: "blueprint", costISK: 50000 }
  },
  gas_frigate: {
    id: "gas_frigate", name: "勘探者级", tier: "T1", type: "industrial_frigate",
    flavor: "采气专用护卫舰，放大采气装备效能",
    hp: { shield: 220, armor: 75, structure: 75 }, totalHp: 370,
    dodge: 20, speed: 240, targeting: 90,
    capacitor: { capacity: 100, rechargeRate: 5 },
    fuelEfficiency: 1.0,
    slots: { high: 2, mid: 2, low: 1, rig: 1 },
    bonuses: { gasLaserEfficiency: 1.0 },
    unlock: { type: "blueprint", costISK: 50000 }
  },
  // ---- 占位：高级工业舰（待装备系统完善后解锁） ----
  miner_destroyer: {
    id: "miner_destroyer", name: "妄想级", tier: "T1", type: "industrial_destroyer",
    flavor: "采矿专用驱逐舰（占位，Lv.20解锁）",
    hp: { shield: 300, armor: 150, structure: 110 }, totalHp: 560,
    dodge: 16, speed: 210, targeting: 100,
    capacitor: { capacity: 120, rechargeRate: 6 },
    fuelEfficiency: 0.95,
    slots: { high: 3, mid: 1, low: 2, rig: 1 },
    bonuses: { miningLaserEfficiency: 1.5 },
    unlock: { type: "blueprint", costISK: 200000, level: 20 }
  },
  gas_destroyer: {
    id: "gas_destroyer", name: "采集者级", tier: "T1", type: "industrial_destroyer",
    flavor: "采气专用驱逐舰（占位，Lv.20解锁）",
    hp: { shield: 300, armor: 150, structure: 110 }, totalHp: 560,
    dodge: 16, speed: 210, targeting: 100,
    capacitor: { capacity: 120, rechargeRate: 6 },
    fuelEfficiency: 0.95,
    slots: { high: 3, mid: 1, low: 2, rig: 1 },
    bonuses: { gasLaserEfficiency: 1.5 },
    unlock: { type: "blueprint", costISK: 200000, level: 20 }
  },
  miner_cruiser: {
    id: "miner_cruiser", name: "霍克级", tier: "T2", type: "industrial_cruiser",
    flavor: "采矿专用巡洋舰（占位，Lv.50解锁）",
    hp: { shield: 450, armor: 300, structure: 220 }, totalHp: 970,
    dodge: 12, speed: 160, targeting: 110,
    capacitor: { capacity: 150, rechargeRate: 8 },
    fuelEfficiency: 0.90,
    slots: { high: 3, mid: 2, low: 2, rig: 2 },
    bonuses: { miningLaserEfficiency: 2.0 },
    unlock: { type: "invention", level: 50 }
  },
  gas_cruiser: {
    id: "gas_cruiser", name: "奋进级", tier: "T2", type: "industrial_cruiser",
    flavor: "采气专用巡洋舰（占位，Lv.50解锁）",
    hp: { shield: 450, armor: 300, structure: 220 }, totalHp: 970,
    dodge: 12, speed: 160, targeting: 110,
    capacitor: { capacity: 150, rechargeRate: 8 },
    fuelEfficiency: 0.90,
    slots: { high: 3, mid: 2, low: 2, rig: 2 },
    bonuses: { gasLaserEfficiency: 2.0 },
    unlock: { type: "invention", level: 50 }
  },
  orca: {
    id: "orca", name: "逆戟鲸级", tier: "T4", type: "industrial_capital",
    flavor: "工业旗舰，全面提升生产与采集效率（占位，Lv.80解锁）",
    hp: { shield: 2200, armor: 1100, structure: 750 }, totalHp: 4050,
    dodge: 8, speed: 100, targeting: 80,
    capacitor: { capacity: 300, rechargeRate: 15 },
    fuelEfficiency: 0.80,
    slots: { high: 4, mid: 4, low: 3, rig: 3 },
    bonuses: { miningLaserEfficiency: 2.8, gasLaserEfficiency: 2.8, smeltingEfficiency: 0.30 },
    unlock: { type: "composite", level: 80 }
  }
};
