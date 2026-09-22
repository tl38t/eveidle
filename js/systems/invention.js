/* ================================================================
   蓝图发明 · 效率研究（ME / TE）

   规格：docs/INVENTION_LAB_JOB_SPEC_v0.1.md
   时间模型：逐条镜像 js/systems/research.js 的 processResearchUntil
             （唯一锚点 / 24h 封顶 / 虚拟游标 / 私有 startNextFromQueue
              不回调推进函数 / 锚点恒定收口 / 时钟倒退校准）。

   数据真值：78 张消耗品蓝图（63 增强剂 + 15 弹药/燃料/探针），
             由脚本从面板数据抽取注入（禁人工转录）。

   纪律：
   - 推进函数 processUntil 是唯一时间结算入口，在线（tick）与离线共用。
   - startNextFromQueue 绝不回调 processUntil（否则递归）。
   - 本模块不碰 DOM、不在加载期读 gameState。
   ================================================================ */

(function () {
  "use strict";

  /* ---------------------------------------------------------------
     常量（与设计锁定值一致，改这里等于改设计）
     --------------------------------------------------------------- */

  const SKILL_KEY = "blueprintInvention";
  const ISK_ID = "currency:isk";
  const MATRIX_ID = "matrix:analysis_matrix";

  const INVENTION_GATES = Object.freeze([1, 20, 40, 60, 80]);            // T1..T5 解锁门槛（蓝图发明等级）
  const INVENTION_MILESTONES = Object.freeze([10, 50, 250, 1250, 5000]); // I..V 累计研究次数
  const INVENTION_REDUCTIONS = Object.freeze([0.05, 0.10, 0.15, 0.20, 0.25]); // I..V 减免
  const INVENTION_ISK_PER_TIER = 2000;
  const INVENTION_MATRIX_PER_TIER = 1;
  const INVENTION_BASE_SECONDS = 30;

  const LAB_QUEUE_MAX = 3;
  const MAX_LAB_OFFLINE_SECONDS = 86400; // 与 offline.js MAX_OFFLINE_SECONDS / research.js 同值
  const LAB_GUARD_MAX_STEPS = 10000;
  const RESEARCH_HOUR_CAP_RATIO = 0.5;   // 科研工时抵扣上限：作业基础时间的 50%

  // 数据注入点（脚本写入，禁人工编辑）：78 张高频蓝图
  const INVENTION_BLUEPRINTS = [{"key":"ammo:ammo_cannon","name":"炮台弹药","cat":"弹药","sub":"ammunition","skill":"装备工程","E":1,"tier":1,"gate":"Lv1","xp":1,"time":10,"matTotal":4,"baseCost":"三钛合金×4","perIsk":2000,"perCore":1},{"key":"ammo:ammo_cannon_t2","name":"重型轨道弹药","cat":"弹药","sub":"ammunition","skill":"装备工程","E":1,"tier":1,"gate":"Lv1","xp":1,"time":25,"matTotal":10,"baseCost":"三钛合金×8 + 铂×2","perIsk":2000,"perCore":1},{"key":"ammo:ammo_laser","name":"激光晶体弹药","cat":"弹药","sub":"ammunition","skill":"装备工程","E":1,"tier":1,"gate":"Lv1","xp":1,"time":10,"matTotal":7,"baseCost":"三钛合金×4 + 稀有气体×3","perIsk":2000,"perCore":1},{"key":"ammo:ammo_laser_t2","name":"聚焦相位激光弹","cat":"弹药","sub":"ammunition","skill":"装备工程","E":1,"tier":1,"gate":"Lv1","xp":1,"time":25,"matTotal":10,"baseCost":"三钛合金×8 + 镓×2","perIsk":2000,"perCore":1},{"key":"ammo:ammo_missile","name":"导弹","cat":"弹药","sub":"ammunition","skill":"装备工程","E":1,"tier":1,"gate":"Lv1","xp":1,"time":10,"matTotal":6,"baseCost":"三钛合金×5 + 重金属×1","perIsk":2000,"perCore":1},{"key":"ammo:ammo_missile_t2","name":"高爆制导导弹","cat":"弹药","sub":"ammunition","skill":"装备工程","E":1,"tier":1,"gate":"Lv1","xp":1,"time":25,"matTotal":12,"baseCost":"三钛合金×10 + 镓×2","perIsk":2000,"perCore":1},{"key":"booster:mining_lubricant_n","name":"纳米采掘润滑剂·普通","cat":"增强剂","sub":"mining","skill":"增强剂制造","E":1,"tier":1,"gate":"Lv1","xp":1,"time":18,"matTotal":4,"baseCost":"planetary:重金属×2 + special:战术残液×2","perIsk":2000,"perCore":1},{"key":"fuel:fuel_t1","name":"标准燃料单元","cat":"燃料","sub":"fuel","skill":"装备工程","E":1,"tier":1,"gate":"Lv1","xp":1,"time":15,"matTotal":3,"baseCost":"粗制富勒烯×3","perIsk":2000,"perCore":1},{"key":"probe:probe_core_i","name":"标准考古探针 I","cat":"探针","sub":"probes","skill":"装备工程","E":1,"tier":1,"gate":"Lv1","xp":1,"time":15,"matTotal":40,"baseCost":"三钛合金×40","perIsk":2000,"perCore":1},{"key":"probe:probe_faction_i","name":"苍穹劫团考古探针·掠空型","cat":"探针","sub":"probes","skill":"装备工程","E":1,"tier":1,"gate":"Lv1","xp":1,"time":15,"matTotal":41,"baseCost":"三钛合金×40 + 苍穹劫团装备生产许可D×1","perIsk":2000,"perCore":1},{"key":"booster:shield_recharge_n","name":"护盾回充液·普通","cat":"增强剂","sub":"combatRepair","skill":"增强剂制造","E":4,"tier":1,"gate":"Lv1","xp":1,"time":18,"matTotal":3,"baseCost":"planetary:稀有气体×2 + gas:粗制富勒烯×1","perIsk":2000,"perCore":1},{"key":"booster:ore_resonance_n","name":"富矿共振催化剂·普通","cat":"增强剂","sub":"mining","skill":"增强剂制造","E":7,"tier":1,"gate":"Lv1","xp":1,"time":19,"matTotal":4,"baseCost":"planetary:重金属×2 + special:战术残液×2","perIsk":2000,"perCore":1},{"key":"booster:laser_coolant_n","name":"激光炮冷却剂·普通","cat":"增强剂","sub":"combatWeapon","skill":"增强剂制造","E":10,"tier":1,"gate":"Lv1","xp":2,"time":19,"matTotal":3,"baseCost":"planetary:稀有气体×2 + gas:氦同位素×1","perIsk":2000,"perCore":1},{"key":"booster:relic_solver_n","name":"遗迹解析液·普通","cat":"增强剂","sub":"archaeology","skill":"增强剂制造","E":13,"tier":1,"gate":"Lv1","xp":2,"time":20,"matTotal":4,"baseCost":"planetary:稀有气体×2 + special:战术残液×2","perIsk":2000,"perCore":1},{"key":"booster:armor_nano_n","name":"装甲纳米修复剂·普通","cat":"增强剂","sub":"combatRepair","skill":"增强剂制造","E":16,"tier":1,"gate":"Lv1","xp":2,"time":20,"matTotal":3,"baseCost":"planetary:稀有气体×2 + gas:氦同位素×1","perIsk":2000,"perCore":1},{"key":"booster:missile_catalyst_n","name":"导弹燃烧催化剂·普通","cat":"增强剂","sub":"combatWeapon","skill":"增强剂制造","E":20,"tier":2,"gate":"Lv20","xp":3,"time":21,"matTotal":3,"baseCost":"planetary:同位素×2 + gas:稳定富勒烯×1","perIsk":4000,"perCore":2},{"key":"fuel:fuel_t2","name":"强化燃料单元","cat":"燃料","sub":"fuel","skill":"装备工程","E":20,"tier":2,"gate":"Lv20","xp":3,"time":25,"matTotal":2,"baseCost":"稳定富勒烯×2","perIsk":4000,"perCore":2},{"key":"booster:artifact_tracer_n","name":"文物示踪剂·普通","cat":"增强剂","sub":"archaeology","skill":"增强剂制造","E":24,"tier":2,"gate":"Lv20","xp":4,"time":21,"matTotal":4,"baseCost":"planetary:同位素×2 + special:战术残液×2","perIsk":4000,"perCore":2},{"key":"booster:cannon_booster_n","name":"火炮增压药·普通","cat":"增强剂","sub":"combatWeapon","skill":"增强剂制造","E":28,"tier":2,"gate":"Lv20","xp":6,"time":22,"matTotal":3,"baseCost":"planetary:同位素×2 + gas:稳定富勒烯×1","perIsk":4000,"perCore":2},{"key":"booster:skill_overdrive_n","name":"技能超载催化器·普通","cat":"增强剂","sub":"training","skill":"增强剂制造","E":30,"tier":2,"gate":"Lv20","xp":7,"time":180,"matTotal":7,"baseCost":"planetary:同位素×3 + special:活性战术凝胶×4","perIsk":4000,"perCore":2},{"key":"booster:structure_gel_n","name":"结构再生胶·普通","cat":"增强剂","sub":"combatRepair","skill":"增强剂制造","E":32,"tier":2,"gate":"Lv20","xp":9,"time":22,"matTotal":3,"baseCost":"planetary:同位素×2 + gas:稳定富勒烯×1","perIsk":4000,"perCore":2},{"key":"booster:gas_rheology_n","name":"气云流变剂·普通","cat":"增强剂","sub":"gas","skill":"增强剂制造","E":33,"tier":2,"gate":"Lv20","xp":10,"time":64,"matTotal":7,"baseCost":"planetary:同位素×3 + special:活性战术凝胶×4","perIsk":4000,"perCore":2},{"key":"booster:fullerene_nucleation_n","name":"富勒烯成核剂·普通","cat":"增强剂","sub":"gas","skill":"增强剂制造","E":34,"tier":2,"gate":"Lv20","xp":11,"time":65,"matTotal":7,"baseCost":"planetary:同位素×3 + special:活性战术凝胶×4","perIsk":4000,"perCore":2},{"key":"booster:high_temp_flux_n","name":"高温助熔剂·普通","cat":"增强剂","sub":"refining","skill":"增强剂制造","E":35,"tier":2,"gate":"Lv20","xp":12,"time":67,"matTotal":7,"baseCost":"planetary:同位素×3 + special:活性战术凝胶×4","perIsk":4000,"perCore":2},{"key":"booster:mining_lubricant_r","name":"纳米采掘润滑剂·精工","cat":"增强剂","sub":"mining","skill":"增强剂制造","E":35,"tier":2,"gate":"Lv20","xp":12,"time":56,"matTotal":7,"baseCost":"planetary:同位素×3 + special:活性战术凝胶×4","perIsk":4000,"perCore":2},{"key":"probe:probe_enhanced_ii","name":"强化考古探针 II","cat":"探针","sub":"probes","skill":"装备工程","E":35,"tier":2,"gate":"Lv20","xp":12,"time":35,"matTotal":260,"baseCost":"三钛合金×200 + 类晶体胶矿×60","perIsk":4000,"perCore":2},{"key":"probe:probe_faction_ii","name":"赤誓教团考古探针·血誓型","cat":"探针","sub":"probes","skill":"装备工程","E":35,"tier":2,"gate":"Lv20","xp":12,"time":35,"matTotal":262,"baseCost":"三钛合金×200 + 类晶体胶矿×60 + 赤誓教团装备生产许可C×2","perIsk":4000,"perCore":2},{"key":"booster:lattice_proliferation_n","name":"晶格增殖剂·普通","cat":"增强剂","sub":"refining","skill":"增强剂制造","E":36,"tier":2,"gate":"Lv20","xp":13,"time":68,"matTotal":7,"baseCost":"planetary:同位素×3 + special:活性战术凝胶×4","perIsk":4000,"perCore":2},{"key":"booster:assembly_coordinator_n","name":"装配协调剂·普通","cat":"增强剂","sub":"ship","skill":"增强剂制造","E":37,"tier":2,"gate":"Lv20","xp":14,"time":70,"matTotal":7,"baseCost":"planetary:同位素×3 + special:活性战术凝胶×4","perIsk":4000,"perCore":2},{"key":"booster:equipment_assembly_n","name":"装备总装协调剂·普通","cat":"增强剂","sub":"equipment","skill":"增强剂制造","E":38,"tier":2,"gate":"Lv20","xp":15,"time":70,"matTotal":7,"baseCost":"planetary:同位素×3 + special:活性战术凝胶×4","perIsk":4000,"perCore":2},{"key":"booster:precision_rationing_n","name":"精密配给剂·普通","cat":"增强剂","sub":"ship,equipment","skill":"增强剂制造","E":38,"tier":2,"gate":"Lv20","xp":15,"time":70,"matTotal":7,"baseCost":"planetary:同位素×3 + special:活性战术凝胶×4","perIsk":4000,"perCore":2},{"key":"booster:reaction_accelerant_n","name":"反应加速介质·普通","cat":"增强剂","sub":"booster","skill":"增强剂制造","E":39,"tier":2,"gate":"Lv20","xp":17,"time":73,"matTotal":7,"baseCost":"planetary:同位素×3 + special:活性战术凝胶×4","perIsk":4000,"perCore":2},{"key":"booster:shield_recharge_r","name":"护盾回充液·精工","cat":"增强剂","sub":"combatRepair","skill":"增强剂制造","E":39,"tier":2,"gate":"Lv20","xp":17,"time":58,"matTotal":5,"baseCost":"planetary:稀有气体×3 + gas:稳定富勒烯×2","perIsk":4000,"perCore":2},{"key":"booster:reaction_chain_proliferation_n","name":"反应链增殖剂·普通","cat":"增强剂","sub":"booster","skill":"增强剂制造","E":40,"tier":3,"gate":"Lv40","xp":19,"time":74,"matTotal":7,"baseCost":"planetary:同位素×3 + special:活性战术凝胶×4","perIsk":6000,"perCore":3},{"key":"booster:neural_booster_n","name":"神经训练催化器·普通","cat":"增强剂","sub":"training","skill":"增强剂制造","E":42,"tier":3,"gate":"Lv40","xp":22,"time":64,"matTotal":11,"baseCost":"planetary:同位素×3 + special:活性战术凝胶×4 + gas:氦同位素×4","perIsk":6000,"perCore":3},{"key":"booster:ore_resonance_r","name":"富矿共振催化剂·精工","cat":"增强剂","sub":"mining","skill":"增强剂制造","E":43,"tier":3,"gate":"Lv40","xp":25,"time":60,"matTotal":7,"baseCost":"planetary:等离子体×3 + special:高能战术萃取物×4","perIsk":6000,"perCore":3},{"key":"booster:laser_coolant_r","name":"激光炮冷却剂·精工","cat":"增强剂","sub":"combatWeapon","skill":"增强剂制造","E":47,"tier":3,"gate":"Lv40","xp":36,"time":62,"matTotal":5,"baseCost":"planetary:等离子体×3 + gas:氢同位素×2","perIsk":6000,"perCore":3},{"key":"booster:relic_solver_r","name":"遗迹解析液·精工","cat":"增强剂","sub":"archaeology","skill":"增强剂制造","E":51,"tier":3,"gate":"Lv40","xp":52,"time":64,"matTotal":7,"baseCost":"planetary:等离子体×3 + special:高能战术萃取物×4","perIsk":6000,"perCore":3},{"key":"booster:armor_nano_r","name":"装甲纳米修复剂·精工","cat":"增强剂","sub":"combatRepair","skill":"增强剂制造","E":55,"tier":3,"gate":"Lv40","xp":76,"time":66,"matTotal":5,"baseCost":"planetary:等离子体×3 + gas:高纯富勒烯×2","perIsk":6000,"perCore":3},{"key":"fuel:fuel_t3","name":"超纯燃料单元","cat":"燃料","sub":"fuel","skill":"装备工程","E":55,"tier":3,"gate":"Lv40","xp":76,"time":50,"matTotal":52,"baseCost":"高纯富勒烯×2 + 稀有气体×50","perIsk":6000,"perCore":3},{"key":"booster:missile_catalyst_r","name":"导弹燃烧催化剂·精工","cat":"增强剂","sub":"combatWeapon","skill":"增强剂制造","E":59,"tier":3,"gate":"Lv40","xp":111,"time":68,"matTotal":5,"baseCost":"planetary:等离子体×3 + gas:高纯富勒烯×2","perIsk":6000,"perCore":3},{"key":"booster:mining_lubricant_l","name":"纳米采掘润滑剂·传奇","cat":"增强剂","sub":"mining","skill":"增强剂制造","E":60,"tier":4,"gate":"Lv60","xp":122,"time":128,"matTotal":12,"baseCost":"planetary:生物质×5 + special:极化战术介质×7","perIsk":8000,"perCore":4},{"key":"booster:artifact_tracer_r","name":"文物示踪剂·精工","cat":"增强剂","sub":"archaeology","skill":"增强剂制造","E":63,"tier":4,"gate":"Lv60","xp":163,"time":70,"matTotal":7,"baseCost":"planetary:生物质×3 + special:极化战术介质×4","perIsk":8000,"perCore":4},{"key":"booster:shield_recharge_l","name":"护盾回充液·传奇","cat":"增强剂","sub":"combatRepair","skill":"增强剂制造","E":64,"tier":4,"gate":"Lv60","xp":179,"time":131,"matTotal":8,"baseCost":"planetary:生物质×5 + gas:高纯富勒烯×3","perIsk":8000,"perCore":4},{"key":"booster:cannon_booster_r","name":"火炮增压药·精工","cat":"增强剂","sub":"combatWeapon","skill":"增强剂制造","E":67,"tier":4,"gate":"Lv60","xp":238,"time":72,"matTotal":5,"baseCost":"planetary:等离子体×3 + gas:高纯富勒烯×2","perIsk":8000,"perCore":4},{"key":"booster:ore_resonance_l","name":"富矿共振催化剂·传奇","cat":"增强剂","sub":"mining","skill":"增强剂制造","E":68,"tier":4,"gate":"Lv60","xp":262,"time":135,"matTotal":12,"baseCost":"planetary:等离子体×5 + special:极化战术介质×7","perIsk":8000,"perCore":4},{"key":"booster:skill_overdrive_r","name":"技能超载催化器·精工","cat":"增强剂","sub":"training","skill":"增强剂制造","E":70,"tier":4,"gate":"Lv60","xp":316,"time":180,"matTotal":7,"baseCost":"planetary:等离子体×3 + special:高能战术萃取物×4","perIsk":8000,"perCore":4},{"key":"probe:probe_deep_iii","name":"深空考古探针 III","cat":"探针","sub":"probes","skill":"装备工程","E":70,"tier":4,"gate":"Lv60","xp":316,"time":75,"matTotal":613,"baseCost":"三钛合金×600 + 超噬矿×10 + 铷×3","perIsk":8000,"perCore":4},{"key":"probe:probe_faction_iii","name":"静默集群考古探针·同化型","cat":"探针","sub":"probes","skill":"装备工程","E":70,"tier":4,"gate":"Lv60","xp":316,"time":75,"matTotal":616,"baseCost":"三钛合金×600 + 超噬矿×10 + 铷×3 + 静默集群装备生产许可B×3","perIsk":8000,"perCore":4},{"key":"booster:structure_gel_r","name":"结构再生胶·精工","cat":"增强剂","sub":"combatRepair","skill":"增强剂制造","E":71,"tier":4,"gate":"Lv60","xp":348,"time":74,"matTotal":7,"baseCost":"planetary:生物质×3 + special:极化战术介质×4","perIsk":8000,"perCore":4},{"key":"booster:laser_coolant_l","name":"激光炮冷却剂·传奇","cat":"增强剂","sub":"combatWeapon","skill":"增强剂制造","E":72,"tier":4,"gate":"Lv60","xp":383,"time":138,"matTotal":8,"baseCost":"planetary:生物质×5 + gas:聚合气体×3","perIsk":8000,"perCore":4},{"key":"booster:gas_rheology_r","name":"气云流变剂·精工","cat":"增强剂","sub":"gas","skill":"增强剂制造","E":73,"tier":4,"gate":"Lv60","xp":421,"time":124,"matTotal":7,"baseCost":"planetary:等离子体×3 + special:高能战术萃取物×4","perIsk":8000,"perCore":4},{"key":"booster:fullerene_nucleation_r","name":"富勒烯成核剂·精工","cat":"增强剂","sub":"gas","skill":"增强剂制造","E":74,"tier":4,"gate":"Lv60","xp":463,"time":125,"matTotal":7,"baseCost":"planetary:等离子体×3 + special:高能战术萃取物×4","perIsk":8000,"perCore":4},{"key":"booster:high_temp_flux_r","name":"高温助熔剂·精工","cat":"增强剂","sub":"refining","skill":"增强剂制造","E":75,"tier":4,"gate":"Lv60","xp":509,"time":127,"matTotal":7,"baseCost":"planetary:等离子体×3 + special:高能战术萃取物×4","perIsk":8000,"perCore":4},{"key":"booster:lattice_proliferation_r","name":"晶格增殖剂·精工","cat":"增强剂","sub":"refining","skill":"增强剂制造","E":76,"tier":4,"gate":"Lv60","xp":560,"time":128,"matTotal":7,"baseCost":"planetary:等离子体×3 + special:高能战术萃取物×4","perIsk":8000,"perCore":4},{"key":"booster:relic_solver_l","name":"遗迹解析液·传奇","cat":"增强剂","sub":"archaeology","skill":"增强剂制造","E":76,"tier":4,"gate":"Lv60","xp":560,"time":142,"matTotal":12,"baseCost":"planetary:生物质×5 + special:极化战术介质×7","perIsk":8000,"perCore":4},{"key":"booster:assembly_coordinator_r","name":"装配协调剂·精工","cat":"增强剂","sub":"ship","skill":"增强剂制造","E":77,"tier":4,"gate":"Lv60","xp":616,"time":130,"matTotal":7,"baseCost":"planetary:等离子体×3 + special:高能战术萃取物×4","perIsk":8000,"perCore":4},{"key":"booster:equipment_assembly_r","name":"装备总装协调剂·精工","cat":"增强剂","sub":"equipment","skill":"增强剂制造","E":78,"tier":4,"gate":"Lv60","xp":678,"time":130,"matTotal":7,"baseCost":"planetary:等离子体×3 + special:高能战术萃取物×4","perIsk":8000,"perCore":4},{"key":"booster:precision_rationing_r","name":"精密配给剂·精工","cat":"增强剂","sub":"ship,equipment","skill":"增强剂制造","E":78,"tier":4,"gate":"Lv60","xp":678,"time":130,"matTotal":7,"baseCost":"planetary:等离子体×3 + special:高能战术萃取物×4","perIsk":8000,"perCore":4},{"key":"booster:reaction_accelerant_r","name":"反应加速介质·精工","cat":"增强剂","sub":"booster","skill":"增强剂制造","E":79,"tier":4,"gate":"Lv60","xp":745,"time":133,"matTotal":7,"baseCost":"planetary:等离子体×3 + special:高能战术萃取物×4","perIsk":8000,"perCore":4},{"key":"booster:armor_nano_l","name":"装甲纳米修复剂·传奇","cat":"增强剂","sub":"combatRepair","skill":"增强剂制造","E":80,"tier":5,"gate":"Lv80","xp":820,"time":146,"matTotal":8,"baseCost":"planetary:磁场聚合物×5 + gas:聚合气体×3","perIsk":10000,"perCore":5},{"key":"booster:reaction_chain_proliferation_r","name":"反应链增殖剂·精工","cat":"增强剂","sub":"booster","skill":"增强剂制造","E":80,"tier":5,"gate":"Lv80","xp":820,"time":134,"matTotal":7,"baseCost":"planetary:等离子体×3 + special:高能战术萃取物×4","perIsk":10000,"perCore":5},{"key":"booster:neural_booster_r","name":"神经训练催化器·精工","cat":"增强剂","sub":"training","skill":"增强剂制造","E":82,"tier":5,"gate":"Lv80","xp":992,"time":124,"matTotal":11,"baseCost":"planetary:等离子体×3 + special:高能战术萃取物×4 + gas:氢同位素×4","perIsk":10000,"perCore":5},{"key":"booster:missile_catalyst_l","name":"导弹燃烧催化剂·传奇","cat":"增强剂","sub":"combatWeapon","skill":"增强剂制造","E":84,"tier":5,"gate":"Lv80","xp":1200,"time":149,"matTotal":8,"baseCost":"planetary:磁场聚合物×5 + gas:聚合气体×3","perIsk":10000,"perCore":5},{"key":"booster:artifact_tracer_l","name":"文物示踪剂·传奇","cat":"增强剂","sub":"archaeology","skill":"增强剂制造","E":88,"tier":5,"gate":"Lv80","xp":1757,"time":153,"matTotal":12,"baseCost":"planetary:磁场聚合物×5 + special:深层适应性样本×7","perIsk":10000,"perCore":5},{"key":"booster:gas_rheology_l","name":"气云流变剂·传奇","cat":"增强剂","sub":"gas","skill":"增强剂制造","E":89,"tier":5,"gate":"Lv80","xp":1933,"time":148,"matTotal":12,"baseCost":"planetary:生物质×5 + special:极化战术介质×7","perIsk":10000,"perCore":5},{"key":"booster:fullerene_nucleation_l","name":"富勒烯成核剂·传奇","cat":"增强剂","sub":"gas","skill":"增强剂制造","E":90,"tier":5,"gate":"Lv80","xp":2126,"time":149,"matTotal":12,"baseCost":"planetary:生物质×5 + special:极化战术介质×7","perIsk":10000,"perCore":5},{"key":"booster:high_temp_flux_l","name":"高温助熔剂·传奇","cat":"增强剂","sub":"refining","skill":"增强剂制造","E":91,"tier":5,"gate":"Lv80","xp":2338,"time":151,"matTotal":12,"baseCost":"planetary:生物质×5 + special:极化战术介质×7","perIsk":10000,"perCore":5},{"key":"booster:cannon_booster_l","name":"火炮增压药·传奇","cat":"增强剂","sub":"combatWeapon","skill":"增强剂制造","E":92,"tier":5,"gate":"Lv80","xp":2572,"time":156,"matTotal":8,"baseCost":"planetary:磁场聚合物×5 + gas:超纯聚合气体×3","perIsk":10000,"perCore":5},{"key":"booster:lattice_proliferation_l","name":"晶格增殖剂·传奇","cat":"增强剂","sub":"refining","skill":"增强剂制造","E":92,"tier":5,"gate":"Lv80","xp":2572,"time":152,"matTotal":12,"baseCost":"planetary:生物质×5 + special:极化战术介质×7","perIsk":10000,"perCore":5},{"key":"booster:skill_overdrive_l","name":"技能超载催化器·传奇","cat":"增强剂","sub":"training","skill":"增强剂制造","E":92,"tier":5,"gate":"Lv80","xp":2572,"time":180,"matTotal":12,"baseCost":"planetary:生物质×5 + special:极化战术介质×7","perIsk":10000,"perCore":5},{"key":"booster:assembly_coordinator_l","name":"装配协调剂·传奇","cat":"增强剂","sub":"ship","skill":"增强剂制造","E":93,"tier":5,"gate":"Lv80","xp":2829,"time":154,"matTotal":12,"baseCost":"planetary:生物质×5 + special:极化战术介质×7","perIsk":10000,"perCore":5},{"key":"booster:equipment_assembly_l","name":"装备总装协调剂·传奇","cat":"增强剂","sub":"equipment","skill":"增强剂制造","E":94,"tier":5,"gate":"Lv80","xp":3112,"time":154,"matTotal":12,"baseCost":"planetary:生物质×5 + special:极化战术介质×7","perIsk":10000,"perCore":5},{"key":"booster:precision_rationing_l","name":"精密配给剂·传奇","cat":"增强剂","sub":"ship,equipment","skill":"增强剂制造","E":94,"tier":5,"gate":"Lv80","xp":3112,"time":154,"matTotal":12,"baseCost":"planetary:生物质×5 + special:极化战术介质×7","perIsk":10000,"perCore":5},{"key":"booster:reaction_accelerant_l","name":"反应加速介质·传奇","cat":"增强剂","sub":"booster","skill":"增强剂制造","E":95,"tier":5,"gate":"Lv80","xp":3423,"time":157,"matTotal":12,"baseCost":"planetary:生物质×5 + special:极化战术介质×7","perIsk":10000,"perCore":5},{"key":"booster:reaction_chain_proliferation_l","name":"反应链增殖剂·传奇","cat":"增强剂","sub":"booster","skill":"增强剂制造","E":96,"tier":5,"gate":"Lv80","xp":3765,"time":158,"matTotal":12,"baseCost":"planetary:生物质×5 + special:极化战术介质×7","perIsk":10000,"perCore":5},{"key":"booster:structure_gel_l","name":"结构再生胶·传奇","cat":"增强剂","sub":"combatRepair","skill":"增强剂制造","E":96,"tier":5,"gate":"Lv80","xp":3765,"time":160,"matTotal":8,"baseCost":"planetary:磁场聚合物×5 + gas:超纯聚合气体×3","perIsk":10000,"perCore":5},{"key":"booster:neural_booster_l","name":"神经训练催化器·传奇","cat":"增强剂","sub":"training","skill":"增强剂制造","E":98,"tier":5,"gate":"Lv80","xp":4556,"time":148,"matTotal":14,"baseCost":"planetary:生物质×5 + special:极化战术介质×7 + gas:聚合气体×2","perIsk":10000,"perCore":5}];

  const BP_BY_KEY = Object.create(null);
  for (const bp of INVENTION_BLUEPRINTS) BP_BY_KEY[bp.key] = bp;

  /* ---------------------------------------------------------------
     纯函数：规则查询
     --------------------------------------------------------------- */

  function blueprintByKey(key) { return BP_BY_KEY[key] || null; }

  function listBlueprints() { return INVENTION_BLUEPRINTS; }

  // 档位门槛：T1..T5 → 1/20/40/60/80
  function tierGate(tier) {
    const t = Math.max(1, Math.min(5, Math.floor(Number(tier) || 1)));
    return INVENTION_GATES[t - 1];
  }

  // 累计次数 → 里程碑等级 0..5
  function milestoneLevel(count) {
    const n = Math.max(0, Math.floor(Number(count) || 0));
    let level = 0;
    for (let i = 0; i < INVENTION_MILESTONES.length; i++) {
      if (n >= INVENTION_MILESTONES[i]) level = i + 1;
    }
    return level;
  }

  // 里程碑等级 → 减免比例
  function reductionFor(level) {
    const l = Math.max(0, Math.min(5, Math.floor(Number(level) || 0)));
    return l === 0 ? 0 : INVENTION_REDUCTIONS[l - 1];
  }

  // 单次研究经验：ceil(0.4 × 1.1^E)，E = 该蓝图的制造需求等级
  function xpForBlueprint(bp) {
    const e = Math.max(0, Number(bp && bp.E) || 0);
    return Math.ceil(0.4 * Math.pow(1.1, e));
  }

  function iskPerCycle(bp) { return INVENTION_ISK_PER_TIER * Math.max(1, Math.floor(Number(bp && bp.tier) || 1)); }
  function matrixPerCycle(bp) { return INVENTION_MATRIX_PER_TIER * Math.max(1, Math.floor(Number(bp && bp.tier) || 1)); }

  /* ---------------------------------------------------------------
     实验室速度乘区链
     🔴 必须用 getStationLogisticsBaseMultiplier（不含 getGameSpeed）：
        在线 tick 已用 processUntil(..., {scale:getGameSpeed()}) 缩放 elapsed，
        再用带速度的版本会双倍加速。
     --------------------------------------------------------------- */

  function labSpeed(state) {
    let mult = 1;
    let lvl = 1;
    if (typeof getEffectiveSkillLevel === "function") lvl = getEffectiveSkillLevel(state, SKILL_KEY);
    else if (state && state.skills && state.skills[SKILL_KEY]) lvl = Number(state.skills[SKILL_KEY].lvl) || 1;
    mult *= 1 + Math.max(0, Number(lvl) || 0) * 0.02;

    if (typeof getStationLogisticsBaseMultiplier === "function") {
      mult *= Math.max(0.001, Number(getStationLogisticsBaseMultiplier(state, "invention")) || 1);
    }
    if (typeof ResearchState !== "undefined" && ResearchState && typeof ResearchState.getResearchMultiplier === "function") {
      mult *= Math.max(0.001, Number(ResearchState.getResearchMultiplier(state, ["invention"])) || 1);
    }
    if (typeof getImplantBonuses === "function") {
      const b = getImplantBonuses(state);
      if (b && Number(b.inventionEff) > 0) mult *= Number(b.inventionEff);
    }
    if (typeof getBoosterEffectState === "function") {
      const e = getBoosterEffectState(state);
      if (e && Number(e.inventionSpeedMultiplier) > 0) mult *= Number(e.inventionSpeedMultiplier);
    }
    if (typeof LEGION_NPC !== "undefined" && LEGION_NPC && typeof LEGION_NPC.getLegionContributionSnapshot === "function") {
      const m = LEGION_NPC.getLegionContributionSnapshot(state).multipliers;
      if (m && Number(m.invention) > 0) mult *= Number(m.invention);
    }
    return mult > 0 ? mult : 1;
  }

  // 单次循环秒数：30 × 档 ÷ 实验室速度
  function cycleSeconds(state, bp) {
    if (!bp) return INVENTION_BASE_SECONDS;
    const speed = labSpeed(state);
    return Math.max(0.001, (INVENTION_BASE_SECONDS * Math.max(1, Math.floor(Number(bp.tier) || 1))) / speed);
  }

  /* ---------------------------------------------------------------
     状态存取（幂等）
     --------------------------------------------------------------- */

  function ensureState(state, now) {
    if (!state) return null;
    const anchor = (typeof now === "number" && isFinite(now) && now > 0) ? now : 0;
    if (!state.invention || typeof state.invention !== "object" || Array.isArray(state.invention)) {
      state.invention = { schemaVersion: 1, lab: null, blueprints: {} };
    }
    const inv = state.invention;
    if (typeof inv.schemaVersion !== "number") inv.schemaVersion = 1;
    if (!inv.blueprints || typeof inv.blueprints !== "object" || Array.isArray(inv.blueprints)) inv.blueprints = {};
    if (!inv.lab || typeof inv.lab !== "object" || Array.isArray(inv.lab)) {
      inv.lab = { lastProcessedAt: anchor, activeJob: null, queue: [], pausedReason: null };
    }
    const lab = inv.lab;
    if (typeof lab.lastProcessedAt !== "number" || !isFinite(lab.lastProcessedAt)) lab.lastProcessedAt = anchor;
    if (!Array.isArray(lab.queue)) lab.queue = [];
    if (lab.queue.length > LAB_QUEUE_MAX) lab.queue.length = LAB_QUEUE_MAX;
    if (lab.activeJob !== null && (typeof lab.activeJob !== "object" || Array.isArray(lab.activeJob))) lab.activeJob = null;
    if (typeof lab.pausedReason !== "string") lab.pausedReason = null;
    // 资源池（matrix）由 persistence 的池迁移负责；这里只保证读取安全
    return inv;
  }

  // 取（或建）单张蓝图的研究记录；不传 create 则只读、绝不创建
  function blueprintState(state, key, create) {
    const inv = state && state.invention ? state.invention : null;
    if (!inv || !inv.blueprints) return null;
    let entry = inv.blueprints[key];
    if (!entry || typeof entry !== "object") {
      if (!create) return null;
      entry = { meCount: 0, teCount: 0, savingProgress: {} };
      inv.blueprints[key] = entry;
    }
    if (typeof entry.meCount !== "number" || !isFinite(entry.meCount)) entry.meCount = 0;
    if (typeof entry.teCount !== "number" || !isFinite(entry.teCount)) entry.teCount = 0;
    if (!entry.savingProgress || typeof entry.savingProgress !== "object") entry.savingProgress = {};
    return entry;
  }

  function researchCount(state, key, dir) {
    const e = blueprintState(state, key, false);
    if (!e) return 0;
    return dir === "te" ? e.teCount : e.meCount;
  }

  // ME / TE 减免比例（0 / 0.05 / ... / 0.25）；供制造报价与时间函数读取
  function meReduction(state, key) { return reductionFor(milestoneLevel(researchCount(state, key, "me"))); }
  function teReduction(state, key) { return reductionFor(milestoneLevel(researchCount(state, key, "te"))); }

  // 制造配方 → 发明蓝图 key 映射（ME/TE 减免的唯一真值源）。
  // 仅当该配方在 INVENTION_BLUEPRINTS 有对应蓝图时返回 key；纯装备（mining/gas 等无蓝图）返回 null。
  // 关键：增强剂 recipe 的 category 字段是 UI 分组标签（mining/archery/combatWeapon…），并非蓝图前缀；
  // 所有增强剂蓝图的 key 前缀恒为 "booster:"，故必须用 output.type==="booster" 判定，不能依赖 category。
  function recipeKeyForRecipe(recipe) {
    if (!recipe || !recipe.id) return null;
    // 增强剂：产物类型恒为 booster，蓝图 key 前缀恒为 "booster:"（与 recipe.category 无关）。
    if (recipe.output && recipe.output.type === "booster") return "booster:" + recipe.id;
    // 装备工程三类（弹药/燃料/探针）：产业 category 直接决定蓝图前缀。
    const cat = recipe.category;
    let prefix = null;
    if (cat === "ammunition") prefix = "ammo";
    else if (cat === "fuel") prefix = "fuel";
    else if (cat === "probes") prefix = "probe";
    if (!prefix) return null;
    return prefix + ":" + recipe.id;
  }

  // 在 baseCost（配方原材料 ref→qty 映射）上叠加该配方对应蓝图的 ME 里程碑减免。
  // 取整 floor + 下限 1（与装备工程槽折扣口径一致）；无对应蓝图或无减免则原样返回。
  function applyMeReduction(state, recipe, baseCost) {
    const key = recipeKeyForRecipe(recipe);
    if (!key) return baseCost;
    const r = meReduction(state, key);
    if (!r) return baseCost;
    const src = baseCost || (recipe && recipe.cost) || {};
    const out = {};
    for (const ref in src) {
      if (!Object.prototype.hasOwnProperty.call(src, ref)) continue;
      let c = Math.floor(Number(src[ref]) * (1 - r));
      if (!(c >= 1)) c = 1;
      out[ref] = c;
    }
    return out;
  }

  function meReductionForRecipe(state, recipe) {
    const key = recipeKeyForRecipe(recipe);
    if (!key) return 0;
    return meReduction(state, key);
  }
  // TE 减免比例（0 / 0.05 / ... / 0.25）；与 meReductionForRecipe 对称，供制造耗时真值函数读取。
  function teReductionForRecipe(state, recipe) {
    const key = recipeKeyForRecipe(recipe);
    if (!key) return 0;
    return teReduction(state, key);
  }

  function isUnlocked(state, bp) {
    if (!bp) return false;
    let lvl = 1;
    if (typeof getEffectiveSkillLevel === "function") lvl = getEffectiveSkillLevel(state, SKILL_KEY);
    else if (state && state.skills && state.skills[SKILL_KEY]) lvl = Number(state.skills[SKILL_KEY].lvl) || 1;
    return (Number(lvl) || 0) >= tierGate(bp.tier);
  }

  /* ---------------------------------------------------------------
     扣费（不预扣；每完成 1 循环扣 1 份，故取消无需退款逻辑）
     --------------------------------------------------------------- */

  function canPayOneCycle(state, job) {
    const bp = BP_BY_KEY[job && job.key];
    if (!bp) return false;
    const isk = iskPerCycle(bp);
    const mat = matrixPerCycle(bp);
    if (typeof ResourceRegistry === "undefined") return false;
    if (Number(ResourceRegistry.get(state, ISK_ID)) < isk) return false;
    if (Number(ResourceRegistry.get(state, MATRIX_ID)) < mat) return false;
    return true;
  }

  function payOneCycle(state, job) {
    const bp = BP_BY_KEY[job && job.key];
    if (!bp) return false;
    if (!canPayOneCycle(state, job)) return false;
    ResourceRegistry.spend(state, ISK_ID, iskPerCycle(bp));
    ResourceRegistry.spend(state, MATRIX_ID, matrixPerCycle(bp));
    return true;
  }

  /* ---------------------------------------------------------------
     推进：唯一时间结算入口
     --------------------------------------------------------------- */

  let CLOCK_DRIFT_WARNED = false;

  function completeCycle(state, atMs) {
    const lab = state.invention.lab;
    const job = lab.activeJob;
    if (!job) return false;
    if (!payOneCycle(state, job)) return false;   // 资源不足：不完成、不推进
    const bp = BP_BY_KEY[job.key];
    job.done = Math.max(0, Number(job.done) || 0) + 1;
    const entry = blueprintState(state, job.key, true);
    if (entry) {
      if (job.dir === "te") entry.teCount = Math.max(0, Number(entry.teCount) || 0) + 1;
      else entry.meCount = Math.max(0, Number(entry.meCount) || 0) + 1;
    }
    if (typeof addSkillXpToState === "function" && bp) {
      addSkillXpToState(state, SKILL_KEY, xpForBlueprint(bp), { job: SKILL_KEY });
    }
    if (typeof GameEvents !== "undefined" && GameEvents && typeof GameEvents.emit === "function") {
      GameEvents.emit("invention:cycleCompleted", {
        key: job.key, dir: job.dir, done: job.done, times: job.times,
        isk: bp ? iskPerCycle(bp) : 0, matrix: bp ? matrixPerCycle(bp) : 0,
        xp: bp ? xpForBlueprint(bp) : 0
      }, { offline: false });
    }
    state._dirty = true;
    return true;
  }

  // 私有原语：队列 shift → 组装 activeJob。绝不回调 processUntil。
  function startNextFromQueue(state, atMs) {
    const lab = state.invention.lab;
    lab.activeJob = null;
    lab.pausedReason = null;
    if (!Array.isArray(lab.queue) || lab.queue.length === 0) return null;
    const next = lab.queue.shift();
    const bp = BP_BY_KEY[next.key];
    if (!bp) return startNextFromQueue(state, atMs); // 脏数据：跳过
    const per = cycleSeconds(state, bp);
    lab.activeJob = {
      key: next.key,
      dir: next.dir === "te" ? "te" : "me",
      times: Math.max(1, Math.floor(Number(next.times) || 1)),
      done: 0,
      perSeconds: per,
      remainingSeconds: per,
      startedAt: atMs,
      baseTotalSeconds: per * Math.max(1, Math.floor(Number(next.times) || 1)),
      appliedAchievementSeconds: 0
    };
    return lab.activeJob;
  }

  function processUntil(state, now, opts) {
    const inv = ensureState(state, now);
    if (!inv) return { ok: false, reason: "NO_STATE", cycles: 0 };
    const lab = inv.lab;
    const resolvedNow = (typeof now === "number" && isFinite(now) && now > 0)
      ? now
      : ((typeof Date !== "undefined" && Date.now) ? Date.now() : 0);
    const oldAnchor = lab.lastProcessedAt;
    if (typeof oldAnchor !== "number" || !isFinite(oldAnchor) || oldAnchor <= 0) {
      // 坏锚点：视为无可结算时间，直接收口到 now（不白给 elapsed）
      lab.lastProcessedAt = resolvedNow > 0 ? resolvedNow : oldAnchor;
      return { ok: true, cycles: 0 };
    }

    const scale = (opts && typeof opts.scale === "number" && isFinite(opts.scale) && opts.scale > 0) ? opts.scale : 1;
    const rawElapsed = Math.max(0, (resolvedNow - oldAnchor) / 1000);
    let elapsed = Math.min(rawElapsed, MAX_LAB_OFFLINE_SECONDS) * scale;
    let cursorAt = oldAnchor;
    let cycles = 0;
    let guard = 0;

    while (elapsed > 0 && lab.activeJob && typeof lab.activeJob === "object") {
      guard += 1;
      if (guard > LAB_GUARD_MAX_STEPS) break;           // 坏档死循环守卫

      const job = lab.activeJob;

      // ① 资源闸门：不足则暂停，不消耗 elapsed（暂停期不积攒）
      if (!canPayOneCycle(state, job)) {
        lab.pausedReason = "NO_RESOURCE";
        elapsed = 0;
        break;
      }
      if (lab.pausedReason) lab.pausedReason = null;

      const stepLeft = Number(job.remainingSeconds);
      if (!isFinite(stepLeft) || stepLeft <= 0) {
        // 防御：非法/已耗尽剩余时间 → 立即完成该循环（不消耗 elapsed，游标不动）
        if (completeCycle(state, cursorAt)) {
          cycles += 1;
          if (job.done >= job.times) startNextFromQueue(state, cursorAt);
        } else {
          lab.pausedReason = "NO_RESOURCE";
          elapsed = 0;
          break;
        }
        continue;
      }

      if (elapsed >= stepLeft) {
        // 完成整循环（含 exact boundary：elapsed === stepLeft 也完成）
        elapsed -= stepLeft;
        cursorAt += stepLeft * 1000;
        if (completeCycle(state, cursorAt)) {
          cycles += 1;
          if (job.done >= job.times) startNextFromQueue(state, cursorAt);
          else job.remainingSeconds = Number(job.perSeconds) || stepLeft;
        } else {
          lab.pausedReason = "NO_RESOURCE";
          elapsed = 0;
          break;
        }
      } else {
        job.remainingSeconds = stepLeft - elapsed;   // 浮点，不整数化
        cursorAt += elapsed * 1000;
        elapsed = 0;
        state._dirty = true;
      }
    }

    // 时钟倒退校准（与 research.js 2026-09-08 修复同源）
    if (!CLOCK_DRIFT_WARNED && oldAnchor - resolvedNow > 60000) {
      CLOCK_DRIFT_WARNED = true;
      try {
        console.warn("[invention] 存档时间锚点超前系统时钟 " +
          Math.round((oldAnchor - resolvedNow) / 60000) +
          " 分钟（多为调系统时钟后拨回所致），已自动校准。");
      } catch (_) { /* 告警失败不阻塞结算 */ }
    }
    lab.lastProcessedAt = resolvedNow > 0 ? resolvedNow : oldAnchor;
    return { ok: true, cycles: cycles };
  }

  /* ---------------------------------------------------------------
     公共 API（每个都先 processUntil(now) 再操作）
     --------------------------------------------------------------- */

  function enqueueJob(state, key, dir, times, now) {
    const resolvedNow = (typeof now === "number" && isFinite(now) && now > 0) ? now : Date.now();
    processUntil(state, resolvedNow);
    const inv = ensureState(state, resolvedNow);
    const bp = BP_BY_KEY[key];
    if (!bp) return { ok: false, reason: "UNKNOWN_BLUEPRINT" };
    const d = dir === "te" ? "te" : "me";
    const n = Math.max(1, Math.floor(Number(times) || 1));
    if (!isUnlocked(state, bp)) return { ok: false, reason: "LOCKED", gate: tierGate(bp.tier) };
    const lab = inv.lab;
    if (lab.queue.length >= LAB_QUEUE_MAX) return { ok: false, reason: "QUEUE_FULL" };
    lab.queue.push({ key: key, dir: d, times: n });
    if (!lab.activeJob) startNextFromQueue(state, resolvedNow);
    state._dirty = true;
    return { ok: true, queued: n };
  }

  // 取消当前作业：已完成的循环已扣不退，未开始的不扣 → 无退款逻辑
  function cancelJob(state, now) {
    const resolvedNow = (typeof now === "number" && isFinite(now) && now > 0) ? now : Date.now();
    processUntil(state, resolvedNow);
    const inv = ensureState(state, resolvedNow);
    const lab = inv.lab;
    if (!lab.activeJob) return { ok: false, reason: "NO_ACTIVE_JOB" };
    lab.activeJob = null;
    lab.pausedReason = null;
    startNextFromQueue(state, resolvedNow);
    state._dirty = true;
    return { ok: true };
  }

  function cancelQueueItem(state, index, now) {
    const resolvedNow = (typeof now === "number" && isFinite(now) && now > 0) ? now : Date.now();
    processUntil(state, resolvedNow);
    const inv = ensureState(state, resolvedNow);
    const i = Math.floor(Number(index));
    if (!Array.isArray(inv.lab.queue) || i < 0 || i >= inv.lab.queue.length) return { ok: false, reason: "BAD_INDEX" };
    inv.lab.queue.splice(i, 1);
    state._dirty = true;
    return { ok: true };
  }

  // 科研工时抵扣：单作业累计 ≤ 基础时间的 50%（spec §5.4）
  function applyResearchHours(state, hours, now) {
    const resolvedNow = (typeof now === "number" && isFinite(now) && now > 0) ? now : Date.now();
    processUntil(state, resolvedNow);
    const inv = ensureState(state, resolvedNow);
    const lab = inv.lab;
    const job = lab.activeJob;
    if (!job) return { ok: false, reason: "NO_ACTIVE_JOB" };
    const research = state.research;
    const bank = (research && typeof research.researchHourBank === "number" && isFinite(research.researchHourBank) && research.researchHourBank > 0)
      ? research.researchHourBank : 0;
    if (bank <= 0) return { ok: false, reason: "INSUFFICIENT_BANK" };
    const remaining = Math.max(0, Number(job.remainingSeconds) || 0);
    if (!(remaining > 0)) return { ok: false, reason: "NO_REMAINING" };
    const capTotal = (Number(job.baseTotalSeconds) || 0) * RESEARCH_HOUR_CAP_RATIO;
    const applied = Math.max(0, Number(job.appliedAchievementSeconds) || 0);
    const capLeft = capTotal - applied;
    if (!(capLeft > 0)) return { ok: false, reason: "CAP_REACHED" };
    const requested = Math.max(0, Number(hours) || 0) * 3600;
    const usedSeconds = Math.min(requested, capLeft, bank, remaining);
    if (!(usedSeconds > 0)) return { ok: false, reason: "INSUFFICIENT_BANK" };
    research.researchHourBank = bank - usedSeconds;
    job.appliedAchievementSeconds = applied + usedSeconds;
    job.remainingSeconds = remaining - usedSeconds;
    state._dirty = true;
    // 抵扣到 0 → 立即结算该循环并衔接队列
    if (!(job.remainingSeconds > 0)) {
      if (completeCycle(state, resolvedNow)) {
        if (job.done >= job.times) startNextFromQueue(state, resolvedNow);
        else job.remainingSeconds = Number(job.perSeconds) || 1;
      } else {
        lab.pausedReason = "NO_RESOURCE";
      }
    }
    return { ok: true, usedSeconds: usedSeconds };
  }

  // 只读进度查询：绝不调用 processUntil、绝不改 state（渲染层可安全调用）
  function getLabState(state) {
    const inv = state && state.invention ? state.invention : null;
    const lab = inv && inv.lab ? inv.lab : null;
    if (!lab) return { activeJob: null, queue: [], pausedReason: null, speed: 1, ratio: 0 };
    const job = lab.activeJob;
    const queue = Array.isArray(lab.queue) ? lab.queue.slice() : [];
    if (!job) return { activeJob: null, queue: queue, pausedReason: lab.pausedReason, speed: labSpeed(state), ratio: 0 };
    const per = Math.max(0.001, Number(job.perSeconds) || 1);
    const remaining = Math.max(0, Number(job.remainingSeconds) || 0);
    return {
      activeJob: {
        key: job.key, dir: job.dir, times: job.times, done: job.done,
        perSeconds: per, remainingSeconds: remaining,
        ratio: Math.max(0, Math.min(1, 1 - remaining / per)),
        startedAt: job.startedAt, appliedAchievementSeconds: Number(job.appliedAchievementSeconds) || 0
      },
      queue: queue,
      pausedReason: lab.pausedReason,
      speed: labSpeed(state)
    };
  }

  /* ---------------------------------------------------------------
     暴露
     --------------------------------------------------------------- */

  const INVENTION = {
    SKILL_KEY, ISK_ID, MATRIX_ID,
    GATES: INVENTION_GATES,
    MILESTONES: INVENTION_MILESTONES,
    REDUCTIONS: INVENTION_REDUCTIONS,
    ISK_PER_TIER: INVENTION_ISK_PER_TIER,
    MATRIX_PER_TIER: INVENTION_MATRIX_PER_TIER,
    BASE_SECONDS: INVENTION_BASE_SECONDS,
    QUEUE_MAX: LAB_QUEUE_MAX,
    MAX_OFFLINE_SECONDS: MAX_LAB_OFFLINE_SECONDS,
    blueprints: INVENTION_BLUEPRINTS,
    blueprintByKey, listBlueprints, tierGate, milestoneLevel, reductionFor,
    xpForBlueprint, iskPerCycle, matrixPerCycle,
    labSpeed, cycleSeconds, isUnlocked,
    ensureState, blueprintState, researchCount, meReduction, teReduction,
    recipeKeyForRecipe, applyMeReduction, meReductionForRecipe, teReductionForRecipe,
    canPayOneCycle, processUntil, enqueueJob, cancelJob, cancelQueueItem,
    applyResearchHours, getLabState
  };

  if (typeof window !== "undefined") {
    window.INVENTION = INVENTION;
    window.inventionProcessUntil = processUntil;
    window.inventionEnsureState = ensureState;
  }
  if (typeof module !== "undefined" && module.exports) module.exports = { INVENTION: INVENTION };
})();
