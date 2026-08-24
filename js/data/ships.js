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
  { id:"battleship_functional_system", name:"战列舰舰船功能组件", level:55, time:60, xp:65, cost:{ "三钛合金":10, "同位聚合体":5, "超新星诺克石":7, "稀有气体":6, "等离子体":2 } },
  { id:"capital_integrated_hull", name:"旗舰综合舰体组件", level:80, time:420, xp:430, cost:{ "三钛合金":220, "基腹断岩":11, "超噬矿":7, "铷":1, "磁场聚合物":6 } },
  { id:"capital_power_core", name:"旗舰动力控制核心", level:80, time:300, xp:300, cost:{ "三钛合金":165, "基腹断岩":7, "超噬矿":5, "铷":1, "等离子体":5, "超纯聚合气体":1 } },
  { id:"capital_functional_system", name:"旗舰舰船功能组件", level:80, time:180, xp:180, cost:{ "三钛合金":110, "基腹断岩":5, "超噬矿":4, "铷":1, "磁场聚合物":4, "聚合气体":1 } },
  { id:"supercapital_integrated_hull", name:"超级旗舰综合舰体组件", level:90, time:630, xp:650, cost:{ "三钛合金":340, "基腹断岩":17, "超噬矿":11, "莫尔石":1, "铷":3, "磁场聚合物":8 } },
  { id:"supercapital_power_core", name:"超级旗舰动力控制核心", level:90, time:450, xp:460, cost:{ "三钛合金":255, "基腹断岩":11, "超噬矿":9, "莫尔石":1, "铷":2, "等离子体":7, "超纯聚合气体":1 } },
  { id:"supercapital_functional_system", name:"超级旗舰舰船功能组件", level:90, time:270, xp:280, cost:{ "三钛合金":170, "基腹断岩":7, "超噬矿":6, "莫尔石":1, "铷":2, "磁场聚合物":6, "聚合气体":2 } }
];

// ---- 舰船工程：蓝图商店 ----
const SHIP_BLUEPRINTS = [
  { id: "rifter",  name: "星矛级",   shipId: "rifter",  costISK: 50000, level: 1  },
  { id: "kestrel", name: "铁卫级",   shipId: "kestrel", costISK: 50000, level: 1  },
  { id: "atron",   name: "闪刃级", shipId: "atron",   costISK: 50000, level: 1  },
  { id: "miner_frigate",  name: "拓岩级", shipId: "miner_frigate",  costISK: 50000, level: 1  },
  { id: "gas_frigate",    name: "捕云级", shipId: "gas_frigate",    costISK: 50000, level: 1  },
  { id: "gale", name: "疾风级", shipId: "gale", costLP: 60, level: 20, sourceZoneId:"angel_corridor" },
  { id: "bloodthorn", name: "血刺级", shipId: "bloodthorn", costLP: 60, level: 20, sourceZoneId:"blood_sacrifice" },
  { id: "umbra", name: "暗影级", shipId: "umbra", costLP: 60, level: 20, sourceZoneId:"sansha_node" },
  { id: "thunder", name: "雷霆级", shipId: "thunder", costLP: 100, level: 40, sourceZoneId:"angel_hunting_ground" },
  { id: "crimson", name: "猩红级", shipId: "crimson", costLP: 100, level: 40, sourceZoneId:"blood_cathedral" },
  { id: "nether", name: "幽冥级", shipId: "nether", costLP: 100, level: 40, sourceZoneId:"sansha_nexus" },
  { id: "dawnbreaker", name: "破晓级", shipId: "dawnbreaker", costLP: 150, level: 60, sourceZoneId:"angel_warfront" },
  { id: "crimson_bastion", name: "赤垒级", shipId: "crimson_bastion", costLP: 150, level: 60, sourceZoneId:"blood_iron_basilica" },
  { id: "spectre_frame", name: "幽构级", shipId: "spectre_frame", costLP: 150, level: 60, sourceZoneId:"sansha_command_matrix" },
  { id: "starcrown", name: "星冕级", shipId: "starcrown", costLP: 1000, level: 90, description:"永久解锁护盾·激光超级旗舰制造配方" },
  { id: "eternal_fortress", name: "恒城级", shipId: "eternal_fortress", costLP: 1000, level: 90, description:"永久解锁装甲·导弹超级旗舰制造配方" },
  { id: "arbiter", name: "裁决级", shipId: "arbiter", costLP: 1000, level: 90, description:"永久解锁结构·火炮超级旗舰制造配方" },
  // ---- 考古船蓝图（仅苍鹭级需要永久蓝图，其余四舰凭舰船工程等级解锁）----
  { id: "heron", name: "觅迹级", shipId: "heron", costISK: 50000, level: 1 }
];

// ---- 舰船工程：舰船合成配方 ----
const SHIP_ASSEMBLY_RECIPES = [
  // ---- 启程级：新手引导专属低成本配方（1/1/1 组件，无需蓝图），不参与常规同级预算模型 ----
  { id:"rookie_corvette", name:"启程级", shipId:"rookie_corvette", level:1, time:30, xp:30, requiresBlueprint:false, componentCost:{integrated_hull:1,power_core:1,functional_system:1} },
  { id:"rifter", name:"星矛级", shipId:"rifter", level:1, time:30, xp:30, componentCost:{integrated_hull:2,power_core:2,functional_system:2} },
  { id:"kestrel", name:"铁卫级", shipId:"kestrel", level:1, time:30, xp:30, componentCost:{integrated_hull:2,power_core:2,functional_system:2} },
  { id:"atron", name:"闪刃级", shipId:"atron", level:1, time:30, xp:30, componentCost:{integrated_hull:2,power_core:2,functional_system:2} },
  { id:"miner_frigate", name:"拓岩级", shipId:"miner_frigate", level:1, time:30, xp:30, componentCost:{integrated_hull:2,power_core:2,functional_system:2} },
  { id:"gas_frigate", name:"捕云级", shipId:"gas_frigate", level:1, time:30, xp:30, componentCost:{integrated_hull:2,power_core:2,functional_system:2} },
  { id:"raylight", name:"雷光级", shipId:"raylight", level:15, time:45, xp:60, requiresBlueprint:false, componentCost:{destroyer_integrated_hull:3,destroyer_power_core:3,destroyer_functional_system:4} },
  { id:"spearfalcon", name:"矛隼级", shipId:"spearfalcon", level:15, time:45, xp:60, requiresBlueprint:false, componentCost:{destroyer_integrated_hull:3,destroyer_power_core:3,destroyer_functional_system:4} },
  { id:"swiftblade", name:"疾锋级", shipId:"swiftblade", level:15, time:45, xp:60, requiresBlueprint:false, componentCost:{destroyer_integrated_hull:3,destroyer_power_core:3,destroyer_functional_system:4} },
  { id:"miner_destroyer", name:"凿岩级", shipId:"miner_destroyer", level:15, time:45, xp:60, requiresBlueprint:false, componentCost:{destroyer_integrated_hull:3,destroyer_power_core:3,destroyer_functional_system:4} },
  { id:"gas_destroyer", name:"采集者级", shipId:"gas_destroyer", level:15, time:45, xp:60, requiresBlueprint:false, componentCost:{destroyer_integrated_hull:3,destroyer_power_core:3,destroyer_functional_system:4} },
  { id:"gale", name:"疾风级", shipId:"gale", level:20, time:60, xp:90, componentCost:{destroyer_integrated_hull:4,destroyer_power_core:4,destroyer_functional_system:5}, materialCost:{"镓":10,"铂":8,"天使低级加密数据":10} },
  { id:"bloodthorn", name:"血刺级", shipId:"bloodthorn", level:20, time:60, xp:90, componentCost:{destroyer_integrated_hull:4,destroyer_power_core:4,destroyer_functional_system:5}, materialCost:{"镓":10,"铂":8,"血袭者低级加密数据":10} },
  { id:"umbra", name:"暗影级", shipId:"umbra", level:20, time:60, xp:90, componentCost:{destroyer_integrated_hull:4,destroyer_power_core:4,destroyer_functional_system:5}, materialCost:{"镓":10,"铂":8,"萨沙低级加密数据":10} },
  { id:"dawnlight", name:"曙光级", shipId:"dawnlight", level:35, time:70, xp:100, requiresBlueprint:false, componentCost:{cruiser_integrated_hull:4,cruiser_power_core:5,cruiser_functional_system:4} },
  { id:"warfalcon", name:"战隼级", shipId:"warfalcon", level:35, time:70, xp:100, requiresBlueprint:false, componentCost:{cruiser_integrated_hull:4,cruiser_power_core:5,cruiser_functional_system:4} },
  { id:"stormblade", name:"烈锋级", shipId:"stormblade", level:35, time:70, xp:100, requiresBlueprint:false, componentCost:{cruiser_integrated_hull:4,cruiser_power_core:5,cruiser_functional_system:4} },
  { id:"miner_cruiser", name:"岩脊级", shipId:"miner_cruiser", level:35, time:70, xp:100, requiresBlueprint:false, componentCost:{cruiser_integrated_hull:4,cruiser_power_core:5,cruiser_functional_system:4} },
  { id:"gas_cruiser", name:"云舶级", shipId:"gas_cruiser", level:35, time:70, xp:100, requiresBlueprint:false, componentCost:{cruiser_integrated_hull:4,cruiser_power_core:5,cruiser_functional_system:4} },
  { id:"dolphin", name:"驮星级", shipId:"dolphin", level:35, time:80, xp:120, requiresBlueprint:false, componentCost:{cruiser_integrated_hull:4,cruiser_power_core:4,cruiser_functional_system:6} },
  { id:"thunder", name:"雷霆级", shipId:"thunder", level:40, time:90, xp:140, componentCost:{cruiser_integrated_hull:5,cruiser_power_core:5,cruiser_functional_system:6}, materialCost:{"铪":15,"锇":12,"天使中级加密数据":20} },
  { id:"crimson", name:"猩红级", shipId:"crimson", level:40, time:90, xp:140, componentCost:{cruiser_integrated_hull:5,cruiser_power_core:5,cruiser_functional_system:6}, materialCost:{"铪":15,"锇":12,"血袭者中级加密数据":20} },
  { id:"nether", name:"幽冥级", shipId:"nether", level:40, time:90, xp:140, componentCost:{cruiser_integrated_hull:5,cruiser_power_core:5,cruiser_functional_system:6}, materialCost:{"铪":15,"锇":12,"萨沙中级加密数据":20} },
  { id:"sunlance", name:"曜光级", shipId:"sunlance", level:55, time:100, xp:160, requiresBlueprint:false, componentCost:{battleship_integrated_hull:6,battleship_power_core:5,battleship_functional_system:5} },
  { id:"fortfalcon", name:"堡隼级", shipId:"fortfalcon", level:55, time:100, xp:160, requiresBlueprint:false, componentCost:{battleship_integrated_hull:6,battleship_power_core:5,battleship_functional_system:5} },
  { id:"thunderblade", name:"震锋级", shipId:"thunderblade", level:55, time:100, xp:160, requiresBlueprint:false, componentCost:{battleship_integrated_hull:6,battleship_power_core:5,battleship_functional_system:5} },
  { id:"miner_battleship", name:"巨像级", shipId:"miner_battleship", level:55, time:100, xp:160, requiresBlueprint:false, componentCost:{battleship_integrated_hull:6,battleship_power_core:5,battleship_functional_system:5} },
  { id:"gas_battleship", name:"云海级", shipId:"gas_battleship", level:55, time:100, xp:160, requiresBlueprint:false, componentCost:{battleship_integrated_hull:6,battleship_power_core:5,battleship_functional_system:5} },
  { id:"dawnbreaker", name:"破晓级", shipId:"dawnbreaker", level:60, time:120, xp:200, componentCost:{battleship_integrated_hull:6,battleship_power_core:5,battleship_functional_system:5}, materialCost:{"钷":20,"铷":16,"天使高级加密数据":30} },
  { id:"crimson_bastion", name:"赤垒级", shipId:"crimson_bastion", level:60, time:120, xp:200, componentCost:{battleship_integrated_hull:6,battleship_power_core:5,battleship_functional_system:5}, materialCost:{"钷":20,"铷":16,"血袭者高级加密数据":30} },
  { id:"spectre_frame", name:"幽构级", shipId:"spectre_frame", level:60, time:120, xp:200, componentCost:{battleship_integrated_hull:6,battleship_power_core:5,battleship_functional_system:5}, materialCost:{"钷":20,"铷":16,"萨沙高级加密数据":30} },
  { id:"firmament", name:"天穹级", shipId:"firmament", level:80, time:300, xp:450, requiresBlueprint:false, componentCost:{capital_integrated_hull:10,capital_power_core:8,capital_functional_system:8} },
  { id:"heavy_bastion", name:"重垒级", shipId:"heavy_bastion", level:80, time:300, xp:450, requiresBlueprint:false, componentCost:{capital_integrated_hull:10,capital_power_core:8,capital_functional_system:8} },
  { id:"riftbreaker", name:"裂界级", shipId:"riftbreaker", level:80, time:300, xp:450, requiresBlueprint:false, componentCost:{capital_integrated_hull:10,capital_power_core:8,capital_functional_system:8} },
  { id:"orca", name:"山海级", shipId:"orca", level:80, time:320, xp:500, requiresBlueprint:false, componentCost:{capital_integrated_hull:10,capital_power_core:8,capital_functional_system:10} },
  { id:"starcrown", name:"星冕级", shipId:"starcrown", level:90, time:600, xp:800, componentCost:{supercapital_integrated_hull:18,supercapital_power_core:16,supercapital_functional_system:18}, materialCost:{"天穹深层舰船数据":60} },
  { id:"eternal_fortress", name:"恒城级", shipId:"eternal_fortress", level:90, time:600, xp:800, componentCost:{supercapital_integrated_hull:18,supercapital_power_core:16,supercapital_functional_system:18}, materialCost:{"重垒深层舰船数据":60} },
  { id:"arbiter", name:"裁决级", shipId:"arbiter", level:90, time:600, xp:800, componentCost:{supercapital_integrated_hull:18,supercapital_power_core:16,supercapital_functional_system:18}, materialCost:{"裂界深层舰船数据":60} },
  // ---- 考古船制造配方（复用现有舰体组件，无考古专属材料；仅苍鹭级需蓝图）----
  { id:"heron", name:"觅迹级", shipId:"heron", level:1, time:30, xp:30, componentCost:{integrated_hull:2,power_core:2,functional_system:2} },
  { id:"tracer", name:"追迹级", shipId:"tracer", level:15, time:45, xp:60, requiresBlueprint:false, componentCost:{destroyer_integrated_hull:3,destroyer_power_core:3,destroyer_functional_system:4} },
  { id:"starmap", name:"星图级", shipId:"starmap", level:35, time:70, xp:100, requiresBlueprint:false, componentCost:{cruiser_integrated_hull:4,cruiser_power_core:5,cruiser_functional_system:4} },
  { id:"farscope", name:"远镜级", shipId:"farscope", level:55, time:100, xp:160, requiresBlueprint:false, componentCost:{battleship_integrated_hull:6,battleship_power_core:5,battleship_functional_system:5} },
  { id:"illuminator", name:"启明级", shipId:"illuminator", level:80, time:320, xp:500, requiresBlueprint:false, componentCost:{capital_integrated_hull:10,capital_power_core:8,capital_functional_system:10} }
];

// ---- 舰船工程：新手战舰属性表（参照第7节） ----
const STARTER_SHIPS = {
  rookie_corvette: {
    id: "rookie_corvette", name: "启程级", tier: "T1", type: "frigate",
    flavor: "边疆登记机构配发的低成本通用训练艇，高槽两格、中低槽各一格，采矿、探查与自卫都能勉强胜任，唯独哪一项都不出色。",
    hp: { shield: 240, armor: 80, structure: 80 }, totalHp: 400,
    dodge: 22, speed: 240, targeting: 105,
    capacitor: { capacity: 90 },
    fuelEfficiency: 1.0,
    slots: { high: 2, mid: 1, low: 1, rig: 0 },
    bonuses: {
      laserDamage: 0.02, missileDamage: 0.02, cannonDamage: 0.02,
      shieldCapacity: 0.05, archaeologyScanStrength: 2,
      miningLaserEfficiency: 0.15
    },
    recommendedWeapon: "laser",
    unlock: { type: "tutorial", isDefault: false }
  },
  rifter: {
    id: "rifter", name: "星矛级", tier: "T1", type: "frigate",
    flavor: "苍穹劫团风格，高护盾、高电容，适配激光武器",
    hp: { shield: 300, armor: 100, structure: 100 }, totalHp: 500,
    dodge: 25, speed: 280, targeting: 120,
    capacitor: { capacity: 120 },
    fuelEfficiency: 1.0,
    slots: { high: 2, mid: 2, low: 1, rig: 1 },
    bonuses: { shieldCapacity: 0.10, laserDamage: 0.05 },
    recommendedWeapon: "laser", counterFaction: "angel",
    unlock: { type: "starter", isDefault: true },
  },
  kestrel: {
    id: "kestrel", name: "铁卫级", tier: "T1", type: "frigate",
    flavor: "赤誓教团风格，高装甲、高锁定，适配导弹武器",
    hp: { shield: 100, armor: 300, structure: 100 }, totalHp: 500,
    dodge: 22, speed: 250, targeting: 135,
    capacitor: { capacity: 100 },
    fuelEfficiency: 0.9,
    slots: { high: 2, mid: 1, low: 2, rig: 1 },
    bonuses: { armorCapacity: 0.10, missileDamage: 0.05, targetingSpeed: 0.10 },
    recommendedWeapon: "missile", counterFaction: "blood",
    unlock: { type: "starter", isDefault: true }
  },
  atron: {
    id: "atron", name: "闪刃级", tier: "T1", type: "frigate",
    flavor: "静默集群风格，高结构、高速度，适配炮台武器",
    hp: { shield: 100, armor: 100, structure: 300 }, totalHp: 500,
    dodge: 30, speed: 320, targeting: 110,
    capacitor: { capacity: 100 },
    fuelEfficiency: 0.95,
    slots: { high: 2, mid: 1, low: 2, rig: 1 },
    bonuses: { structureCapacity: 0.10, cannonDamage: 0.05, speed: 0.10, structureRepair: 2.00, structureEmergencyRepair: 1.00 },
    recommendedWeapon: "cannon", counterFaction: "sansha",
    unlock: { type: "starter", isDefault: true }
  },
  raylight: {
    id: "raylight", name: "雷光级", tier: "T1", type: "destroyer",
    flavor: "护盾专精驱逐舰，以三门小型激光武器和持续护盾维修承担正面火力",
    hp: { shield: 600, armor: 150, structure: 150 }, totalHp: 900,
    dodge: 18, speed: 230, targeting: 135,
    capacitor: { capacity: 170 },
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
    capacitor: { capacity: 160 },
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
    capacitor: { capacity: 160 },
    fuelEfficiency: 0.90,
    slots: { high: 3, mid: 1, low: 3, rig: 1 },
    bonuses: { structureCapacity: 0.15, cannonDamage: 0.10, speed: 0.15, structureRepair: 2.00, hitBonus: 10, structureEmergencyRepair: 1.00 },
    recommendedWeapon: "cannon", counterFaction: "sansha",
    unlock: { type: "shipEngineering", level: 15 }
  },
  gale: {
    id: "gale", name: "疾风级", tier: "混血", type: "destroyer",
    flavor: "苍穹劫团联合技术驱逐舰，在常规驱逐舰框架上强化护盾与激光火力",
    hp: { shield: 660, armor: 165, structure: 165 }, totalHp: 990,
    dodge: 26, speed: 230, targeting: 135,
    capacitor: { capacity: 170 },
    fuelEfficiency: 0.95,
    slots: { high: 3, mid: 3, low: 1, rig: 1 },
    bonuses: { shieldCapacity: 0.20, laserDamage: 0.15, hitBonus: 10 },
    recommendedWeapon: "laser", counterFaction: "angel",
    unlock: { type: "blueprint", costLP: 60, level: 20 }
  },
  bloodthorn: {
    id: "bloodthorn", name: "血刺级", tier: "混血", type: "destroyer",
    flavor: "赤誓教团联合技术驱逐舰，在常规驱逐舰框架上强化装甲与导弹火力",
    hp: { shield: 165, armor: 660, structure: 165 }, totalHp: 990,
    dodge: 12, speed: 210, targeting: 155,
    capacitor: { capacity: 160 },
    fuelEfficiency: 0.85,
    slots: { high: 3, mid: 1, low: 3, rig: 1 },
    bonuses: { armorCapacity: 0.20, missileDamage: 0.15, armorRepair: 0.50, hitBonus: 10 },
    recommendedWeapon: "missile", counterFaction: "blood",
    unlock: { type: "blueprint", costLP: 60, level: 20 }
  },
  umbra: {
    id: "umbra", name: "暗影级", tier: "混血", type: "destroyer",
    flavor: "静默集群联合技术驱逐舰，在常规驱逐舰框架上强化结构与射弹火力",
    hp: { shield: 165, armor: 165, structure: 660 }, totalHp: 990,
    dodge: 24, speed: 260, targeting: 125,
    capacitor: { capacity: 160 },
    fuelEfficiency: 0.90,
    slots: { high: 3, mid: 1, low: 3, rig: 1 },
    bonuses: { structureCapacity: 0.20, cannonDamage: 0.15, speed: 0.15, structureRepair: 2.00, hitBonus: 10, structureEmergencyRepair: 1.00 },
    recommendedWeapon: "cannon", counterFaction: "sansha",
    unlock: { type: "blueprint", costLP: 60, level: 20 }
  },
  dawnlight: {
    id: "dawnlight", name: "曙光级", tier: "T1", type: "cruiser",
    flavor: "护盾专精巡洋舰，以四门中型激光炮和厚重护盾维持正面火力",
    hp: { shield: 1300, armor: 250, structure: 250 }, totalHp: 1800,
    dodge: 12, speed: 170, targeting: 155,
    capacitor: { capacity: 260 },
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
    capacitor: { capacity: 240 },
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
    capacitor: { capacity: 240 },
    fuelEfficiency: 0.85,
    slots: { high: 4, mid: 2, low: 4, rig: 2 },
    bonuses: { structureCapacity: 0.20, cannonDamage: 0.15, speed: 0.15, structureRepair: 2.00, hitBonus: 15, structureEmergencyRepair: 1.00 },
    recommendedWeapon: "cannon", counterFaction: "sansha",
    unlock: { type: "shipEngineering", level: 35 }
  },
  thunder: {
    id: "thunder", name: "雷霆级", tier: "混血", type: "cruiser",
    flavor: "苍穹劫团联合技术巡洋舰，在常规巡洋舰框架上强化护盾与中型激光火力",
    hp: { shield: 1380, armor: 345, structure: 345 }, totalHp: 2070,
    dodge: 17, speed: 170, targeting: 155,
    capacitor: { capacity: 260 },
    fuelEfficiency: 0.90,
    slots: { high: 4, mid: 4, low: 2, rig: 2 },
    bonuses: { shieldCapacity: 0.25, laserDamage: 0.20, hitBonus: 15 },
    recommendedWeapon: "laser", counterFaction: "angel",
    unlock: { type: "blueprint", costLP: 100, level: 40 }
  },
  crimson: {
    id: "crimson", name: "猩红级", tier: "混血", type: "cruiser",
    flavor: "赤誓教团联合技术巡洋舰，在常规巡洋舰框架上强化装甲与重型导弹火力",
    hp: { shield: 375, armor: 1320, structure: 375 }, totalHp: 2070,
    dodge: 14, speed: 155, targeting: 180,
    capacitor: { capacity: 240 },
    fuelEfficiency: 0.80,
    slots: { high: 4, mid: 2, low: 4, rig: 2 },
    bonuses: { armorCapacity: 0.25, missileDamage: 0.20, armorRepair: 0.50, hitBonus: 15 },
    recommendedWeapon: "missile", counterFaction: "blood",
    unlock: { type: "blueprint", costLP: 100, level: 40 }
  },
  nether: {
    id: "nether", name: "幽冥级", tier: "混血", type: "cruiser",
    flavor: "静默集群联合技术巡洋舰，在常规巡洋舰框架上强化结构与中型射弹火力",
    hp: { shield: 285, armor: 285, structure: 1500 }, totalHp: 2070,
    dodge: 18, speed: 195, targeting: 145,
    capacitor: { capacity: 240 },
    fuelEfficiency: 0.85,
    slots: { high: 4, mid: 2, low: 4, rig: 2 },
    bonuses: { structureCapacity: 0.25, cannonDamage: 0.20, speed: 0.15, structureRepair: 2.00, hitBonus: 15, structureEmergencyRepair: 1.00 },
    recommendedWeapon: "cannon", counterFaction: "sansha",
    unlock: { type: "blueprint", costLP: 100, level: 40 }
  },
  sunlance: {
    id: "sunlance", name: "曜光级", tier: "T1", type: "battleship",
    flavor: "护盾专精战列舰，以五门大型激光炮和重型护盾阵列维持正面火力",
    hp: { shield: 2600, armor: 500, structure: 500 }, totalHp: 3600,
    dodge: 8, speed: 120, targeting: 180,
    capacitor: { capacity: 420 },
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
    capacitor: { capacity: 390 },
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
    capacitor: { capacity: 390 },
    fuelEfficiency: 0.80,
    slots: { high: 5, mid: 2, low: 5, rig: 3 },
    bonuses: { structureCapacity: 0.25, cannonDamage: 0.20, speed: 0.15, structureRepair: 2.00, hitBonus: 20, structureEmergencyRepair: 1.00 },
    recommendedWeapon: "cannon", counterFaction: "sansha",
    unlock: { type: "shipEngineering", level: 55 }
  },
  dawnbreaker: {
    id: "dawnbreaker", name: "破晓级", tier: "混血", type: "battleship",
    flavor: "苍穹劫团混血战列舰，在曜光级框架上以护盾与聚焦激光压制战场",
    hp: { shield: 3300, armor: 510, structure: 510 }, totalHp: 4320,
    dodge: 13, speed: 120, targeting: 180,
    capacitor: { capacity: 420 },
    fuelEfficiency: 0.85,
    slots: { high: 5, mid: 5, low: 2, rig: 3 },
    bonuses: { shieldCapacity: 0.30, laserDamage: 0.25, hitBonus: 20 },
    recommendedWeapon: "laser", counterFaction: "angel",
    unlock: { type: "blueprint", costLP: 150, level: 60 }
  },
  crimson_bastion: {
    id: "crimson_bastion", name: "赤垒级", tier: "混血", type: "battleship",
    flavor: "赤誓教团混血战列舰，在堡隼级框架上以装甲与重型导弹持久压制",
    hp: { shield: 660, armor: 3000, structure: 660 }, totalHp: 4320,
    dodge: 8, speed: 110, targeting: 210,
    capacitor: { capacity: 390 },
    fuelEfficiency: 0.75,
    slots: { high: 5, mid: 2, low: 5, rig: 3 },
    bonuses: { armorCapacity: 0.30, missileDamage: 0.25, armorRepair: 0.50, hitBonus: 20 },
    recommendedWeapon: "missile", counterFaction: "blood",
    unlock: { type: "blueprint", costLP: 150, level: 60 }
  },
  spectre_frame: {
    id: "spectre_frame", name: "幽构级", tier: "混血", type: "battleship",
    flavor: "静默集群混血战列舰，在震锋级框架上以结构与射弹炮实施重装突击",
    hp: { shield: 460, armor: 460, structure: 3400 }, totalHp: 4320,
    dodge: 5, speed: 135, targeting: 165,
    capacitor: { capacity: 390 },
    fuelEfficiency: 0.80,
    slots: { high: 5, mid: 2, low: 5, rig: 3 },
    bonuses: { structureCapacity: 0.30, cannonDamage: 0.25, speed: 0.15, structureRepair: 2.00, hitBonus: 20, structureEmergencyRepair: 1.00 },
    recommendedWeapon: "cannon", counterFaction: "sansha",
    unlock: { type: "blueprint", costLP: 150, level: 60 }
  },
  firmament: {
    id: "firmament", name: "天穹级", tier: "旗舰", type: "capital",
    flavor: "曜光技术线的护盾·激光旗舰，以偏导护盾抵挡敌方编队的首轮重击",
    hp: { shield: 4400, armor: 800, structure: 800 }, totalHp: 6000,
    dodge: 5, speed: 85, targeting: 235,
    capacitor: { capacity: 650 },
    fuelEfficiency: 0.78,
    slots: { high: 6, mid: 6, low: 2, rig: 4 },
    bonuses: { shieldCapacity: 0.30, laserDamage: 0.25, hitBonus: 25 },
    capitalTrait: { id:"deflection_shield", name:"偏导护盾", description:"每轮敌方攻击阶段，第一个命中护盾的攻击最终伤害降低30%", shieldHits:1, reduction:0.30 },
    recommendedWeapon: "laser", counterFaction: "angel",
    unlock: { type: "shipEngineering", level: 80 }
  },
  heavy_bastion: {
    id: "heavy_bastion", name: "重垒级", tier: "旗舰", type: "capital",
    flavor: "堡隼技术线的装甲·导弹旗舰，以应激装甲维持长时间阵地作战",
    hp: { shield: 900, armor: 4200, structure: 900 }, totalHp: 6000,
    dodge: 3, speed: 75, targeting: 270,
    capacitor: { capacity: 620 },
    fuelEfficiency: 0.68,
    slots: { high: 6, mid: 2, low: 6, rig: 4 },
    bonuses: { armorCapacity: 0.30, missileDamage: 0.25, armorRepair: 0.50, hitBonus: 25 },
    capitalTrait: { id:"reactive_armor", name:"应激装甲", description:"敌方攻击阶段结束后，恢复本轮装甲损失的8%，每轮最多恢复最大装甲的2%", restoreRate:0.08, maxArmorRate:0.02 },
    recommendedWeapon: "missile", counterFaction: "blood",
    unlock: { type: "shipEngineering", level: 80 }
  },
  riftbreaker: {
    id: "riftbreaker", name: "裂界级", tier: "旗舰", type: "capital",
    flavor: "震锋技术线的结构·火炮旗舰，在结构受损后逐步释放过载火力",
    hp: { shield: 700, armor: 700, structure: 4600 }, totalHp: 6000,
    dodge: 7, speed: 95, targeting: 215,
    capacitor: { capacity: 620 },
    fuelEfficiency: 0.73,
    slots: { high: 6, mid: 2, low: 6, rig: 4 },
    bonuses: { structureCapacity: 0.30, cannonDamage: 0.25, speed: 0.15, structureRepair: 2.00, hitBonus: 25, structureEmergencyRepair: 1.00 },
    capitalTrait: { id:"structure_overdrive", name:"结构过载", description:"每损失10%结构，火炮最终伤害提高3%，最多7层", perLayer:0.03, maxLayers:7 },
    recommendedWeapon: "cannon", counterFaction: "sansha",
    unlock: { type: "shipEngineering", level: 80 }
  },
  starcrown: {
    id: "starcrown", name: "星冕级", tier: "超级旗舰", type: "supercapital",
    flavor: "护盾·激光超级旗舰，将偏导护盾扩展到每轮前两次护盾命中",
    hp: { shield: 6200, armor: 1100, structure: 1100 }, totalHp: 8400,
    dodge: 3, speed: 65, targeting: 270,
    capacitor: { capacity: 850 },
    fuelEfficiency: 0.72,
    slots: { high: 7, mid: 7, low: 3, rig: 5 },
    bonuses: { shieldCapacity: 0.35, laserDamage: 0.30, hitBonus: 30 },
    capitalTrait: { id:"deflection_shield", name:"强化偏导护盾", description:"每轮敌方攻击阶段，前两个命中护盾的攻击最终伤害降低30%", shieldHits:2, reduction:0.30 },
    recommendedWeapon: "laser", counterFaction: "angel",
    unlock: { type: "blueprint", costLP: 1000, level: 90 }
  },
  eternal_fortress: {
    id: "eternal_fortress", name: "恒城级", tier: "超级旗舰", type: "supercapital",
    flavor: "装甲·导弹超级旗舰，以强化应激装甲承受深层0.0的持续火力",
    hp: { shield: 1250, armor: 5900, structure: 1250 }, totalHp: 8400,
    dodge: 2, speed: 58, targeting: 310,
    capacitor: { capacity: 820 },
    fuelEfficiency: 0.62,
    slots: { high: 7, mid: 3, low: 7, rig: 5 },
    bonuses: { armorCapacity: 0.35, missileDamage: 0.30, armorRepair: 0.50, hitBonus: 30 },
    capitalTrait: { id:"reactive_armor", name:"强化应激装甲", description:"敌方攻击阶段结束后，恢复本轮装甲损失的12%，每轮最多恢复最大装甲的3%", restoreRate:0.12, maxArmorRate:0.03 },
    recommendedWeapon: "missile", counterFaction: "blood",
    unlock: { type: "blueprint", costLP: 1000, level: 90 }
  },
  arbiter: {
    id: "arbiter", name: "裁决级", tier: "超级旗舰", type: "supercapital",
    flavor: "结构·火炮超级旗舰，以强化结构过载换取终局级单体火力",
    hp: { shield: 950, armor: 950, structure: 6500 }, totalHp: 8400,
    dodge: 5, speed: 75, targeting: 250,
    capacitor: { capacity: 820 },
    fuelEfficiency: 0.67,
    slots: { high: 7, mid: 3, low: 7, rig: 5 },
    bonuses: { structureCapacity: 0.35, cannonDamage: 0.30, speed: 0.15, structureRepair: 2.00, hitBonus: 30, structureEmergencyRepair: 1.00 },
    capitalTrait: { id:"structure_overdrive", name:"强化结构过载", description:"每损失10%结构，火炮最终伤害提高4%，最多8层", perLayer:0.04, maxLayers:8 },
    recommendedWeapon: "cannon", counterFaction: "sansha",
    unlock: { type: "blueprint", costLP: 1000, level: 90 }
  }
};

// ---- 工业舰船：属性表（参照20260712细化，效能加成版） ----
const INDUSTRIAL_SHIPS = {
  miner_frigate: {
    id: "miner_frigate", name: "拓岩级", tier: "T1", type: "industrial_frigate",
    flavor: "采矿专用护卫舰，放大采矿装备效能",
    hp: { shield: 220, armor: 75, structure: 75 }, totalHp: 370,
    dodge: 20, speed: 240, targeting: 90,
    capacitor: { capacity: 100 },
    fuelEfficiency: 1.0,
    slots: { high: 2, mid: 2, low: 1, rig: 1 },
    bonuses: { miningLaserEfficiency: 0.25 },
    unlock: { type: "blueprint", costISK: 50000 }
  },
  gas_frigate: {
    id: "gas_frigate", name: "捕云级", tier: "T1", type: "industrial_frigate",
    flavor: "采气专用护卫舰，放大采气装备效能",
    hp: { shield: 220, armor: 75, structure: 75 }, totalHp: 370,
    dodge: 20, speed: 240, targeting: 90,
    capacitor: { capacity: 100 },
    fuelEfficiency: 1.0,
    slots: { high: 2, mid: 2, low: 1, rig: 1 },
    bonuses: { gasLaserEfficiency: 0.25 },
    unlock: { type: "blueprint", costISK: 50000 }
  },
  miner_destroyer: {
    id: "miner_destroyer", name: "凿岩级", tier: "T1", type: "industrial_destroyer",
    flavor: "采矿专用驱逐舰，在低级工业舰与巡洋级采矿平台之间承上启下",
    hp: { shield: 300, armor: 150, structure: 110 }, totalHp: 560,
    dodge: 16, speed: 210, targeting: 100,
    capacitor: { capacity: 120 },
    fuelEfficiency: 0.95,
    slots: { high: 3, mid: 1, low: 2, rig: 1 },
    bonuses: { miningLaserEfficiency: 0.5 },
    unlock: { type: "shipEngineering", level: 15 }
  },
  gas_destroyer: {
    id: "gas_destroyer", name: "采集者级", tier: "T1", type: "industrial_destroyer",
    flavor: "采气专用驱逐舰，在低级工业舰与巡洋级采气平台之间承上启下",
    hp: { shield: 300, armor: 150, structure: 110 }, totalHp: 560,
    dodge: 16, speed: 210, targeting: 100,
    capacitor: { capacity: 120 },
    fuelEfficiency: 0.95,
    slots: { high: 3, mid: 1, low: 2, rig: 1 },
    bonuses: { gasLaserEfficiency: 0.5 },
    unlock: { type: "shipEngineering", level: 15 }
  },
  miner_cruiser: {
    id: "miner_cruiser", name: "岩脊级", tier: "T1", type: "industrial_cruiser",
    flavor: "采矿专用巡洋舰，以更多工业槽位承载中级采矿装备",
    hp: { shield: 450, armor: 300, structure: 220 }, totalHp: 970,
    dodge: 12, speed: 160, targeting: 110,
    capacitor: { capacity: 150 },
    fuelEfficiency: 0.90,
    slots: { high: 3, mid: 2, low: 2, rig: 2 },
    bonuses: { miningLaserEfficiency: 1.0 },
    unlock: { type: "shipEngineering", level: 35 }
  },
  gas_cruiser: {
    id: "gas_cruiser", name: "云舶级", tier: "T1", type: "industrial_cruiser",
    flavor: "采气专用巡洋舰，以更多工业槽位承载中级采气装备",
    hp: { shield: 450, armor: 300, structure: 220 }, totalHp: 970,
    dodge: 12, speed: 160, targeting: 110,
    capacitor: { capacity: 150 },
    fuelEfficiency: 0.90,
    slots: { high: 3, mid: 2, low: 2, rig: 2 },
    bonuses: { gasLaserEfficiency: 1.0 },
    unlock: { type: "shipEngineering", level: 35 }
  },
  dolphin: {
    id: "dolphin", name: "驮星级", tier: "T1", type: "industrial_support",
    flavor: "工业支援巡洋舰；在船坞中协调采矿作业，也可被分配至冶炼工作",
    hp: { shield: 550, armor: 350, structure: 250 }, totalHp: 1150,
    dodge: 11, speed: 150, targeting: 120,
    capacitor: { capacity: 180 },
    fuelEfficiency: 0.90,
    slots: { high: 2, mid: 3, low: 2, rig: 2 },
    bonuses: { fleetMiningSpeed: 0.10, smeltingSpeed: 0.25 },
    fleetMiningExcludesSelf: true,
    unlock: { type: "shipEngineering", level: 35 }
  },
  miner_battleship: {
    id: "miner_battleship", name: "巨像级", tier: "T1", type: "industrial_battleship",
    flavor: "大型采矿工业舰，以高槽规模和工业系统支撑长时间采矿作业",
    hp: { shield: 1000, armor: 500, structure: 350 }, totalHp: 1850,
    dodge: 8, speed: 120, targeting: 120,
    capacitor: { capacity: 240 },
    fuelEfficiency: 0.85,
    slots: { high: 4, mid: 3, low: 2, rig: 3 },
    bonuses: { miningLaserEfficiency: 1.4 },
    unlock: { type: "shipEngineering", level: 55 }
  },
  gas_battleship: {
    id: "gas_battleship", name: "云海级", tier: "T1", type: "industrial_battleship",
    flavor: "大型采气工业舰，以高槽规模和工业系统支撑长时间采气作业",
    hp: { shield: 1000, armor: 500, structure: 350 }, totalHp: 1850,
    dodge: 8, speed: 120, targeting: 120,
    capacitor: { capacity: 240 },
    fuelEfficiency: 0.85,
    slots: { high: 4, mid: 3, low: 2, rig: 3 },
    bonuses: { gasLaserEfficiency: 1.4 },
    unlock: { type: "shipEngineering", level: 55 }
  },
  orca: {
    id: "orca", name: "山海级", tier: "旗舰", type: "industrial_capital",
    flavor: "工业旗舰，在船坞中为整个采矿编队提供最高级别的协调加成",
    hp: { shield: 2200, armor: 1100, structure: 750 }, totalHp: 4050,
    dodge: 8, speed: 100, targeting: 80,
    capacitor: { capacity: 300 },
    fuelEfficiency: 0.80,
    slots: { high: 4, mid: 4, low: 2, rig: 3 },
    bonuses: { miningLaserEfficiency: 1.8, gasLaserEfficiency: 1.8, fleetMiningSpeed: 0.20, smeltingSpeed: 0.30 },
    unlock: { type: "shipEngineering", level: 80 }
  }
};

// ---- 考古舰船类型（仅考古舰可装备考古装备） ----
const ARCHAEOLOGY_SHIP_TYPES = ["archaeology_frigate", "archaeology_destroyer", "archaeology_cruiser", "archaeology_battleship", "archaeology_capital"];

// ---- 考古船：属性表（第一阶段仅船体，考古行动/遗迹/探针/装备/文物为后续批次） ----
const ARCHAEOLOGY_SHIPS = {
  heron: {
    id: "heron", name: "觅迹级", tier: "T1", type: "archaeology_frigate",
    flavor: "入门级考古护卫舰，专为扫描信号与解析遗迹而生，轻装应对微弱的信号反噬",
    hp: { shield: 260, armor: 80, structure: 60 }, totalHp: 400,
    dodge: 22, speed: 250, targeting: 100,
    capacitor: { capacity: 100 },
    fuelEfficiency: 1.00,
    slots: { high: 2, mid: 2, low: 1, rig: 1 },
    bonuses: { archaeologyScanStrength: 10, archaeologyFailureDamageReduction: 0 },
    unlock: { type: "blueprint", costISK: 50000, level: 1 }
  },
  tracer: {
    id: "tracer", name: "追迹级", tier: "T1", type: "archaeology_destroyer",
    flavor: "轻型考古驱逐舰，强化扫描阵列以追踪深层遗迹信号，具备初步的信号反噬抗性",
    hp: { shield: 430, armor: 150, structure: 120 }, totalHp: 700,
    dodge: 18, speed: 220, targeting: 120,
    capacitor: { capacity: 140 },
    fuelEfficiency: 0.95,
    slots: { high: 3, mid: 2, low: 1, rig: 1 },
    bonuses: { archaeologyScanStrength: 25, archaeologyFailureDamageReduction: 0.05 },
    unlock: { type: "shipEngineering", level: 15 }
  },
  starmap: {
    id: "starmap", name: "星图级", tier: "T1", type: "archaeology_cruiser",
    flavor: "中型考古巡洋舰，以更强的扫描解析能力测绘复杂遗迹，并加固对信号反噬的防护",
    hp: { shield: 780, armor: 300, structure: 220 }, totalHp: 1300,
    dodge: 14, speed: 180, targeting: 150,
    capacitor: { capacity: 200 },
    fuelEfficiency: 0.90,
    slots: { high: 3, mid: 3, low: 2, rig: 2 },
    bonuses: { archaeologyScanStrength: 50, archaeologyFailureDamageReduction: 0.10 },
    unlock: { type: "shipEngineering", level: 35 }
  },
  farscope: {
    id: "farscope", name: "远镜级", tier: "T1", type: "archaeology_battleship",
    flavor: "大型考古战列舰，凭借远程扫描阵列深入解析大型遗迹，厚重装甲承受强烈信号反噬",
    hp: { shield: 1400, armor: 600, structure: 400 }, totalHp: 2400,
    dodge: 9, speed: 125, targeting: 180,
    capacitor: { capacity: 280 },
    fuelEfficiency: 0.85,
    slots: { high: 4, mid: 4, low: 2, rig: 3 },
    bonuses: { archaeologyScanStrength: 80, archaeologyFailureDamageReduction: 0.15 },
    unlock: { type: "shipEngineering", level: 55 }
  },
  illuminator: {
    id: "illuminator", name: "启明级", tier: "旗舰", type: "archaeology_capital",
    flavor: "考古旗舰，搭载最高级扫描与遗迹解析矩阵，能在最强的信号反噬中稳定作业",
    hp: { shield: 2900, armor: 1100, structure: 800 }, totalHp: 4800,
    dodge: 6, speed: 90, targeting: 220,
    capacitor: { capacity: 400 },
    fuelEfficiency: 0.80,
    slots: { high: 4, mid: 5, low: 3, rig: 4 },
    bonuses: { archaeologyScanStrength: 120, archaeologyFailureDamageReduction: 0.20 },
    unlock: { type: "shipEngineering", level: 80 }
  }
};

// 暴露给 3D 外观层（js/ui/ship3d.js，ES module）读取。仅挂到 window，不改原有经典脚本语义。
const SHIP_DATA = {
  STARTER_SHIPS,
  INDUSTRIAL_SHIPS,
  ARCHAEOLOGY_SHIPS,
  SHIP_BLUEPRINTS,
  SHIP_ASSEMBLY_RECIPES
};
if (typeof window !== "undefined") window.SHIP_DATA = SHIP_DATA;
// 增补 Node 导出（仅供测试 / legion-npc 查 shipId→type），不改动任何舰船数值与浏览器语义。
if (typeof module !== "undefined" && module.exports) module.exports = { SHIP_DATA: SHIP_DATA };
