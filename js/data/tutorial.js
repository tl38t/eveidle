// ---- 新手引导：任务目录与文案冻结表（Batch N 冻结 + Batch O 运行时契约升级）----
// 说明：
//   1. 本文件只负责「数据与文案冻结」，不含任何进度推进/奖励发放/UI 渲染逻辑。
//   2. reward / target 中一律存内部真实 ID（如 "mineral:三钛合金" / "miner_frigate" / "site_i_a"），
//      展示时统一走 DisplayNames 转换（如 三钛合金 → 标准钛材，凡晶石 → 铁硅原矿）。
//   3. 文案为原创，叙述人：序章为「边疆调度员」，工业线为「潮歌」（空间站船坞女装配师），考古线 / 作战线为「引航员」。
//   4. 奖励舰语义：仅 I7（空配捕云级）、A6（空配觅迹级）、C6（按训练方向发空配星矛级/铁卫级/闪刃级）
//      三处由系统赠予空配成品舰；玩家自造的启程级(P5)与拓岩级(I7目标)一律写成建造目标，不得写为赠予。
//   5. 资源奖励统一走 ResourceRegistry 命名空间引用（resourceAmounts），运行时不再猜测容器。
//   6. 全部对象与数组均 Object.freeze。
(function () {
  "use strict";

  function deepFreeze(value) {
    if (value === null || typeof value !== "object") return value;
    if (Object.isFrozen(value)) return value;
    Object.freeze(value);
    const keys = Object.getOwnPropertyNames(value);
    for (let i = 0; i < keys.length; i++) deepFreeze(value[keys[i]]);
    return value;
  }

  // ---- 章节定义 ----
  const CHAPTERS = [
    { id: "prologue",    name: "序章·登记",   order: 1, speaker: "边疆调度员", summary: "从一包原料开始，造出属于自己的第一艘船，并完成登记。" },
    { id: "industrial",  name: "工业线·产能", order: 2, speaker: "潮歌", summary: "把矿石变成产能，把产能变成舰队。" },
    { id: "archaeology", name: "考古线·测绘", order: 3, speaker: "引航员",     summary: "在无人认领的遗迹里，找出还能用的东西。" },
    { id: "combat",      name: "作战线·武装", order: 4, speaker: "引航员",     summary: "边疆不保护任何人，只保护还能开火的人。" }
  ];

  // 资源键常量（与 ResourceRegistry 命名空间严格对应）
  const R = {
    ISK: "currency:isk",
    TI: "mineral:三钛合金",
    AG: "mineral:类银超金属",
    HEAVY: "planetary:重金属",
    RARE: "planetary:稀有气体",
    FUEL: "consumable:fuel",
    AMMO_LASER: "ammo:laser",
    AMMO_MISSILE: "ammo:missile",
    AMMO_CANNON: "ammo:cannon",
    PROBE: "probe:core_probe_i"
  };

  function rewardResource(map) {
    const out = { resourceAmounts: {}, equipment: {}, ships: {}, blueprints: {} };
    if (map) {
      for (const key of Object.keys(map)) {
        const v = Number(map[key]);
        if (!(v >= 0) || !Number.isInteger(v)) throw new Error("非法奖励值：" + key);
        out.resourceAmounts[key] = v;
      }
    }
    return out;
  }
  function withEquipment(reward, equip) {
    if (equip) for (const id of Object.keys(equip)) reward.equipment[id] = equip[id];
    return reward;
  }
  function withShips(reward, ships) {
    if (ships) for (const id of Object.keys(ships)) reward.ships[id] = ships[id];
    return reward;
  }
  function withBlueprints(reward, bp) {
    if (bp) for (const id of Object.keys(bp)) reward.blueprints[id] = bp[id];
    return reward;
  }

  // ---- 26 条任务（序章 7 / 工业 7 / 考古 6 / 作战 6）----
  const TASKS = [
    // ================= 序章 prologue P1-P7 =================
    {
      id: "P1", chapter: "prologue", order: 1,
      title: "登记材料包",
      speaker: "边疆调度员",
      briefing: "这里是边疆登记机构的空间站，光头男人坐在油腻的合金桌后，用一只猩红的电子眼打量着你。\n「又一个边疆地区开拓人？你是坐边疆开拓公社的船来的？」他的喉咙中传出混着痰音的咕哝声，「按规矩，我们会提供一艘启程级……喏，去取你的船吧，就在后边的货舱里。」\n数十分钟后，你带着一张写满材料的库单和满腔疑惑回到了办公室。\n光头浓密的胡须下挂着促狭的笑容，显然他很清楚会是这样的结果。\n「不好意思啊菜鸟，我们手头也没有现成的船，麻烦你自个儿跑一趟造船厂吧。」",
      objectiveText: "在调度台手动领取边疆登记材料包。",
      completionText: "取走你的材料，前往造船厂建造你的第一艘船。",
      progressType: "claim",
      target: { kit: "registration_materials" },
      reward: withEquipment(rewardResource({
        [R.TI]: 82, [R.AG]: 13, [R.HEAVY]: 9, [R.RARE]: 9
      }), {}),
      rewardTiming: "onAction",
      completionMode: "claim",
      unlocks: [],
      navigationTarget: null
    },
    {
      id: "P2", chapter: "prologue", order: 2,
      title: "综合舰体组件",
      speaker: "边疆调度员",
      briefing: "按照光头给你的数据秘钥，你应当先完成综合舰体组件，它是整艘船的承重骨架。",
      objectiveText: "新制造 1 件综合舰体组件。",
      completionText: "骨架完成。",
      progressType: "manufacture",
      target: { recipeId: "integrated_hull", count: 1 },
      reward: rewardResource(null),
      rewardTiming: "none",
      completionMode: "automatic",
      unlocks: [],
      navigationTarget: "shipEngineering"
    },
    {
      id: "P3", chapter: "prologue", order: 3,
      title: "动力控制核心",
      speaker: "边疆调度员",
      briefing: "骨架完成之后，你需要在骨架上加装动力系统。",
      objectiveText: "新制造 1 件动力控制核心。",
      completionText: "动力核心完成。",
      progressType: "manufacture",
      target: { recipeId: "power_core", count: 1 },
      reward: rewardResource(null),
      rewardTiming: "none",
      completionMode: "automatic",
      unlocks: [],
      navigationTarget: "shipEngineering"
    },
    {
      id: "P4", chapter: "prologue", order: 4,
      title: "舰船功能组件",
      speaker: "边疆调度员",
      briefing: "随后还需要装配传感器，铺设线束系统，将动力传遍船壳。",
      objectiveText: "新制造 1 件舰船功能组件。",
      completionText: "组件全部完成，只待总装。",
      progressType: "manufacture",
      target: { recipeId: "functional_system", count: 1 },
      reward: rewardResource(null),
      rewardTiming: "none",
      completionMode: "automatic",
      unlocks: [],
      navigationTarget: "shipEngineering"
    },
    {
      id: "P5", chapter: "prologue", order: 5,
      title: "启程级入列",
      speaker: "边疆调度员",
      briefing: "今天是你的小船儿排期总装的日子，即将耗尽的星币驱使着你早早来到了造船厂。\n「你的第一艘船就要下水了，你现在感觉如何啊，菜鸟？」在你盯着船台的时候，光头不知何时来到了你的背后，脸上依然是带些嘲弄的笑容。\n他仿佛是读懂了你的心思，指着正在总装的船只问道：「嫌小？」\n你思忖了一番，最终还是点点头。\n他放声大笑，拍拍你的肩膀：「那就去采矿，去盗墓，去草翻那些该死的海盗！」",
      objectiveText: "新制造 1 艘启程级，并将这艘启程级编入战斗位。",
      completionText: "启程级驶出装配架、挂上战斗位，你名下终于有了第一艘能开的船。",
      progressType: "build_and_assign",
      target: { shipId: "rookie_corvette", count: 1, slot: "combat" },
      reward: rewardResource(null),
      rewardTiming: "none",
      completionMode: "automatic",
      unlocks: [],
      note: "完成后获得一次性紧急调船资格（运行时批次已实装为 claimEmergencyTutorialShip，需玩家主动领取）。",
      navigationTarget: "shipEngineering"
    },
    {
      id: "P6", chapter: "prologue", order: 6,
      title: "登记奖金",
      speaker: "边疆调度员",
      briefing: "你驾驶着你的启程级缓缓驶出了边疆登记空间站的港口。\n正在你想着再也不会见到那个该死的家伙时，通讯器里又响起了一个熟悉的声音：「老弟，差点忘记跟你说了，你在空间站的所有食宿费用，应该由开拓公社支付才对。」\n他一定是故意的！正当你想用从边疆学到的骂人话问候他时，他的下一句话又打消了你的想法。\n「回来签个报销单吧。」",
      objectiveText: "在调度台手动领取补偿金。",
      completionText: "我一开始就该掐死他。",
      progressType: "claim",
      target: { kit: "registration_bonus" },
      reward: rewardResource({ [R.ISK]: 50000 }),
      rewardTiming: "onAction",
      completionMode: "claim",
      unlocks: [],
      navigationTarget: null
    },
    {
      id: "P7", chapter: "prologue", order: 7,
      title: "三支路开通",
      speaker: "边疆调度员",
      briefing: "登记站的教习到此为止。往前有三条独立的路：挖矿造船的工业线、翻遗迹的考古线、拿枪换钱的作战线。你不必只走一条，但得先确认登记完成、把路打开。",
      objectiveText: "确认完成边疆登记，开通三条分支线路。",
      completionText: "三条分支线路已全部向你开放，接下来的航向由你自己定。",
      progressType: "confirm",
      target: { registration: "prologue" },
      reward: rewardResource(null),
      rewardTiming: "none",
      completionMode: "confirm",
      unlocks: ["industrial", "archaeology", "combat"],
      navigationTarget: null
    },

    // ================= 工业线 industrial I1-I7 =================
    {
      id: "I1", chapter: "industrial", order: 1,
      title: "工业开工",
      speaker: "潮歌",
      briefing: "这玩意在中央星区甚至丢给收破烂的都没有人要！你瞪大了眼睛看着工人正打算安装在你船舰上的激光采矿器。「你要不要吧？」在这个空间站船坞负责装备装配的女人瞥了你一眼，冷淡地回应着你的愤怒。「就没有……更好一点的。」你还想继续挣扎一下。「更好一点的？」女人轻蔑地指了指身后的柜台，「那边，边疆开拓公社的蓝图商店，想要什么蓝图都能买到，只要你买得起。」你无奈地表示囊中羞涩，尝试性地询问能有什么自己负担得起的，原以为会迎来嘲笑——你已经习惯了边疆星区的刁民。没想到女人却露出了若有所思的表情。「倒确实有个适合你的路子……这样，你先去一趟附近的小行星带。」",
      objectiveText: "领取基础采矿器，将其安装到启程级，并把启程级编入采矿位。",
      completionText: "基础采矿器装配完成，准备前往小行星带开工吧。",
      progressType: "claim_install_assign",
      target: { equipmentId: "t1_mining_laser", shipId: "rookie_corvette", slot: "mining" },
      reward: withEquipment(rewardResource({ [R.FUEL]: 200 }), { "t1_mining_laser": 1 }),
      rewardTiming: "beforeObjective",
      completionMode: "claim",
      unlocks: [],
      navigationTarget: "hangar"
    },
    {
      id: "I2", chapter: "industrial", order: 2,
      title: "铁硅原矿带",
      speaker: "潮歌",
      briefing: "你驾驶着船只行驶在小行星带中，想着之前女人的要求，让你采集20单位的铁硅原矿。这应该花不了多少时间。",
      objectiveText: "任务激活后，在铁硅原矿带新采集铁硅原矿 20 单位。",
      completionText: "采集完成，该回去找她了。",
      progressType: "mine",
      target: { resourceId: "ore:凡晶石", count: 20, sinceActivation: true },
      reward: rewardResource(null),
      rewardTiming: "none",
      completionMode: "automatic",
      unlocks: [],
      navigationTarget: "mining"
    },
    {
      id: "I3", chapter: "industrial", order: 3,
      title: "标准钛材产线",
      speaker: "潮歌",
      briefing: "你带着一船的铁硅原矿回到空间站，却在女人的指挥下马不停蹄地来到了空间站的冶炼设施。按照她的说法，等你完成这一批标准钛材的冶炼，她就能替你申请某个星区的拓殖资格。而边疆开拓公社将补给你344 单位标准钛材和 26 单位银镍合金，用于部署行星产线并生产首艘工业舰。",
      objectiveText: "任务激活后，新冶炼标准钛材 20 单位。",
      completionText: "带着你的材料出发吧，前往你的应许之地。",
      progressType: "refine",
      target: { outputId: "mineral:三钛合金", count: 20, sinceActivation: true },
      reward: rewardResource({ [R.TI]: 344, [R.AG]: 26 }),
      rewardTiming: "afterObjective",
      completionMode: "claim",
      unlocks: [],
      navigationTarget: "refining"
    },
    {
      id: "I4", chapter: "industrial", order: 4,
      title: "双星部署",
      speaker: "潮歌",
      briefing: "边疆星区有着大量饱含资源的，且未经开发的处女行星。它们是你的生命之火，你的欲念之光，你的原罪，你的灵魂……在资源富集的星球上建设采集基地，当地资源会自动发送到环绕轨道上的海关中。",
      objectiveText: "在行星开发中部署 1 颗熔岩行星与 1 颗气态行星。",
      completionText: "重金属与稀有气体会自动流进仓库。",
      progressType: "planetDeploy",
      target: { planetTypes: ["lava", "gas"], count: 1 },
      reward: withEquipment(rewardResource({ [R.ISK]: 276000 }), {}),
      rewardTiming: "beforeObjective",
      completionMode: "claim",
      unlocks: [],
      navigationTarget: "planetary"
    },
    {
      id: "I5", chapter: "industrial", order: 5,
      title: "行星收成",
      speaker: "潮歌",
      briefing: "行星资源是自动采集的，你可以先去其他地方做些别的，等采集完成后再回来收取资源。但要注意，待海关仓储存满后，自动采集会暂停，且每过一段时间都需要为这些采集基地续费。",
      objectiveText: "提取重金属 18 单位与稀有气体 18 单位。",
      completionText: "第一批行星产出入库，产线终于跑成了闭环。",
      progressType: "planetExtract",
      target: { resources: { [R.HEAVY]: 18, [R.RARE]: 18 } },
      reward: rewardResource(null),
      rewardTiming: "none",
      completionMode: "automatic",
      unlocks: [],
      navigationTarget: "planetary"
    },
    {
      id: "I6", chapter: "industrial", order: 6,
      title: "组件量产",
      speaker: "潮歌",
      briefing: "一段时间后，当你正在边疆区努力讨生活的时候，又接到了那个女人的电话——现在你知道她的名字叫「潮歌」了。「你的星球开拓奖励申请下来了，有空过来一趟吧。对了，我给你列个单子，你把这些资源一起带过来，有用。」你本想仔细问问，潮歌却嬉笑着挂断了电话。等你赶到她所在的空间站，她又让你先带着资源去了造船厂……",
      objectiveText: "任务激活后，新制造综合舰体组件、动力控制核心、舰船功能组件各 2 件。",
      completionText: "到底要干什么？",
      progressType: "manufacture_components",
      target: { components: { integrated_hull: 2, power_core: 2, functional_system: 2 }, sinceActivation: true },
      reward: withBlueprints(rewardResource(null), { "miner_frigate": 1 }),
      rewardTiming: "afterObjective",
      completionMode: "claim",
      unlocks: [],
      navigationTarget: "shipEngineering"
    },
    {
      id: "I7", chapter: "industrial", order: 7,
      title: "拓岩级总装",
      speaker: "潮歌",
      briefing: "「如何，这可是长须鲸工业最新锐的小型工业舰，拓岩级的蓝图。」潮歌给你发送了一张蓝图，满意地看到你脸上露出了惊讶的表情。「怎么，这就满意了？」她恶作剧得逞一般小声笑了起来，又指着旁边的另一艘工业舰说道，「还有这艘捕云级，现在也是你的了——不过别去乱打听它前任主人去哪儿了。」",
      objectiveText: "新总装 1 艘拓岩级。",
      completionText: "工业线结束。",
      progressType: "assemble_ship",
      target: { shipId: "miner_frigate", count: 1 },
      reward: withShips(rewardResource({ [R.ISK]: 50000 }), { "gas_frigate": { count: 1, fitting: "empty" } }),
      rewardTiming: "afterObjective",
      completionMode: "claim",
      unlocks: [],
      navigationTarget: "shipEngineering"
    },

    // ================= 考古线 archaeology A1-A6 =================
    {
      id: "A1", chapter: "archaeology", order: 1,
      title: "考古实习包",
      speaker: "引航员",
      briefing: "考古不靠蛮力，靠探针把遗迹从背景噪声里捞出来。实习补给里直接发了二十枚标准考古探针 I 和一点燃料，别自己造，先拿着用。",
      objectiveText: "在考古台手动领取考古实习补给。",
      completionText: "二十枚探针和燃料入库，你现在能听见那些沉默了很久的信号了。",
      progressType: "claim",
      target: { kit: "archaeology_starter" },
      reward: withEquipment(rewardResource({ [R.PROBE]: 20, [R.FUEL]: 200 }), {}),
      rewardTiming: "onAction",
      completionMode: "claim",
      unlocks: [],
      navigationTarget: null
    },
    {
      id: "A2", chapter: "archaeology", order: 2,
      title: "测绘编队",
      speaker: "引航员",
      briefing: "测绘不需要强力武器，但需要一台能稳稳张开扫描阵列的船。把你的启程级编进考古位——它那点扫描加成刚好够用，不必另造专门的测绘舰。",
      objectiveText: "将启程级实例编入考古位。",
      completionText: "启程级进入考古位，扫描阵列第一次为测绘任务张开。",
      progressType: "assign",
      target: { shipId: "rookie_corvette", slot: "archaeology" },
      reward: rewardResource(null),
      rewardTiming: "none",
      completionMode: "automatic",
      unlocks: [],
      navigationTarget: "hangar"
    },
    {
      id: "A3", chapter: "archaeology", order: 3,
      title: "首次遗迹勘测",
      speaker: "引航员",
      briefing: "你现在的考古水平，在边疆也就能试试最简单的遗迹。想注重打捞星币、功勋或者货柜都无所谓，随便选一个焦点吧。去开始你的第一次勘测——成不成都行，总之先把手感找到。",
      objectiveText: "在失落信标残骸、远古殖民舱、漂流货柜群中任选一处 I 级遗迹，完成一次真实考古尝试（成功或失败均完成）。",
      completionText: "你亲手完成了第一次遗迹勘测，噪声里浮出了几个坐标。",
      progressType: "archaeology_attempt",
      target: { sites: ["site_i_a", "site_i_b", "site_i_c"], tier: "I", count: 1, acceptEither: true },
      reward: rewardResource(null),
      rewardTiming: "none",
      completionMode: "automatic",
      unlocks: [],
      navigationTarget: "archaeology"
    },
    {
      id: "A4", chapter: "archaeology", order: 4,
      title: "第一件遗物",
      speaker: "引航员",
      briefing: "勘测的回报是遗物。无论好坏，先带一件回来——有实物，后面的兑换和归档才立得住。",
      objectiveText: "任务激活后，成功获得任意考古遗物 1 件。",
      completionText: "第一件遗物入袋，考古线第一次有了实在的产出。",
      progressType: "obtain_artifact",
      target: { count: 1, sinceActivation: true },
      reward: rewardResource(null),
      rewardTiming: "none",
      completionMode: "automatic",
      unlocks: [],
      navigationTarget: "archaeology"
    },
    {
      id: "A5", chapter: "archaeology", order: 5,
      title: "遗物兑现",
      speaker: "引航员",
      briefing: "遗物堆着不值钱。去仓库→交易品栏，把遗物回收或兑换成星币或功勋，让考古线的价值落回账面上。",
      objectiveText: "出售或兑换任意考古遗物 1 件。",
      completionText: "一件遗物完成兑现，账面上多了一笔来自古迹的收入。",
      progressType: "dispose_artifact",
      target: { count: 1 },
      reward: rewardResource(null),
      rewardTiming: "none",
      completionMode: "automatic",
      unlocks: [],
      navigationTarget: "cargo",
      navigationSubtab: "trade"
    },
    {
      id: "A6", chapter: "archaeology", order: 6,
      title: "测绘结业",
      speaker: "引航员",
      briefing: "测绘登记到此收尾。调度中心认你这段时间的勘测，补一笔安家费，再白送一艘空配觅迹级——它是正经的测绘舰，比你那艘启程级看得远得多，顺带再补二十枚探针。",
      objectiveText: "确认完成考古登记。",
      completionText: "考古登记结业，空配觅迹级与补充探针已划到你名下。",
      progressType: "confirm",
      target: { registration: "archaeology" },
      reward: withShips(rewardResource({ [R.ISK]: 50000, [R.PROBE]: 20 }), { "heron": { count: 1, fitting: "empty" } }),
      rewardTiming: "afterObjective",
      completionMode: "claim",
      unlocks: [],
      navigationTarget: null
    },

    // ================= 作战线 combat C1-C6 =================
    {
      id: "C1", chapter: "combat", order: 1,
      title: "武装方向",
      speaker: "引航员",
      briefing: "边疆不替你选打法，只发一次性的训练方向补贴。激光稳、导弹准、火炮狠，三条路只能选一条，选了就不能改——先把方向定下来。方向定了，配套的武器和护盾回充器会一并下发；这两件要装到启程级上，再把启程级指派进战斗位，你才算真有能开火的船。",
      objectiveText: "在激光 / 导弹 / 火炮中选择一个训练方向（仅可一次）。",
      completionText: "训练方向已锁定，对应的武器与护盾回充器发了下来。",
      progressType: "choose_combat_training",
      target: { tracks: ["laser", "missile", "cannon"], once: true },
      reward: rewardResource(null),
      rewardTiming: "none",
      completionMode: "choice",
      choiceRewards: {
        laser:   withEquipment(rewardResource({ [R.FUEL]: 300, [R.AMMO_LASER]: 100 }), { "t1_small_laser": 1, "t1_shield_booster": 1 }),
        missile: withEquipment(rewardResource({ [R.FUEL]: 300, [R.AMMO_MISSILE]: 100 }), { "t1_light_missile_launcher": 1, "t1_shield_booster": 1 }),
        cannon:  withEquipment(rewardResource({ [R.FUEL]: 300, [R.AMMO_CANNON]: 100 }), { "t1_small_cannon": 1, "t1_shield_booster": 1 })
      },
      unlocks: [],
      navigationTarget: null
    },
    {
      id: "C2", chapter: "combat", order: 2,
      title: "武器与护盾",
      speaker: "引航员",
      briefing: "选了方向，就得把家伙装上船。去机库打开启程级的装备面板，把 C1 领到的那件武器和一台护盾回充器都装上去——护盾不能省，启程级总共只有四百点冗余。",
      objectiveText: "将 C1 选中的武器与 1 台 T1 护盾回充器安装到启程级。",
      completionText: "启程级不再是一艘只能挨打的空壳。",
      progressType: "install",
      target: { shipId: "rookie_corvette", shieldBooster: "t1_shield_booster", weaponFromChoice: true },
      reward: rewardResource(null),
      rewardTiming: "none",
      completionMode: "automatic",
      unlocks: [],
      navigationTarget: "hangar"
    },
    {
      id: "C3", chapter: "combat", order: 3,
      title: "首战编队",
      speaker: "引航员",
      briefing: "离登记站最近的几处一级普通星带，外围都是火力最弱的一批打手。在机库点启程级卡片上的战斗标签，把这艘船指派进战斗位，再挑一处这样的星带——第一仗就从这里打起。",
      objectiveText: "将启程级编入战斗位，并选择任意一处真实的一级普通星带。",
      completionText: "启程级进入战斗位，作战序列第一次亮起红灯。",
      progressType: "assign_and_select_zone",
      target: { shipId: "rookie_corvette", slot: "combat", zones: ["angel_outpost", "blood_hideout", "sansha_outpost"], zoneLevel: 1, zoneType: "highsec" },
      reward: rewardResource(null),
      rewardTiming: "none",
      completionMode: "automatic",
      unlocks: [],
      navigationTarget: "hangar"
    },
    {
      id: "C4", chapter: "combat", order: 4,
      title: "首杀",
      speaker: "引航员",
      briefing: "打得响不算本事，打得出结果才算。这一趟不求多，先把一个目标切实击毁——开火链路通了，后面的波次才有得打。",
      objectiveText: "任务激活后，真实击毁敌人 1 个。",
      completionText: "第一个战果记上战绩表，你的船真的能开火了。",
      progressType: "kill",
      target: { count: 1, sinceActivation: true },
      reward: rewardResource(null),
      rewardTiming: "none",
      completionMode: "automatic",
      unlocks: [],
      navigationTarget: "combat"
    },
    {
      id: "C5", chapter: "combat", order: 5,
      title: "首波清场",
      speaker: "引航员",
      briefing: "星带里的散兵最弱也最磨人。先清掉任意一波，确认你的配装能稳定输出，战斗线就有第一份交代。",
      objectiveText: "真实战斗中清除任意一波敌人。",
      completionText: "一波清场，作战线有了第一份干净的交代。",
      progressType: "clear_wave",
      target: { wave: 1 },
      reward: rewardResource(null),
      rewardTiming: "none",
      completionMode: "automatic",
      unlocks: [],
      navigationTarget: "combat"
    },
    {
      id: "C6", chapter: "combat", order: 6,
      title: "晋升战舰",
      speaker: "引航员",
      briefing: "能连续清到第四波，说明这套配装已经站住了。在同一趟出击中咬住第四波——清掉它，调度中心按你的训练方向补一艘空配的正战舰，作战线就此结业。要是卡在第四波久攻不下，也别死磕：启程级高槽留有两格，再造一件同种武器装上，双炮齐射能更稳地啃下这最后一波。",
      objectiveText: "在同一次一级普通星带出击中，真实清除第 4 波（无需手动撤离，无需停止挂机）。",
      completionText: "第四波在火光里散开，一艘为战斗而生的空配战舰划归你名下。",
      progressType: "clear_wave_same_sortie",
      target: { wave: 4, zones: ["angel_outpost", "blood_hideout", "sansha_outpost"], sameSortie: true },
      reward: rewardResource(null),
      rewardTiming: "afterObjective",
      completionMode: "claim",
      choiceRewards: {
        laser:   withShips(rewardResource({ [R.ISK]: 50000, [R.AMMO_LASER]: 100, [R.FUEL]: 300 }), { "rifter": { count: 1, fitting: "empty" } }),
        missile: withShips(rewardResource({ [R.ISK]: 50000, [R.AMMO_MISSILE]: 100, [R.FUEL]: 300 }), { "kestrel": { count: 1, fitting: "empty" } }),
        cannon:  withShips(rewardResource({ [R.ISK]: 50000, [R.AMMO_CANNON]: 100, [R.FUEL]: 300 }), { "atron": { count: 1, fitting: "empty" } })
      },
      unlocks: [],
      navigationTarget: "combat"
    }
  ];

  const BY_ID = {};
  for (let i = 0; i < TASKS.length; i++) BY_ID[TASKS[i].id] = TASKS[i];

  const CHAPTER_ORDER = ["prologue", "industrial", "archaeology", "combat"];

  const TutorialData = {
    version: 1,
    chapterOrder: CHAPTER_ORDER,
    chapters: CHAPTERS,
    tasks: TASKS,
    byId: BY_ID
  };

  deepFreeze(TutorialData);

  if (typeof window !== "undefined") {
    window.TutorialData = TutorialData;
    window.TUTORIAL_TASKS = TutorialData.tasks;
  }
  if (typeof globalThis !== "undefined") {
    globalThis.TutorialData = TutorialData;
    globalThis.TUTORIAL_TASKS = TutorialData.tasks;
  }
})();
