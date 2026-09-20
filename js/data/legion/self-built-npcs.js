// ================================================================
// 军团 DLC —— 自建 NPC 数据（AUTO-GENERATED，勿手改）
// 由 tools/import-legion-npcs.py 从「军团NPC自建填写模板」生成。
// 这些 NPC 的台词只存在于 customDialogue 字段，绝不写入内置随机角色台词库。
// 兼容双环境：浏览器挂 window.LEGION_NPC_SELF_BUILT，Node 下 module.exports。
// ================================================================
(function (root, factory) {
  const mod = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = mod;
  if (typeof window !== "undefined") window.LEGION_NPC_SELF_BUILT = mod;
  else if (root) root.LEGION_NPC_SELF_BUILT = mod;
})(typeof self !== "undefined" ? self : this, function () {
  const SELF_BUILT_NPCS = [
    {
      npcId: 'self_穆萨韦德',
      name: '穆萨韦德',
      personalityId: 'sharp',
      skillId: 'lootSearch',
      skillGrade: 'A',
      secondarySkillId: 'archaeologySpeed',
      secondarySkillGrade: 'B',
      customDialogue: {
          'recruit': ['你好，新八指定打捞', '接打捞', '我只在新八活动'],
          'dailyGreeting': ['黄金时间上线', '有猫娘没', '大狸子我好想你'],
          'salaryPaid': ['今日入账还算可以', '好耶，消费去了', '我的海凤凰在招手'],
          'salaryOverdue': ['不是哥们，你不给尾款我不给箱子的', '那我吞货了', '尾款结一下'],
          'shipAssigned': ['我说打捞是唯一出路', '有黑夜没', '可以兄弟可以的'],
          'shipReplaced': ['旧的放转转', '这船好大', '这船真白'],
          'noShip': ['你是想让我开日不完打捞吗？', '信不信我把星城给你开过来', '我要叫强暴队了'],
          'incompatibleShip': ['不是哥们，我开不了这船', '你给出脑浆钱吗？', '我技能不够开这船'],
          'levelUp': ['为什么打捞没有官员装？', '为什么没有打捞泰坦？', '我打算直接战地打捞，有说法没'],
          'skillMilestone': ['我强的可怕', '知道什么叫专业打捞吗？', '我打捞技能专精哥们'],
          'maxLevel': ['知道什么叫新八专业打捞吗？', '我要去日风暴炼乳', '小草你人呢？我要去会战打捞！'],
          'dismiss': ['不是哥们？', '你再也找不到像我这样的专业打捞人了', '我的梦想其实是海凤凰和奇美拉小航']
        }
    },
    {
      npcId: 'self_潮歌',
      name: '潮歌',
      personalityId: 'serious',
      skillId: 'archaeologySpeed',
      skillGrade: 'A',
      secondarySkillId: 'shipComponentCostReduce',
      secondarySkillGrade: 'B',
      customDialogue: {
          'recruit': ['遗迹解析，就交给我。', '考古岗报到，信号已锁定。', '新成员就位，准备开掘。'],
          'dailyGreeting': ['今日遗迹波动清晰，可探。', '你来了，遗址在唤。', '新的一天，进度稳。'],
          'salaryPaid': ['薪酬入账，继续发掘。', '报酬到手，记下了。', '工资收到，干劲足。'],
          'salaryOverdue': ['没钱发？我先歇着。', '欠薪状态，停手等补。', '账空了，暂不发力。'],
          'shipAssigned': ['考古舰到手，深入遗址。', '座驾是考古舰，正好。', '飞船配属，勘探就绪。'],
          'shipReplaced': ['换上更好的考古舰。', '旧舰退了，新舰探得更深。', '换装完成，继续探。'],
          'noShip': ['还没船，基础探查也行。', '无舰状态，照看信号。', '空手也盯紧遗迹。'],
          'incompatibleShip': ['这船非考古舰，效率低。', '配错舰型，解析打折。', '舰不对口，慢慢探。'],
          'levelUp': ['升级了，解析更利。', '等级up，眼更尖。', '进阶完成，继续。'],
          'skillMilestone': ['核心考古词条强化。', '解析增幅，数值刷新。', '强化节点过，收获提升。'],
          'maxLevel': ['到顶啦，等科技解锁。', '封顶，催研发去。', '满级，期待扩容。'],
          'dismiss': ['明白，我离队了。', '交接清，告退。', '我走，保重。']
        }
    }
  ];
  return { SELF_BUILT_NPCS: SELF_BUILT_NPCS };
});
