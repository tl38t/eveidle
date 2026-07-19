// ---- 战斗：敌人数据库 ----
const ENEMY_DATABASE = {
  angel: {
    name: "天使集团",
    types: {
      scout:    { name:"天使侦察兵", level:1,  kind:"normal", icon:"👹", hp:{shield:220,armor:88,structure:55},   hit:100,dodge:30,baseDamage:40, iskDrop:500, xpDrop:20,  image:"images/enemies/天使侦查舰.png" },
      raider:   { name:"天使突击舰", level:10, kind:"elite",  icon:"👹", hp:{shield:550,armor:220,structure:110}, hit:130,dodge:40,baseDamage:59, iskDrop:1500,xpDrop:60 },
      commander:{ name:"天使指挥官", level:20, kind:"boss",   icon:"👺", hp:{shield:1853,armor:65,structure:32}, hit:160,dodge:50,baseDamage:96, iskDrop:4000,xpDrop:180 },
      patrol_destroyer:{ name:"天使巡猎驱逐舰", level:20, kind:"normal", icon:"👹", hp:{shield:545,armor:220,structure:135}, hit:120,dodge:45,baseDamage:94, iskDrop:500,xpDrop:40 },
      raider_destroyer:{ name:"天使掠袭驱逐舰", level:25, kind:"elite", icon:"👹", hp:{shield:1200,armor:500,structure:300}, hit:150,dodge:60,baseDamage:141, iskDrop:1500,xpDrop:120 },
      hunter_commander:{ name:"天使猎杀指挥官", level:30, kind:"boss", icon:"👺", hp:{shield:4200,armor:200,structure:100}, hit:200,dodge:70,baseDamage:308, iskDrop:4000,xpDrop:360 },
      strike_cruiser:{ name:"天使突击巡洋舰", level:40, kind:"normal", icon:"👹", hp:{shield:1800,armor:720,structure:450}, hit:145,dodge:55,baseDamage:310, iskDrop:1000,xpDrop:70 },
      war_cruiser:{ name:"天使战斗巡洋舰", level:45, kind:"elite", icon:"👹", hp:{shield:4140,armor:1620,structure:900}, hit:180,dodge:70,baseDamage:465, iskDrop:3000,xpDrop:210 },
      fleet_commander:{ name:"天使舰队指挥官", level:50, kind:"boss", icon:"👺", hp:{shield:14040,armor:630,structure:270}, hit:235,dodge:85,baseDamage:990, iskDrop:8000,xpDrop:630 },
      siege_battleship:{ name:"天使攻城战列舰", level:60, kind:"normal", icon:"👹", hp:{shield:5400,armor:2160,structure:1350}, hit:170,dodge:45,baseDamage:930, iskDrop:2000,xpDrop:120 },
      marauder_battleship:{ name:"天使掠袭战列舰", level:65, kind:"elite", icon:"👹", hp:{shield:12420,armor:4860,structure:2700}, hit:210,dodge:60,baseDamage:1395, iskDrop:6000,xpDrop:360 },
      war_master:{ name:"天使战争主宰", level:70, kind:"boss", icon:"👺", hp:{shield:42120,armor:1890,structure:810}, hit:270,dodge:70,baseDamage:2970, iskDrop:16000,xpDrop:1080 }
    }
  },
  blood: {
    name: "血袭者",
    types: {
      acolyte:  { name:"血袭者侍僧", level:1,  kind:"normal", icon:"🧛", hp:{shield:88,armor:220,structure:55},   hit:110,dodge:25,baseDamage:44, iskDrop:500, xpDrop:20 },
      priest:   { name:"血袭者祭司", level:10, kind:"elite",  icon:"🧛", hp:{shield:220,armor:550,structure:110}, hit:140,dodge:35,baseDamage:66, iskDrop:1500,xpDrop:60 },
      cardinal: { name:"血袭者主教", level:20, kind:"boss",   icon:"🧛‍♂️", hp:{shield:65,armor:1853,structure:32},hit:170,dodge:45,baseDamage:96, iskDrop:4000,xpDrop:180 },
      ritual_destroyer:{ name:"血袭者仪式驱逐舰", level:20, kind:"normal", icon:"🧛", hp:{shield:220,armor:545,structure:135}, hit:130,dodge:40,baseDamage:82, iskDrop:500,xpDrop:40 },
      blood_destroyer:{ name:"血袭者鲜血驱逐舰", level:25, kind:"elite", icon:"🧛", hp:{shield:500,armor:1200,structure:300}, hit:160,dodge:55,baseDamage:123, iskDrop:1500,xpDrop:120 },
      high_priest:{ name:"血袭者大祭司", level:30, kind:"boss", icon:"🧛‍♂️", hp:{shield:200,armor:4200,structure:100}, hit:210,dodge:65,baseDamage:260, iskDrop:4000,xpDrop:360 },
      sermon_cruiser:{ name:"血袭者布道巡洋舰", level:40, kind:"normal", icon:"🧛", hp:{shield:702,armor:1755,structure:439}, hit:155,dodge:50,baseDamage:280, iskDrop:1000,xpDrop:70 },
      sacrament_cruiser:{ name:"血袭者圣礼巡洋舰", level:45, kind:"elite", icon:"🧛", hp:{shield:1580,armor:4037,structure:878}, hit:190,dodge:65,baseDamage:420, iskDrop:3000,xpDrop:210 },
      blood_archon:{ name:"血袭者鲜血执政官", level:50, kind:"boss", icon:"🧛‍♂️", hp:{shield:614,armor:13689,structure:263}, hit:245,dodge:80,baseDamage:840, iskDrop:8000,xpDrop:630 },
      iron_battleship:{ name:"血袭者铁血战列舰", level:60, kind:"normal", icon:"🧛", hp:{shield:2106,armor:5265,structure:1317}, hit:180,dodge:40,baseDamage:840, iskDrop:2000,xpDrop:120 },
      apostle_battleship:{ name:"血袭者使徒战列舰", level:65, kind:"elite", icon:"🧛", hp:{shield:4740,armor:12111,structure:2634}, hit:220,dodge:55,baseDamage:1260, iskDrop:6000,xpDrop:360 },
      blood_sovereign:{ name:"血袭者鲜血君王", level:70, kind:"boss", icon:"🧛‍♂️", hp:{shield:1842,armor:41067,structure:789}, hit:280,dodge:65,baseDamage:2570, iskDrop:16000,xpDrop:1080 }
    }
  },
  sansha: {
    name: "萨沙共和国",
    types: {
      drone:    { name:"萨沙无人机", level:1,  kind:"normal", icon:"🤖", hp:{shield:88,armor:55,structure:220},   hit:90,dodge:35,baseDamage:42, iskDrop:500, xpDrop:20 },
      sentinel: { name:"萨沙哨兵",   level:10, kind:"elite",  icon:"🤖", hp:{shield:220,armor:110,structure:550}, hit:120,dodge:45,baseDamage:63, iskDrop:1500,xpDrop:60 },
      overlord: { name:"萨沙领主",   level:20, kind:"boss",   icon:"👾", hp:{shield:65,armor:32,structure:1853},hit:150,dodge:55,baseDamage:96, iskDrop:4000,xpDrop:180 },
      control_destroyer:{ name:"萨沙控制驱逐舰", level:20, kind:"normal", icon:"🤖", hp:{shield:220,armor:135,structure:545}, hit:110,dodge:50,baseDamage:74, iskDrop:500,xpDrop:40 },
      sentinel_destroyer:{ name:"萨沙哨戒驱逐舰", level:25, kind:"elite", icon:"🤖", hp:{shield:500,armor:300,structure:1200}, hit:140,dodge:65,baseDamage:111, iskDrop:1500,xpDrop:120 },
      control_overlord:{ name:"萨沙控制领主", level:30, kind:"boss", icon:"👾", hp:{shield:200,armor:100,structure:4200}, hit:190,dodge:75,baseDamage:226, iskDrop:4000,xpDrop:360 },
      assimilation_cruiser:{ name:"萨沙同化巡洋舰", level:40, kind:"normal", icon:"🤖", hp:{shield:720,armor:450,structure:1800}, hit:135,dodge:60,baseDamage:250, iskDrop:1000,xpDrop:70 },
      dominion_cruiser:{ name:"萨沙支配巡洋舰", level:45, kind:"elite", icon:"🤖", hp:{shield:1620,armor:900,structure:4140}, hit:170,dodge:75,baseDamage:375, iskDrop:3000,xpDrop:210 },
      nexus_overlord:{ name:"萨沙枢纽领主", level:50, kind:"boss", icon:"👾", hp:{shield:630,armor:270,structure:14040}, hit:225,dodge:90,baseDamage:801, iskDrop:8000,xpDrop:630 },
      command_battleship:{ name:"萨沙指令战列舰", level:60, kind:"normal", icon:"🤖", hp:{shield:2160,armor:1350,structure:5400}, hit:160,dodge:50,baseDamage:750, iskDrop:2000,xpDrop:120 },
      domination_battleship:{ name:"萨沙统治战列舰", level:65, kind:"elite", icon:"🤖", hp:{shield:4860,armor:2700,structure:12420}, hit:200,dodge:65,baseDamage:1125, iskDrop:6000,xpDrop:360 },
      matrix_overlord:{ name:"萨沙矩阵领主", level:70, kind:"boss", icon:"👾", hp:{shield:1890,armor:810,structure:42120}, hit:260,dodge:75,baseDamage:2550, iskDrop:16000,xpDrop:1080 }
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
  ]
};

const COMBAT_ZONES = [
  { id:"angel_outpost",  name:"天使前哨站",  faction:"angel",  secLevel:"1.0-0.8", level:1, icon:"👹", enemyPool:{normal:["scout"],elite:["raider"],boss:["commander"]}, formationPool:"highsec", bossEscortCount:1, maxWave:20, clearLp:3, iskMulti:1.0, encryptedDataMaterial:"天使初级加密数据" },
  { id:"blood_hideout",  name:"血袭者隐蔽所", faction:"blood",  secLevel:"1.0-0.8", level:1, icon:"🧛", enemyPool:{normal:["acolyte"],elite:["priest"],boss:["cardinal"]}, formationPool:"highsec", bossEscortCount:1, maxWave:20, clearLp:3, iskMulti:1.0, encryptedDataMaterial:"血袭者初级加密数据" },
  { id:"sansha_outpost", name:"萨沙哨站",     faction:"sansha", secLevel:"1.0-0.8", level:1, icon:"🤖", enemyPool:{normal:["drone"],elite:["sentinel"],boss:["overlord"]}, formationPool:"highsec", bossEscortCount:1, maxWave:20, clearLp:3, iskMulti:1.0, encryptedDataMaterial:"萨沙初级加密数据" },
  { id:"angel_corridor", name:"天使劫掠走廊", faction:"angel", secLevel:"0.7-0.5", level:20, requiredCL:15, icon:"👹", enemyPool:{normal:["patrol_destroyer"],elite:["raider_destroyer"],boss:["hunter_commander"]}, formationPool:"bordersec", bossEscortCount:1, maxWave:20, clearLp:6, iskMulti:1.5, fuelMult:1.2, encryptedDataMaterial:"天使低级加密数据", encryptedDataChances:{elite:0.01,boss:0.04} },
  { id:"blood_sacrifice", name:"血袭者献祭场", faction:"blood", secLevel:"0.7-0.5", level:20, requiredCL:15, icon:"🧛", enemyPool:{normal:["ritual_destroyer"],elite:["blood_destroyer"],boss:["high_priest"]}, formationPool:"bordersec", bossEscortCount:1, maxWave:20, clearLp:6, iskMulti:1.5, fuelMult:1.2, encryptedDataMaterial:"血袭者低级加密数据", encryptedDataChances:{elite:0.01,boss:0.04} },
  { id:"sansha_node", name:"萨沙控制节点", faction:"sansha", secLevel:"0.7-0.5", level:20, requiredCL:15, icon:"🤖", enemyPool:{normal:["control_destroyer"],elite:["sentinel_destroyer"],boss:["control_overlord"]}, formationPool:"bordersec", bossEscortCount:1, maxWave:20, clearLp:6, iskMulti:1.5, fuelMult:1.2, encryptedDataMaterial:"萨沙低级加密数据", encryptedDataChances:{elite:0.01,boss:0.04} },
  { id:"angel_hunting_ground", name:"天使猎杀空域", faction:"angel", secLevel:"0.4-0.3", level:40, requiredCL:35, icon:"👹", enemyPool:{normal:["strike_cruiser"],elite:["war_cruiser"],boss:["fleet_commander"]}, formationPool:"lowsec", bossEscortCount:1, maxWave:20, clearLp:10, iskMulti:2.0, fuelMult:1.4, encryptedDataMaterial:"天使中级加密数据", encryptedDataChances:{elite:0.02,boss:0.06} },
  { id:"blood_cathedral", name:"血袭者深红圣堂", faction:"blood", secLevel:"0.4-0.3", level:40, requiredCL:35, icon:"🧛", enemyPool:{normal:["sermon_cruiser"],elite:["sacrament_cruiser"],boss:["blood_archon"]}, formationPool:"lowsec", bossEscortCount:1, maxWave:20, clearLp:10, iskMulti:2.0, fuelMult:1.4, encryptedDataMaterial:"血袭者中级加密数据", encryptedDataChances:{elite:0.02,boss:0.06} },
  { id:"sansha_nexus", name:"萨沙同化枢纽", faction:"sansha", secLevel:"0.4-0.3", level:40, requiredCL:35, icon:"🤖", enemyPool:{normal:["assimilation_cruiser"],elite:["dominion_cruiser"],boss:["nexus_overlord"]}, formationPool:"lowsec", bossEscortCount:1, maxWave:20, clearLp:10, iskMulti:2.0, fuelMult:1.4, encryptedDataMaterial:"萨沙中级加密数据", encryptedDataChances:{elite:0.02,boss:0.06} },
  { id:"angel_warfront", name:"天使破阵战场", faction:"angel", secLevel:"0.2-0.1", level:60, requiredCL:55, icon:"👹", enemyPool:{normal:["siege_battleship"],elite:["marauder_battleship"],boss:["war_master"]}, formationPool:"deepsec", bossEscortCount:1, maxWave:20, clearLp:15, iskMulti:2.5, fuelMult:1.6, encryptedDataMaterial:"天使高级加密数据", encryptedDataChances:{elite:0.03,boss:0.08} },
  { id:"blood_iron_basilica", name:"血袭者铁血圣殿", faction:"blood", secLevel:"0.2-0.1", level:60, requiredCL:55, icon:"🧛", enemyPool:{normal:["iron_battleship"],elite:["apostle_battleship"],boss:["blood_sovereign"]}, formationPool:"deepsec", bossEscortCount:1, maxWave:20, clearLp:15, iskMulti:2.5, fuelMult:1.6, encryptedDataMaterial:"血袭者高级加密数据", encryptedDataChances:{elite:0.03,boss:0.08} },
  { id:"sansha_command_matrix", name:"萨沙统御矩阵", faction:"sansha", secLevel:"0.2-0.1", level:60, requiredCL:55, icon:"🤖", enemyPool:{normal:["command_battleship"],elite:["domination_battleship"],boss:["matrix_overlord"]}, formationPool:"deepsec", bossEscortCount:1, maxWave:20, clearLp:15, iskMulti:2.5, fuelMult:1.6, encryptedDataMaterial:"萨沙高级加密数据", encryptedDataChances:{elite:0.03,boss:0.08} }
];

const STAR_BELT_DATA_MATERIALS = [...new Set(COMBAT_ZONES.map(zone => zone.encryptedDataMaterial).filter(Boolean))];

// combatBalance为各副本固定编队系数，不读取玩家状态：hp/damage作用于全层，finalHp/finalDamage只作用于最终层。
// 校准目标统一为成熟同级技能下：+5舰船/T1装配45%～55%，+10舰船/T1装配85%～95%。
const DEATHSPACE_DATABASE = [
  {
    id:"angel_ded_2_10", name:"天使2/10秘密补给站", faction:"angel", sourceZoneId:"angel_outpost", requiredCL:1, dedTier:2,
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
    id:"blood_ded_2_10", name:"血袭者2/10仪式地窖", faction:"blood", sourceZoneId:"blood_hideout", requiredCL:1, dedTier:2,
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
    id:"sansha_ded_2_10", name:"萨沙2/10控制哨所", faction:"sansha", sourceZoneId:"sansha_outpost", requiredCL:1, dedTier:2,
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
    id:"angel_ded_3_10", name:"天使3/10劫掠者船坞", faction:"angel", sourceZoneId:"angel_corridor", requiredCL:15, dedTier:3,
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
    id:"blood_ded_3_10", name:"血袭者3/10献祭圣所", faction:"blood", sourceZoneId:"blood_sacrifice", requiredCL:15, dedTier:3,
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
    id:"sansha_ded_3_10", name:"萨沙3/10同步节点", faction:"sansha", sourceZoneId:"sansha_node", requiredCL:15, dedTier:3,
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
    id:"angel_ded_4_10", name:"天使4/10舰队集结区", faction:"angel", sourceZoneId:"angel_hunting_ground", requiredCL:35, dedTier:4,
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
    id:"blood_ded_4_10", name:"血袭者4/10深红修道院", faction:"blood", sourceZoneId:"blood_cathedral", requiredCL:35, dedTier:4,
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
    id:"sansha_ded_4_10", name:"萨沙4/10同化中枢", faction:"sansha", sourceZoneId:"sansha_nexus", requiredCL:35, dedTier:4,
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
    id:"angel_ded_6_10", name:"天使6/10军事复合体", faction:"angel", sourceZoneId:"angel_warfront", requiredCL:55, dedTier:6,
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
    id:"blood_ded_6_10", name:"血袭者6/10海军造船厂", faction:"blood", sourceZoneId:"blood_iron_basilica", requiredCL:55, dedTier:6,
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
    id:"sansha_ded_6_10", name:"萨沙6/10战争设施", faction:"sansha", sourceZoneId:"sansha_command_matrix", requiredCL:55, dedTier:6,
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
const COMBAT_SPECIAL_MATERIALS = [...STAR_BELT_DATA_MATERIALS, ...DEATHSPACE_TICKET_MATERIALS, ...DEATHSPACE_LOOT_MATERIALS];

// 势力装备只通过装备工程制造；战斗仅掉落对应加密数据。
const FACTION_ENCRYPTED_DATA_DROPS = {
  angel:  { material:"天使初级加密数据", chances:{elite:0.005,boss:0.02}, qty:1 },
  blood:  { material:"血袭者初级加密数据", chances:{elite:0.005,boss:0.02}, qty:1 },
  sansha: { material:"萨沙初级加密数据", chances:{elite:0.005,boss:0.02}, qty:1 }
};
