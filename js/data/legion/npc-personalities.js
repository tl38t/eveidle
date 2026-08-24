// ================================================================
// 军团 DLC —— NPC 性格库
// ----------------------------------------------------------------
// 性格只影响文案表现，绝不参与任何数值计算。
// 所有加成、生产速度、经验、伤害一律来自 NPC 技能词条。
// 兼容双环境：浏览器挂 window.LEGION_NPC_PERSONALITIES，Node 下 module.exports。
// ================================================================
(function (root, factory) {
  const mod = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = mod;
  if (typeof window !== "undefined") window.LEGION_NPC_PERSONALITIES = mod;
  else if (root) root.LEGION_NPC_PERSONALITIES = mod;
})(typeof self !== "undefined" ? self : this, function () {
  // 字段说明：
  //   personalityId : 内部稳定 id（数据 / 文案索引用）
  //   name          : 性格中文名（展示用）
  //   desc          : 简短描述
  //   tone          : 语气标签
  //   style         : 适合的句式风格（仅用于文案撰写的指导，不影响逻辑）
  const PERSONALITIES = [
    { personalityId: "calm",       name: "冷静", desc: "遇事不惊，语调平稳。", tone: "平稳/克制", style: "短句陈述，少修饰，直接给结论。" },
    { personalityId: "warm",       name: "热情", desc: "开朗外向，乐于表达。", tone: "明亮/积极", style: "感叹与感叹号，第二人称亲近。" },
    { personalityId: "taciturn",   name: "寡言", desc: "惜字如金，话极少。",   tone: "极简",     style: "单词句或极短句，省略主语。" },
    { personalityId: "arrogant",   name: "傲慢", desc: "自视甚高，语气居高。", tone: "居高/轻慢", style: "强调自身优越，略带不屑。" },
    { personalityId: "lazy",       name: "慵懒", desc: "提不起劲，慢吞吞。",   tone: "拖沓/困倦", style: "拉长语气，省略标点，抱怨式。" },
    { personalityId: "serious",    name: "认真", desc: "一丝不苟，态度端正。", tone: "郑重/严谨", style: "条列感，强调规程与记录。" },
    { personalityId: "optimistic", name: "乐观", desc: "总往好处想。",         tone: "轻快/期待", style: "展望式，正向预测。" },
    { personalityId: "pessimistic",name: "悲观", desc: "习惯往坏处想。",       tone: "低沉/担忧", style: "担忧式，预设失败或麻烦。" },
    { personalityId: "mystic",     name: "神秘", desc: "言语含混，似有深意。", tone: "幽深/朦胧", style: "隐喻，留白，不直接回答。" },
    { personalityId: "sharp",      name: "机敏", desc: "反应快，嘴利。",       tone: "机巧/俏皮", style: "反问，抖机灵，短促。" },
    { personalityId: "blunt",      name: "直率", desc: "有话直说，不绕弯。",   tone: "直接/干脆", style: "直陈，无客套。" },
    { personalityId: "scheming",   name: "腹黑", desc: "表面温和，暗藏心思。", tone: "温和带刺",   style: "甜里藏刀，反讽。" }
  ];

  return PERSONALITIES;
});
