// ---- 行星类型静态配置表 ----
// 正式首版经济：首次建设消耗 constructionCost（ISK + 三钛合金），维护期统一 24h（maintenanceDuration=86400）。
// 到期后停产，需手动支付 maintenanceCostISK 续期（续期只耗 ISK，不再耗三钛）。无等级/升级系统。
// 旧字段 costISK / costTrit 已移除；三钛合金资源寻址采用真实 ResourceRegistry key "mineral:三钛合金"。
const PLANET_TYPES = [
  { id:"lava",      name:"熔岩行星",   icon:"🌋", output:"重金属",     level:1,  interval:10, constructionCost:{ isk:138000,   resources:{ "mineral:三钛合金":100  } }, maintenanceCostISK:46000,   maintenanceDuration:86400 },
  { id:"gas",       name:"气态行星",   icon:"💨", output:"稀有气体",   level:1,  interval:10, constructionCost:{ isk:138000,   resources:{ "mineral:三钛合金":100  } }, maintenanceCostISK:46000,   maintenanceDuration:86400 },
  { id:"ice",       name:"冰行星",     icon:"❄️", output:"同位素",     level:20, interval:15, constructionCost:{ isk:249000,   resources:{ "mineral:三钛合金":150  } }, maintenanceCostISK:83000,   maintenanceDuration:86400 },
  { id:"plasma",    name:"等离子行星", icon:"🌌", output:"等离子体",   level:40, interval:18, constructionCost:{ isk:714000,   resources:{ "mineral:三钛合金":300  } }, maintenanceCostISK:238000,  maintenanceDuration:86400 },
  { id:"temperate", name:"温带行星",   icon:"🌍", output:"生物质",     level:60, interval:22, constructionCost:{ isk:1914000,  resources:{ "mineral:三钛合金":500  } }, maintenanceCostISK:638000,  maintenanceDuration:86400 },
  { id:"storm",     name:"风暴行星",   icon:"⛈️", output:"磁场聚合物", level:80, interval:30, constructionCost:{ isk:4899000,  resources:{ "mineral:三钛合金":1000 } }, maintenanceCostISK:1633000, maintenanceDuration:86400 }
];
