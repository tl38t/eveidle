// ---- 战斗：敌人数据库 ----
const ENEMY_DATABASE = {
  angel: {
    name: "苍穹劫团",
    types: {
      scout:    { name:"苍穹劫团侦察兵", level:1,  kind:"normal", icon:"👹", hp:{shield:220,armor:88,structure:55},   hit:100,dodge:30,baseDamage:40, iskDrop:500, xpDrop:20,  image:"images/enemies/天使侦查舰.png" },
      raider:   { name:"苍穹劫团突击舰", level:10, kind:"elite",  icon:"👹", hp:{shield:550,armor:220,structure:110}, hit:130,dodge:40,baseDamage:59, iskDrop:1500,xpDrop:60 },
      commander:{ name:"苍穹劫团指挥官", level:20, kind:"boss",   icon:"👺", hp:{shield:1853,armor:65,structure:32}, hit:160,dodge:50,baseDamage:96, iskDrop:4000,xpDrop:180 },
      patrol_destroyer:{ name:"苍穹劫团巡猎驱逐舰", level:20, kind:"normal", icon:"👹", hp:{shield:545,armor:220,structure:135}, hit:120,dodge:45,baseDamage:94, iskDrop:500,xpDrop:40 },
      raider_destroyer:{ name:"苍穹劫团掠袭驱逐舰", level:25, kind:"elite", icon:"👹", hp:{shield:1200,armor:500,structure:300}, hit:150,dodge:60,baseDamage:141, iskDrop:1500,xpDrop:120 },
      hunter_commander:{ name:"苍穹劫团猎杀指挥官", level:30, kind:"boss", icon:"👺", hp:{shield:4200,armor:200,structure:100}, hit:200,dodge:70,baseDamage:308, iskDrop:4000,xpDrop:360 },
      strike_cruiser:{ name:"苍穹劫团突击巡洋舰", level:40, kind:"normal", icon:"👹", hp:{shield:1800,armor:720,structure:450}, hit:145,dodge:55,baseDamage:310, iskDrop:1000,xpDrop:70 },
      war_cruiser:{ name:"苍穹劫团战斗巡洋舰", level:45, kind:"elite", icon:"👹", hp:{shield:4140,armor:1620,structure:900}, hit:180,dodge:70,baseDamage:465, iskDrop:3000,xpDrop:210 },
      fleet_commander:{ name:"苍穹劫团舰队指挥官", level:50, kind:"boss", icon:"👺", hp:{shield:14040,armor:630,structure:270}, hit:235,dodge:85,baseDamage:990, iskDrop:8000,xpDrop:630 },
      siege_battleship:{ name:"苍穹劫团攻城战列舰", level:60, kind:"normal", icon:"👹", hp:{shield:5400,armor:2160,structure:1350}, hit:170,dodge:45,baseDamage:930, iskDrop:2000,xpDrop:120 },
      marauder_battleship:{ name:"苍穹劫团掠袭战列舰", level:65, kind:"elite", icon:"👹", hp:{shield:12420,armor:4860,structure:2700}, hit:210,dodge:60,baseDamage:1395, iskDrop:6000,xpDrop:360 },
      war_master:{ name:"苍穹劫团战争主宰", level:70, kind:"boss", icon:"👺", hp:{shield:42120,armor:1890,structure:810}, hit:270,dodge:70,baseDamage:2970, iskDrop:16000,xpDrop:1080 }
      , frontier_capital:{ name:"苍穹劫团边疆旗舰", level:80, kind:"normal", icon:"👹", hp:{shield:15000,armor:6000,structure:3750}, hit:310,dodge:65,baseDamage:1800, iskDrop:4000,xpDrop:200 }
      , domination_capital:{ name:"苍穹劫团统治旗舰", level:85, kind:"elite", icon:"👹", hp:{shield:34500,armor:13500,structure:7500}, hit:350,dodge:75,baseDamage:2700, iskDrop:12000,xpDrop:600 }
      , outer_reach_overseer:{ name:"苍穹劫团外环督军", level:90, kind:"boss", icon:"👺", hp:{shield:117000,armor:5250,structure:2250}, hit:400,dodge:85,baseDamage:5700, iskDrop:32000,xpDrop:1800 }
      , abyssal_supercapital:{ name:"苍穹劫团深渊超级旗舰", level:90, kind:"normal", icon:"👹", hp:{shield:27000,armor:10800,structure:6750}, hit:380,dodge:75,baseDamage:2900, iskDrop:8000,xpDrop:320 }
      , seraph_supercapital:{ name:"苍穹劫团炽天超级旗舰", level:95, kind:"elite", icon:"👹", hp:{shield:62100,armor:24300,structure:13500}, hit:425,dodge:85,baseDamage:4350, iskDrop:24000,xpDrop:960 }
      , deep_domain_overlord:{ name:"苍穹劫团深域战争领主", level:99, kind:"boss", icon:"👺", hp:{shield:210600,armor:9450,structure:4050}, hit:480,dodge:95,baseDamage:9000, iskDrop:64000,xpDrop:2880 }
    }
  },
  blood: {
    name: "赤誓教团",
    types: {
      acolyte:  { name:"赤誓教团侍僧", level:1,  kind:"normal", icon:"🧛", hp:{shield:88,armor:220,structure:55},   hit:110,dodge:25,baseDamage:44, iskDrop:500, xpDrop:20 },
      priest:   { name:"赤誓教团祭司", level:10, kind:"elite",  icon:"🧛", hp:{shield:220,armor:550,structure:110}, hit:140,dodge:35,baseDamage:66, iskDrop:1500,xpDrop:60 },
      cardinal: { name:"赤誓教团主教", level:20, kind:"boss",   icon:"🧛‍♂️", hp:{shield:65,armor:1853,structure:32},hit:170,dodge:45,baseDamage:96, iskDrop:4000,xpDrop:180 },
      ritual_destroyer:{ name:"赤誓教团仪式驱逐舰", level:20, kind:"normal", icon:"🧛", hp:{shield:220,armor:545,structure:135}, hit:130,dodge:40,baseDamage:82, iskDrop:500,xpDrop:40 },
      blood_destroyer:{ name:"赤誓教团鲜血驱逐舰", level:25, kind:"elite", icon:"🧛", hp:{shield:500,armor:1200,structure:300}, hit:160,dodge:55,baseDamage:123, iskDrop:1500,xpDrop:120 },
      high_priest:{ name:"赤誓教团大祭司", level:30, kind:"boss", icon:"🧛‍♂️", hp:{shield:200,armor:4200,structure:100}, hit:210,dodge:65,baseDamage:260, iskDrop:4000,xpDrop:360 },
      sermon_cruiser:{ name:"赤誓教团布道巡洋舰", level:40, kind:"normal", icon:"🧛", hp:{shield:702,armor:1755,structure:439}, hit:155,dodge:50,baseDamage:280, iskDrop:1000,xpDrop:70 },
      sacrament_cruiser:{ name:"赤誓教团圣礼巡洋舰", level:45, kind:"elite", icon:"🧛", hp:{shield:1580,armor:4037,structure:878}, hit:190,dodge:65,baseDamage:420, iskDrop:3000,xpDrop:210 },
      blood_archon:{ name:"赤誓教团鲜血执政官", level:50, kind:"boss", icon:"🧛‍♂️", hp:{shield:614,armor:13689,structure:263}, hit:245,dodge:80,baseDamage:840, iskDrop:8000,xpDrop:630 },
      iron_battleship:{ name:"赤誓教团铁血战列舰", level:60, kind:"normal", icon:"🧛", hp:{shield:2106,armor:5265,structure:1317}, hit:180,dodge:40,baseDamage:840, iskDrop:2000,xpDrop:120 },
      apostle_battleship:{ name:"赤誓教团使徒战列舰", level:65, kind:"elite", icon:"🧛", hp:{shield:4740,armor:12111,structure:2634}, hit:220,dodge:55,baseDamage:1260, iskDrop:6000,xpDrop:360 },
      blood_sovereign:{ name:"赤誓教团鲜血君王", level:70, kind:"boss", icon:"🧛‍♂️", hp:{shield:1842,armor:41067,structure:789}, hit:280,dodge:65,baseDamage:2570, iskDrop:16000,xpDrop:1080 }
      , covenant_capital:{ name:"赤誓教团盟约旗舰", level:80, kind:"normal", icon:"🧛", hp:{shield:5850,armor:14625,structure:3656}, hit:320,dodge:60,baseDamage:1620, iskDrop:4000,xpDrop:200 }
      , apostolic_capital:{ name:"赤誓教团使徒旗舰", level:85, kind:"elite", icon:"🧛", hp:{shield:13163,armor:33638,structure:7313}, hit:360,dodge:70,baseDamage:2430, iskDrop:12000,xpDrop:600 }
      , outer_reliquary_overseer:{ name:"赤誓教团外环圣主", level:90, kind:"boss", icon:"🧛‍♂️", hp:{shield:5119,armor:114075,structure:2194}, hit:410,dodge:80,baseDamage:5130, iskDrop:32000,xpDrop:1800 }
      , abyssal_blood_supercapital:{ name:"赤誓教团深渊超级旗舰", level:90, kind:"normal", icon:"🧛", hp:{shield:10530,armor:26325,structure:6581}, hit:390,dodge:70,baseDamage:2610, iskDrop:8000,xpDrop:320 }
      , crimson_supercapital:{ name:"赤誓教团深红超级旗舰", level:95, kind:"elite", icon:"🧛", hp:{shield:23693,armor:60548,structure:13163}, hit:435,dodge:80,baseDamage:3915, iskDrop:24000,xpDrop:960 }
      , deep_reliquary_overlord:{ name:"赤誓教团深域大君", level:99, kind:"boss", icon:"🧛‍♂️", hp:{shield:9214,armor:205335,structure:3949}, hit:490,dodge:90,baseDamage:8100, iskDrop:64000,xpDrop:2880 }
    }
  },
  sansha: {
    name: "静默集群",
    types: {
      drone:    { name:"静默集群无人机", level:1,  kind:"normal", icon:"🤖", hp:{shield:88,armor:55,structure:220},   hit:90,dodge:35,baseDamage:42, iskDrop:500, xpDrop:20 },
      sentinel: { name:"静默集群哨兵",   level:10, kind:"elite",  icon:"🤖", hp:{shield:220,armor:110,structure:550}, hit:120,dodge:45,baseDamage:63, iskDrop:1500,xpDrop:60 },
      overlord: { name:"静默集群领主",   level:20, kind:"boss",   icon:"👾", hp:{shield:65,armor:32,structure:1853},hit:150,dodge:55,baseDamage:96, iskDrop:4000,xpDrop:180 },
      control_destroyer:{ name:"静默集群控制驱逐舰", level:20, kind:"normal", icon:"🤖", hp:{shield:220,armor:135,structure:545}, hit:110,dodge:50,baseDamage:74, iskDrop:500,xpDrop:40 },
      sentinel_destroyer:{ name:"静默集群哨戒驱逐舰", level:25, kind:"elite", icon:"🤖", hp:{shield:500,armor:300,structure:1200}, hit:140,dodge:65,baseDamage:111, iskDrop:1500,xpDrop:120 },
      control_overlord:{ name:"静默集群控制领主", level:30, kind:"boss", icon:"👾", hp:{shield:200,armor:100,structure:4200}, hit:190,dodge:75,baseDamage:226, iskDrop:4000,xpDrop:360 },
      assimilation_cruiser:{ name:"静默集群同化巡洋舰", level:40, kind:"normal", icon:"🤖", hp:{shield:720,armor:450,structure:1800}, hit:135,dodge:60,baseDamage:250, iskDrop:1000,xpDrop:70 },
      dominion_cruiser:{ name:"静默集群支配巡洋舰", level:45, kind:"elite", icon:"🤖", hp:{shield:1620,armor:900,structure:4140}, hit:170,dodge:75,baseDamage:375, iskDrop:3000,xpDrop:210 },
      nexus_overlord:{ name:"静默集群枢纽领主", level:50, kind:"boss", icon:"👾", hp:{shield:630,armor:270,structure:14040}, hit:225,dodge:90,baseDamage:801, iskDrop:8000,xpDrop:630 },
      command_battleship:{ name:"静默集群指令战列舰", level:60, kind:"normal", icon:"🤖", hp:{shield:2160,armor:1350,structure:5400}, hit:160,dodge:50,baseDamage:750, iskDrop:2000,xpDrop:120 },
      domination_battleship:{ name:"静默集群统治战列舰", level:65, kind:"elite", icon:"🤖", hp:{shield:4860,armor:2700,structure:12420}, hit:200,dodge:65,baseDamage:1125, iskDrop:6000,xpDrop:360 },
      matrix_overlord:{ name:"静默集群矩阵领主", level:70, kind:"boss", icon:"👾", hp:{shield:1890,armor:810,structure:42120}, hit:260,dodge:75,baseDamage:2550, iskDrop:16000,xpDrop:1080 }
      , nexus_capital:{ name:"静默集群枢纽旗舰", level:80, kind:"normal", icon:"🤖", hp:{shield:6000,armor:3750,structure:15000}, hit:300,dodge:70,baseDamage:1440, iskDrop:4000,xpDrop:200 }
      , dominion_capital:{ name:"静默集群支配旗舰", level:85, kind:"elite", icon:"🤖", hp:{shield:13500,armor:7500,structure:34500}, hit:340,dodge:80,baseDamage:2160, iskDrop:12000,xpDrop:600 }
      , outer_array_overseer:{ name:"静默集群外环主脑", level:90, kind:"boss", icon:"👾", hp:{shield:5250,armor:2250,structure:117000}, hit:390,dodge:90,baseDamage:4560, iskDrop:32000,xpDrop:1800 }
      , abyssal_nexus_supercapital:{ name:"静默集群深渊超级旗舰", level:90, kind:"normal", icon:"🤖", hp:{shield:10800,armor:6750,structure:27000}, hit:370,dodge:80,baseDamage:2320, iskDrop:8000,xpDrop:320 }
      , ascendant_supercapital:{ name:"静默集群升格超级旗舰", level:95, kind:"elite", icon:"🤖", hp:{shield:24300,armor:13500,structure:62100}, hit:415,dodge:90,baseDamage:3480, iskDrop:24000,xpDrop:960 }
      , deep_nexus_overlord:{ name:"静默集群深域主宰", level:99, kind:"boss", icon:"👾", hp:{shield:9450,armor:4050,structure:210600}, hit:470,dodge:100,baseDamage:7200, iskDrop:64000,xpDrop:2880 }
    }
  }
};

// ---- 战斗：武器配置 ----
const WEAPON_CONFIG = {
  laser:   { name:"激光炮",     damageType:"em",        baseDps:120, fuelCost:3, baseHit:100, counterType:"shield",    icon:"🔫", skillKey:"laserOps" },
  missile: { name:"导弹发射器", damageType:"explosive", baseDps:100, fuelCost:1, baseHit:130, counterType:"armor",     icon:"🚀", skillKey:"missileOperations" },
  cannon:  { name:"炮台",       damageType:"kinetic",   baseDps:80,  fuelCost:2, baseHit:80,  counterType:"structure", icon:"💣", skillKey:"cannonOps" }
};

// ---- 战斗：海盗星带 ----
const COMBAT_FORMATION_POOLS = {
  highsec: [
    { id:"2_normal", normal:2, elite:0, chance:0.45 },
    { id:"3_normal", normal:3, elite:0, chance:0.45 },
    { id:"2_normal_1_elite", normal:2, elite:1, chance:0.08 },
    { id:"3_normal_1_elite", normal:3, elite:1, chance:0.02 }
  ],
  bordersec: [
    { id:"2_normal", normal:2, elite:0, chance:0.30 },
    { id:"3_normal", normal:3, elite:0, chance:0.40 },
    { id:"2_normal_1_elite", normal:2, elite:1, chance:0.20 },
    { id:"3_normal_1_elite", normal:3, elite:1, chance:0.10 }
  ],
  lowsec: [
    { id:"2_normal", normal:2, elite:0, chance:0.25 },
    { id:"3_normal", normal:3, elite:0, chance:0.35 },
    { id:"2_normal_1_elite", normal:2, elite:1, chance:0.25 },
    { id:"3_normal_1_elite", normal:3, elite:1, chance:0.15 }
  ],
  deepsec: [
    { id:"2_normal", normal:2, elite:0, chance:0.20 },
    { id:"3_normal", normal:3, elite:0, chance:0.30 },
    { id:"2_normal_1_elite", normal:2, elite:1, chance:0.30 },
    { id:"3_normal_1_elite", normal:3, elite:1, chance:0.20 }
  ],
  nullsec: [
    { id:"2_normal", normal:2, elite:0, chance:0.15 },
    { id:"3_normal", normal:3, elite:0, chance:0.25 },
    { id:"2_normal_1_elite", normal:2, elite:1, chance:0.35 },
    { id:"3_normal_1_elite", normal:3, elite:1, chance:0.25 }
  ],
  deepnull: [
    { id:"2_normal", normal:2, elite:0, chance:0.10 },
    { id:"3_normal", normal:3, elite:0, chance:0.20 },
    { id:"2_normal_1_elite", normal:2, elite:1, chance:0.35 },
    { id:"3_normal_1_elite", normal:3, elite:1, chance:0.35 }
  ]
};

const COMBAT_ZONES = [
  { id:"angel_outpost",  name:"苍穹劫团前哨站",  faction:"angel",  secLevel:"1.0-0.8", level:1, icon:"👹", enemyPool:{normal:["scout"],elite:["raider"],boss:["commander"]}, formationPool:"highsec", bossEscortCount:1, maxWave:20, clearLp:3, iskMulti:1.0, encryptedDataMaterial:"天使初级加密数据", gearDrops:[{resourceId:"special:苍穹劫团装备生产许可D", qty:1, chances:{elite:0.005,boss:0.02}}] },
  { id:"blood_hideout",  name:"赤誓教团隐蔽所", faction:"blood",  secLevel:"1.0-0.8", level:1, icon:"🧛", enemyPool:{normal:["acolyte"],elite:["priest"],boss:["cardinal"]}, formationPool:"highsec", bossEscortCount:1, maxWave:20, clearLp:3, iskMulti:1.0, encryptedDataMaterial:"血袭者初级加密数据" },
  { id:"sansha_outpost", name:"静默集群哨站",     faction:"sansha", secLevel:"1.0-0.8", level:1, icon:"🤖", enemyPool:{normal:["drone"],elite:["sentinel"],boss:["overlord"]}, formationPool:"highsec", bossEscortCount:1, maxWave:20, clearLp:3, iskMulti:1.0, encryptedDataMaterial:"萨沙初级加密数据", gearDrops:[{resourceId:"special:静默集群装备生产许可D", qty:1, chances:{elite:0.005,boss:0.02}}] },
  { id:"angel_corridor", name:"苍穹劫团劫掠走廊", faction:"angel", secLevel:"0.7-0.5", level:20, requiredCL:15, icon:"👹", enemyPool:{normal:["patrol_destroyer"],elite:["raider_destroyer"],boss:["hunter_commander"]}, formationPool:"bordersec", bossEscortCount:1, maxWave:20, clearLp:6, iskMulti:1.5, fuelMult:1.2, encryptedDataMaterial:"天使低级加密数据", gearDrops:[{resourceId:"special:苍穹劫团装备生产许可C", qty:1, chances:{elite:0.005,boss:0.02}}] },
  { id:"blood_sacrifice", name:"赤誓教团献祭场", faction:"blood", secLevel:"0.7-0.5", level:20, requiredCL:15, icon:"🧛", enemyPool:{normal:["ritual_destroyer"],elite:["blood_destroyer"],boss:["high_priest"]}, formationPool:"bordersec", bossEscortCount:1, maxWave:20, clearLp:6, iskMulti:1.5, fuelMult:1.2, encryptedDataMaterial:"血袭者低级加密数据", gearDrops:[{resourceId:"special:赤誓教团装备生产许可C", qty:1, chances:{elite:0.005,boss:0.02}}] },
  { id:"sansha_node", name:"静默集群控制节点", faction:"sansha", secLevel:"0.7-0.5", level:20, requiredCL:15, icon:"🤖", enemyPool:{normal:["control_destroyer"],elite:["sentinel_destroyer"],boss:["control_overlord"]}, formationPool:"bordersec", bossEscortCount:1, maxWave:20, clearLp:6, iskMulti:1.5, fuelMult:1.2, encryptedDataMaterial:"萨沙低级加密数据", gearDrops:[{resourceId:"special:静默集群装备生产许可C", qty:1, chances:{elite:0.005,boss:0.02}}] },
  { id:"angel_hunting_ground", name:"苍穹劫团猎杀空域", faction:"angel", secLevel:"0.4-0.3", level:40, requiredCL:35, icon:"👹", enemyPool:{normal:["strike_cruiser"],elite:["war_cruiser"],boss:["fleet_commander"]}, formationPool:"lowsec", bossEscortCount:1, maxWave:20, clearLp:10, iskMulti:2.0, fuelMult:1.4, encryptedDataMaterial:"天使中级加密数据", stationCoreDrops:[{coreId:"smelt", resourceId:"special:空间站冶炼核心", qty:1, chances:{elite:0.000794,boss:0.00397}}] },
  { id:"blood_cathedral", name:"赤誓教团深红圣堂", faction:"blood", secLevel:"0.4-0.3", level:40, requiredCL:35, icon:"🧛", enemyPool:{normal:["sermon_cruiser"],elite:["sacrament_cruiser"],boss:["blood_archon"]}, formationPool:"lowsec", bossEscortCount:1, maxWave:20, clearLp:10, iskMulti:2.0, fuelMult:1.4, encryptedDataMaterial:"血袭者中级加密数据", gearDrops:[{resourceId:"special:赤誓教团装备生产许可B", qty:1, chances:{elite:0.005,boss:0.02}}] },
  { id:"sansha_nexus", name:"静默集群同化枢纽", faction:"sansha", secLevel:"0.4-0.3", level:40, requiredCL:35, icon:"🤖", enemyPool:{normal:["assimilation_cruiser"],elite:["dominion_cruiser"],boss:["nexus_overlord"]}, formationPool:"lowsec", bossEscortCount:1, maxWave:20, clearLp:10, iskMulti:2.0, fuelMult:1.4, encryptedDataMaterial:"萨沙中级加密数据", gearDrops:[{resourceId:"special:静默集群装备生产许可B", qty:1, chances:{elite:0.005,boss:0.02}}] },
  { id:"angel_warfront", name:"苍穹劫团破阵战场", faction:"angel", secLevel:"0.2-0.1", level:60, requiredCL:55, icon:"👹", enemyPool:{normal:["siege_battleship"],elite:["marauder_battleship"],boss:["war_master"]}, formationPool:"deepsec", bossEscortCount:1, maxWave:20, clearLp:15, iskMulti:2.5, fuelMult:1.6, encryptedDataMaterial:"天使高级加密数据", gearDrops:[{resourceId:"special:苍穹劫团装备生产许可A", qty:1, chances:{elite:0.005,boss:0.02}}] },
  { id:"blood_iron_basilica", name:"赤誓教团铁血圣殿", faction:"blood", secLevel:"0.2-0.1", level:60, requiredCL:55, icon:"🧛", enemyPool:{normal:["iron_battleship"],elite:["apostle_battleship"],boss:["blood_sovereign"]}, formationPool:"deepsec", bossEscortCount:1, maxWave:20, clearLp:15, iskMulti:2.5, fuelMult:1.6, encryptedDataMaterial:"血袭者高级加密数据", gearDrops:[{resourceId:"special:赤誓教团装备生产许可A", qty:1, chances:{elite:0.005,boss:0.02}}] },
  { id:"sansha_command_matrix", name:"静默集群统御矩阵", faction:"sansha", secLevel:"0.2-0.1", level:60, requiredCL:55, icon:"🤖", enemyPool:{normal:["command_battleship"],elite:["domination_battleship"],boss:["matrix_overlord"]}, formationPool:"deepsec", bossEscortCount:1, maxWave:20, clearLp:15, iskMulti:2.5, fuelMult:1.6, encryptedDataMaterial:"萨沙高级加密数据", gearDrops:[{resourceId:"special:静默集群装备生产许可A", qty:1, chances:{elite:0.005,boss:0.02}}], stationCoreDrops:[{coreId:"shipEng", resourceId:"special:空间站船坞核心", qty:1, chances:{elite:0.000690,boss:0.00345}}] }
  , { id:"angel_outer_reach", name:"苍穹劫团外环侵袭区", faction:"angel", secLevel:"0.0外环", level:80, requiredCL:80, icon:"👹", enemyPool:{normal:["frontier_capital"],elite:["domination_capital"],boss:["outer_reach_overseer"]}, formationPool:"nullsec", bossEscortCount:1, maxWave:20, clearLp:25, iskMulti:3.0, fuelMult:1.9, encryptedDataDisabled:true, specialDrops:[{resourceId:"mineral:莫尔石",material:"莫尔石",qty:1,chances:{elite:0.05,boss:1.0}}] }
  , { id:"blood_outer_reliquary", name:"赤誓教团外环圣库", faction:"blood", secLevel:"0.0外环", level:80, requiredCL:80, icon:"🧛", enemyPool:{normal:["covenant_capital"],elite:["apostolic_capital"],boss:["outer_reliquary_overseer"]}, formationPool:"nullsec", bossEscortCount:1, maxWave:20, clearLp:25, iskMulti:3.0, fuelMult:1.9, encryptedDataDisabled:true, specialDrops:[{resourceId:"mineral:莫尔石",material:"莫尔石",qty:1,chances:{elite:0.05,boss:1.0}}], stationCoreDrops:[{coreId:"equipEng", resourceId:"special:空间站装备制造核心", qty:1, chances:{elite:0.000610,boss:0.00305}}] }
  , { id:"sansha_outer_array", name:"静默集群外环同化阵列", faction:"sansha", secLevel:"0.0外环", level:80, requiredCL:80, icon:"🤖", enemyPool:{normal:["nexus_capital"],elite:["dominion_capital"],boss:["outer_array_overseer"]}, formationPool:"nullsec", bossEscortCount:1, maxWave:20, clearLp:25, iskMulti:3.0, fuelMult:1.9, encryptedDataDisabled:true, specialDrops:[{resourceId:"mineral:莫尔石",material:"莫尔石",qty:1,chances:{elite:0.05,boss:1.0}}] }
  , { id:"angel_deep_domain", name:"苍穹劫团深域王庭", faction:"angel", secLevel:"0.0深层", level:90, requiredCL:90, icon:"👹", enemyPool:{normal:["abyssal_supercapital"],elite:["seraph_supercapital"],boss:["deep_domain_overlord"]}, formationPool:"deepnull", bossEscortCount:2, maxWave:20, clearLp:30, iskMulti:4.0, fuelMult:2.2, encryptedDataDisabled:true, specialDrops:[{resourceId:"special:天穹深层舰船数据",material:"天穹深层舰船数据",qty:1,chances:{elite:0.05,boss:1.0}}], stationCoreDrops:[{coreId:"booster", resourceId:"special:空间站增强剂制造核心", qty:1, chances:{elite:0.000546,boss:0.00273}}] }
  , { id:"blood_deep_reliquary", name:"赤誓教团深域圣殿", faction:"blood", secLevel:"0.0深层", level:90, requiredCL:90, icon:"🧛", enemyPool:{normal:["abyssal_blood_supercapital"],elite:["crimson_supercapital"],boss:["deep_reliquary_overlord"]}, formationPool:"deepnull", bossEscortCount:2, maxWave:20, clearLp:30, iskMulti:4.0, fuelMult:2.2, encryptedDataDisabled:true, specialDrops:[{resourceId:"special:重垒深层舰船数据",material:"重垒深层舰船数据",qty:1,chances:{elite:0.05,boss:1.0}}] }
  , { id:"sansha_deep_nexus", name:"静默集群深域主脑", faction:"sansha", secLevel:"0.0深层", level:90, requiredCL:90, icon:"🤖", enemyPool:{normal:["abyssal_nexus_supercapital"],elite:["ascendant_supercapital"],boss:["deep_nexus_overlord"]}, formationPool:"deepnull", bossEscortCount:2, maxWave:20, clearLp:30, iskMulti:4.0, fuelMult:2.2, encryptedDataDisabled:true, specialDrops:[{resourceId:"special:裂界深层舰船数据",material:"裂界深层舰船数据",qty:1,chances:{elite:0.05,boss:1.0}}] }
];


const ENDGAME_COMBAT_ZONE_BALANCE = Object.freeze({
  angel_outer_reach:Object.freeze({hp:1.728,damage:0.709,boss:Object.freeze({hp:1.18,damage:1.18})}),
  blood_outer_reliquary:Object.freeze({hp:1.24,damage:0.76935,boss:Object.freeze({hp:0.88,damage:0.95})}),
  sansha_outer_array:Object.freeze({hp:1.528,damage:0.69462,boss:Object.freeze({hp:1.05,damage:1.05})}),
  angel_deep_domain:Object.freeze({hp:1.32275,damage:0.55125,boss:Object.freeze({hp:1.087,damage:1.087})}),
  blood_deep_reliquary:Object.freeze({hp:1.0871,damage:0.5247,boss:Object.freeze({hp:1.045,damage:1.045})}),
  sansha_deep_nexus:Object.freeze({hp:1.02544,damage:0.48825,boss:Object.freeze({hp:1.07,damage:1.07})})
});
for (const zone of COMBAT_ZONES) zone.enemyBalance = ENDGAME_COMBAT_ZONE_BALANCE[zone.id] || null;

const STAR_BELT_DATA_MATERIALS = [...new Set(COMBAT_ZONES.map(zone => zone.encryptedDataMaterial).filter(Boolean))];

// combatBalance为各副本固定编队系数，不读取玩家状态：hp/damage作用于全层，finalHp/finalDamage只作用于最终层。
// 校准目标统一为成熟同级技能下：+5舰船/T1装配45%～55%，+10舰船/T1装配85%～95%。
const DEATHSPACE_DATABASE = [
  {
    id:"angel_ded_2_10", name:"苍穹劫团2/10秘密补给站", faction:"angel", sourceZoneId:"angel_outpost", requiredCL:1, dedTier:2,
    ticketMaterial:"天使秘密补给站通行密钥", ticketChances:{elite:0.05,boss:0.05}, maxWave:3, waveLp:1, clearLpBonus:9,
    coreMaterial:"吉斯特试制校准核心", protocolMaterial:"吉斯特试制协议", protocolChance:0.02,
    combatBalance:{hp:0.2589,damage:0.9725,finalHp:1.3616,finalDamage:2.1353},
    waves:[
      { name:"补给站外围警戒官", hpMult:0.85, damageMult:0.85, escortNormal:1, coreChance:0.08 },
      { name:"补给线路主管", hpMult:1.05, damageMult:1.05, escortNormal:1, coreChance:0.12 },
      { name:"吉斯特补给站监督者", hpMult:1.25, damageMult:1.25, escortNormal:2, coreChance:0.25, final:true }
    ]
  },
  {
    id:"blood_ded_2_10", name:"赤誓教团2/10仪式地窖", faction:"blood", sourceZoneId:"blood_hideout", requiredCL:1, dedTier:2,
    ticketMaterial:"血袭者仪式地窖通行密钥", ticketChances:{elite:0.05,boss:0.05}, maxWave:3, waveLp:1, clearLpBonus:9,
    coreMaterial:"科尔普斯试制校准核心", protocolMaterial:"科尔普斯试制协议", protocolChance:0.02,
    combatBalance:{hp:0.2797,damage:0.8064,finalHp:2.0632,finalDamage:1.2039},
    waves:[
      { name:"地窖外围侍祭", hpMult:0.85, damageMult:0.85, escortNormal:1, coreChance:0.08 },
      { name:"仪式主持者", hpMult:1.05, damageMult:1.05, escortNormal:1, coreChance:0.12 },
      { name:"科尔普斯地窖监督者", hpMult:1.25, damageMult:1.25, escortNormal:2, coreChance:0.25, final:true }
    ]
  },
  {
    id:"sansha_ded_2_10", name:"静默集群2/10控制哨所", faction:"sansha", sourceZoneId:"sansha_outpost", requiredCL:1, dedTier:2,
    ticketMaterial:"萨沙控制哨所通行密钥", ticketChances:{elite:0.05,boss:0.05}, maxWave:3, waveLp:1, clearLpBonus:9,
    coreMaterial:"森屠斯试制校准核心", protocolMaterial:"森屠斯试制协议", protocolChance:0.02,
    combatBalance:{hp:0.3647,damage:0.8507,finalHp:0.6061,finalDamage:1.0000},
    waves:[
      { name:"哨所外围控制官", hpMult:0.85, damageMult:0.85, escortNormal:1, coreChance:0.08 },
      { name:"同步节点主管", hpMult:1.05, damageMult:1.05, escortNormal:1, coreChance:0.12 },
      { name:"森屠斯哨所监督者", hpMult:1.25, damageMult:1.25, escortNormal:2, coreChance:0.25, final:true }
    ]
  },
  {
    id:"angel_ded_3_10", name:"苍穹劫团3/10劫掠者船坞", faction:"angel", sourceZoneId:"angel_corridor", requiredCL:15, dedTier:3,
    ticketMaterial:"天使劫掠者船坞通行密钥", ticketChances:{elite:0.05,boss:0.05}, maxWave:4, waveLp:1, clearLpBonus:18,
    coreMaterial:"吉斯特强化校准核心", protocolMaterial:"吉斯特强化协议", protocolChance:0.02,
    combatBalance:{hp:1.4713,damage:0.3574,finalHp:0.8875,finalDamage:1.7003},
    waves:[
      { name:"船坞外围警戒官", hpMult:0.85, damageMult:0.85, escortNormal:1, coreChance:0.08 },
      { name:"泊位防卫主管", hpMult:0.98, damageMult:0.98, escortNormal:1, coreChance:0.12 },
      { name:"劫掠舰队协调官", hpMult:1.12, damageMult:1.12, escortNormal:1, coreChance:0.17 },
      { name:"吉斯特船坞监督者", hpMult:1.25, damageMult:1.25, escortNormal:2, coreChance:0.28, final:true }
    ]
  },
  {
    id:"blood_ded_3_10", name:"赤誓教团3/10献祭圣所", faction:"blood", sourceZoneId:"blood_sacrifice", requiredCL:15, dedTier:3,
    ticketMaterial:"血袭者献祭圣所通行密钥", ticketChances:{elite:0.05,boss:0.05}, maxWave:4, waveLp:1, clearLpBonus:18,
    coreMaterial:"科尔普斯强化校准核心", protocolMaterial:"科尔普斯强化协议", protocolChance:0.02,
    combatBalance:{hp:0.2176,damage:0.9253,finalHp:2.0649,finalDamage:1.1589},
    waves:[
      { name:"圣所外围侍从", hpMult:0.85, damageMult:0.85, escortNormal:1, coreChance:0.08 },
      { name:"献祭仪轨主管", hpMult:0.98, damageMult:0.98, escortNormal:1, coreChance:0.12 },
      { name:"深红教团协调官", hpMult:1.12, damageMult:1.12, escortNormal:1, coreChance:0.17 },
      { name:"科尔普斯圣所监督者", hpMult:1.25, damageMult:1.25, escortNormal:2, coreChance:0.28, final:true }
    ]
  },
  {
    id:"sansha_ded_3_10", name:"静默集群3/10同步节点", faction:"sansha", sourceZoneId:"sansha_node", requiredCL:15, dedTier:3,
    ticketMaterial:"萨沙同步节点通行密钥", ticketChances:{elite:0.05,boss:0.05}, maxWave:4, waveLp:1, clearLpBonus:18,
    coreMaterial:"森屠斯强化校准核心", protocolMaterial:"森屠斯强化协议", protocolChance:0.02,
    combatBalance:{hp:0.2754,damage:0.8503,finalHp:1.7278,finalDamage:0.9919},
    waves:[
      { name:"节点外围控制官", hpMult:0.85, damageMult:0.85, escortNormal:1, coreChance:0.08 },
      { name:"同步阵列主管", hpMult:0.98, damageMult:0.98, escortNormal:1, coreChance:0.12 },
      { name:"控制集群协调官", hpMult:1.12, damageMult:1.12, escortNormal:1, coreChance:0.17 },
      { name:"森屠斯节点监督者", hpMult:1.25, damageMult:1.25, escortNormal:2, coreChance:0.28, final:true }
    ]
  },
  {
    id:"angel_ded_4_10", name:"苍穹劫团4/10舰队集结区", faction:"angel", sourceZoneId:"angel_hunting_ground", requiredCL:35, dedTier:4,
    ticketMaterial:"天使舰队集结区通行密钥", ticketChances:{elite:0.05,boss:0.05}, maxWave:5, waveLp:2, clearLpBonus:30,
    coreMaterial:"吉斯特精锐校准核心", protocolMaterial:"吉斯特精锐协议", protocolChance:0.02,
    combatBalance:{hp:0.6392,damage:0.6678,finalHp:1.8327,finalDamage:0.8308},
    waves:[
      { name:"集结区外围警戒官", hpMult:0.85, damageMult:0.85, escortNormal:1, coreChance:0.08 },
      { name:"舰队调度主管", hpMult:0.95, damageMult:0.95, escortNormal:1, coreChance:0.12 },
      { name:"火力节点协调官", hpMult:1.05, damageMult:1.05, escortNormal:1, coreChance:0.16 },
      { name:"核心舰队统领", hpMult:1.15, damageMult:1.15, escortNormal:1, coreChance:0.20 },
      { name:"吉斯特集结区监督者", hpMult:1.25, damageMult:1.25, escortNormal:2, coreChance:0.29, final:true }
    ]
  },
  {
    id:"blood_ded_4_10", name:"赤誓教团4/10深红修道院", faction:"blood", sourceZoneId:"blood_cathedral", requiredCL:35, dedTier:4,
    ticketMaterial:"血袭者深红修道院通行密钥", ticketChances:{elite:0.05,boss:0.05}, maxWave:5, waveLp:2, clearLpBonus:30,
    coreMaterial:"科尔普斯精锐校准核心", protocolMaterial:"科尔普斯精锐协议", protocolChance:0.02,
    combatBalance:{hp:0.2923,damage:1.1475,finalHp:0.5022,finalDamage:0.8693},
    waves:[
      { name:"修道院外围侍从", hpMult:0.85, damageMult:0.85, escortNormal:1, coreChance:0.08 },
      { name:"圣坛防卫主管", hpMult:0.95, damageMult:0.95, escortNormal:1, coreChance:0.12 },
      { name:"深红舰队协调官", hpMult:1.05, damageMult:1.05, escortNormal:1, coreChance:0.16 },
      { name:"核心圣坛统领", hpMult:1.15, damageMult:1.15, escortNormal:1, coreChance:0.20 },
      { name:"科尔普斯修道院监督者", hpMult:1.25, damageMult:1.25, escortNormal:2, coreChance:0.29, final:true }
    ]
  },
  {
    id:"sansha_ded_4_10", name:"静默集群4/10同化中枢", faction:"sansha", sourceZoneId:"sansha_nexus", requiredCL:35, dedTier:4,
    ticketMaterial:"萨沙同化中枢通行密钥", ticketChances:{elite:0.05,boss:0.05}, maxWave:5, waveLp:2, clearLpBonus:30,
    coreMaterial:"森屠斯精锐校准核心", protocolMaterial:"森屠斯精锐协议", protocolChance:0.02,
    combatBalance:{hp:0.3378,damage:0.9652,finalHp:2.2407,finalDamage:0.6000},
    waves:[
      { name:"中枢外围控制官", hpMult:0.85, damageMult:0.85, escortNormal:1, coreChance:0.08 },
      { name:"同化矩阵主管", hpMult:0.95, damageMult:0.95, escortNormal:1, coreChance:0.12 },
      { name:"控制集群协调官", hpMult:1.05, damageMult:1.05, escortNormal:1, coreChance:0.16 },
      { name:"核心节点统领", hpMult:1.15, damageMult:1.15, escortNormal:1, coreChance:0.20 },
      { name:"森屠斯中枢监督者", hpMult:1.25, damageMult:1.25, escortNormal:2, coreChance:0.29, final:true }
    ]
  },
  {
    id:"angel_ded_6_10", name:"苍穹劫团6/10军事复合体", faction:"angel", sourceZoneId:"angel_warfront", requiredCL:55, dedTier:6,
    ticketMaterial:"天使军事复合体通行密钥", ticketChances:{elite:0.05,boss:0.05}, maxWave:5, waveLp:3, clearLpBonus:45,
    coreMaterial:"吉斯特A型校准核心", protocolMaterial:"吉斯特改良协议", protocolChance:0.02,
    combatBalance:{hp:0.9954,damage:0.4334,finalHp:1.7324,finalDamage:1.2280},
    waves:[
      { name:"外围警戒指挥官", hpMult:0.85, damageMult:0.85, escortNormal:1, coreChance:0.12 },
      { name:"防御节点主管", hpMult:0.95, damageMult:0.95, escortNormal:1, coreChance:0.15 },
      { name:"舰队协调官", hpMult:1.05, damageMult:1.05, escortNormal:1, coreChance:0.18 },
      { name:"核心守卫统领", hpMult:1.15, damageMult:1.15, escortNormal:1, coreChance:0.22 },
      { name:"吉斯特复合体监督者", hpMult:1.25, damageMult:1.25, escortNormal:2, coreChance:0.35, final:true }
    ]
  },
  {
    id:"blood_ded_6_10", name:"赤誓教团6/10海军造船厂", faction:"blood", sourceZoneId:"blood_iron_basilica", requiredCL:55, dedTier:6,
    ticketMaterial:"血袭者海军造船厂通行密钥", ticketChances:{elite:0.05,boss:0.05}, maxWave:5, waveLp:3, clearLpBonus:45,
    coreMaterial:"科尔普斯A型校准核心", protocolMaterial:"科尔普斯改良协议", protocolChance:0.02,
    combatBalance:{hp:0.5882,damage:0.8610,finalHp:1.4007,finalDamage:0.5900},
    waves:[
      { name:"外围献祭监工", hpMult:0.85, damageMult:0.85, escortNormal:1, coreChance:0.12 },
      { name:"船坞防卫主管", hpMult:0.95, damageMult:0.95, escortNormal:1, coreChance:0.15 },
      { name:"深红舰队协调官", hpMult:1.05, damageMult:1.05, escortNormal:1, coreChance:0.18 },
      { name:"核心圣堂统领", hpMult:1.15, damageMult:1.15, escortNormal:1, coreChance:0.22 },
      { name:"科尔普斯造船厂监督者", hpMult:1.25, damageMult:1.25, escortNormal:2, coreChance:0.35, final:true }
    ]
  },
  {
    id:"sansha_ded_6_10", name:"静默集群6/10战争设施", faction:"sansha", sourceZoneId:"sansha_command_matrix", requiredCL:55, dedTier:6,
    ticketMaterial:"萨沙战争设施通行密钥", ticketChances:{elite:0.05,boss:0.05}, maxWave:5, waveLp:3, clearLpBonus:45,
    coreMaterial:"森屠斯A型校准核心", protocolMaterial:"森屠斯改良协议", protocolChance:0.02,
    combatBalance:{hp:0.2463,damage:1.0602,finalHp:1.7108,finalDamage:0.6900},
    waves:[
      { name:"外围控制监督者", hpMult:0.85, damageMult:0.85, escortNormal:1, coreChance:0.12 },
      { name:"防御矩阵主管", hpMult:0.95, damageMult:0.95, escortNormal:1, coreChance:0.15 },
      { name:"战争节点协调官", hpMult:1.05, damageMult:1.05, escortNormal:1, coreChance:0.18 },
      { name:"核心设施统领", hpMult:1.15, damageMult:1.15, escortNormal:1, coreChance:0.22 },
      { name:"森屠斯战争设施监督者", hpMult:1.25, damageMult:1.25, escortNormal:2, coreChance:0.35, final:true }
    ]
  }
];

const DEATHSPACE_TICKET_MATERIALS = DEATHSPACE_DATABASE.map(site => site.ticketMaterial);
const DEATHSPACE_LOOT_MATERIALS = DEATHSPACE_DATABASE.flatMap(site => [site.coreMaterial, site.protocolMaterial]);
const SUPERCAPITAL_DATA_MATERIALS = ["天穹深层舰船数据", "重垒深层舰船数据", "裂界深层舰船数据"];
// Tier2 加密数据拆分：4 件势力装备的专属制造料（bare name 即 cost 键；掉落用 "special:"+名）。
const GEAR_DATA_MATERIALS = ["苍穹劫团装备生产许可D", "苍穹劫团装备生产许可C", "苍穹劫团装备生产许可B", "苍穹劫团装备生产许可A", "赤誓教团装备生产许可D", "赤誓教团装备生产许可C", "赤誓教团装备生产许可B", "赤誓教团装备生产许可A", "静默集群装备生产许可D", "静默集群装备生产许可C", "静默集群装备生产许可B", "静默集群装备生产许可A"];
// Tier3 空间站四核心：特殊物资（非装备），建站+持有才生效，唯一产出。
const STATION_CORE_MATERIALS = ["空间站冶炼核心", "空间站船坞核心", "空间站装备制造核心", "空间站增强剂制造核心"];
// 货柜系统：4 尺寸货柜物品 + 4 种神经植入体（脑插，T4头奖；完整装备系统延后，当前仅收藏物品）。
const CARGO_CONTAINER_MATERIALS = ["货柜S", "货柜M", "货柜L", "货柜XL"];
const NEURAL_IMPLANT_MATERIALS = ["神经植入体·攻击", "神经植入体·防御", "神经植入体·工程", "神经植入体·指挥"];
// 增强剂系统 Phase 2A：5 档高频战术材料并入 special 池（登记于 boosters.js:TACTICAL_MATERIALS，先于本文件加载）。
const TACTICAL_MATERIAL_IDS = typeof TACTICAL_MATERIALS !== "undefined" ? TACTICAL_MATERIALS.map(material => material.id) : [];
const COMBAT_SPECIAL_MATERIALS = [...STAR_BELT_DATA_MATERIALS, ...DEATHSPACE_TICKET_MATERIALS, ...DEATHSPACE_LOOT_MATERIALS, ...SUPERCAPITAL_DATA_MATERIALS, ...GEAR_DATA_MATERIALS, ...STATION_CORE_MATERIALS, ...CARGO_CONTAINER_MATERIALS, ...NEURAL_IMPLANT_MATERIALS, ...TACTICAL_MATERIAL_IDS];

// 势力装备只通过装备工程制造；战斗仅掉落对应加密数据。
const FACTION_ENCRYPTED_DATA_DROPS = {
  angel:  { material:"天使初级加密数据", chances:{elite:0.005,boss:0.02}, qty:1 },
  blood:  { material:"血袭者初级加密数据", chances:{elite:0.005,boss:0.02}, qty:1 },
  sansha: { material:"萨沙初级加密数据", chances:{elite:0.005,boss:0.02}, qty:1 }
};
