// ---- 装备工程：T1装备数据库（参照20260712细化） ----
const EQUIPMENT_DB = {
  // 高槽装备
  "t1_mining_laser":  { id:"t1_mining_laser",  name:"T1采矿激光器",  slot:"high", level:1, time:15, xp:8,  cost:{"三钛合金":20,"类银超金属":10}, bonuses:{miningEfficiency:0.05} },
  "t1_gas_harvester": { id:"t1_gas_harvester", name:"T1气云采集器",  slot:"high", level:1, time:15, xp:8,  cost:{"三钛合金":20,"粗制富勒烯":6},   bonuses:{gasEfficiency:0.05} },
  "t2_mining_laser":  { id:"t2_mining_laser",  name:"中型采矿激光器",  slot:"high", level:15, time:35, xp:20, cost:{"三钛合金":80,"类银超金属":30,"类晶体胶矿":10}, bonuses:{miningEfficiency:0.15} },
  "t2_gas_harvester": { id:"t2_gas_harvester", name:"中型气云采集器",  slot:"high", level:15, time:35, xp:20, cost:{"三钛合金":80,"稳定富勒烯":10}, bonuses:{gasEfficiency:0.15} },
  "raider_mining_laser": { id:"raider_mining_laser", name:"联盟采矿激光器", slot:"high", level:25, time:45, xp:30, cost:{"三钛合金":120,"类银超金属":48}, bonuses:{miningEfficiency:0.20}, faction:"alliance", requiresBlueprint:true },
  "raider_gas_harvester": { id:"raider_gas_harvester", name:"联盟气云采集器", slot:"high", level:25, time:45, xp:30, cost:{"三钛合金":120,"稳定富勒烯":15}, bonuses:{gasEfficiency:0.20}, faction:"alliance", requiresBlueprint:true },
  "angel_mining_laser": { id:"angel_mining_laser", name:"苍穹劫团联合采矿激光器", slot:"high", level:25, time:45, xp:30, cost:{"三钛合金":100,"类银超金属":40,"苍穹劫团装备生产许可C":5}, bonuses:{miningEfficiency:0.20}, faction:"angel", sourceZoneId:"angel_corridor", requiresBlueprint:true },
  "angel_gas_harvester": { id:"angel_gas_harvester", name:"苍穹劫团联合气云采集器", slot:"high", level:25, time:45, xp:30, cost:{"三钛合金":100,"稳定富勒烯":12,"苍穹劫团装备生产许可C":5}, bonuses:{gasEfficiency:0.20}, faction:"angel", sourceZoneId:"angel_corridor", requiresBlueprint:true },
  "t3_mining_laser":  { id:"t3_mining_laser",  name:"重型采矿激光器",  slot:"high", level:35, time:60, xp:40, cost:{"三钛合金":200,"类银超金属":80,"同位聚合体":20,"重金属":10}, bonuses:{miningEfficiency:0.30} },
  "t3_gas_harvester": { id:"t3_gas_harvester", name:"重型气云采集器",  slot:"high", level:35, time:60, xp:40, cost:{"三钛合金":200,"稳定富勒烯":8,"氦同位素":5}, bonuses:{gasEfficiency:0.30} },
  "t4_mining_laser":  { id:"t4_mining_laser",  name:"大型采矿激光器",  slot:"high", level:55, time:100, xp:75, cost:{"三钛合金":500,"超新星诺克石":30,"铷":2,"等离子体":15}, bonuses:{miningEfficiency:0.50} },
  "t4_gas_harvester": { id:"t4_gas_harvester", name:"大型气云采集器",  slot:"high", level:55, time:100, xp:75, cost:{"三钛合金":500,"聚合气体":5,"氢同位素":5}, bonuses:{gasEfficiency:0.50} },
  "t5_mining_laser":  { id:"t5_mining_laser",  name:"旗舰采矿激光器",  slot:"high", level:80, time:180, xp:130, cost:{"三钛合金":1200,"超噬矿":20,"铷":10,"磁场聚合物":30}, bonuses:{miningEfficiency:0.80} },
  "t5_gas_harvester": { id:"t5_gas_harvester", name:"旗舰气云采集器",  slot:"high", level:80, time:180, xp:130, cost:{"三钛合金":1200,"超纯聚合气体":3,"铷":5}, bonuses:{gasEfficiency:0.80} },
  "t1_small_laser": { id:"t1_small_laser", name:"小型激光炮 I", slot:"high", level:1, time:20, xp:12, cost:{"三钛合金":45,"类晶体胶矿":12}, bonuses:{}, combat:{kind:"weapon",weaponType:"laser",baseDamage:120,baseHit:100,fuelCost:3,ammoCost:1} },
  "t1_light_missile_launcher": { id:"t1_light_missile_launcher", name:"轻型导弹发射器 I", slot:"high", level:1, time:20, xp:12, cost:{"三钛合金":45,"类银超金属":12}, bonuses:{}, combat:{kind:"weapon",weaponType:"missile",baseDamage:100,baseHit:130,fuelCost:1,ammoCost:1} },
  "t1_small_cannon": { id:"t1_small_cannon", name:"小型射弹炮 I", slot:"high", level:1, time:20, xp:12, cost:{"三钛合金":45,"同位聚合体":10}, bonuses:{}, combat:{kind:"weapon",weaponType:"cannon",baseDamage:80,baseHit:80,fuelCost:2,ammoCost:1} },
  "t1_medium_laser": { id:"t1_medium_laser", name:"中型激光炮 I", slot:"high", level:35, time:45, xp:35, cost:{"三钛合金":150,"类晶体胶矿":40,"同位聚合体":10,"同位素":5}, bonuses:{}, combat:{kind:"weapon",weaponType:"laser",baseDamage:240,baseHit:100,fuelCost:6,ammoCost:1} },
  "t1_heavy_missile_launcher": { id:"t1_heavy_missile_launcher", name:"重型导弹发射器 I", slot:"high", level:35, time:45, xp:35, cost:{"三钛合金":150,"类银超金属":40,"同位聚合体":10,"稀有气体":8}, bonuses:{}, combat:{kind:"weapon",weaponType:"missile",baseDamage:200,baseHit:130,fuelCost:2,ammoCost:1} },
  "t1_medium_cannon": { id:"t1_medium_cannon", name:"中型射弹炮 I", slot:"high", level:35, time:45, xp:35, cost:{"三钛合金":150,"同位聚合体":35,"重金属":8}, bonuses:{}, combat:{kind:"weapon",weaponType:"cannon",baseDamage:160,baseHit:80,fuelCost:4,ammoCost:1} },
  "t1_large_laser": { id:"t1_large_laser", name:"大型激光炮 I", slot:"high", level:55, time:70, xp:55, cost:{"三钛合金":300,"同位聚合体":50,"超新星诺克石":15,"等离子体":8}, bonuses:{}, combat:{kind:"weapon",weaponType:"laser",baseDamage:480,baseHit:100,fuelCost:12,ammoCost:1} },
  "t1_cruise_missile_launcher": { id:"t1_cruise_missile_launcher", name:"巡航导弹发射器 I", slot:"high", level:55, time:70, xp:55, cost:{"三钛合金":300,"类银超金属":100,"超新星诺克石":15,"稀有气体":12}, bonuses:{}, combat:{kind:"weapon",weaponType:"missile",baseDamage:400,baseHit:130,fuelCost:4,ammoCost:1} },
  "t1_large_cannon": { id:"t1_large_cannon", name:"大型射弹炮 I", slot:"high", level:55, time:70, xp:55, cost:{"三钛合金":300,"同位聚合体":70,"超新星诺克石":12,"重金属":12}, bonuses:{}, combat:{kind:"weapon",weaponType:"cannon",baseDamage:320,baseHit:80,fuelCost:8,ammoCost:1} },
  "t1_capital_laser": { id:"t1_capital_laser", name:"旗舰级聚焦激光炮 I", slot:"high", level:80, time:180, xp:130, cost:{"三钛合金":500,"基腹断岩":12,"超噬矿":8,"铷":2,"等离子体":10}, bonuses:{}, shipTypes:["capital","supercapital"], combat:{kind:"weapon",weaponType:"laser",baseDamage:600,baseHit:100,fuelCost:15,ammoCost:1,aoe:{mode:"next",multiplier:0.30,maxTargets:1,description:"扫掠光束：下一目标受到30%最终伤害"}} },
  "t1_capital_missile_array": { id:"t1_capital_missile_array", name:"旗舰级巡航导弹阵列 I", slot:"high", level:80, time:180, xp:130, cost:{"三钛合金":500,"基腹断岩":10,"超噬矿":8,"铷":2,"超纯聚合气体":1,"磁场聚合物":8}, bonuses:{}, shipTypes:["capital","supercapital"], combat:{kind:"weapon",weaponType:"missile",baseDamage:500,baseHit:130,fuelCost:5,ammoCost:1,aoe:{mode:"all",multiplier:0.12,description:"扩散弹头：其他所有目标受到12%最终伤害"}} },
  "t1_capital_cannon": { id:"t1_capital_cannon", name:"旗舰级攻城射弹炮 I", slot:"high", level:80, time:180, xp:130, cost:{"三钛合金":500,"基腹断岩":12,"超噬矿":7,"铷":2,"重金属":12}, bonuses:{}, shipTypes:["capital","supercapital"], combat:{kind:"weapon",weaponType:"cannon",baseDamage:400,baseHit:80,fuelCost:10,ammoCost:1,aoe:{mode:"next",multiplier:0.15,maxTargets:2,description:"破片齐射：最多两个其他目标受到15%最终伤害"}} },
  // 中槽装备
  "t1_drone_control": { id:"t1_drone_control", name:"T1无人机控制单元", slot:"mid", level:1, time:20, xp:10, cost:{"三钛合金":25,"类银超金属":8}, bonuses:{miningEfficiency:0.02,gasEfficiency:0.02} },
  "t2_drone_link": { id:"t2_drone_link", name:"协同无人机指挥链路", slot:"mid", level:15, time:35, xp:20, cost:{"三钛合金":100,"类银超金属":35,"类晶体胶矿":10,"稳定富勒烯":5}, bonuses:{miningEfficiency:0.05,gasEfficiency:0.05} },
  "t3_drone_link": { id:"t3_drone_link", name:"高级无人机指挥链路", slot:"mid", level:35, time:60, xp:40, cost:{"三钛合金":250,"类银超金属":90,"同位聚合体":20,"稳定富勒烯":5,"稀有气体":10}, bonuses:{miningEfficiency:0.10,gasEfficiency:0.10} },
  "blood_servant_drone_link": { id:"blood_servant_drone_link", name:"赤誓仆从无人机指挥链路", slot:"mid", level:45, time:75, xp:55, cost:{"三钛合金":350,"类银超金属":120,"同位聚合体":20,"赤誓教团装备生产许可B":8}, bonuses:{miningEfficiency:0.12,gasEfficiency:0.12}, faction:"blood", sourceZoneId:"blood_cathedral", requiresBlueprint:true },
  "blood_servant_drone_link_sacrifice": { id:"blood_servant_drone_link_sacrifice", name:"赤誓仆从无人机指挥链路·献祭型", slot:"mid", level:25, time:45, xp:30, cost:{"三钛合金":150,"类银超金属":50,"同位聚合体":10,"赤誓教团装备生产许可C":5}, bonuses:{miningEfficiency:0.13,gasEfficiency:0.13}, faction:"blood", requiresBlueprint:true },
  "alliance_drone_link": { id:"alliance_drone_link", name:"联盟无人机指挥链路", slot:"mid", level:45, time:75, xp:55, cost:{"三钛合金":420,"类银超金属":144,"同位聚合体":24}, bonuses:{miningEfficiency:0.12,gasEfficiency:0.12}, faction:"alliance", requiresBlueprint:true },
  "t4_drone_link": { id:"t4_drone_link", name:"深空无人机指挥链路", slot:"mid", level:55, time:100, xp:75, cost:{"三钛合金":600,"超新星诺克石":25,"铷":2,"等离子体":15}, bonuses:{miningEfficiency:0.16,gasEfficiency:0.16} },
  "t5_drone_core": { id:"t5_drone_core", name:"旗舰无人机指挥核心", slot:"mid", level:80, time:180, xp:130, cost:{"三钛合金":1400,"超噬矿":20,"铷":8,"超纯聚合气体":2,"磁场聚合物":30}, bonuses:{miningEfficiency:0.25,gasEfficiency:0.25} },
  "shield_ext_small":  { id:"shield_ext_small",  name:"小型护盾扩展",   slot:"mid", level:1, time:15, xp:6,  cost:{"三钛合金":50,"类银超金属":20},  bonuses:{shieldCapacity:50} },
  "t1_shield_booster": { id:"t1_shield_booster", name:"小型护盾回充器 I", slot:"mid", level:1, time:18, xp:10, cost:{"三钛合金":35,"类银超金属":15}, bonuses:{}, combat:{kind:"repair",target:"shield",amount:30,fuelCost:1} },
  "t1_medium_shield_booster": { id:"t1_medium_shield_booster", name:"中型护盾回充器 I", slot:"mid", level:35, time:42, xp:30, cost:{"三钛合金":120,"类银超金属":40,"同位素":8}, bonuses:{}, combat:{kind:"repair",target:"shield",amount:60,fuelCost:2} },
  "t1_large_shield_booster": { id:"t1_large_shield_booster", name:"大型护盾回充器 I", slot:"mid", level:55, time:65, xp:50, cost:{"三钛合金":240,"类银超金属":80,"超新星诺克石":10,"同位素":12}, bonuses:{}, combat:{kind:"repair",target:"shield",amount:120,fuelCost:4} },
  // 低槽装备
  "t1_armor_repairer": { id:"t1_armor_repairer", name:"小型装甲维修器 I", slot:"low", level:1, time:18, xp:10, cost:{"三钛合金":35,"同位聚合体":12}, bonuses:{}, combat:{kind:"repair",target:"armor",amount:20,fuelCost:1} },
  "t1_structure_repairer": { id:"t1_structure_repairer", name:"小型结构修理器 I", slot:"low", level:1, time:18, xp:10, cost:{"三钛合金":40,"类银超金属":8,"同位聚合体":8}, bonuses:{}, combat:{kind:"repair",target:"structure",amount:10,fuelCost:3} },
  "t1_medium_armor_repairer": { id:"t1_medium_armor_repairer", name:"中型装甲维修器 I", slot:"low", level:35, time:42, xp:30, cost:{"三钛合金":120,"同位聚合体":35,"重金属":10}, bonuses:{}, combat:{kind:"repair",target:"armor",amount:40,fuelCost:2} },
  "t1_medium_structure_repairer": { id:"t1_medium_structure_repairer", name:"中型结构修理器 I", slot:"low", level:35, time:42, xp:30, cost:{"三钛合金":130,"类银超金属":25,"同位聚合体":25,"稀有气体":6}, bonuses:{}, combat:{kind:"repair",target:"structure",amount:20,fuelCost:6} },
  "t1_large_armor_repairer": { id:"t1_large_armor_repairer", name:"大型装甲维修器 I", slot:"low", level:55, time:65, xp:50, cost:{"三钛合金":240,"同位聚合体":50,"超新星诺克石":10,"重金属":14}, bonuses:{}, combat:{kind:"repair",target:"armor",amount:80,fuelCost:4} },
  "t1_large_structure_repairer": { id:"t1_large_structure_repairer", name:"大型结构修理器 I", slot:"low", level:55, time:65, xp:50, cost:{"三钛合金":260,"类银超金属":50,"超新星诺克石":12,"稀有气体":10}, bonuses:{}, combat:{kind:"repair",target:"structure",amount:40,fuelCost:12} },
  "t1_capital_shield_array": { id:"t1_capital_shield_array", name:"旗舰级护盾回充阵列 I", slot:"mid", level:80, time:160, xp:110, cost:{"三钛合金":400,"基腹断岩":8,"超噬矿":6,"铷":1,"同位素":8,"磁场聚合物":8}, bonuses:{}, shipTypes:["capital","supercapital"], combat:{kind:"repair",target:"shield",amount:150,fuelCost:5} },
  "t1_capital_armor_array": { id:"t1_capital_armor_array", name:"旗舰级装甲维修阵列 I", slot:"low", level:80, time:160, xp:110, cost:{"三钛合金":400,"基腹断岩":9,"超噬矿":6,"铷":1,"重金属":10,"等离子体":6}, bonuses:{}, shipTypes:["capital","supercapital"], combat:{kind:"repair",target:"armor",amount:100,fuelCost:5} },
  "t1_capital_structure_array": { id:"t1_capital_structure_array", name:"旗舰级结构修复阵列 I", slot:"low", level:80, time:160, xp:110, cost:{"三钛合金":400,"基腹断岩":8,"超噬矿":7,"铷":1,"稀有气体":8,"磁场聚合物":6}, bonuses:{}, shipTypes:["capital","supercapital"], combat:{kind:"repair",target:"structure",amount:50,fuelCost:15} },
  "t1_mining_booster": { id:"t1_mining_booster", name:"T1采矿提升器",  slot:"low", level:10,time:20, xp:12, cost:{"三钛合金":50,"类银超金属":20}, bonuses:{miningLaserEfficiency:0.10} },
  "t2_mining_booster": { id:"t2_mining_booster", name:"中型采矿提升器", slot:"low", level:15,time:35, xp:20, cost:{"三钛合金":160,"类银超金属":60,"类晶体胶矿":15}, bonuses:{miningLaserEfficiency:0.30} },
  "t3_mining_booster": { id:"t3_mining_booster", name:"重型采矿提升器", slot:"low", level:35,time:60, xp:40, cost:{"三钛合金":400,"类银超金属":150,"同位聚合体":30,"重金属":15}, bonuses:{miningLaserEfficiency:0.50} },
  "t4_mining_booster": { id:"t4_mining_booster", name:"大型采矿提升器", slot:"low", level:55,time:110,xp:80, cost:{"三钛合金":900,"超新星诺克石":45,"铷":4,"等离子体":25}, bonuses:{miningLaserEfficiency:0.70} },
  "sansha_mineral_assimilation": { id:"sansha_mineral_assimilation", name:"矿物同化注入器", slot:"low", level:65,time:130,xp:95, cost:{"三钛合金":1100,"超新星诺克石":50,"铷":5,"等离子体":25,"静默集群装备生产许可A":10}, bonuses:{miningLaserEfficiency:0.80}, faction:"sansha", sourceZoneId:"sansha_command_matrix", shipTypes:["industrial_capital"], requiresBlueprint:true },
  // ===== 新增星带势力生产装备（材料按档位分级：D=1.0-0.8 / C=0.7-0.5 / B=0.4-0.3 / A=0.2-0.1） =====
  "angel_mining_laser_outpost": { id:"angel_mining_laser_outpost", name:"苍穹劫团采矿激光器·前哨型", slot:"high", level:10, time:30, xp:15, cost:{"三钛合金":60,"类银超金属":20,"苍穹劫团装备生产许可D":3}, bonuses:{miningEfficiency:0.20}, faction:"angel", requiresBlueprint:true },
  "angel_mineral_assimilation_outpost": { id:"angel_mineral_assimilation_outpost", name:"苍穹劫团矿物同化注入器·前哨型", slot:"low", level:10, time:30, xp:15, cost:{"三钛合金":80,"类银超金属":20,"苍穹劫团装备生产许可D":3}, bonuses:{miningLaserEfficiency:0.35}, faction:"angel", requiresBlueprint:true },
  "angel_drone_link_war": { id:"angel_drone_link_war", name:"苍穹劫团无人机指挥链路·破阵型", slot:"mid", level:65, time:130, xp:95, cost:{"三钛合金":900,"超新星诺克石":35,"铷":2,"等离子体":20,"苍穹劫团装备生产许可A":10}, bonuses:{miningEfficiency:0.30,gasEfficiency:0.30,miningLaserEfficiency:0.30,gasLaserEfficiency:0.30}, faction:"angel", shipTypes:["industrial_capital"], requiresBlueprint:true },
  "blood_drone_link_sacrifice": { id:"blood_drone_link_sacrifice", name:"赤誓仆从无人机指挥链路·献祭型", slot:"mid", level:25, time:45, xp:30, cost:{"三钛合金":150,"类银超金属":50,"同位聚合体":10,"赤誓教团装备生产许可C":5}, bonuses:{miningEfficiency:0.08,gasEfficiency:0.08}, faction:"blood", sourceZoneId:"blood_sacrifice", requiresBlueprint:true },
  "blood_mining_laser_hunt": { id:"blood_mining_laser_hunt", name:"赤誓采矿激光器·猎杀型", slot:"high", level:45, time:75, xp:55, cost:{"三钛合金":300,"类银超金属":100,"同位聚合体":20,"重金属":15,"赤誓教团装备生产许可B":8}, bonuses:{miningEfficiency:0.60}, faction:"blood", requiresBlueprint:true },
  "blood_mineral_assimilation_nexus": { id:"blood_mineral_assimilation_nexus", name:"赤誓矿物同化注入器·枢纽型", slot:"low", level:45, time:75, xp:55, cost:{"三钛合金":600,"超新星诺克石":35,"铷":3,"等离子体":15,"赤誓教团装备生产许可B":8}, bonuses:{miningLaserEfficiency:0.85}, faction:"blood", requiresBlueprint:true },
  "blood_gas_harvester_iron": { id:"blood_gas_harvester_iron", name:"赤誓气云采集器·铁血型", slot:"high", level:65, time:130, xp:95, cost:{"三钛合金":700,"聚合气体":15,"氢同位素":10,"赤誓教团装备生产许可A":10}, bonuses:{gasEfficiency:0.90,gasLaserEfficiency:0.30}, faction:"blood", shipTypes:["industrial_capital"], requiresBlueprint:true },
  "sansha_mineral_assimilation_node": { id:"sansha_mineral_assimilation_node", name:"矿物同化注入器·节点型", slot:"low", level:25, time:45, xp:30, cost:{"三钛合金":300,"类银超金属":100,"同位聚合体":15,"静默集群装备生产许可C":5}, bonuses:{miningLaserEfficiency:0.55}, faction:"sansha", requiresBlueprint:true },
  "sansha_gas_harvester_nexus": { id:"sansha_gas_harvester_nexus", name:"静默气云采集器·枢纽型", slot:"high", level:45, time:75, xp:55, cost:{"三钛合金":300,"稳定富勒烯":15,"氦同位素":10,"静默集群装备生产许可B":8}, bonuses:{gasEfficiency:0.60}, faction:"sansha", requiresBlueprint:true },
  "sansha_mining_laser_war": { id:"sansha_mining_laser_war", name:"静默采矿激光器·破阵型", slot:"high", level:65, time:130, xp:95, cost:{"三钛合金":700,"超新星诺克石":40,"铷":4,"等离子体":20,"静默集群装备生产许可A":10}, bonuses:{miningEfficiency:0.90,miningLaserEfficiency:0.30}, faction:"sansha", shipTypes:["industrial_capital"], requiresBlueprint:true },
  "sansha_drone_link_outpost": { id:"sansha_drone_link_outpost", name:"静默无人机指挥链路·前哨型", slot:"mid", level:10, time:30, xp:15, cost:{"三钛合金":40,"类银超金属":15,"静默集群装备生产许可D":3}, bonuses:{miningEfficiency:0.08,gasEfficiency:0.08}, faction:"sansha", requiresBlueprint:true },

  "alliance_mineral_assimilation": { id:"alliance_mineral_assimilation", name:"联盟矿物同化注入器", slot:"low", level:65,time:130,xp:95, cost:{"三钛合金":1320,"超新星诺克石":60,"铷":6,"等离子体":30}, bonuses:{miningLaserEfficiency:0.80}, faction:"alliance", shipTypes:["industrial_capital"], requiresBlueprint:true },
  "t5_mining_booster": { id:"t5_mining_booster", name:"旗舰采矿提升核心", slot:"low", level:80,time:200,xp:150,cost:{"三钛合金":2000,"超噬矿":35,"铷":15,"磁场聚合物":50}, bonuses:{miningLaserEfficiency:0.90} },
  "t1_gas_booster":    { id:"t1_gas_booster",    name:"T1采气提升器",  slot:"low", level:10,time:20, xp:12, cost:{"三钛合金":50,"粗制富勒烯":20},  bonuses:{gasLaserEfficiency:0.10} },
  // ===== 采气提升器（对标采矿提升器，低槽 gasLaserEfficiency） =====
  "t2_gas_booster":    { id:"t2_gas_booster",    name:"中型采气提升器",  slot:"low", level:15,time:35,  xp:20,  cost:{"三钛合金":160, "稳定富勒烯":60,   "类晶体胶矿":15}, bonuses:{gasLaserEfficiency:0.30} },
  "t3_gas_booster":    { id:"t3_gas_booster",    name:"重型采气提升器",  slot:"low", level:35,time:60,  xp:40,  cost:{"三钛合金":400, "稳定富勒烯":150,  "同位聚合体":30,"重金属":15}, bonuses:{gasLaserEfficiency:0.50} },
  "t4_gas_booster":    { id:"t4_gas_booster",    name:"大型采气提升器",  slot:"low", level:55,time:110, xp:80,  cost:{"三钛合金":900, "聚合气体":45,     "铷":4,  "等离子体":25}, bonuses:{gasLaserEfficiency:0.70} },
  "t5_gas_booster":    { id:"t5_gas_booster",    name:"旗舰采气提升核心", slot:"low", level:80,time:200, xp:150, cost:{"三钛合金":2000,"超纯聚合气体":35, "铷":15, "磁场聚合物":50}, bonuses:{gasLaserEfficiency:0.90} },
  // ===== 势力采气提升器（对标势力采矿提升器，气体同化注入器系，需蓝图） =====
  "sansha_gas_assimilation":  { id:"sansha_gas_assimilation",  name:"静默气体同化注入器",       slot:"low", level:65,time:130,xp:95,  cost:{"三钛合金":1100,"聚合气体":50, "铷":5,"等离子体":25,"静默集群装备生产许可A":10}, bonuses:{gasLaserEfficiency:0.80}, faction:"sansha", sourceZoneId:"sansha_command_matrix", shipTypes:["industrial_capital"], requiresBlueprint:true },
  "angel_gas_assimilation_outpost": { id:"angel_gas_assimilation_outpost", name:"苍穹劫团气体同化注入器·前哨型", slot:"low", level:10,time:30, xp:15, cost:{"三钛合金":80, "稳定富勒烯":20, "苍穹劫团装备生产许可D":3}, bonuses:{gasLaserEfficiency:0.35}, faction:"angel", requiresBlueprint:true },
  "blood_gas_assimilation_nexus":  { id:"blood_gas_assimilation_nexus",  name:"赤誓气体同化注入器·枢纽型",   slot:"low", level:45,time:75, xp:55,  cost:{"三钛合金":600, "聚合气体":35, "铷":3,"等离子体":15,"赤誓教团装备生产许可B":8}, bonuses:{gasLaserEfficiency:0.85}, faction:"blood", requiresBlueprint:true },
  "sansha_gas_assimilation_node":  { id:"sansha_gas_assimilation_node",  name:"静默气体同化注入器·节点型",   slot:"low", level:25,time:45, xp:30,  cost:{"三钛合金":300, "稳定富勒烯":100,"同位聚合体":15,"静默集群装备生产许可C":5}, bonuses:{gasLaserEfficiency:0.55}, faction:"sansha", requiresBlueprint:true },
  "alliance_gas_assimilation": { id:"alliance_gas_assimilation", name:"联盟气体同化注入器",     slot:"low", level:65,time:130,xp:95,  cost:{"三钛合金":1320,"聚合气体":60, "铷":6,"等离子体":30}, bonuses:{gasLaserEfficiency:0.80}, faction:"alliance", shipTypes:["industrial_capital"], requiresBlueprint:true },

  // ===== 同位素标记打捞臂（对标采矿/采气提升器，低槽 salvageEfficiency；战斗界面可开关：关=仅被动提升货柜掉率，开=燃料×2+消耗同位素+打捞舰船组件） =====
  "t1_salvage_arm":    { id:"t1_salvage_arm",    name:"T1同位素标记打捞臂",  slot:"low", level:10, time:20,  xp:12,  cost:{"三钛合金":50,  "重金属":20, "稀有气体":12}, bonuses:{salvageEfficiency:0.10} },
  "t2_salvage_arm":    { id:"t2_salvage_arm",    name:"中型同位素标记打捞臂", slot:"low", level:15, time:35,  xp:20,  cost:{"三钛合金":160, "同位素":60,  "类晶体胶矿":15}, bonuses:{salvageEfficiency:0.30} },
  "t3_salvage_arm":    { id:"t3_salvage_arm",    name:"重型同位素标记打捞臂", slot:"low", level:35, time:60,  xp:40,  cost:{"三钛合金":400, "等离子体":150, "同位素":30, "重金属":15}, bonuses:{salvageEfficiency:0.50} },
  "t4_salvage_arm":    { id:"t4_salvage_arm",    name:"大型同位素标记打捞臂", slot:"low", level:55, time:110, xp:80,  cost:{"三钛合金":900, "生物质":45, "铷":4,  "等离子体":25}, bonuses:{salvageEfficiency:0.70} },
  "t5_salvage_arm":    { id:"t5_salvage_arm",    name:"旗舰同位素标记打捞核心", slot:"low", level:80, time:200, xp:150, cost:{"三钛合金":2000,"磁场聚合物":35, "铷":15, "生物质":50}, bonuses:{salvageEfficiency:0.90} },
  // ===== 势力同位素标记打捞臂（对标势力采矿/采气提升器，残骸打捞注入器系，需蓝图；渠道逐件对标矿提孪生件：货柜 S/M/L + LP_STORE + STAR_BELT） =====
  "sansha_salvage_injector":  { id:"sansha_salvage_injector",  name:"静默残骸打捞注入器",       slot:"low", level:65, time:130, xp:95,  cost:{"三钛合金":1100,"等离子体":50, "铷":5, "生物质":25, "静默集群装备生产许可A":10}, bonuses:{salvageEfficiency:0.80}, faction:"sansha", sourceZoneId:"sansha_command_matrix", shipTypes:["industrial_capital"], requiresBlueprint:true },
  "angel_salvage_injector_outpost": { id:"angel_salvage_injector_outpost", name:"苍穹劫团残骸打捞注入器·前哨型", slot:"low", level:10, time:30, xp:15, cost:{"三钛合金":80, "稀有气体":20, "苍穹劫团装备生产许可D":3}, bonuses:{salvageEfficiency:0.35}, faction:"angel", requiresBlueprint:true },
  "blood_salvage_injector_nexus":  { id:"blood_salvage_injector_nexus",  name:"赤誓残骸打捞注入器·枢纽型",   slot:"low", level:45, time:75, xp:55,  cost:{"三钛合金":600, "等离子体":35, "铷":3, "生物质":15, "赤誓教团装备生产许可B":8}, bonuses:{salvageEfficiency:0.85}, faction:"blood", requiresBlueprint:true },
  "sansha_salvage_injector_node":  { id:"sansha_salvage_injector_node",  name:"静默残骸打捞注入器·节点型",   slot:"low", level:25, time:45, xp:30,  cost:{"三钛合金":300, "同位素":100, "同位聚合体":15, "静默集群装备生产许可C":5}, bonuses:{salvageEfficiency:0.55}, faction:"sansha", requiresBlueprint:true },
  "alliance_salvage_injector": { id:"alliance_salvage_injector", name:"联盟残骸打捞注入器",     slot:"low", level:65, time:130, xp:95,  cost:{"三钛合金":1320,"磁场聚合物":60, "铷":6, "生物质":30}, bonuses:{salvageEfficiency:0.80}, faction:"alliance", shipTypes:["industrial_capital"], requiresBlueprint:true },

  // ===== 考古装备（仅考古舰可装备，不可用于战斗，不可安装战斗装备） =====
  // 高槽：遗迹分析仪 — 提升扫描强度
  "archaeo_analyzer_i": { id:"archaeo_analyzer_i", name:"遗迹分析仪 I", slot:"high", level:1,  time:20, xp:14, cost:{"三钛合金":40,"类银超金属":15}, bonuses:{archaeologyScan:5},  shipTypes:ARCHAEOLOGY_SHIP_TYPES, archaeology:true },
  "archaeo_analyzer_ii":{ id:"archaeo_analyzer_ii",name:"遗迹分析仪 II",slot:"high", level:15, time:40, xp:35, cost:{"三钛合金":160,"类银超金属":60,"类晶体胶矿":15}, bonuses:{archaeologyScan:8},  shipTypes:ARCHAEOLOGY_SHIP_TYPES, archaeology:true },
  "archaeo_analyzer_iii":{id:"archaeo_analyzer_iii",name:"遗迹分析仪 III",slot:"high",level:35, time:70, xp:60, cost:{"三钛合金":400,"类银超金属":150,"同位聚合体":25,"重金属":12}, bonuses:{archaeologyScan:12}, shipTypes:ARCHAEOLOGY_SHIP_TYPES, archaeology:true },
  "archaeo_analyzer_iv":{ id:"archaeo_analyzer_iv",name:"遗迹分析仪 IV",slot:"high", level:55, time:120,xp:110,cost:{"三钛合金":900,"超新星诺克石":40,"铷":3,"等离子体":20}, bonuses:{archaeologyScan:18}, shipTypes:ARCHAEOLOGY_SHIP_TYPES, archaeology:true },
  "archaeo_analyzer_v": { id:"archaeo_analyzer_v", name:"遗迹分析仪 V", slot:"high", level:80, time:200,xp:180,cost:{"三钛合金":2000,"超噬矿":15,"铷":10,"磁场聚合物":40}, bonuses:{archaeologyScan:25}, shipTypes:ARCHAEOLOGY_SHIP_TYPES, archaeology:true },
  // 中槽：信号稳定器 — 降低失败反噬（总和上限 60%）
  "archaeo_stabilizer_i": { id:"archaeo_stabilizer_i", name:"信号稳定器 I", slot:"mid", level:1,  time:20, xp:14, cost:{"三钛合金":40,"类银超金属":15}, bonuses:{archaeologyStabilizer:0.05}, shipTypes:ARCHAEOLOGY_SHIP_TYPES, archaeology:true },
  "archaeo_stabilizer_ii":{ id:"archaeo_stabilizer_ii",name:"信号稳定器 II",slot:"mid", level:15, time:40, xp:35, cost:{"三钛合金":160,"类银超金属":60,"类晶体胶矿":15}, bonuses:{archaeologyStabilizer:0.08}, shipTypes:ARCHAEOLOGY_SHIP_TYPES, archaeology:true },
  "archaeo_stabilizer_iii":{id:"archaeo_stabilizer_iii",name:"信号稳定器 III",slot:"mid",level:35, time:70, xp:60, cost:{"三钛合金":400,"类银超金属":150,"同位聚合体":25,"重金属":12}, bonuses:{archaeologyStabilizer:0.11}, shipTypes:ARCHAEOLOGY_SHIP_TYPES, archaeology:true },
  "archaeo_stabilizer_iv":{ id:"archaeo_stabilizer_iv",name:"信号稳定器 IV",slot:"mid", level:55, time:120,xp:110,cost:{"三钛合金":900,"超新星诺克石":40,"铷":3,"等离子体":20}, bonuses:{archaeologyStabilizer:0.14}, shipTypes:ARCHAEOLOGY_SHIP_TYPES, archaeology:true },
  "archaeo_stabilizer_v": { id:"archaeo_stabilizer_v", name:"信号稳定器 V", slot:"mid", level:80, time:200,xp:180,cost:{"三钛合金":2000,"超噬矿":15,"铷":10,"磁场聚合物":40}, bonuses:{archaeologyStabilizer:0.17}, shipTypes:ARCHAEOLOGY_SHIP_TYPES, archaeology:true },
  // 低槽：文物译码器 — 额外普通 ISK 文物概率（总和上限 75%）
  "archaeo_decoder_i": { id:"archaeo_decoder_i", name:"文物译码器 I", slot:"low", level:1,  time:20, xp:14, cost:{"三钛合金":40,"同位聚合体":12}, bonuses:{archaeologyDecoder:0.10}, shipTypes:ARCHAEOLOGY_SHIP_TYPES, archaeology:true },
  "archaeo_decoder_ii":{ id:"archaeo_decoder_ii",name:"文物译码器 II",slot:"low", level:15, time:40, xp:35, cost:{"三钛合金":160,"同位聚合体":40,"重金属":8}, bonuses:{archaeologyDecoder:0.14}, shipTypes:ARCHAEOLOGY_SHIP_TYPES, archaeology:true },
  "archaeo_decoder_iii":{id:"archaeo_decoder_iii",name:"文物译码器 III",slot:"low",level:35, time:70, xp:60, cost:{"三钛合金":400,"同位聚合体":90,"超新星诺克石":12,"稀有气体":8}, bonuses:{archaeologyDecoder:0.18}, shipTypes:ARCHAEOLOGY_SHIP_TYPES, archaeology:true },
  "archaeo_decoder_iv":{ id:"archaeo_decoder_iv",name:"文物译码器 IV",slot:"low", level:55, time:120,xp:110,cost:{"三钛合金":900,"同位聚合体":200,"铷":3,"等离子体":20}, bonuses:{archaeologyDecoder:0.22}, shipTypes:ARCHAEOLOGY_SHIP_TYPES, archaeology:true },
  "archaeo_decoder_v": { id:"archaeo_decoder_v", name:"文物译码器 V", slot:"low", level:80, time:200,xp:180,cost:{"三钛合金":2000,"同位聚合体":450,"铷":10,"磁场聚合物":40}, bonuses:{archaeologyDecoder:0.26}, shipTypes:ARCHAEOLOGY_SHIP_TYPES, archaeology:true },

  // ===== 考古重做 — 7 张特殊考古装备蓝图（仅掉落蓝图，制造后属现有三类考古装备；requiresBlueprint） =====
  // 高槽：遗迹分析仪 — 扫描 + 周期缩短
  "archaeo_analyzer_frontier_i": { id:"archaeo_analyzer_frontier_i", name:"边疆遗迹分析仪 I", slot:"high", level:1,  time:25, xp:18, cost:{"三钛合金":60,"类银超金属":25}, bonuses:{archaeologyScan:7, archaeologyCycleReduction:0.02}, shipTypes:ARCHAEOLOGY_SHIP_TYPES, archaeology:true, requiresBlueprint:true },
  "archaeo_analyzer_forbidden_iv": { id:"archaeo_analyzer_forbidden_iv", name:"禁区遗迹分析仪 IV", slot:"high", level:55, time:130,xp:120,cost:{"三钛合金":1000,"超新星诺克石":50,"铷":4,"等离子体":25}, bonuses:{archaeologyScan:23, archaeologyCycleReduction:0.05}, shipTypes:ARCHAEOLOGY_SHIP_TYPES, archaeology:true, requiresBlueprint:true },
  "archaeo_analyzer_pioneer_v": { id:"archaeo_analyzer_pioneer_v", name:"先驱遗迹分析仪 V", slot:"high", level:80, time:210,xp:190,cost:{"三钛合金":2200,"超噬矿":20,"铷":12,"磁场聚合物":50}, bonuses:{archaeologyScan:32, archaeologyCycleReduction:0.06}, shipTypes:ARCHAEOLOGY_SHIP_TYPES, archaeology:true, requiresBlueprint:true },
  // 中槽：信号稳定器 — 反噬减免 + 非致命免伤
  "archaeo_stabilizer_station_ii": { id:"archaeo_stabilizer_station_ii", name:"环站信号稳定器 II", slot:"mid", level:15, time:45, xp:40, cost:{"三钛合金":200,"类银超金属":80,"类晶体胶矿":20}, bonuses:{archaeologyStabilizer:0.08, archaeologyNonFatalAvoid:0.05}, shipTypes:ARCHAEOLOGY_SHIP_TYPES, archaeology:true, requiresBlueprint:true },
  "archaeo_stabilizer_pioneer_v": { id:"archaeo_stabilizer_pioneer_v", name:"先驱信号稳定器 V", slot:"mid", level:80, time:210,xp:190,cost:{"三钛合金":2200,"超噬矿":20,"铷":12,"磁场聚合物":50}, bonuses:{archaeologyStabilizer:0.20, archaeologyNonFatalAvoid:0.12}, shipTypes:ARCHAEOLOGY_SHIP_TYPES, archaeology:true, requiresBlueprint:true },
  // 低槽：文物译码器 — 常规掉落加成 + 复制焦点结果
  "archaeo_decoder_fleet_iii": { id:"archaeo_decoder_fleet_iii", name:"舰墓文物译码器 III", slot:"low", level:35, time:75, xp:65, cost:{"三钛合金":450,"同位聚合体":100,"超新星诺克石":15,"稀有气体":10}, bonuses:{archaeologyDecoder:0.19, archaeologyCopyChance:0.04}, shipTypes:ARCHAEOLOGY_SHIP_TYPES, archaeology:true, requiresBlueprint:true },
  "archaeo_decoder_pioneer_v": { id:"archaeo_decoder_pioneer_v", name:"先驱文物译码器 V", slot:"low", level:80, time:210,xp:190,cost:{"三钛合金":2200,"同位聚合体":500,"铷":12,"磁场聚合物":50}, bonuses:{archaeologyDecoder:0.28, archaeologyCopyChance:0.07}, shipTypes:ARCHAEOLOGY_SHIP_TYPES, archaeology:true, requiresBlueprint:true }
};

/* ================================================================
   改装件（rig）系统 — 9 系列 × 5 档 = 45 件
   见 RIG_SYSTEM_IMPLEMENTATION_PLAN.md 第二/三/五节。
   数据由下方配置程序化生成并合并入 EQUIPMENT_DB（避免 45 行手写重复）。
   ================================================================ */
// 9 系列：stackGroup 唯一，bonusKey 为效果字段，rigCategory 用于装备工程子分类。
// 档位曲线遵循「谐振（堆叠）规范」：同一 stackGroup 内第 3 件同级改装件的实际增量严格低于下一级单件值。
//   - 战斗 / 工业 6 系列封顶 15% → [0.05, 0.07, 0.09, 0.12, 0.15]
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
  // 考古（扫描增益 / 燃料减免 / 干扰缩短，减免类以正数存储）
  { stackGroup:"rig_archaeology_scan",         label:"扫描强度",   rigCategory:"archaeology", bonusKey:"archaeologyScanPercent",         values:[0.08, 0.11, 0.14, 0.17, 0.20] },
  { stackGroup:"rig_archaeology_fuel",         label:"考古燃料效率", rigCategory:"archaeology", bonusKey:"archaeologyFuelEfficiency",       values:[0.08, 0.11, 0.14, 0.17, 0.20] },
  { stackGroup:"rig_archaeology_interference", label:"考古干扰缩短", rigCategory:"archaeology", bonusKey:"archaeologyInterferenceReduction", values:[0.08, 0.11, 0.14, 0.17, 0.20] }
];
// 5 档：等级门槛、耗时、经验、校准材料需求、精炼矿物成本（材料来源见 PLAN 5.2）。
const RIG_TIER_META = [
  { suffix:"i",   roman:"I",   level:1,  time:20,  xp:14,  calib:"art_i_calib",   calibQty:1, minerals:{"三钛合金":100,  "类银超金属":40} },
  { suffix:"ii",  roman:"II",  level:15, time:40,  xp:35,  calib:"art_ii_calib",  calibQty:1, minerals:{"三钛合金":400,  "类晶体胶矿":60} },
  { suffix:"iii", roman:"III", level:35, time:70,  xp:60,  calib:"art_iii_calib", calibQty:2, minerals:{"三钛合金":800,  "同位聚合体":150} },
  { suffix:"iv",  roman:"IV",  level:55, time:120, xp:110, calib:"art_iv_calib",  calibQty:2, minerals:{"三钛合金":1500, "超新星诺克石":40, "铷":3} },
  { suffix:"v",   roman:"V",   level:80, time:200, xp:180, calib:"art_v_calib",   calibQty:3, minerals:{"三钛合金":2500, "超噬矿":10, "铷":8} }
];

function buildRigDefinitions() {
  const defs = {};
  for (const series of RIG_SERIES) {
    for (let t = 0; t < RIG_TIER_META.length; t++) {
      const meta = RIG_TIER_META[t];
      const id = series.stackGroup + "_" + meta.suffix;
      // 成本 = 精炼矿物（按名）+ 校准材料（按 calibration: 命名空间 id）
      const cost = { ...meta.minerals };
      cost["calibration:" + meta.calib] = meta.calibQty;
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
  2:{ level:10, effect:1.12, coreRequired:2, materialMultiplier:1.0, time:30, xp:18 },
  3:{ level:25, effect:1.20, coreRequired:4, materialMultiplier:1.5, time:50, xp:32 },
  4:{ level:45, effect:1.28, coreRequired:6, materialMultiplier:2.0, time:80, xp:55 },
  6:{ level:65, effect:1.35, coreRequired:10, materialMultiplier:2.5, time:120, xp:90 }
});

const DEATHSPACE_EQUIPMENT_ROUTES = Object.freeze({
  angel:{ prefix:{2:"劫团试制",3:"劫团强化",4:"劫团精锐",6:"劫团A型"}, weapon:{2:"t1_small_laser",3:"t1_small_laser",4:"t1_medium_laser",6:"t1_large_laser"}, repair:{2:"t1_shield_booster",3:"t1_shield_booster",4:"t1_medium_shield_booster",6:"t1_large_shield_booster"} },
  blood:{ prefix:{2:"科尔普斯试制",3:"科尔普斯强化",4:"科尔普斯精锐",6:"科尔普斯A型"}, weapon:{2:"t1_light_missile_launcher",3:"t1_light_missile_launcher",4:"t1_heavy_missile_launcher",6:"t1_cruise_missile_launcher"}, repair:{2:"t1_armor_repairer",3:"t1_armor_repairer",4:"t1_medium_armor_repairer",6:"t1_large_armor_repairer"} },
  sansha:{ prefix:{2:"森屠斯试制",3:"森屠斯强化",4:"森屠斯精锐",6:"森屠斯A型"}, weapon:{2:"t1_small_cannon",3:"t1_small_cannon",4:"t1_medium_cannon",6:"t1_large_cannon"}, repair:{2:"t1_structure_repairer",3:"t1_structure_repairer",4:"t1_medium_structure_repairer",6:"t1_large_structure_repairer"} }
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

  const improvedId = "ded_" + site.faction + "_" + site.dedTier + "_" + role + "_supervisor";
  const improvedCombat = { ...standardCombat };
  if (improvedCombat.kind === "weapon") improvedCombat.baseDamage = Math.round(improvedCombat.baseDamage * 1.10);
  else improvedCombat.amount = Math.round(improvedCombat.amount * 1.10);
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
    name:"联盟采矿激光器蓝图",
    kind:"equipmentBlueprint",
    equipmentId:"raider_mining_laser",
    lpPrice:624,
    sourceZoneId:"angel_corridor",
    dataMaterial:"天使低级加密数据",
    dataRequired:5,
    expectedClears:51.9522797321635,
    expectedLP:311.713678392981,
    description:"永久解锁联盟采矿激光器制造配方"
  },
  {
    id:"alliance_gas_harvester_blueprint",
    name:"联盟气云采集器蓝图",
    kind:"equipmentBlueprint",
    equipmentId:"raider_gas_harvester",
    lpPrice:624,
    sourceZoneId:"angel_corridor",
    dataMaterial:"天使低级加密数据",
    dataRequired:5,
    expectedClears:51.9522797321635,
    expectedLP:311.713678392981,
    description:"永久解锁联盟气云采集器制造配方"
  },
  {
    id:"alliance_drone_link_blueprint",
    name:"联盟无人机指挥链路蓝图",
    kind:"equipmentBlueprint",
    equipmentId:"alliance_drone_link",
    lpPrice:764,
    sourceZoneId:"blood_cathedral",
    dataMaterial:"血袭者中级加密数据",
    dataRequired:8,
    expectedClears:38.1822712709151,
    expectedLP:381.822712709151,
    description:"永久解锁联盟无人机指挥链路制造配方"
  },
  {
    id:"alliance_mineral_assimilation_blueprint",
    name:"联盟矿物同化注入器蓝图",
    kind:"equipmentBlueprint",
    equipmentId:"alliance_mineral_assimilation",
    lpPrice:836,
    sourceZoneId:"sansha_command_matrix",
    dataMaterial:"萨沙高级加密数据",
    dataRequired:10,
    expectedClears:27.8571964721334,
    expectedLP:417.857947082001,
    description:"永久解锁联盟矿物同化注入器制造配方"
  },
  {
    id:"alliance_gas_assimilation_blueprint",
    name:"联盟气体同化注入器蓝图",
    kind:"equipmentBlueprint",
    equipmentId:"alliance_gas_assimilation",
    lpPrice:836,
    sourceZoneId:"sansha_command_matrix",
    dataMaterial:"萨沙高级加密数据",
    dataRequired:10,
    description:"永久解锁联盟气体同化注入器制造配方"
  },
  {
    id:"alliance_salvage_injector_blueprint",
    name:"联盟残骸打捞注入器蓝图",
    kind:"equipmentBlueprint",
    equipmentId:"alliance_salvage_injector",
    lpPrice:836,
    sourceZoneId:"sansha_command_matrix",
    dataMaterial:"萨沙高级加密数据",
    dataRequired:10,
    description:"永久解锁联盟残骸打捞注入器制造配方"
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
      lpPrice:getZoneBlueprintPrice(equipment.sourceZoneId, 2), sourceZoneId:equipment.sourceZoneId
    };
  });

const DEATHSPACE_EQUIPMENT_BLUEPRINTS = Object.values(EQUIPMENT_DB)
  .filter(equipment => equipment.sourceDeathspaceId && equipment.requiresBlueprint)
  .map(equipment => {
    const site = DEATHSPACE_DATABASE.find(item => item.id === equipment.sourceDeathspaceId);
    const fullClearLP = getDeathspaceFullClearLP(equipment.sourceDeathspaceId);
    return {
      id:equipment.id + "_blueprint", name:equipment.name + "蓝图", kind:"equipmentBlueprint", equipmentId:equipment.id,
      lpPrice:fullClearLP * 2, sourceDeathspaceId:equipment.sourceDeathspaceId, deathspaceTier:equipment.deathspaceTier
    };
  });

const BLUEPRINT_STORE_CATEGORIES = Object.freeze([
  { id:"ships", name:"舰船蓝图", icon:"fa-solid fa-ship" },
  { id:"alliance", name:"联盟装备", icon:"fa-solid fa-star" },
  { id:"faction", name:"势力装备", icon:"fa-solid fa-flag" },
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
  return !recipe || !recipe.requiresBlueprint || hasEquipmentBlueprintFromState(state, recipe.id);
}

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
  return [...shipItems, ...equipmentItems];
}

function getEquipmentRecipeCategory(equipment) {
  if (equipment.slot === "rig") return "rigs";
  if (equipment.archaeology) return "archaeology";
  if (equipment.combat && equipment.combat.kind === "weapon") return "weapons";
  if ((equipment.combat && equipment.combat.kind === "repair") || equipment.id === "shield_ext_small") return "defense";
  if (equipment.id.includes("drone")) return "drones";
  // 工业采集类按功能细分为三个顶层分类：采矿装备 / 采气装备 / 采集增益
  if (equipment.slot === "high") {
    if (equipment.bonuses && equipment.bonuses.miningEfficiency) return "mining";
    if (equipment.bonuses && equipment.bonuses.gasEfficiency) return "gas";
  }
  if (equipment.slot === "low" && equipment.bonuses && (equipment.bonuses.miningLaserEfficiency || equipment.bonuses.gasLaserEfficiency || equipment.bonuses.salvageEfficiency)) return "collect_boost";
  return "mining";
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

// 权威 LP 商店装备蓝图 ID 集合：蓝图商店实际在售装备（联盟 + 星带势力 + 深空清剿三类），
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
  if (recipe.sourceDeathspaceId) return "深空清剿获取蓝图";
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
  archaeologyDecoder:"文物掉落加成",
  archaeologyCycleReduction:"考古周期缩短",
  archaeologyNonFatalAvoid:"非致命免伤",
  archaeologyCopyChance:"复制焦点概率",
  archaeologyFuelEfficiency:"考古燃料效率",
  archaeologyInterferenceReduction:"考古干扰缩短"
};
// rig 百分比减免类：以正数存储，展示为 -X%
const RIG_REDUCTION_BONUS_KEYS = ["archaeologyFuelEfficiency", "archaeologyInterferenceReduction"];
const RIG_PERCENT_BONUS_KEYS = ["shieldCapacityPercent","armorCapacityPercent","structureCapacityPercent","smeltingSpeed","archaeologyScanPercent"];

const ARCHAEOLOGY_REDUCTION_BONUS_KEYS = ["archaeologyStabilizer", "archaeologyCycleReduction"];
const ARCHAEOLOGY_PERCENT_BONUS_KEYS = ["archaeologyDecoder", "archaeologyNonFatalAvoid", "archaeologyCopyChance"];

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
  return "+" + value;
}

function getEquipmentAttributeLines(equipmentRef) {
  const eq = typeof equipmentRef === "string" ? EQUIPMENT_DB[equipmentRef] : equipmentRef;
  if (!eq) return [];
  const lines = ["槽位：" + (EQUIPMENT_SLOT_NAMES[eq.slot] || eq.slot)];
  for (const [key, value] of Object.entries(eq.bonuses || {})) {
    lines.push((EQUIPMENT_BONUS_NAMES[key] || key) + " " + formatEquipmentBonusValue(key, value));
  }
  // 改装件信息卡片：说明同舰同系列装配的谐振（堆叠）惩罚
  if (eq.slot === "rig") {
    lines.push("谐振效应：同一舰船装配相同改装件时，后装配的改装件会因谐振效应降低实际效果（同系列第 2 件起实际加成比例递减）。");
  }
  if (eq.combat && eq.combat.kind === "weapon") {
    const weaponNames = { laser:"激光", missile:"导弹", cannon:"射弹" };
    lines.push("武器类型：" + (weaponNames[eq.combat.weaponType] || eq.combat.weaponType));
    lines.push("基础伤害：" + eq.combat.baseDamage);
    lines.push("每轮消耗：燃料 " + eq.combat.fuelCost + " / 弹药 " + eq.combat.ammoCost);
    if (eq.combat.aoe && eq.combat.aoe.description) lines.push(eq.combat.aoe.description);
    if (Array.isArray(eq.shipTypes)) lines.push("适用舰体：旗舰 / 超级旗舰");
  } else if (eq.combat && eq.combat.kind === "repair") {
    const targetNames = { shield:"护盾", armor:"装甲", structure:"结构" };
    lines.push("自动维修：" + (targetNames[eq.combat.target] || eq.combat.target) + " +" + eq.combat.amount);
    lines.push("触发消耗：燃料 " + eq.combat.fuelCost);
    if (Array.isArray(eq.shipTypes)) lines.push("适用舰体：旗舰 / 超级旗舰");
  }
  if (eq.bonuses && typeof eq.bonuses.salvageEfficiency === "number") {
    lines.push("被动：装备即提升货柜掉率（货柜基础掉率×(1+打捞效率)，封顶 50%；战斗与考古通用）");
    lines.push("主动（战斗界面开关，非死亡空间）：开启后每轮燃料×2，每击毁敌舰消耗同位素与打捞舰船组件，额外掉落舰船组件");
  }
  return lines;
}

function getEquipmentAttributeText(equipmentRef, separator) {
  return getEquipmentAttributeLines(equipmentRef).join(separator || " · ");
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
