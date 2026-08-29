// ---- 装备工程：T1装备数据库（参照20260712细化） ----
const EQUIPMENT_DB = {
  // 高槽装备
  "t1_mining_laser":  { id:"t1_mining_laser",  name:"T1采矿激光器",  slot:"high", level:1, time:15, xp:8,  cost:{"三钛合金":20,"类银超金属":10}, bonuses:{miningEfficiency:0.05} },
  "t1_gas_harvester": { id:"t1_gas_harvester", name:"T1气云采集器",  slot:"high", level:1, time:15, xp:8,  cost:{"三钛合金":20,"粗制富勒烯":6},   bonuses:{gasEfficiency:0.05} },
  "t2_mining_laser":  { id:"t2_mining_laser",  name:"中型采矿激光器",  slot:"high", level:15, time:35, xp:20, cost:{"三钛合金":80,"类银超金属":30,"类晶体胶矿":10}, bonuses:{miningEfficiency:0.15} },
  "t2_gas_harvester": { id:"t2_gas_harvester", name:"中型气云采集器",  slot:"high", level:15, time:35, xp:20, cost:{"三钛合金":80,"稳定富勒烯":10}, bonuses:{gasEfficiency:0.15} },
  "raider_mining_laser": { id:"raider_mining_laser", name:"银河联盟采矿激光器", slot:"high", level:25, time:45, xp:30, cost:{"三钛合金":120,"类银超金属":48}, bonuses:{miningEfficiency:0.20}, faction:"alliance", requiresBlueprint:true },
  "raider_gas_harvester": { id:"raider_gas_harvester", name:"银河联盟气云采集器", slot:"high", level:25, time:45, xp:30, cost:{"三钛合金":120,"稳定富勒烯":15}, bonuses:{gasEfficiency:0.20}, faction:"alliance", requiresBlueprint:true },
  "angel_mining_laser": { id:"angel_mining_laser", name:"苍穹劫团联合采矿激光器", slot:"high", level:25, time:45, xp:30, cost:{"三钛合金":100,"类银超金属":40,"苍穹劫团装备生产许可C":5}, bonuses:{miningEfficiency:0.22}, faction:"angel", sourceZoneId:"angel_corridor", requiresBlueprint:true },
  "angel_gas_harvester": { id:"angel_gas_harvester", name:"苍穹劫团联合气云采集器", slot:"high", level:25, time:45, xp:30, cost:{"三钛合金":100,"稳定富勒烯":12,"苍穹劫团装备生产许可C":5}, bonuses:{gasEfficiency:0.22}, faction:"angel", sourceZoneId:"angel_corridor", requiresBlueprint:true },
  "t3_mining_laser":  { id:"t3_mining_laser",  name:"重型采矿激光器",  slot:"high", level:35, time:60, xp:40, cost:{"三钛合金":200,"类银超金属":80,"同位聚合体":20,"重金属":10}, bonuses:{miningEfficiency:0.30} },
  "t3_gas_harvester": { id:"t3_gas_harvester", name:"重型气云采集器",  slot:"high", level:35, time:60, xp:40, cost:{"三钛合金":200,"稳定富勒烯":8,"氦同位素":5}, bonuses:{gasEfficiency:0.30} },
  "t4_mining_laser":  { id:"t4_mining_laser",  name:"大型采矿激光器",  slot:"high", level:55, time:100, xp:75, cost:{"三钛合金":500,"超新星诺克石":30,"等离子体":15,"钷":5}, bonuses:{miningEfficiency:0.50} },
  "t4_gas_harvester": { id:"t4_gas_harvester", name:"大型气云采集器",  slot:"high", level:55, time:100, xp:75, cost:{"三钛合金":500,"氢同位素":5,"高纯富勒烯":10}, bonuses:{gasEfficiency:0.50} },
  "t5_mining_laser":  { id:"t5_mining_laser", shipTypes:["industrial_capital"], name:"旗舰采矿激光器",  slot:"high", level:80, time:180, xp:130, cost:{"三钛合金":1200,"超噬矿":20,"铷":10,"磁场聚合物":30}, bonuses:{miningEfficiency:0.80} },
  "t5_gas_harvester": { id:"t5_gas_harvester", shipTypes:["industrial_capital"], name:"旗舰气云采集器",  slot:"high", level:80, time:180, xp:130, cost:{"三钛合金":1200,"超纯聚合气体":3,"铷":5}, bonuses:{gasEfficiency:0.80} },
  "t1_small_laser": { id:"t1_small_laser", name:"小型激光炮 I", slot:"high", level:1, time:20, xp:12, cost:{"三钛合金":45,"类晶体胶矿":12}, bonuses:{}, combat:{kind:"weapon",weaponType:"laser",baseDamage:120,baseHit:100,fuelCost:3,ammoCost:1} },
  "t1_light_missile_launcher": { id:"t1_light_missile_launcher", name:"轻型导弹发射器 I", slot:"high", level:1, time:20, xp:12, cost:{"三钛合金":45,"类银超金属":12}, bonuses:{}, combat:{kind:"weapon",weaponType:"missile",baseDamage:100,baseHit:130,fuelCost:2,ammoCost:1} },
  "t1_small_cannon": { id:"t1_small_cannon", name:"小型射弹炮 I", slot:"high", level:1, time:20, xp:12, cost:{"三钛合金":45,"类银超金属":10}, bonuses:{}, combat:{kind:"weapon",weaponType:"cannon",baseDamage:80,baseHit:80,fuelCost:1,ammoCost:1} },
  "t1_medium_laser": { id:"t1_medium_laser", name:"中型激光炮 I", slot:"high", level:35, time:45, xp:35, cost:{"三钛合金":150,"类晶体胶矿":40,"同位聚合体":10,"同位素":5}, bonuses:{}, combat:{kind:"weapon",weaponType:"laser",baseDamage:240,baseHit:100,fuelCost:6,ammoCost:1} },
  "t1_heavy_missile_launcher": { id:"t1_heavy_missile_launcher", name:"重型导弹发射器 I", slot:"high", level:35, time:45, xp:35, cost:{"三钛合金":150,"类银超金属":40,"同位聚合体":10,"稀有气体":8}, bonuses:{}, combat:{kind:"weapon",weaponType:"missile",baseDamage:200,baseHit:130,fuelCost:4,ammoCost:1} },
  "t1_medium_cannon": { id:"t1_medium_cannon", name:"中型射弹炮 I", slot:"high", level:35, time:45, xp:35, cost:{"三钛合金":150,"同位聚合体":35,"重金属":8}, bonuses:{}, combat:{kind:"weapon",weaponType:"cannon",baseDamage:160,baseHit:80,fuelCost:2,ammoCost:1} },
  "t1_large_laser": { id:"t1_large_laser", name:"大型激光炮 I", slot:"high", level:55, time:70, xp:55, cost:{"三钛合金":300,"同位聚合体":50,"超新星诺克石":15,"等离子体":8}, bonuses:{}, combat:{kind:"weapon",weaponType:"laser",baseDamage:480,baseHit:100,fuelCost:12,ammoCost:1} },
  "t1_cruise_missile_launcher": { id:"t1_cruise_missile_launcher", name:"巡航导弹发射器 I", slot:"high", level:55, time:70, xp:55, cost:{"三钛合金":300,"类银超金属":100,"超新星诺克石":15,"稀有气体":12}, bonuses:{}, combat:{kind:"weapon",weaponType:"missile",baseDamage:400,baseHit:130,fuelCost:8,ammoCost:1} },
  "t1_large_cannon": { id:"t1_large_cannon", name:"大型射弹炮 I", slot:"high", level:55, time:70, xp:55, cost:{"三钛合金":300,"同位聚合体":70,"超新星诺克石":12,"重金属":12}, bonuses:{}, combat:{kind:"weapon",weaponType:"cannon",baseDamage:320,baseHit:80,fuelCost:4,ammoCost:1} },
  "t1_capital_laser": { id:"t1_capital_laser", name:"旗舰级聚焦激光炮 I", slot:"high", level:80, time:180, xp:130, cost:{"三钛合金":500,"基腹断岩":12,"超噬矿":8,"铷":2,"等离子体":10}, bonuses:{}, shipTypes:["capital","supercapital"], combat:{kind:"weapon",weaponType:"laser",baseDamage:600,baseHit:100,fuelCost:15,ammoCost:1,aoe:{mode:"next",multiplier:0.30,maxTargets:1,description:"扫掠光束：下一目标受到30%最终伤害"}} },
  "t1_capital_missile_array": { id:"t1_capital_missile_array", name:"旗舰级巡航导弹阵列 I", slot:"high", level:80, time:180, xp:130, cost:{"三钛合金":500,"基腹断岩":10,"超噬矿":8,"铷":2,"超纯聚合气体":1,"磁场聚合物":8}, bonuses:{}, shipTypes:["capital","supercapital"], combat:{kind:"weapon",weaponType:"missile",baseDamage:500,baseHit:130,fuelCost:10,ammoCost:1,aoe:{mode:"all",multiplier:0.12,description:"扩散弹头：其他所有目标受到12%最终伤害"}} },
  "t1_capital_cannon": { id:"t1_capital_cannon", name:"旗舰级攻城射弹炮 I", slot:"high", level:80, time:180, xp:130, cost:{"三钛合金":500,"基腹断岩":12,"超噬矿":7,"铷":2,"重金属":12}, bonuses:{}, shipTypes:["capital","supercapital"], combat:{kind:"weapon",weaponType:"cannon",baseDamage:400,baseHit:80,fuelCost:5,ammoCost:1,aoe:{mode:"next",multiplier:0.15,maxTargets:2,description:"破片齐射：最多两个其他目标受到15%最终伤害"}} },
  // 中槽装备
  "t1_drone_control": { id:"t1_drone_control", name:"T1无人机控制单元", slot:"mid", level:1, time:20, xp:10, cost:{"三钛合金":25,"类银超金属":8}, bonuses:{miningEfficiency:0.02,gasEfficiency:0.02} },
  "t2_drone_link": { id:"t2_drone_link", name:"协同无人机指挥链路", slot:"mid", level:15, time:35, xp:20, cost:{"三钛合金":100,"类银超金属":35,"类晶体胶矿":10,"稳定富勒烯":5}, bonuses:{miningEfficiency:0.05,gasEfficiency:0.05} },
  "t3_drone_link": { id:"t3_drone_link", name:"高级无人机指挥链路", slot:"mid", level:35, time:60, xp:40, cost:{"三钛合金":250,"类银超金属":90,"同位聚合体":20,"稳定富勒烯":5,"稀有气体":10}, bonuses:{miningEfficiency:0.10,gasEfficiency:0.10} },
  "blood_servant_drone_link": { id:"blood_servant_drone_link", name:"赤誓仆从无人机指挥链路", slot:"mid", level:45, time:75, xp:55, cost:{"三钛合金":350,"类银超金属":120,"同位聚合体":20,"赤誓教团装备生产许可B":8}, bonuses:{miningEfficiency:0.13,gasEfficiency:0.13}, faction:"blood", sourceZoneId:"blood_cathedral", requiresBlueprint:true },
  "blood_servant_drone_link_sacrifice": { id:"blood_servant_drone_link_sacrifice", name:"赤誓仆从无人机指挥链路·献祭型", slot:"mid", level:25, time:45, xp:30, cost:{"三钛合金":150,"类银超金属":50,"赤誓教团装备生产许可C":5,"类晶体胶矿":15}, bonuses:{miningEfficiency:0.08,gasEfficiency:0.08}, faction:"blood", requiresBlueprint:true },
  "alliance_drone_link": { id:"alliance_drone_link", name:"银河联盟无人机指挥链路", slot:"mid", level:45, time:75, xp:55, cost:{"三钛合金":420,"类银超金属":144,"同位聚合体":24}, bonuses:{miningEfficiency:0.13,gasEfficiency:0.13}, faction:"alliance", requiresBlueprint:true },
  "t4_drone_link": { id:"t4_drone_link", name:"深空无人机指挥链路", slot:"mid", level:55, time:100, xp:75, cost:{"三钛合金":600,"超新星诺克石":25,"等离子体":15,"钷":5}, bonuses:{miningEfficiency:0.16,gasEfficiency:0.16} },
  "t5_drone_core": { id:"t5_drone_core", shipTypes:["industrial_capital"], name:"旗舰无人机指挥核心", slot:"mid", level:80, time:180, xp:130, cost:{"三钛合金":1400,"超噬矿":20,"铷":8,"超纯聚合气体":2,"磁场聚合物":30}, bonuses:{miningEfficiency:0.25,gasEfficiency:0.25} },
  "shield_ext_small":  { id:"shield_ext_small",  name:"小型护盾扩展",   slot:"mid", level:1, time:15, xp:6,  cost:{"三钛合金":50,"类银超金属":20},  bonuses:{shieldCapacity:50} },
  "t1_shield_booster": { id:"t1_shield_booster", name:"小型护盾回充器 I", slot:"mid", level:1, time:18, xp:10, cost:{"三钛合金":35,"类银超金属":15}, bonuses:{}, combat:{kind:"repair",target:"shield",amount:30,fuelCost:1} },
  "t1_medium_shield_booster": { id:"t1_medium_shield_booster", name:"中型护盾回充器 I", slot:"mid", level:35, time:42, xp:30, cost:{"三钛合金":120,"类银超金属":40,"同位素":8}, bonuses:{}, combat:{kind:"repair",target:"shield",amount:60,fuelCost:2} },
  "t1_large_shield_booster": { id:"t1_large_shield_booster", name:"大型护盾回充器 I", slot:"mid", level:55, time:65, xp:50, cost:{"三钛合金":240,"类银超金属":80,"超新星诺克石":10,"同位素":12}, bonuses:{}, combat:{kind:"repair",target:"shield",amount:120,fuelCost:4} },
  // 低槽装备
  "t1_armor_repairer": { id:"t1_armor_repairer", name:"小型装甲维修器 I", slot:"low", level:1, time:18, xp:10, cost:{"三钛合金":35,"类银超金属":12}, bonuses:{}, combat:{kind:"repair",target:"armor",amount:20,fuelCost:1} },
  "t1_structure_repairer": { id:"t1_structure_repairer", name:"小型结构修理器 I", slot:"low", level:1, time:18, xp:10, cost:{"三钛合金":40,"类银超金属":8}, bonuses:{}, combat:{kind:"repair",target:"structure",amount:10,fuelCost:1} },
  "t1_medium_armor_repairer": { id:"t1_medium_armor_repairer", name:"中型装甲维修器 I", slot:"low", level:35, time:42, xp:30, cost:{"三钛合金":120,"同位聚合体":35,"重金属":10}, bonuses:{}, combat:{kind:"repair",target:"armor",amount:40,fuelCost:2} },
  "t1_medium_structure_repairer": { id:"t1_medium_structure_repairer", name:"中型结构修理器 I", slot:"low", level:35, time:42, xp:30, cost:{"三钛合金":130,"类银超金属":25,"同位聚合体":25,"稀有气体":6}, bonuses:{}, combat:{kind:"repair",target:"structure",amount:20,fuelCost:2} },
  "t1_large_armor_repairer": { id:"t1_large_armor_repairer", name:"大型装甲维修器 I", slot:"low", level:55, time:65, xp:50, cost:{"三钛合金":240,"同位聚合体":50,"超新星诺克石":10,"重金属":14}, bonuses:{}, combat:{kind:"repair",target:"armor",amount:80,fuelCost:4} },
  "t1_large_structure_repairer": { id:"t1_large_structure_repairer", name:"大型结构修理器 I", slot:"low", level:55, time:65, xp:50, cost:{"三钛合金":260,"类银超金属":50,"超新星诺克石":12,"稀有气体":10}, bonuses:{}, combat:{kind:"repair",target:"structure",amount:40,fuelCost:4} },
  "t1_capital_shield_array": { id:"t1_capital_shield_array", name:"旗舰级护盾回充阵列 I", slot:"mid", level:80, time:160, xp:110, cost:{"三钛合金":400,"基腹断岩":8,"超噬矿":6,"铷":1,"同位素":8,"磁场聚合物":8}, bonuses:{}, shipTypes:["capital","supercapital"], combat:{kind:"repair",target:"shield",amount:150,fuelCost:5} },
  "t1_capital_armor_array": { id:"t1_capital_armor_array", name:"旗舰级装甲维修阵列 I", slot:"low", level:80, time:160, xp:110, cost:{"三钛合金":400,"基腹断岩":9,"超噬矿":6,"铷":1,"重金属":10,"等离子体":6}, bonuses:{}, shipTypes:["capital","supercapital"], combat:{kind:"repair",target:"armor",amount:100,fuelCost:5} },
  "t1_capital_structure_array": { id:"t1_capital_structure_array", name:"旗舰级结构修复阵列 I", slot:"low", level:80, time:160, xp:110, cost:{"三钛合金":400,"基腹断岩":8,"超噬矿":7,"铷":1,"稀有气体":8,"磁场聚合物":6}, bonuses:{}, shipTypes:["capital","supercapital"], combat:{kind:"repair",target:"structure",amount:50,fuelCost:5} },
  "t1_mining_booster": { id:"t1_mining_booster", name:"T1采矿提升器",  slot:"low", level:10,time:20, xp:12, cost:{"三钛合金":50,"类银超金属":20}, bonuses:{miningLaserEfficiency:0.10} },
  "t2_mining_booster": { id:"t2_mining_booster", name:"中型采矿提升器", slot:"low", level:15,time:35, xp:20, cost:{"三钛合金":160,"类银超金属":60,"类晶体胶矿":15}, bonuses:{miningLaserEfficiency:0.30} },
  "t3_mining_booster": { id:"t3_mining_booster", name:"重型采矿提升器", slot:"low", level:35,time:60, xp:40, cost:{"三钛合金":400,"类银超金属":150,"同位聚合体":30,"重金属":15}, bonuses:{miningLaserEfficiency:0.50} },
  "t4_mining_booster": { id:"t4_mining_booster", name:"大型采矿提升器", slot:"low", level:55,time:110,xp:80, cost:{"三钛合金":900,"超新星诺克石":45,"等离子体":25,"钷":5}, bonuses:{miningLaserEfficiency:0.70} },
  "sansha_mineral_assimilation": { id:"sansha_mineral_assimilation", name:"矿物同化注入器", slot:"low", level:65,time:130,xp:95, cost:{"三钛合金":1100,"超新星诺克石":50,"钷":5,"等离子体":25,"静默集群装备生产许可A":10}, bonuses:{miningLaserEfficiency:0.80}, faction:"sansha", sourceZoneId:"sansha_command_matrix", requiresBlueprint:true },
  // ===== 新增星带势力生产装备（材料按档位分级：D=1.0-0.8 / C=0.7-0.5 / B=0.4-0.3 / A=0.2-0.1） =====
  "angel_mining_laser_outpost": { id:"angel_mining_laser_outpost", name:"苍穹劫团采矿激光器·前哨型", slot:"high", level:10, time:30, xp:15, cost:{"三钛合金":60,"类银超金属":20,"苍穹劫团装备生产许可D":3}, bonuses:{miningEfficiency:0.10}, faction:"angel", requiresBlueprint:true },
  "angel_mineral_assimilation_outpost": { id:"angel_mineral_assimilation_outpost", name:"苍穹劫团矿物同化注入器·前哨型", slot:"low", level:10, time:30, xp:15, cost:{"三钛合金":80,"类银超金属":20,"苍穹劫团装备生产许可D":3}, bonuses:{miningLaserEfficiency:0.20}, faction:"angel", requiresBlueprint:true },
  "angel_drone_link_war": { id:"angel_drone_link_war", name:"苍穹劫团无人机指挥链路·破阵型", slot:"mid", level:65, time:130, xp:95, cost:{"三钛合金":900,"超新星诺克石":35,"钷":2,"等离子体":20,"苍穹劫团装备生产许可A":10}, bonuses:{miningEfficiency:0.20,gasEfficiency:0.20,miningLaserEfficiency:0.80,gasLaserEfficiency:0.80}, faction:"angel", requiresBlueprint:true },
  "blood_drone_link_sacrifice": { id:"blood_drone_link_sacrifice", name:"赤誓仆从无人机指挥链路·献祭型", slot:"mid", level:25, time:45, xp:30, cost:{"三钛合金":150,"类银超金属":50,"赤誓教团装备生产许可C":5,"类晶体胶矿":15}, bonuses:{miningEfficiency:0.08,gasEfficiency:0.08}, faction:"blood", sourceZoneId:"blood_sacrifice", requiresBlueprint:true },
  "blood_mining_laser_hunt": { id:"blood_mining_laser_hunt", name:"赤誓采矿激光器·猎杀型", slot:"high", level:45, time:75, xp:55, cost:{"三钛合金":300,"类银超金属":100,"同位聚合体":20,"重金属":15,"赤誓教团装备生产许可B":8}, bonuses:{miningEfficiency:0.40}, faction:"blood", requiresBlueprint:true },
  "blood_mineral_assimilation_nexus": { id:"blood_mineral_assimilation_nexus", name:"赤誓矿物同化注入器·枢纽型", slot:"low", level:45, time:75, xp:55, cost:{"三钛合金":600,"同位聚合体":25,"重金属":15,"赤誓教团装备生产许可B":8,"氦同位素":10}, bonuses:{miningLaserEfficiency:0.60}, faction:"blood", requiresBlueprint:true },
  "blood_gas_harvester_iron": { id:"blood_gas_harvester_iron", name:"赤誓气云采集器·铁血型", slot:"high", level:65, time:130, xp:95, cost:{"三钛合金":700,"氢同位素":15,"氦同位素":10,"赤誓教团装备生产许可A":10}, bonuses:{gasEfficiency:0.65,gasLaserEfficiency:0.80}, faction:"blood", requiresBlueprint:true },
  "sansha_mineral_assimilation_node": { id:"sansha_mineral_assimilation_node", name:"矿物同化注入器·节点型", slot:"low", level:25, time:45, xp:30, cost:{"三钛合金":300,"类银超金属":100,"静默集群装备生产许可C":5,"类晶体胶矿":20}, bonuses:{miningLaserEfficiency:0.40}, faction:"sansha", requiresBlueprint:true },
  "sansha_gas_harvester_nexus": { id:"sansha_gas_harvester_nexus", name:"静默气云采集器·枢纽型", slot:"high", level:45, time:75, xp:55, cost:{"三钛合金":300,"稳定富勒烯":15,"氦同位素":10,"静默集群装备生产许可B":8}, bonuses:{gasEfficiency:0.40}, faction:"sansha", requiresBlueprint:true },
  "sansha_mining_laser_war": { id:"sansha_mining_laser_war", name:"静默采矿激光器·破阵型", slot:"high", level:65, time:130, xp:95, cost:{"三钛合金":700,"超新星诺克石":40,"钷":4,"等离子体":20,"静默集群装备生产许可A":10}, bonuses:{miningEfficiency:0.65,miningLaserEfficiency:0.80}, faction:"sansha", requiresBlueprint:true },
  "sansha_drone_link_outpost": { id:"sansha_drone_link_outpost", name:"静默无人机指挥链路·前哨型", slot:"mid", level:10, time:30, xp:15, cost:{"三钛合金":40,"类银超金属":15,"静默集群装备生产许可D":3}, bonuses:{miningEfficiency:0.04,gasEfficiency:0.04}, faction:"sansha", requiresBlueprint:true },

  "alliance_mineral_assimilation": { id:"alliance_mineral_assimilation", name:"银河联盟矿物同化注入器", slot:"low", level:65,time:130,xp:95, cost:{"三钛合金":1320,"超新星诺克石":60,"铷":6,"等离子体":30}, bonuses:{miningLaserEfficiency:0.80}, faction:"alliance", requiresBlueprint:true },
  "t5_mining_booster": { id:"t5_mining_booster", shipTypes:["industrial_capital"], name:"旗舰采矿提升核心", slot:"low", level:80,time:200,xp:150,cost:{"三钛合金":2000,"超噬矿":35,"铷":15,"磁场聚合物":50}, bonuses:{miningLaserEfficiency:0.90} },
  "t1_gas_booster":    { id:"t1_gas_booster",    name:"T1采气提升器",  slot:"low", level:10,time:20, xp:12, cost:{"三钛合金":50,"粗制富勒烯":20},  bonuses:{gasLaserEfficiency:0.10} },
  // ===== 采气提升器（对标采矿提升器，低槽 gasLaserEfficiency） =====
  "t2_gas_booster":    { id:"t2_gas_booster",    name:"中型采气提升器",  slot:"low", level:15,time:35,  xp:20,  cost:{"三钛合金":160, "稳定富勒烯":60,   "类晶体胶矿":15}, bonuses:{gasLaserEfficiency:0.30} },
  "t3_gas_booster":    { id:"t3_gas_booster",    name:"重型采气提升器",  slot:"low", level:35,time:60,  xp:40,  cost:{"三钛合金":400, "稳定富勒烯":150,  "同位聚合体":30,"重金属":15}, bonuses:{gasLaserEfficiency:0.50} },
  "t4_gas_booster":    { id:"t4_gas_booster",    name:"大型采气提升器",  slot:"low", level:55,time:110, xp:80,  cost:{"三钛合金":900,"等离子体":25,"高纯富勒烯":55,"钷":5}, bonuses:{gasLaserEfficiency:0.70} },
  "t5_gas_booster":    { id:"t5_gas_booster", shipTypes:["industrial_capital"],    name:"旗舰采气提升核心", slot:"low", level:80,time:200, xp:150, cost:{"三钛合金":2000,"超纯聚合气体":35, "铷":15, "磁场聚合物":50}, bonuses:{gasLaserEfficiency:0.90} },
  // ===== 势力采气提升器（对标势力采矿提升器，气体同化注入器系，需蓝图） =====
  "sansha_gas_assimilation":  { id:"sansha_gas_assimilation",  name:"静默气体同化注入器",       slot:"low", level:65,time:130,xp:95,  cost:{"三钛合金":1100,"高纯富勒烯":50,"钷":5,"等离子体":25,"静默集群装备生产许可A":10}, bonuses:{gasLaserEfficiency:0.80}, faction:"sansha", sourceZoneId:"sansha_command_matrix", requiresBlueprint:true },
  "angel_gas_assimilation_outpost": { id:"angel_gas_assimilation_outpost", name:"苍穹劫团气体同化注入器·前哨型", slot:"low", level:10,time:30, xp:15, cost:{"三钛合金":80, "稳定富勒烯":20, "苍穹劫团装备生产许可D":3}, bonuses:{gasLaserEfficiency:0.20}, faction:"angel", requiresBlueprint:true },
  "blood_gas_assimilation_nexus":  { id:"blood_gas_assimilation_nexus",  name:"赤誓气体同化注入器·枢纽型",   slot:"low", level:45,time:75, xp:55,  cost:{"三钛合金":600,"同位聚合体":15,"氦同位素":15,"赤誓教团装备生产许可B":8}, bonuses:{gasLaserEfficiency:0.60}, faction:"blood", requiresBlueprint:true },
  "sansha_gas_assimilation_node":  { id:"sansha_gas_assimilation_node",  name:"静默气体同化注入器·节点型",   slot:"low", level:25,time:45, xp:30,  cost:{"三钛合金":300,"稳定富勒烯":100,"静默集群装备生产许可C":5,"类晶体胶矿":20}, bonuses:{gasLaserEfficiency:0.40}, faction:"sansha", requiresBlueprint:true },
  "alliance_gas_assimilation": { id:"alliance_gas_assimilation", name:"银河联盟气体同化注入器",     slot:"low", level:65,time:130,xp:95,  cost:{"三钛合金":1320,"聚合气体":60, "铷":6,"等离子体":30}, bonuses:{gasLaserEfficiency:0.80}, faction:"alliance", requiresBlueprint:true },

  // ===== 同位素标记打捞臂（对标采矿/采气提升器，低槽 salvageEfficiency；装备即生效提升货柜掉率；
  //   燃料：装备即按击毁数扣 salvageFuelPerKill（基准），开启主动打捞时基准×3；开主动额外消耗同位素并掉落舰船组件） =====
  "t1_salvage_arm":    { id:"t1_salvage_arm",    name:"T1同位素标记打捞臂",  slot:"low", level:10, time:20,  xp:12,  cost:{"三钛合金":50,  "重金属":20, "稀有气体":12}, bonuses:{salvageEfficiency:0.10}, salvageFuelPerKill:2 },
  "t2_salvage_arm":    { id:"t2_salvage_arm",    name:"中型同位素标记打捞臂", slot:"low", level:15, time:35,  xp:20,  cost:{"三钛合金":160, "同位素":60,  "类晶体胶矿":15}, bonuses:{salvageEfficiency:0.30}, salvageFuelPerKill:4 },
  "t3_salvage_arm":    { id:"t3_salvage_arm",    name:"重型同位素标记打捞臂", slot:"low", level:35, time:60,  xp:40,  cost:{"三钛合金":400, "等离子体":150, "同位素":30, "重金属":15}, bonuses:{salvageEfficiency:0.50}, salvageFuelPerKill:6 },
  "t4_salvage_arm":    { id:"t4_salvage_arm",    name:"大型同位素标记打捞臂", slot:"low", level:55, time:110, xp:80,  cost:{"三钛合金":900,"生物质":45,"等离子体":25,"钷":5}, bonuses:{salvageEfficiency:0.70}, salvageFuelPerKill:8 },
  "t5_salvage_arm":    { id:"t5_salvage_arm", shipTypes:["capital","supercapital","archaeology_capital"], name:"旗舰同位素标记打捞核心", slot:"low", level:80, time:200, xp:150, cost:{"三钛合金":2000,"磁场聚合物":35, "铷":15, "生物质":50}, bonuses:{salvageEfficiency:0.90}, salvageFuelPerKill:10 },
  // ===== 势力同位素标记打捞臂（对标势力采矿/采气提升器，残骸打捞注入器系，需蓝图；渠道逐件对标矿提孪生件：货柜 S/M/L + LP_STORE + STAR_BELT） =====
  "sansha_salvage_injector":  { id:"sansha_salvage_injector",  name:"静默残骸打捞注入器",       slot:"low", level:65, time:130, xp:95,  cost:{"三钛合金":1100,"等离子体":50,"钷":5,"生物质":25,"静默集群装备生产许可A":10}, bonuses:{salvageEfficiency:0.80}, salvageFuelPerKill:8, faction:"sansha", sourceZoneId:"sansha_command_matrix", requiresBlueprint:true },
  "angel_salvage_injector_outpost": { id:"angel_salvage_injector_outpost", name:"苍穹劫团残骸打捞注入器·前哨型", slot:"low", level:10, time:30, xp:15, cost:{"三钛合金":80, "稀有气体":20, "苍穹劫团装备生产许可D":3}, bonuses:{salvageEfficiency:0.20}, salvageFuelPerKill:2, faction:"angel", requiresBlueprint:true },
  "blood_salvage_injector_nexus":  { id:"blood_salvage_injector_nexus",  name:"赤誓残骸打捞注入器·枢纽型",   slot:"low", level:45, time:75, xp:55,  cost:{"三钛合金":600,"同位聚合体":25,"重金属":15,"赤誓教团装备生产许可B":8}, bonuses:{salvageEfficiency:0.60}, salvageFuelPerKill:8, faction:"blood", requiresBlueprint:true },
  "sansha_salvage_injector_node":  { id:"sansha_salvage_injector_node",  name:"静默残骸打捞注入器·节点型",   slot:"low", level:25, time:45, xp:30,  cost:{"三钛合金":300,"同位素":100,"静默集群装备生产许可C":5,"类晶体胶矿":20}, bonuses:{salvageEfficiency:0.40}, salvageFuelPerKill:4, faction:"sansha", requiresBlueprint:true },
  "alliance_salvage_injector": { id:"alliance_salvage_injector", name:"银河联盟残骸打捞注入器",     slot:"low", level:65, time:130, xp:95,  cost:{"三钛合金":1320,"铷":6,"生物质":105}, bonuses:{salvageEfficiency:0.80}, salvageFuelPerKill:8, faction:"alliance", requiresBlueprint:true },

  // ===== 考古装备（仅考古舰可装备，不可用于战斗，不可安装战斗装备） =====
  // 高槽：遗迹分析仪 — 提升扫描强度
  "archaeo_analyzer_i": { id:"archaeo_analyzer_i", name:"遗迹分析仪 I", slot:"high", level:1,  time:20, xp:14, cost:{"三钛合金":40,"类银超金属":15}, bonuses:{archaeologyScan:5},  shipTypes:ARCHAEOLOGY_SHIP_TYPES, archaeology:true },
  "archaeo_analyzer_ii":{ id:"archaeo_analyzer_ii",name:"遗迹分析仪 II",slot:"high", level:15, time:40, xp:35, cost:{"三钛合金":160,"类银超金属":60,"类晶体胶矿":15}, bonuses:{archaeologyScan:8},  shipTypes:ARCHAEOLOGY_SHIP_TYPES, archaeology:true },
  "archaeo_analyzer_iii":{id:"archaeo_analyzer_iii",name:"遗迹分析仪 III",slot:"high",level:35, time:70, xp:60, cost:{"三钛合金":400,"类银超金属":150,"同位聚合体":25,"重金属":12}, bonuses:{archaeologyScan:12}, shipTypes:ARCHAEOLOGY_SHIP_TYPES, archaeology:true },
  "archaeo_analyzer_iv":{ id:"archaeo_analyzer_iv",name:"遗迹分析仪 IV",slot:"high", level:55, time:120,xp:110,cost:{"三钛合金":900,"超新星诺克石":40,"等离子体":20,"钷":5}, bonuses:{archaeologyScan:18}, shipTypes:ARCHAEOLOGY_SHIP_TYPES, archaeology:true },
  "archaeo_analyzer_v": { id:"archaeo_analyzer_v", name:"遗迹分析仪 V", slot:"high", level:80, time:200,xp:180,cost:{"三钛合金":2000,"超噬矿":15,"铷":10,"磁场聚合物":40}, bonuses:{archaeologyScan:25}, shipTypes:ARCHAEOLOGY_SHIP_TYPES, archaeology:true },
  // 中槽：信号稳定器 — 降低失败反噬（总和上限 60%）
  "archaeo_stabilizer_i": { id:"archaeo_stabilizer_i", name:"信号稳定器 I", slot:"mid", level:1,  time:20, xp:14, cost:{"三钛合金":40,"类银超金属":15}, bonuses:{archaeologyStabilizer:0.05}, shipTypes:ARCHAEOLOGY_SHIP_TYPES, archaeology:true },
  "archaeo_stabilizer_ii":{ id:"archaeo_stabilizer_ii",name:"信号稳定器 II",slot:"mid", level:15, time:40, xp:35, cost:{"三钛合金":160,"类银超金属":60,"类晶体胶矿":15}, bonuses:{archaeologyStabilizer:0.08}, shipTypes:ARCHAEOLOGY_SHIP_TYPES, archaeology:true },
  "archaeo_stabilizer_iii":{id:"archaeo_stabilizer_iii",name:"信号稳定器 III",slot:"mid",level:35, time:70, xp:60, cost:{"三钛合金":400,"类银超金属":150,"同位聚合体":25,"重金属":12}, bonuses:{archaeologyStabilizer:0.11}, shipTypes:ARCHAEOLOGY_SHIP_TYPES, archaeology:true },
  "archaeo_stabilizer_iv":{ id:"archaeo_stabilizer_iv",name:"信号稳定器 IV",slot:"mid", level:55, time:120,xp:110,cost:{"三钛合金":900,"超新星诺克石":40,"等离子体":20,"钷":5}, bonuses:{archaeologyStabilizer:0.14}, shipTypes:ARCHAEOLOGY_SHIP_TYPES, archaeology:true },
  "archaeo_stabilizer_v": { id:"archaeo_stabilizer_v", name:"信号稳定器 V", slot:"mid", level:80, time:200,xp:180,cost:{"三钛合金":2000,"超噬矿":15,"铷":10,"磁场聚合物":40}, bonuses:{archaeologyStabilizer:0.17}, shipTypes:ARCHAEOLOGY_SHIP_TYPES, archaeology:true },
  // 低槽：文物译码器 — 稀有发现掉率加成（乘子 1+加成，总和上限 75%）
  "archaeo_decoder_i": { id:"archaeo_decoder_i", name:"文物译码器 I", slot:"low", level:1,  time:20, xp:14, cost:{"三钛合金":40,"类晶体胶矿":15}, bonuses:{archaeologyDecoder:0.10}, shipTypes:ARCHAEOLOGY_SHIP_TYPES, archaeology:true },
  "archaeo_decoder_ii":{ id:"archaeo_decoder_ii",name:"文物译码器 II",slot:"low", level:15, time:40, xp:35, cost:{"三钛合金":160,"重金属":8,"类晶体胶矿":50}, bonuses:{archaeologyDecoder:0.14}, shipTypes:ARCHAEOLOGY_SHIP_TYPES, archaeology:true },
  "archaeo_decoder_iii":{id:"archaeo_decoder_iii",name:"文物译码器 III",slot:"low",level:35, time:70, xp:60, cost:{"三钛合金":400,"同位聚合体":105,"稀有气体":8}, bonuses:{archaeologyDecoder:0.18}, shipTypes:ARCHAEOLOGY_SHIP_TYPES, archaeology:true },
  "archaeo_decoder_iv":{ id:"archaeo_decoder_iv",name:"文物译码器 IV",slot:"low", level:55, time:120,xp:110,cost:{"三钛合金":900,"同位聚合体":200,"等离子体":20,"钷":5}, bonuses:{archaeologyDecoder:0.22}, shipTypes:ARCHAEOLOGY_SHIP_TYPES, archaeology:true },
  "archaeo_decoder_v": { id:"archaeo_decoder_v", name:"文物译码器 V", slot:"low", level:80, time:200,xp:180,cost:{"三钛合金":2000,"同位聚合体":450,"铷":10,"磁场聚合物":40}, bonuses:{archaeologyDecoder:0.26}, shipTypes:ARCHAEOLOGY_SHIP_TYPES, archaeology:true },

  // ===== 考古重做 — 7 张特殊考古装备蓝图（仅掉落蓝图，制造后属现有三类考古装备；requiresBlueprint） =====
  // 高槽：遗迹分析仪 — 扫描 + 周期缩短
  "archaeo_analyzer_frontier_i": { id:"archaeo_analyzer_frontier_i", name:"边疆遗迹分析仪 I", slot:"high", level:1,  time:25, xp:18, cost:{"三钛合金":60,"类银超金属":25}, bonuses:{archaeologyScan:7, archaeologyCycleReduction:0.02}, shipTypes:ARCHAEOLOGY_SHIP_TYPES, archaeology:true, requiresBlueprint:true },
  "archaeo_analyzer_forbidden_iv": { id:"archaeo_analyzer_forbidden_iv", name:"禁区遗迹分析仪 IV", slot:"high", level:55, time:130,xp:120,cost:{"三钛合金":1000,"超新星诺克石":50,"等离子体":25,"钷":5}, bonuses:{archaeologyScan:23, archaeologyCycleReduction:0.05}, shipTypes:ARCHAEOLOGY_SHIP_TYPES, archaeology:true, requiresBlueprint:true },
  "archaeo_analyzer_pioneer_v": { id:"archaeo_analyzer_pioneer_v", name:"先驱遗迹分析仪 V", slot:"high", level:80, time:210,xp:190,cost:{"三钛合金":2200,"超噬矿":20,"铷":12,"磁场聚合物":50}, bonuses:{archaeologyScan:32, archaeologyCycleReduction:0.06}, shipTypes:ARCHAEOLOGY_SHIP_TYPES, archaeology:true, requiresBlueprint:true },
  // 中槽：信号稳定器 — 反噬减免 + 非致命免伤
  "archaeo_stabilizer_station_ii": { id:"archaeo_stabilizer_station_ii", name:"环站信号稳定器 II", slot:"mid", level:15, time:45, xp:40, cost:{"三钛合金":200,"类银超金属":80,"类晶体胶矿":20}, bonuses:{archaeologyStabilizer:0.08, archaeologyNonFatalAvoid:0.05}, shipTypes:ARCHAEOLOGY_SHIP_TYPES, archaeology:true, requiresBlueprint:true },
  "archaeo_stabilizer_pioneer_v": { id:"archaeo_stabilizer_pioneer_v", name:"先驱信号稳定器 V", slot:"mid", level:80, time:210,xp:190,cost:{"三钛合金":2200,"超噬矿":20,"铷":12,"磁场聚合物":50}, bonuses:{archaeologyStabilizer:0.20, archaeologyNonFatalAvoid:0.12}, shipTypes:ARCHAEOLOGY_SHIP_TYPES, archaeology:true, requiresBlueprint:true },
  // 低槽：文物译码器 — 稀有发现掉率加成 + 货柜焦点额外掉落一个货柜
  "archaeo_decoder_fleet_iii": { id:"archaeo_decoder_fleet_iii", name:"舰墓文物译码器 III", slot:"low", level:35, time:75, xp:65, cost:{"三钛合金":450,"同位聚合体":120,"稀有气体":10}, bonuses:{archaeologyDecoder:0.19, archaeologyCopyChance:0.04}, shipTypes:ARCHAEOLOGY_SHIP_TYPES, archaeology:true, requiresBlueprint:true },
  "archaeo_decoder_pioneer_v": { id:"archaeo_decoder_pioneer_v", name:"先驱文物译码器 V", slot:"low", level:80, time:210,xp:190,cost:{"三钛合金":2200,"同位聚合体":500,"铷":12,"磁场聚合物":50}, bonuses:{archaeologyDecoder:0.28, archaeologyCopyChance:0.07}, shipTypes:ARCHAEOLOGY_SHIP_TYPES, archaeology:true, requiresBlueprint:true },

  // ===== 损伤控制单元（中槽主动耗燃料，全局减伤乘区；燃料=ceil(2/3×护盾回充器)，走 calcFuelMult 自动吃电容减免） =====
  "t1_damage_control": { id:"t1_damage_control", name:"小型损伤控制单元 I", slot:"mid", level:1, time:18, xp:10, cost:{"三钛合金":35,"类银超金属":15}, bonuses:{globalDamageReduction:0.05}, combat:{kind:"damageControl",fuelCost:1} },
  "t1_medium_damage_control": { id:"t1_medium_damage_control", name:"中型损伤控制单元 I", slot:"mid", level:35, time:42, xp:30, cost:{"三钛合金":120,"类银超金属":40,"同位素":8}, bonuses:{globalDamageReduction:0.08}, combat:{kind:"damageControl",fuelCost:2} },
  "t1_large_damage_control": { id:"t1_large_damage_control", name:"大型损伤控制单元 I", slot:"mid", level:55, time:65, xp:50, cost:{"三钛合金":240,"类银超金属":80,"超新星诺克石":10,"同位素":12}, bonuses:{globalDamageReduction:0.12}, combat:{kind:"damageControl",fuelCost:3} },
  "t1_capital_damage_control": { id:"t1_capital_damage_control", name:"旗舰级损伤控制阵列 I", slot:"mid", level:80, time:160, xp:110, cost:{"三钛合金":400,"基腹断岩":8,"超噬矿":6,"铷":1,"同位素":8,"磁场聚合物":8}, bonuses:{globalDamageReduction:0.18}, shipTypes:["capital","supercapital"], combat:{kind:"damageControl",fuelCost:4} },
  // 势力损伤控制单元：angel 吃死许可B（lv45，对标大型档）/ blood 吃死许可D（lv10，对标前哨型）；蓝图由 sourceZoneId 自动派生
  "angel_damage_control": { id:"angel_damage_control", name:"苍穹劫团损伤控制单元", slot:"mid", level:45, time:55, xp:45, cost:{"三钛合金":240,"类银超金属":80,"同位聚合体":10,"苍穹劫团装备生产许可B":5}, bonuses:{globalDamageReduction:0.12,shieldRepair:0.01}, combat:{kind:"damageControl",fuelCost:3}, faction:"angel", sourceZoneId:"angel_corridor", requiresBlueprint:true },
  "blood_damage_control": { id:"blood_damage_control", name:"赤誓教团损伤控制单元", slot:"mid", level:10, time:22, xp:12, cost:{"三钛合金":60,"类银超金属":20,"赤誓教团装备生产许可B":5}, bonuses:{globalDamageReduction:0.08,armorRepair:0.03}, combat:{kind:"damageControl",fuelCost:1}, faction:"blood", sourceZoneId:"blood_cathedral", requiresBlueprint:true },

  "angel_mining_gas_apoc": { id:"angel_mining_gas_apoc", name:"苍穹劫团采矿·气云采集器·终焉型", slot:"high", level:85, time:200, xp:150, cost:{"三钛合金":2000,"超噬矿":40,"铷":15,"磁场聚合物":50,"莫尔石":5,"苍穹劫团装备生产许可S":10}, bonuses:{miningEfficiency:1.0,gasEfficiency:1.0}, faction:"angel", sourceZoneId:"angel_outer_reach", shipTypes:["industrial_capital"], requiresBlueprint:true },
  "angel_drone_link_apoc": { id:"angel_drone_link_apoc", name:"苍穹劫团无人机指挥链路·终焉型", slot:"mid", level:85, time:200, xp:150,  cost:{"三钛合金":2000,"超噬矿":40,"铷":15,"磁场聚合物":50,"莫尔石":5,"苍穹劫团装备生产许可S":10}, bonuses:{miningEfficiency:0.35,gasEfficiency:0.35}, faction:"angel", sourceZoneId:"angel_outer_reach", shipTypes:["industrial_capital"], requiresBlueprint:true },
  "blood_mineral_assimilation_apoc": { id:"blood_mineral_assimilation_apoc", name:"赤誓矿物同化注入器·终焉型", slot:"low", level:85, time:200, xp:150, cost:{"三钛合金":2000,"超噬矿":40,"铷":15,"磁场聚合物":50,"莫尔石":5,"赤誓教团装备生产许可S":10}, bonuses:{miningLaserEfficiency:1.1}, faction:"blood", sourceZoneId:"blood_outer_reliquary", shipTypes:["industrial_capital"], requiresBlueprint:true },
  "blood_salvage_injector_apoc": { id:"blood_salvage_injector_apoc", name:"赤誓残骸打捞注入器·终焉型", slot:"low", level:85, time:200, xp:150, cost:{"三钛合金":2000,"超噬矿":40,"铷":15,"磁场聚合物":50,"莫尔石":5,"赤誓教团装备生产许可S":10}, bonuses:{salvageEfficiency:1.1}, salvageFuelPerKill:10, faction:"blood", sourceZoneId:"blood_outer_reliquary", shipTypes:["capital","supercapital","archaeology_capital"], requiresBlueprint:true },
  "sansha_gas_assimilation_apoc": { id:"sansha_gas_assimilation_apoc", name:"静默集群气体同化注入器·终焉型", slot:"low", level:85, time:200, xp:150, cost:{"三钛合金":2000,"超噬矿":40,"铷":15,"磁场聚合物":50,"莫尔石":5,"静默集群装备生产许可S":10}, bonuses:{gasLaserEfficiency:1.1}, faction:"sansha", sourceZoneId:"sansha_outer_array", shipTypes:["industrial_capital"], requiresBlueprint:true },
};

/* ================================================================
   改装件（rig）系统 — 12 系列 × 5 档 = 60 件
   见 RIG_SYSTEM_IMPLEMENTATION_PLAN.md 第二/三/五节。
   数据由下方配置程序化生成并合并入 EQUIPMENT_DB（避免 55 行手写重复）。
   ================================================================ */
// 11 系列：stackGroup 唯一，bonusKey 为效果字段，rigCategory 用于装备工程子分类。
// 档位曲线遵循「谐振（堆叠）规范」：同一 stackGroup 内第 3 件同级改装件的实际增量严格低于下一级单件值。
//   - 战斗 / 工业 8 系列封顶 15% → [0.05, 0.07, 0.09, 0.12, 0.15]
//   - 考古 3 系列封顶 20%      → [0.08, 0.11, 0.14, 0.17, 0.20]
// 同系列可重复装配，但后续装配受 EVE 谐振惩罚（见 rigs.js getRigStackPenalty）实际效果递减。
const RIG_SERIES = [
  // 战斗（三种容量同档同百分比；用 *Percent 键避免与 shield_ext_small 的平值 shieldCapacity 冲突）
  { stackGroup:"rig_shield_capacity",          label:"护盾容量",   rigCategory:"combat",      bonusKey:"shieldCapacityPercent",          values:[0.05, 0.07, 0.09, 0.12, 0.15] },
  { stackGroup:"rig_armor_capacity",           label:"装甲容量",   rigCategory:"combat",      bonusKey:"armorCapacityPercent",           values:[0.05, 0.07, 0.09, 0.12, 0.15] },
  { stackGroup:"rig_structure_capacity",       label:"结构容量",   rigCategory:"combat",      bonusKey:"structureCapacityPercent",       values:[0.05, 0.07, 0.09, 0.12, 0.15] },
  // 工业（采矿/采气/冶炼同档同速度增幅）
  { stackGroup:"rig_mining_speed",             label:"采矿速度",   rigCategory:"industry",    bonusKey:"miningEfficiency",               values:[0.05, 0.07, 0.09, 0.12, 0.15] },
  { stackGroup:"rig_gas_speed",                label:"采气速度",   rigCategory:"industry",    bonusKey:"gasEfficiency",                  values:[0.05, 0.07, 0.09, 0.12, 0.15] },
  { stackGroup:"rig_smelting_speed",           label:"冶炼速度",   rigCategory:"industry",    bonusKey:"smeltingSpeed",                  values:[0.05, 0.07, 0.09, 0.12, 0.15] },
  // 伴生富集（2026-08-19 新增）：采集周期概率额外获得基准矿（采矿=铁硅原矿 ore:凡晶石 / 采气=粗制富勒烯），
  // 数量 = round(当前区域 baseTime ÷ 基准区域 baseTime) 下限 1；奖励独立，不参与双倍/脑插/调度，不给 XP。
  // 效果摘要 effectSummary 由 buildRigDefinitions 按 bonusKey + values[t] 动态生成（每档位显示该档具体概率）。
  { stackGroup:"rig_mining_rich",              label:"伴生矿物采集", rigCategory:"industry",  bonusKey:"miningRichChance",               values:[0.05, 0.07, 0.09, 0.12, 0.15],
    desc:"采矿周期完成时，有 {chance} 概率额外获得一批铁硅原矿，数量按当前矿带与铁硅原矿带的采集时间比折算（如艾克诺岩带≈19 单位、铷月岩带≈36 单位）。同系列可重复装配，受谐振惩罚。" },
  { stackGroup:"rig_gas_rich",                 label:"伴生气云采集", rigCategory:"industry",  bonusKey:"gasRichChance",                  values:[0.05, 0.07, 0.09, 0.12, 0.15],
    desc:"采气周期完成时，有 {chance} 概率额外获得一批粗制富勒烯，数量按当前云团与富勒烯云团的采集时间比折算（如超纯聚合气体云团≈15 单位）。同系列可重复装配，受谐振惩罚。" },
  // 考古（扫描增益 / 燃料减免 / 干扰缩短，减免类以正数存储）
  { stackGroup:"rig_archaeology_scan",         label:"扫描强度",   rigCategory:"archaeology", bonusKey:"archaeologyScanPercent",         values:[0.08, 0.11, 0.14, 0.17, 0.20] },
  { stackGroup:"rig_archaeology_fuel",         label:"电容回充",       rigCategory:"capacitor",   bonusKey:"archaeologyFuelEfficiency",       values:[0.04, 0.055, 0.07, 0.085, 0.10] },
  { stackGroup:"rig_archaeology_interference", label:"考古干扰缩短", rigCategory:"archaeology", bonusKey:"archaeologyInterferenceReduction", values:[0.08, 0.11, 0.14, 0.17, 0.20] },
  { stackGroup:"rig_archaeology_speed",        label:"遗迹速掘",     rigCategory:"archaeology", bonusKey:"archaeologyCycleReductionPercent", values:[0.08, 0.11, 0.14, 0.17, 0.20] },
  // 技能训练（神经训练改装件）：提升本舰被指派工作（采矿/采气/冶炼/考古/战斗）的技能经验获取；
  // 仅作用于该舰指派的工作，不外溢（见 systems/production.js addSkillXpToState 的 job 判定）。
  { stackGroup:"rig_skill_xp", label:"神经训练改装件", rigCategory:"training", bonusKey:"skillXpBonus", values:[0.05, 0.07, 0.09, 0.12, 0.15],
    desc:"装备于改装件槽，使本舰被指派工作（采矿/采气/冶炼/考古/战斗）的技能经验获取 +{chance}。同系列可重复装配，受谐振惩罚。" }
];
// 5 档：等级门槛、耗时、经验、校准材料需求、精炼矿物成本（材料来源见 PLAN 5.2）。
const RIG_TIER_META = [
  { suffix:"i",   roman:"I",   level:1,  time:20,  xp:14,  calib:"art_i_calib",   calibQty:1, minerals:{"三钛合金":100,  "类银超金属":40} },
  { suffix:"ii",  roman:"II",  level:15, time:40,  xp:35,  calib:"art_ii_calib",  calibQty:1, minerals:{"三钛合金":400,  "类晶体胶矿":60} },
  { suffix:"iii", roman:"III", level:35, time:70,  xp:60,  calib:"art_iii_calib", calibQty:2, minerals:{"三钛合金":800,  "同位聚合体":150} },
  { suffix:"iv",  roman:"IV",  level:55, time:120, xp:110, calib:"art_iv_calib",  calibQty:2, minerals:{"三钛合金":1500,"超新星诺克石":40,"钷":5} },
  { suffix:"v",   roman:"V",   level:80, time:200, xp:180, calib:"art_v_calib",   calibQty:3, minerals:{"三钛合金":2500, "超噬矿":10, "铷":8} }
];

function buildRigDefinitions() {
  // 伴生富集系列的效果摘要：按 bonusKey 自动映射奖励物名，按 values[t] 显示该档具体概率
  const RICH_BONUS_LABEL = { miningRichChance:"铁硅原矿", gasRichChance:"粗制富勒烯", skillXpBonus:"技能经验" };
  const defs = {};
  for (const series of RIG_SERIES) {
    for (let t = 0; t < RIG_TIER_META.length; t++) {
      const meta = RIG_TIER_META[t];
      const id = series.stackGroup + "_" + meta.suffix;
      // 成本 = 精炼矿物（按名）+ 校准材料（按 calibration: 命名空间 id）
      const cost = { ...meta.minerals };
      cost["calibration:" + meta.calib] = meta.calibQty;
      const summaryName = RICH_BONUS_LABEL[series.bonusKey];
      const chancePct = Math.round(series.values[t] * 100);
      const effectSummary = summaryName
        ? (series.bonusKey === "skillXpBonus"
            ? ("技能经验获取 +" + chancePct + "%")
            : ("每周期 " + chancePct + "% 几率额外获得定量" + summaryName))
        : "";
      const description = (series.desc || "").replace(/\{chance\}/g, chancePct + "%");
      defs[id] = {
        id,
        name: series.label + "改装件 " + meta.roman,
        slot: "rig",
        level: meta.level,
        time: meta.time,
        xp: meta.xp,
        stackGroup: series.stackGroup,
        rigCategory: series.rigCategory,
        rigTier: meta.roman,
        cost,
        description: description,
        effectSummary,
        bonuses: { [series.bonusKey]: series.values[t] }
      };
    }
  }
  return defs;
}
// 合并入 EQUIPMENT_DB（必须在 EQUIPMENT_RECIPES 派生之前）
Object.assign(EQUIPMENT_DB, buildRigDefinitions());

function canFitEquipmentOnShip(equipmentRef, shipConfig) {
  const equipment = typeof equipmentRef === "string" ? EQUIPMENT_DB[equipmentRef] : equipmentRef;
  if (!equipment || !shipConfig) return false;
  return !Array.isArray(equipment.shipTypes) || equipment.shipTypes.length === 0 ||
    equipment.shipTypes.includes(shipConfig.type);
}

const DEATHSPACE_EQUIPMENT_TIERS = Object.freeze({
  // 设计锚点（2026-08-28 定稿）：标准型 = 通关船级T1 ×1.10；监督者型 = 下一阶船级T1 ×1.03 余量
  // tier2/3/4/6 通关船级 = 驱逐(small)/巡洋(medium)/战列(large)/旗舰(capital)
  2:{ level:10, effect:1.10, supEffect:2.05, coreRequired:2, materialMultiplier:1.0, time:30, xp:18 },
  3:{ level:40, effect:1.10, supEffect:2.05, coreRequired:4, materialMultiplier:1.5, time:50, xp:32 },
  4:{ level:60, effect:1.10, supEffect:1.30, coreRequired:6, materialMultiplier:2.0, time:80, xp:55 },
  6:{ level:85, effect:1.10, supEffect:1.35, coreRequired:10, materialMultiplier:2.5, time:120, xp:90 }
});

const DEATHSPACE_EQUIPMENT_ROUTES = Object.freeze({
  angel:{ prefix:{2:"劫团试制",3:"劫团强化",4:"劫团精锐",6:"劫团A型"}, weapon:{2:"t1_small_laser",3:"t1_medium_laser",4:"t1_large_laser",6:"t1_capital_laser"}, repair:{2:"t1_shield_booster",3:"t1_medium_shield_booster",4:"t1_large_shield_booster",6:"t1_capital_shield_array"} },
  blood:{ prefix:{2:"科尔普斯试制",3:"科尔普斯强化",4:"科尔普斯精锐",6:"科尔普斯A型"}, weapon:{2:"t1_light_missile_launcher",3:"t1_heavy_missile_launcher",4:"t1_cruise_missile_launcher",6:"t1_capital_missile_array"}, repair:{2:"t1_armor_repairer",3:"t1_medium_armor_repairer",4:"t1_large_armor_repairer",6:"t1_capital_armor_array"} },
  sansha:{ prefix:{2:"森屠斯试制",3:"森屠斯强化",4:"森屠斯精锐",6:"森屠斯A型"}, weapon:{2:"t1_small_cannon",3:"t1_medium_cannon",4:"t1_large_cannon",6:"t1_capital_cannon"}, repair:{2:"t1_structure_repairer",3:"t1_medium_structure_repairer",4:"t1_large_structure_repairer",6:"t1_capital_structure_array"} }
});

function scaleDeathspaceEquipmentCost(cost, multiplier) {
  return Object.fromEntries(Object.entries(cost || {}).map(([material, quantity]) => [material, Math.max(1, Math.ceil(quantity * multiplier))]));
}

function createDeathspaceEquipmentDefinition(site, role, baseItemId, tierConfig) {
  const base = EQUIPMENT_DB[baseItemId];
  const route = DEATHSPACE_EQUIPMENT_ROUTES[site.faction];
  const standardId = "ded_" + site.faction + "_" + site.dedTier + "_" + role;
  const standardName = route.prefix[site.dedTier] + base.name.replace(/ I$/, "");
  const standardCombat = { ...base.combat };
  if (standardCombat.kind === "weapon") standardCombat.baseDamage = Math.round(standardCombat.baseDamage * tierConfig.effect);
  else standardCombat.amount = Math.round(standardCombat.amount * tierConfig.effect);
  const standardCost = scaleDeathspaceEquipmentCost(base.cost, tierConfig.materialMultiplier);
  standardCost[site.coreMaterial] = tierConfig.coreRequired;
  const standard = {
    id:standardId, name:standardName, slot:base.slot, level:tierConfig.level, time:tierConfig.time, xp:tierConfig.xp,
    cost:standardCost, bonuses:{ ...(base.bonuses || {}) }, combat:standardCombat, faction:site.faction,
    deathspaceTier:site.dedTier, deathspaceVariant:"standard", sourceDeathspaceId:site.id, requiresBlueprint:true,
    inputEquipment:{ itemId:baseItemId, quantity:1 }
  };
  // 继承基础件的船型门禁（旗舰级 base 限 capital/supercapital）
  if (Array.isArray(base.shipTypes) && base.shipTypes.length > 0) standard.shipTypes = [...base.shipTypes];

  const improvedId = "ded_" + site.faction + "_" + site.dedTier + "_" + role + "_supervisor";
  // 监督者型直接从基础件按 supEffect 缩放（而非在标准型上再乘），确保锚点数值精确
  const improvedCombat = { ...base.combat };
  if (improvedCombat.kind === "weapon") improvedCombat.baseDamage = Math.round(improvedCombat.baseDamage * (tierConfig.supEffect || 1.10));
  else improvedCombat.amount = Math.round(improvedCombat.amount * (tierConfig.supEffect || 1.10));
  const improvedCost = scaleDeathspaceEquipmentCost(base.cost, Math.max(1, tierConfig.materialMultiplier * 0.75));
  improvedCost[site.coreMaterial] = Math.max(1, Math.ceil(tierConfig.coreRequired / 2));
  improvedCost[site.protocolMaterial] = 1;
  const improved = {
    id:improvedId, name:standardName + "·监督者改良型", slot:base.slot, level:Math.min(99, tierConfig.level + 5),
    time:Math.round(tierConfig.time * 1.4), xp:Math.round(tierConfig.xp * 1.5), cost:improvedCost,
    bonuses:{ ...(base.bonuses || {}) }, combat:improvedCombat, faction:site.faction,
    deathspaceTier:site.dedTier, deathspaceVariant:"supervisor", sourceDeathspaceId:site.id, requiresBlueprint:true,
    inputEquipment:{ itemId:standardId, quantity:1 }
  };
  if (standard.shipTypes) improved.shipTypes = [...standard.shipTypes];
  return [standard, improved];
}

for (const site of DEATHSPACE_DATABASE) {
  const tierConfig = DEATHSPACE_EQUIPMENT_TIERS[site.dedTier];
  const route = DEATHSPACE_EQUIPMENT_ROUTES[site.faction];
  for (const role of ["weapon", "repair"]) {
    for (const equipment of createDeathspaceEquipmentDefinition(site, role, route[role][site.dedTier], tierConfig)) EQUIPMENT_DB[equipment.id] = equipment;
  }
}

const LP_STORE_BLUEPRINTS = [
  {
    id:"alliance_mining_laser_blueprint",
    name:"银河联盟采矿激光器蓝图",
    kind:"equipmentBlueprint",
    equipmentId:"raider_mining_laser",
    lpPrice:624,
    sourceZoneId:"angel_corridor",
    dataMaterial:"天使低级加密数据",
    dataRequired:5,
    expectedClears:51.9522797321635,
    expectedLP:311.713678392981,
    description:"永久解锁银河联盟采矿激光器制造配方"
  },
  {
    id:"alliance_gas_harvester_blueprint",
    name:"银河联盟气云采集器蓝图",
    kind:"equipmentBlueprint",
    equipmentId:"raider_gas_harvester",
    lpPrice:624,
    sourceZoneId:"angel_corridor",
    dataMaterial:"天使低级加密数据",
    dataRequired:5,
    expectedClears:51.9522797321635,
    expectedLP:311.713678392981,
    description:"永久解锁银河联盟气云采集器制造配方"
  },
  {
    id:"alliance_drone_link_blueprint",
    name:"银河联盟无人机指挥链路蓝图",
    kind:"equipmentBlueprint",
    equipmentId:"alliance_drone_link",
    lpPrice:764,
    sourceZoneId:"blood_cathedral",
    dataMaterial:"血袭者中级加密数据",
    dataRequired:8,
    expectedClears:38.1822712709151,
    expectedLP:381.822712709151,
    description:"永久解锁银河联盟无人机指挥链路制造配方"
  },
  {
    id:"alliance_mineral_assimilation_blueprint",
    name:"银河联盟矿物同化注入器蓝图",
    kind:"equipmentBlueprint",
    equipmentId:"alliance_mineral_assimilation",
    lpPrice:836,
    sourceZoneId:"sansha_command_matrix",
    dataMaterial:"萨沙高级加密数据",
    dataRequired:10,
    expectedClears:27.8571964721334,
    expectedLP:417.857947082001,
    description:"永久解锁银河联盟矿物同化注入器制造配方"
  },
  {
    id:"alliance_gas_assimilation_blueprint",
    name:"银河联盟气体同化注入器蓝图",
    kind:"equipmentBlueprint",
    equipmentId:"alliance_gas_assimilation",
    lpPrice:836,
    sourceZoneId:"sansha_command_matrix",
    dataMaterial:"萨沙高级加密数据",
    dataRequired:10,
    description:"永久解锁银河联盟气体同化注入器制造配方"
  },
  {
    id:"alliance_salvage_injector_blueprint",
    name:"银河联盟残骸打捞注入器蓝图",
    kind:"equipmentBlueprint",
    equipmentId:"alliance_salvage_injector",
    lpPrice:836,
    sourceZoneId:"sansha_command_matrix",
    dataMaterial:"萨沙高级加密数据",
    dataRequired:10,
    description:"永久解锁银河联盟残骸打捞注入器制造配方"
  }
];

function getZoneBlueprintPrice(sourceZoneId, clearMultiplier) {
  const zone = COMBAT_ZONES.find(item => item.id === sourceZoneId);
  return zone ? Math.round(zone.clearLp * clearMultiplier) : 0;
}

function getDeathspaceFullClearLP(sourceDeathspaceId) {
  const site = DEATHSPACE_DATABASE.find(item => item.id === sourceDeathspaceId);
  return site ? site.waveLp * site.maxWave + site.clearLpBonus : 0;
}

const STAR_BELT_EQUIPMENT_BLUEPRINTS = Object.values(EQUIPMENT_DB)
  .filter(equipment => ["angel", "blood", "sansha"].includes(equipment.faction) && equipment.sourceZoneId && !equipment.sourceDeathspaceId)
  .map(equipment => {
    const zone = COMBAT_ZONES.find(item => item.id === equipment.sourceZoneId);
    return {
      id:equipment.id + "_blueprint", name:equipment.name + "蓝图", kind:"equipmentBlueprint", equipmentId:equipment.id,
      lpPrice:getZoneBlueprintPrice(equipment.sourceZoneId, 10), sourceZoneId:equipment.sourceZoneId
    };
  });

const DEATHSPACE_EQUIPMENT_BLUEPRINTS = Object.values(EQUIPMENT_DB)
  .filter(equipment => equipment.sourceDeathspaceId && equipment.requiresBlueprint)
  .map(equipment => {
    const site = DEATHSPACE_DATABASE.find(item => item.id === equipment.sourceDeathspaceId);
    const fullClearLP = getDeathspaceFullClearLP(equipment.sourceDeathspaceId);
    return {
      id:equipment.id + "_blueprint", name:equipment.name + "蓝图", kind:"equipmentBlueprint", equipmentId:equipment.id,
      lpPrice:fullClearLP * 10, sourceDeathspaceId:equipment.sourceDeathspaceId, deathspaceTier:equipment.deathspaceTier
    };
  });

// ---- 势力探针限次抄本（BPC）----
// 功勋商店按「流程数」购买：1 流程 = 1 生产周期 = 20 枚探针；流程用尽后抄本消失、可再次购买。
// 显式列出而不从 AMMO_ENG_RECIPES 派生：ammunition.js 在 equipment.js 之后加载，加载期不可引用。
const FACTION_PROBE_BLUEPRINTS = Object.freeze([
  { id:"probe_faction_i_blueprint",   name:"苍穹劫团考古探针·掠空型 抄本", recipeId:"probe_faction_i",   perRunPrice:50,  level:1  },
  { id:"probe_faction_ii_blueprint",  name:"赤誓教团考古探针·血誓型 抄本", recipeId:"probe_faction_ii",  perRunPrice:100, level:35 },
  { id:"probe_faction_iii_blueprint", name:"静默集群考古探针·同化型 抄本", recipeId:"probe_faction_iii", perRunPrice:150, level:70 }
]);
// 单次可购买流程数上限（线性计价：总价 = 每流程单价 × 流程数）
const PROBE_BLUEPRINT_MAX_RUNS_PER_PURCHASE = 999;

const BLUEPRINT_STORE_CATEGORIES = Object.freeze([
  { id:"ships", name:"舰船蓝图", icon:"fa-solid fa-ship" },
  { id:"alliance", name:"银河联盟装备", icon:"fa-solid fa-star" },
  { id:"faction", name:"势力装备", icon:"fa-solid fa-flag" },
  { id:"probes", name:"势力探针抄本", icon:"fa-solid fa-crosshairs" },
  { id:"deathspace-2", name:"深空清剿 2/10", icon:"fa-solid fa-dungeon" },
  { id:"deathspace-3", name:"深空清剿 3/10", icon:"fa-solid fa-dungeon" },
  { id:"deathspace-4", name:"深空清剿 4/10", icon:"fa-solid fa-dungeon" },
  { id:"deathspace-6", name:"深空清剿 6/10", icon:"fa-solid fa-dungeon" }
]);

function getEquipmentBlueprintOwnershipKey(equipmentId) {
  return "equipment:" + equipmentId;
}

function hasEquipmentBlueprintFromState(state, equipmentId) {
  return Array.isArray(state && state.ownedBlueprints) &&
    state.ownedBlueprints.includes(getEquipmentBlueprintOwnershipKey(equipmentId));
}

function equipmentRecipeHasRequiredBlueprint(state, recipe) {
  return manufacturingRecipeHasBlueprint(state, recipe);
}

// ---- 限次蓝图抄本（BPC）类别感知门控 ----
// 考古探针配方（category "probes" + requiresBlueprint）的所有权不在永久 BPO 库 ownedBlueprints，
// 而在限次抄本库 blueprintCharges["probe:<recipeId>"]（按流程次数计，用完消失、须重买）。
// 装备自动线（station.js）与手动装备工程/行动槽（actions.js、tick.js）共用以下函数，
// 故「流程次数门控」只需在此维护一份，两条产线同时生效。
function isProbeBlueprintRecipe(recipe) {
  return Boolean(recipe) && recipe.requiresBlueprint === true && recipe.category === "probes";
}

function getManufacturingBlueprintKey(recipe) {
  return "probe:" + recipe.id;
}

// 该制造配方当前是否持有可用蓝图（BPO 永久 / BPC 剩余流程 > 0）
function manufacturingRecipeHasBlueprint(state, recipe) {
  if (!recipe || recipe.requiresBlueprint !== true) return true;
  if (isProbeBlueprintRecipe(recipe)) {
    return (typeof hasBlueprintAvailable === "function")
      ? hasBlueprintAvailable(state, getManufacturingBlueprintKey(recipe))
      : false;
  }
  return hasEquipmentBlueprintFromState(state, recipe.id);
}

// BPC 配方本次结算最多可完成的周期数（受剩余流程次数限制；非 BPC 配方无限制）
function manufacturingMaxCyclesByBlueprint(state, recipe) {
  if (!isProbeBlueprintRecipe(recipe)) return Infinity;
  return (typeof getBlueprintRuns === "function")
    ? getBlueprintRuns(state, getManufacturingBlueprintKey(recipe)) : 0;
}

// 预留（消耗）cycles 个流程。非 BPC 配方恒 true。
// 返回 false = 流程不足，调用方必须零副作用停止（此时尚未扣料、尚未产出，故无需退还逻辑）。
// 原子性（全有或全无）：可用流程不足时**一个都不扣**——
// 若直接调用 reserveBlueprintRuns，它会按存量部分预留，失败时白扣掉剩余流程。
function manufacturingReserveBlueprintRuns(state, recipe, cycles) {
  if (!isProbeBlueprintRecipe(recipe)) return true;
  const want = Math.max(1, Math.floor(Number(cycles) || 1));
  if (typeof getBlueprintRuns !== "function" || typeof reserveBlueprintRuns !== "function") return false;
  if (getBlueprintRuns(state, getManufacturingBlueprintKey(recipe)) < want) return false;
  return reserveBlueprintRuns(state, getManufacturingBlueprintKey(recipe), want) === want;
}

window.isProbeBlueprintRecipe = isProbeBlueprintRecipe;
window.getManufacturingBlueprintKey = getManufacturingBlueprintKey;
window.manufacturingRecipeHasBlueprint = manufacturingRecipeHasBlueprint;
window.manufacturingMaxCyclesByBlueprint = manufacturingMaxCyclesByBlueprint;
window.manufacturingReserveBlueprintRuns = manufacturingReserveBlueprintRuns;

function getEquipmentBlueprintSourceHint(equipment) {
  if (!equipment) return "蓝图商店购买";
  if (equipment.archaeology === true) return "考古探索获取蓝图";
  if (equipment.sourceDeathspaceId) return "深空清剿蓝图商店购买";
  if (equipment.sourceZoneId) return "星带蓝图商店购买";
  return "蓝图商店购买";
}

window.getEquipmentBlueprintSourceHint = getEquipmentBlueprintSourceHint;

function getLPStoreCatalogItems() {
  const equipmentItems = Object.values(EQUIPMENT_DB)
    .filter(equipment => equipment.storeOnly && equipment.lpPrice > 0)
    .map(equipment => ({ ...equipment, kind:"equipment", equipmentId:equipment.id }));
  return [...LP_STORE_BLUEPRINTS, ...STAR_BELT_EQUIPMENT_BLUEPRINTS, ...DEATHSPACE_EQUIPMENT_BLUEPRINTS, ...equipmentItems];
}

function getLPStoreCatalogItem(itemId) {
  return getLPStoreCatalogItems().find(item => item.id === itemId) || null;
}

function getBlueprintStoreCatalogItems() {
  const shipItems = SHIP_BLUEPRINTS.map(blueprint => ({
    ...blueprint, kind:"shipBlueprint", name:blueprint.name + "蓝图", blueprintId:blueprint.id,
    category:"ships", price:blueprint.costLP || blueprint.costISK || 0, currency:blueprint.costLP ? "lp" : "isk",
    description:blueprint.description || "永久解锁舰船制造配方"
  }));
  const equipmentItems = getLPStoreCatalogItems()
    .filter(item => item.kind === "equipmentBlueprint")
    .map(item => ({
      ...item, price:item.lpPrice, currency:"lp",
      category:item.deathspaceTier ? "deathspace-" + item.deathspaceTier : EQUIPMENT_DB[item.equipmentId].faction === "alliance" ? "alliance" : "faction"
    }));
  // 势力探针限次抄本（BPC）：consumable = 可重复购买（流程用尽后允许再买），按流程数线性计价
  const probeItems = FACTION_PROBE_BLUEPRINTS.map(bp => ({
    id:bp.id, name:bp.name, kind:"probeBlueprint", blueprintId:"probe:" + bp.recipeId,
    recipeId:bp.recipeId, level:bp.level,
    category:"probes", price:bp.perRunPrice, perRunPrice:bp.perRunPrice, currency:"lp",
    consumable:true, maxRunsPerPurchase:PROBE_BLUEPRINT_MAX_RUNS_PER_PURCHASE,
    description:"限次抄本（BPC）：按流程数购买，1 流程 = 1 生产周期 = 20 枚；流程用尽后抄本消失，可再次购买。"
  }));
  return [...shipItems, ...equipmentItems, ...probeItems];
}

function getEquipmentRecipeCategory(equipment) {
  if (equipment.slot === "rig") return "rigs";
  if (equipment.archaeology) return "archaeology";
  if (equipment.combat && equipment.combat.kind === "weapon") return "weapons";
  // 损伤控制单元（damageControl）属防御类，归「防御维修」；与护盾扩展/回充器/装甲维修器同标签。
  if ((equipment.combat && (equipment.combat.kind === "repair" || equipment.combat.kind === "damageControl")) || equipment.id === "shield_ext_small") return "defense";
  if (equipment.id.includes("drone")) return "drones";
  // 工业采集类按功能细分为三个顶层分类：采矿装备 / 采气装备 / 采集增益
  if (equipment.slot === "high") {
    if (equipment.bonuses && equipment.bonuses.miningEfficiency) return "mining";
    if (equipment.bonuses && equipment.bonuses.gasEfficiency) return "gas";
  }
  if (equipment.slot === "low" && equipment.bonuses && (equipment.bonuses.miningLaserEfficiency || equipment.bonuses.gasLaserEfficiency || equipment.bonuses.salvageEfficiency)) return "collect_boost";
  return "mining";
}

// 装备工程三级标签：根据配方判定其所属三级子分类（仅 weapons/defense/collect_boost/archaeology 启用）。
// 返回值须与 EQUIPMENT_ENGINEERING_SUBTABS[category.id] 中的某个子标签 id 一致；不匹配任何细分则返回 "all"。
function getEquipEngSubtabId(recipe) {
  const eq = EQUIPMENT_DB[recipe.id];
  if (!eq) return "all";
  switch (recipe.category) {
    case "weapons":
      return (eq.combat && eq.combat.weaponType) || "all";
    case "defense":
      if (eq.combat && eq.combat.kind === "damageControl") return "damageControl";
      if (eq.id === "shield_ext_small") return "shield";
      if (eq.combat && eq.combat.kind === "repair") return eq.combat.target || "all";
      return "all";
    case "collect_boost":
      if (eq.bonuses) {
        if (typeof eq.bonuses.miningLaserEfficiency === "number") return "mining";
        if (typeof eq.bonuses.gasLaserEfficiency === "number") return "gas";
        if (typeof eq.bonuses.salvageEfficiency === "number") return "salvage";
      }
      return "all";
    case "archaeology":
      if (eq.bonuses) {
        if (typeof eq.bonuses.archaeologyScan === "number") return "analyzer";
        if (typeof eq.bonuses.archaeologyStabilizer === "number") return "stabilizer";
        if (typeof eq.bonuses.archaeologyDecoder === "number") return "decoder";
      }
      return "all";
    default:
      return "all";
  }
}

// 装备蓝图来源提示：基于权威目录判定，不再用 recipe.faction / sourceZoneId 猜测来源。
// recipe 为 EQUIPMENT_RECIPES 展平副本，携带 category / sourceDeathspaceId / sourceZoneId / faction。
// 判定优先级：深空清剿 → 考古勘探 → 货柜 → 蓝图商店(LP) → 未知（绝不默认考古掉落）。
// 货柜与 LP 商店均运行时只读权威常量，不复制第二份目录、不修改配方或 gameState。

// 权威货柜蓝图装备 ID 集合（懒构建，兼容 cargo.js 加载顺序 / TDZ / 常量不可用的情况）。
const BLUEPRINT_PREFIX = "blueprint:";
let _cargoBlueprintEquipmentIds = null;
function getCargoBlueprintEquipmentIds() {
  if (_cargoBlueprintEquipmentIds) return _cargoBlueprintEquipmentIds;
  // 权威货柜目录暂时不可用（TDZ / 加载顺序 / 常量缺失）：安全返回临时空集，
  // 不永久缓存，等目录可用后下一次调用再构建并缓存。
  if (typeof CARGO_BLUEPRINT_BY_SIZE === "undefined" || !CARGO_BLUEPRINT_BY_SIZE) {
    return new Set();
  }
  const ids = new Set();
  for (const size in CARGO_BLUEPRINT_BY_SIZE) {
    const entries = CARGO_BLUEPRINT_BY_SIZE[size];
    if (!Array.isArray(entries)) continue;
    for (const e of entries) {
      if (e && typeof e.id === "string") {
        // 货柜条目 id 形如 "blueprint:<equipmentId>"，剥离前缀得到装备 ID。
        const eqId = e.id.startsWith(BLUEPRINT_PREFIX) ? e.id.slice(BLUEPRINT_PREFIX.length) : e.id;
        if (eqId) ids.add(eqId);
      }
    }
  }
  _cargoBlueprintEquipmentIds = ids;
  return ids;
}

// 权威 LP 商店装备蓝图 ID 集合：蓝图商店实际在售装备（银河联盟 + 星带势力 + 深空清剿三类），
// 由本文件既有权威数组汇总，杜绝用 recipe.faction / sourceZoneId 猜测。
const LP_STORE_EQUIPMENT_IDS = (function () {
  const ids = new Set();
  const add = (arr) => { if (Array.isArray(arr)) for (const it of arr) if (it && it.equipmentId) ids.add(it.equipmentId); };
  add(LP_STORE_BLUEPRINTS);
  add(STAR_BELT_EQUIPMENT_BLUEPRINTS);
  add(DEATHSPACE_EQUIPMENT_BLUEPRINTS);
  return ids;
})();

function getEquipmentBlueprintSourceHint(recipe) {
  if (!recipe || !recipe.id) return "获取蓝图";
  if (recipe.sourceDeathspaceId) return "深空清剿蓝图商店购买";
  if (recipe.category === "archaeology") return "考古勘探获取蓝图";
  if (getCargoBlueprintEquipmentIds().has(recipe.id)) return "开启货柜获取蓝图";
  if (LP_STORE_EQUIPMENT_IDS.has(recipe.id)) return "在蓝图商店用功勋购买蓝图";
  return "获取蓝图";
}

const EQUIPMENT_RECIPES = Object.values(EQUIPMENT_DB).filter(eq => !eq.storeOnly).map(eq => ({
  id:eq.id, name:eq.name, level:eq.level, time:eq.time, xp:eq.xp,
  cost:eq.cost, slot:eq.slot, faction:eq.faction || "", requiresBlueprint:Boolean(eq.requiresBlueprint),
  inputEquipment:eq.inputEquipment ? { ...eq.inputEquipment } : null,
  deathspaceTier:eq.deathspaceTier || null, deathspaceVariant:eq.deathspaceVariant || "", sourceDeathspaceId:eq.sourceDeathspaceId || "", sourceZoneId:eq.sourceZoneId || "",
  stackGroup:eq.stackGroup || null, rigCategory:eq.rigCategory || "", rigTier:eq.rigTier || "",
  category:getEquipmentRecipeCategory(eq)
}));

const EQUIPMENT_SLOT_NAMES = { high:"高槽", mid:"中槽", low:"低槽", rig:"改装槽" };
const EQUIPMENT_BONUS_NAMES = {
  miningEfficiency:"采矿效率",
  gasEfficiency:"气体采集效率",
  miningBonus:"采矿总加成",
  gasBonus:"气体采集总加成",
  miningLaserEfficiency:"采矿激光器效果",
  gasLaserEfficiency:"气云采集器效果",
  salvageEfficiency:"打捞效率",
  shieldCapacity:"护盾容量",
  shieldCapacityPercent:"护盾容量",
  armorCapacityPercent:"装甲容量",
  structureCapacityPercent:"结构容量",
  smeltingSpeed:"冶炼速度",
  archaeologyScan:"扫描强度",
  archaeologyScanPercent:"扫描强度",
  archaeologyStabilizer:"失败反噬减免",
  archaeologyDecoder:"稀有发现掉率加成",
  archaeologyCycleReduction:"考古周期缩短",
  archaeologyCycleReductionPercent:"考古周期缩短",
  archaeologyNonFatalAvoid:"非致命免伤",
  archaeologyCopyChance:"货柜额外掉落",
  archaeologyFuelEfficiency:"电容回充",
  archaeologyInterferenceReduction:"考古干扰缩短",
  miningRichChance:"伴生富集触发",
  gasRichChance:"伴生富集触发",
  globalDamageReduction:"全局减伤",
  shieldRepair:"护盾维修量",
  armorRepair:"装甲维修量",
  structureRepair:"结构维修量"
};
// rig 百分比减免类：以正数存储，展示为 -X%
const RIG_REDUCTION_BONUS_KEYS = ["archaeologyInterferenceReduction", "archaeologyCycleReductionPercent"];
const RIG_PERCENT_BONUS_KEYS = ["shieldCapacityPercent","armorCapacityPercent","structureCapacityPercent","smeltingSpeed","archaeologyScanPercent","archaeologyFuelEfficiency","miningRichChance","gasRichChance"];

const ARCHAEOLOGY_REDUCTION_BONUS_KEYS = ["archaeologyStabilizer", "archaeologyCycleReduction"];
const ARCHAEOLOGY_PERCENT_BONUS_KEYS = ["archaeologyDecoder", "archaeologyNonFatalAvoid", "archaeologyCopyChance"];
const REPAIR_PERCENT_BONUS_KEYS = ["globalDamageReduction", "shieldRepair", "armorRepair", "structureRepair"];

function formatEquipmentBonusValue(key, value) {
  if (["miningEfficiency","gasEfficiency","miningBonus","gasBonus","miningLaserEfficiency","gasLaserEfficiency","salvageEfficiency"].includes(key)) {
    return "+" + (value * 100).toFixed(value * 100 % 1 === 0 ? 0 : 1) + "%";
  }
  if (RIG_REDUCTION_BONUS_KEYS.includes(key) || ARCHAEOLOGY_REDUCTION_BONUS_KEYS.includes(key)) {
    return "-" + (value * 100).toFixed(value * 100 % 1 === 0 ? 0 : 1) + "%";
  }
  if (RIG_PERCENT_BONUS_KEYS.includes(key) || ARCHAEOLOGY_PERCENT_BONUS_KEYS.includes(key)) {
    return "+" + (value * 100).toFixed(value * 100 % 1 === 0 ? 0 : 1) + "%";
  }
  if (REPAIR_PERCENT_BONUS_KEYS.includes(key)) {
    return "+" + (value * 100).toFixed(value * 100 % 1 === 0 ? 0 : 1) + "%";
  }
  return "+" + value;
}

function getEquipmentAttributeLines(equipmentRef) {
  const eq = typeof equipmentRef === "string" ? EQUIPMENT_DB[equipmentRef] : equipmentRef;
  if (!eq) return [];
  const lines = ["槽位：" + (EQUIPMENT_SLOT_NAMES[eq.slot] || eq.slot)];
  for (const [key, value] of Object.entries(eq.bonuses || {})) {
    lines.push((EQUIPMENT_BONUS_NAMES[key] || key) + " " + formatEquipmentBonusValue(key, value));
  }
  if (eq.combat && eq.combat.kind === "weapon") {
    const weaponNames = { laser:"激光", missile:"导弹", cannon:"射弹" };
    lines.push("武器类型：" + (weaponNames[eq.combat.weaponType] || eq.combat.weaponType));
    lines.push("基础伤害：" + eq.combat.baseDamage);
    lines.push("每轮消耗：燃料 " + eq.combat.fuelCost + " / 弹药 " + eq.combat.ammoCost);
    if (eq.combat.aoe && eq.combat.aoe.description) lines.push(eq.combat.aoe.description);
  } else if (eq.combat && eq.combat.kind === "repair") {
    const targetNames = { shield:"护盾", armor:"装甲", structure:"结构" };
    lines.push("自动维修：" + (targetNames[eq.combat.target] || eq.combat.target) + " +" + eq.combat.amount);
    lines.push("触发消耗：燃料 " + eq.combat.fuelCost);
  }
  // 适用舰体（旗舰限定）由 shipTypes 数据驱动：覆盖战斗/工业所有限定件，不再硬编码且不再漏工业旗舰
  const shipFlag = getShipTypesFlag(eq.shipTypes);
  if (shipFlag) lines.push("适用舰体：" + shipFlag.label);
  if (eq.bonuses && typeof eq.bonuses.salvageEfficiency === "number") {
    lines.push("被动：消耗燃料（" + (eq.salvageFuelPerKill || 0) + "/艘）提高货柜掉落。");
    lines.push("主动：消耗被动三倍燃料及同位素，有几率获得与击毁舰船同级舰船组件（几率按打捞效率计算）");
  }
  // 装备描述（rig 等带 description 字段时追加为独立行，供仓库卡片/详情弹窗展示）
  if (eq.description) lines.push(eq.description);
  return lines;
}

function getEquipmentAttributeText(equipmentRef, separator) {
  return getEquipmentAttributeLines(equipmentRef).join(separator || " · ");
}

// 旗舰限定角标：由 shipTypes 数据驱动（非名字判定）。返回 {kind,label} 或 null。
// kind: "combat"（战斗/考古旗舰） | "ind"（工业旗舰）；label 用于提示文案。
function getShipTypesFlag(shipTypes) {
  if (!Array.isArray(shipTypes) || shipTypes.length === 0) return null;
  const combat = shipTypes.includes("capital") || shipTypes.includes("supercapital");
  const ind = shipTypes.includes("industrial_capital");
  const archaeologyCapital = shipTypes.includes("archaeology_capital");
  // 全档考古舰型（护卫/驱逐/巡洋/战列）存在 → 适配全部考古舰，而非仅旗舰
  const archaeologyAll = shipTypes.some(function (t) {
    return t === "archaeology_frigate" || t === "archaeology_destroyer" ||
           t === "archaeology_cruiser" || t === "archaeology_battleship";
  });
  if (!combat && !ind && !archaeologyCapital && !archaeologyAll) return null;
  const parts = [];
  if (combat) parts.push("战斗旗舰 / 超级旗舰");
  if (ind) parts.push("工业旗舰");
  if (archaeologyCapital && !archaeologyAll) parts.push("考古旗舰");
  if (archaeologyAll) parts.push("考古舰");
  const kind = (combat || archaeologyCapital || archaeologyAll) ? "combat" : "ind";
  return { kind, label: parts.join(" / "), archaeologyAll: archaeologyAll };
}

// 返回角标 HTML（受控字符串，内容由上方数据生成，不含外部输入）。
// variant: "cargo"（仓库大卡/强化列表，右上角带文字） | "ee"（装备工程小卡，左上角纯图标小药丸）。
// 不含 tabindex：角标可能嵌在 <button>（装备工程卡）内，嵌套可聚焦元素属无效 HTML；
// 移动端点按提示由全局委托（toggle .tap-open）实现，桌面由 :hover 实现。
function getShipTypesFlagBadge(shipTypes, variant) {
  const f = getShipTypesFlag(shipTypes);
  if (!f) return "";
  const isInd = f.kind === "ind";
  const icon = isInd ? "🏭" : "🚩";
  const tip = "仅可装备于：<b>" + f.label + "</b>";
  if (variant === "ee") {
    return '<span class="ee-flag ' + f.kind + '">' + icon + '<span class="tip">' + tip + "</span></span>";
  }
  let text;
  if (isInd) text = "工业旗舰";
  else if (f.archaeologyAll && !shipTypes.includes("capital")) text = "考古舰";
  else if (shipTypes.includes("capital") && shipTypes.includes("archaeology_capital")) text = "战斗/考古旗舰";
  else if (shipTypes.includes("archaeology_capital")) text = "考古旗舰";
  else text = "战斗旗舰";
  return '<span class="flag-badge ' + f.kind + '">' + icon + " " + text + '<span class="tip">' + tip + "</span></span>";
}

const DEFAULT_COMBAT_FITTINGS = {
  rifter:  { high:["t1_small_laser"], mid:["t1_shield_booster"], low:[], rig:[] },
  kestrel: { high:["t1_light_missile_launcher"], mid:[], low:["t1_armor_repairer"], rig:[] },
  atron:   { high:["t1_small_cannon"], mid:[], low:["t1_structure_repairer"], rig:[] }
};

function getDefaultCombatFitting(shipId) {
  const fitting = DEFAULT_COMBAT_FITTINGS[shipId] || { high:[], mid:[], low:[], rig:[] };
  return {
    high: fitting.high.slice(), mid: fitting.mid.slice(),
    low: fitting.low.slice(), rig: fitting.rig.slice()
  };
}
