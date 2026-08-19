# -*- coding: utf-8 -*-
"""Achievements data generator — 成就系统 Batch A 冻结目录生成器。

权威来源：本文件内嵌的 FROZEN_ROWS（当前 achievements-template.csv 的 198 行）。
任何外部 186 行旧定义一律作废，不得保留两套互相冲突的定义。

用法：
  python tools/gen-achievements-csv.py --check   # 只读，比对冻结数据与产物
  python tools/gen-achievements-csv.py --write   # 确定性生成 CSV 与 JS

--check：
  - 不写文件、不修改时间戳
  - 比对内存冻结数据 与 achievements-template.csv / js/data/achievements.js
  - 一致 EXIT=0，不一致 EXIT=1
  - 打印 行数 / 占位名数量 / provisional 数量 / 冻结哈希

--write：
  - 确定性生成 achievements-template.csv（UTF-8-SIG, RFC4180）
  - 确定性生成 js/data/achievements.js（IIFE, 冻结目录）
  - 连续两次产物字节完全一致
  - 不依赖第三方包、不生成仓库内临时文件

未知参数：EXIT=2
"""
import csv
import io
import os
import sys
import json
import hashlib

HERE = os.path.dirname(os.path.abspath(__file__))
CSV_PATH = os.path.abspath(os.path.join(HERE, "..", "achievements-template.csv"))
JS_PATH = os.path.abspath(os.path.join(HERE, "..", "js", "data", "achievements.js"))

PLACEHOLDER_PREFIX = "待命名成就 · "

FREEZE_TARGET_HASH = "d4f38d421bbe7e8180bcc80c378ebc6a5213b9f6fc7ca62ff60ad3f460e62453"
FREEZE_TARGET_BYTES = 14368

# 第 11–14 列为 Steam 成就映射预留（本批统一：启用=否、三映射字段全空）。
# 这些列不在 FROZEN_ROWS（7 列策划权威）内，仅在 builder 中统一追加，
# 因此不影响 frozen_norm() / 冻结哈希 / 字节数（仍 e76a... / 14321）。
HEADER = ["编号", "分类", "触发条件/建议", "难度档", "隐藏", "成就名（待填）", "备注", "名称状态", "触发器(JSON)", "奖励(JSON)", "Steam启用", "Steam API Name", "Steam进度 Stat API Name", "Steam进度上限"]

TIER_MAP = {"铜": "bronze", "银": "silver", "金": "gold", "传奇": "legendary"}

# Batch E：成就奖励为「一次性科研工时」，按难度档确定性映射（不提供永久研究速度）。
REWARD_TYPE = "research-hours"
TIER_REWARD_HOURS = {"bronze": 0.5, "silver": 1, "gold": 2, "legendary": 4}
# 研究类成就不奖励科研工时（避免研究自反馈），reward 必须为 null。
REWARD_EXCLUDED_CATEGORIES = ("研究",)

PROVISIONAL_NAMES = {
    "A02": "如果你能开100个球种水，你还会是现在这样？",
    "A23": "鹰酱称之曰：能",
    "G01": "好球",
    "G02": "这球好白，哦不，好大",
    "G03": "也是好球",
    "G04": "真正的好球",
    "G05": "我是来种菜的，你是要干什么",
    "G06": "人称小气球",
    "G07": "你的粪勺请拿好",
    "G09": "只要粪勺舞得好，哪有行星挖不倒",
    "G10": "黄金粪勺",
}

# FROZEN_ROWS: [编号, 分类, 触发条件/建议, 难度档, 隐藏, 成就名, 备注]
# 成就名：provisional 保留原名；空档位保留空字符串。
FROZEN_ROWS = [
  [
    "A01",
    "技能",
    "技能 <采矿> 达到 50 级",
    "银",
    "否",
    "",
    ""
  ],
  [
    "A02",
    "技能",
    "技能 <行星开发> 达到 50 级",
    "银",
    "否",
    "如果你能开100个球种水，你还会是现在这样？",
    ""
  ],
  [
    "A03",
    "技能",
    "技能 <冶炼> 达到 50 级",
    "银",
    "否",
    "",
    ""
  ],
  [
    "A04",
    "技能",
    "技能 <气体采集> 达到 50 级",
    "银",
    "否",
    "",
    ""
  ],
  [
    "A05",
    "技能",
    "技能 <舰船工程> 达到 50 级",
    "银",
    "否",
    "",
    ""
  ],
  [
    "A06",
    "技能",
    "技能 <装备制造> 达到 50 级",
    "银",
    "否",
    "",
    ""
  ],
  [
    "A07",
    "技能",
    "技能 <改装件工程> 达到 50 级",
    "银",
    "否",
    "",
    ""
  ],
  [
    "A08",
    "技能",
    "技能 <增强剂工程> 达到 50 级",
    "银",
    "否",
    "",
    ""
  ],
  [
    "A09",
    "技能",
    "技能 <逆向工程> 达到 50 级",
    "银",
    "否",
    "",
    ""
  ],
  [
    "A10",
    "技能",
    "技能 <激光炮操作> 达到 50 级",
    "银",
    "否",
    "",
    ""
  ],
  [
    "A11",
    "技能",
    "技能 <火炮操作> 达到 50 级",
    "银",
    "否",
    "",
    ""
  ],
  [
    "A12",
    "技能",
    "技能 <导弹操作> 达到 50 级",
    "银",
    "否",
    "",
    ""
  ],
  [
    "A13",
    "技能",
    "技能 <防御> 达到 50 级",
    "银",
    "否",
    "",
    ""
  ],
  [
    "A14",
    "技能",
    "技能 <护盾操作> 达到 50 级",
    "银",
    "否",
    "",
    ""
  ],
  [
    "A15",
    "技能",
    "技能 <装甲强化> 达到 50 级",
    "银",
    "否",
    "",
    ""
  ],
  [
    "A16",
    "技能",
    "技能 <舰船结构工程> 达到 50 级",
    "银",
    "否",
    "",
    ""
  ],
  [
    "A17",
    "技能",
    "技能 <锁定> 达到 50 级",
    "银",
    "否",
    "",
    ""
  ],
  [
    "A18",
    "技能",
    "技能 <驾驶> 达到 50 级",
    "银",
    "否",
    "",
    ""
  ],
  [
    "A19",
    "技能",
    "技能 <电容管理> 达到 50 级",
    "银",
    "否",
    "",
    ""
  ],
  [
    "A20",
    "技能",
    "技能 <无人机> 达到 50 级",
    "银",
    "否",
    "",
    ""
  ],
  [
    "A21",
    "技能",
    "技能 <考古> 达到 50 级",
    "银",
    "否",
    "",
    ""
  ],
  [
    "A22",
    "技能",
    "技能 <采矿> 达到 99 级",
    "金",
    "否",
    "",
    ""
  ],
  [
    "A23",
    "技能",
    "技能 <行星开发> 达到 99 级",
    "金",
    "否",
    "鹰酱称之曰：能",
    ""
  ],
  [
    "A24",
    "技能",
    "技能 <冶炼> 达到 99 级",
    "金",
    "否",
    "",
    ""
  ],
  [
    "A25",
    "技能",
    "技能 <气体采集> 达到 99 级",
    "金",
    "否",
    "",
    ""
  ],
  [
    "A26",
    "技能",
    "技能 <舰船工程> 达到 99 级",
    "金",
    "否",
    "",
    ""
  ],
  [
    "A27",
    "技能",
    "技能 <装备制造> 达到 99 级",
    "金",
    "否",
    "",
    ""
  ],
  [
    "A28",
    "技能",
    "技能 <改装件工程> 达到 99 级",
    "金",
    "否",
    "",
    ""
  ],
  [
    "A29",
    "技能",
    "技能 <增强剂工程> 达到 99 级",
    "金",
    "否",
    "",
    ""
  ],
  [
    "A30",
    "技能",
    "技能 <逆向工程> 达到 99 级",
    "金",
    "否",
    "",
    ""
  ],
  [
    "A31",
    "技能",
    "技能 <激光炮操作> 达到 99 级",
    "金",
    "否",
    "",
    ""
  ],
  [
    "A32",
    "技能",
    "技能 <火炮操作> 达到 99 级",
    "金",
    "否",
    "",
    ""
  ],
  [
    "A33",
    "技能",
    "技能 <导弹操作> 达到 99 级",
    "金",
    "否",
    "",
    ""
  ],
  [
    "A34",
    "技能",
    "技能 <防御> 达到 99 级",
    "金",
    "否",
    "",
    ""
  ],
  [
    "A35",
    "技能",
    "技能 <护盾操作> 达到 99 级",
    "金",
    "否",
    "",
    ""
  ],
  [
    "A36",
    "技能",
    "技能 <装甲强化> 达到 99 级",
    "金",
    "否",
    "",
    ""
  ],
  [
    "A37",
    "技能",
    "技能 <舰船结构工程> 达到 99 级",
    "金",
    "否",
    "",
    ""
  ],
  [
    "A38",
    "技能",
    "技能 <锁定> 达到 99 级",
    "金",
    "否",
    "",
    ""
  ],
  [
    "A39",
    "技能",
    "技能 <驾驶> 达到 99 级",
    "金",
    "否",
    "",
    ""
  ],
  [
    "A40",
    "技能",
    "技能 <电容管理> 达到 99 级",
    "金",
    "否",
    "",
    ""
  ],
  [
    "A41",
    "技能",
    "技能 <无人机> 达到 99 级",
    "金",
    "否",
    "",
    ""
  ],
  [
    "A42",
    "技能",
    "技能 <考古> 达到 99 级",
    "金",
    "否",
    "",
    ""
  ],
  [
    "A43",
    "技能",
    "全部战斗技能到达Lv.99",
    "金",
    "否",
    "",
    ""
  ],
  [
    "A44",
    "技能",
    "任意 5 项技能达 Lv.80",
    "银",
    "否",
    "",
    ""
  ],
  [
    "A45",
    "技能",
    "任意 10 项技能达 Lv.90",
    "金",
    "否",
    "",
    ""
  ],
  [
    "A46",
    "技能",
    "全部技能达 Lv.50",
    "银",
    "否",
    "",
    ""
  ],
  [
    "A47",
    "技能",
    "全部战斗技能达 Lv.80",
    "金",
    "否",
    "",
    ""
  ],
  [
    "A48",
    "技能",
    "全部技能达 Lv.99",
    "传奇",
    "否",
    "",
    "终极"
  ],
  [
    "B01",
    "采矿工业",
    "首次采集 铁硅原矿",
    "铜",
    "否",
    "",
    ""
  ],
  [
    "B02",
    "采矿工业",
    "首次采集 赤镍矿",
    "铜",
    "否",
    "",
    ""
  ],
  [
    "B03",
    "采矿工业",
    "首次采集 蓝硼晶",
    "铜",
    "否",
    "",
    ""
  ],
  [
    "B04",
    "采矿工业",
    "首次采集 同位晶簇",
    "铜",
    "否",
    "",
    ""
  ],
  [
    "B05",
    "采矿工业",
    "首次采集 诺瓦矿",
    "铜",
    "否",
    "",
    ""
  ],
  [
    "B06",
    "采矿工业",
    "首次采集 重锆岩",
    "铜",
    "否",
    "",
    ""
  ],
  [
    "B07",
    "采矿工业",
    "首次采集 极星矿",
    "铜",
    "否",
    "",
    ""
  ],
  [
    "B08",
    "采矿工业",
    "首次冶炼 标准钛材",
    "铜",
    "否",
    "",
    ""
  ],
  [
    "B09",
    "采矿工业",
    "首次冶炼 银镍合金",
    "铜",
    "否",
    "",
    ""
  ],
  [
    "B10",
    "采矿工业",
    "首次冶炼 晶格聚合物",
    "铜",
    "否",
    "",
    ""
  ],
  [
    "B11",
    "采矿工业",
    "首次冶炼 同位复材",
    "铜",
    "否",
    "",
    ""
  ],
  [
    "B12",
    "采矿工业",
    "首次冶炼 诺瓦陶金",
    "铜",
    "否",
    "",
    ""
  ],
  [
    "B13",
    "采矿工业",
    "首次冶炼 重锆晶材",
    "铜",
    "否",
    "",
    ""
  ],
  [
    "B14",
    "采矿工业",
    "首次冶炼 奇点合金",
    "铜",
    "否",
    "",
    ""
  ],
  [
    "B15",
    "采矿工业",
    "累计采矿 1,000,000",
    "银",
    "否",
    "",
    ""
  ],
  [
    "B16",
    "采矿工业",
    "累计采矿 100,000,000",
    "金",
    "否",
    "",
    ""
  ],
  [
    "B17",
    "采矿工业",
    "首次气体采集",
    "铜",
    "否",
    "",
    ""
  ],
  [
    "B18",
    "采矿工业",
    "累计气体 1,000,000",
    "银",
    "否",
    "",
    ""
  ],
  [
    "C01",
    "舰船工程",
    "制造首个舰船部件",
    "铜",
    "否",
    "",
    ""
  ],
  [
    "C02",
    "舰船工程",
    "总装首艘舰船",
    "铜",
    "否",
    "",
    ""
  ],
  [
    "C03",
    "舰船工程",
    "总装首艘 天穹级",
    "银",
    "否",
    "",
    ""
  ],
  [
    "C04",
    "舰船工程",
    "总装首艘 重垒级",
    "银",
    "否",
    "",
    ""
  ],
  [
    "C05",
    "舰船工程",
    "总装首艘 裂界级",
    "银",
    "否",
    "",
    ""
  ],
  [
    "C06",
    "舰船工程",
    "总装首艘 山海级",
    "银",
    "否",
    "",
    ""
  ],
  [
    "C07",
    "舰船工程",
    "总装首艘 启明级",
    "银",
    "否",
    "",
    ""
  ],
  [
    "C08",
    "舰船工程",
    "总装首艘 星冕级",
    "金",
    "否",
    "",
    ""
  ],
  [
    "C09",
    "舰船工程",
    "总装首艘 恒城级",
    "金",
    "否",
    "",
    ""
  ],
  [
    "C10",
    "舰船工程",
    "总装首艘 裁决级",
    "金",
    "否",
    "",
    ""
  ],
  [
    "C11",
    "舰船工程",
    "获得首张蓝图",
    "铜",
    "否",
    "",
    ""
  ],
  [
    "C12",
    "舰船工程",
    "累计建造 50 艘旗舰",
    "金",
    "否",
    "",
    ""
  ],
  [
    "C13",
    "舰船工程",
    "累计建造 25 艘超级旗舰",
    "传奇",
    "否",
    "",
    ""
  ],
  [
    "C14",
    "舰船工程",
    "舰船工程达 Lv.99",
    "金",
    "否",
    "",
    ""
  ],
  [
    "D01",
    "装备/增强剂",
    "制造 传奇品质 纳米采掘润滑剂 ",
    "金",
    "否",
    "",
    ""
  ],
  [
    "D02",
    "装备/增强剂",
    "制造 传奇品质 富矿共振催化剂",
    "金",
    "否",
    "",
    ""
  ],
  [
    "D03",
    "装备/增强剂",
    "制造 传奇品质 遗迹解析液",
    "金",
    "否",
    "",
    ""
  ],
  [
    "D04",
    "装备/增强剂",
    "制造 传奇品质 文物示踪剂 ",
    "金",
    "否",
    "",
    ""
  ],
  [
    "D05",
    "装备/增强剂",
    "制造 传奇品质 激光炮冷却剂 ",
    "金",
    "否",
    "",
    ""
  ],
  [
    "D06",
    "装备/增强剂",
    "制造 传奇品质 导弹燃烧催化剂 ",
    "金",
    "否",
    "",
    ""
  ],
  [
    "D07",
    "装备/增强剂",
    "制造 传奇品质火炮增压药 ",
    "金",
    "否",
    "",
    ""
  ],
  [
    "D08",
    "装备/增强剂",
    "制造 传奇品质 护盾回充液 ",
    "金",
    "否",
    "",
    ""
  ],
  [
    "D09",
    "装备/增强剂",
    "制造 传奇品质 装甲纳米修复剂 ",
    "金",
    "否",
    "",
    ""
  ],
  [
    "D10",
    "装备/增强剂",
    "制造 传奇品质 结构再生胶",
    "金",
    "否",
    "",
    ""
  ],
  [
    "D11",
    "装备/增强剂",
    "制造首个任意增强剂",
    "铜",
    "否",
    "",
    ""
  ],
  [
    "D12",
    "装备/增强剂",
    "累计制造 1,000 个增强剂",
    "银",
    "否",
    "",
    ""
  ],
  [
    "D13",
    "装备/增强剂",
    "首次装备制造",
    "铜",
    "否",
    "",
    ""
  ],
  [
    "D14",
    "装备/增强剂",
    "首次燃料制造",
    "铜",
    "否",
    "",
    ""
  ],
  [
    "D15",
    "装备/增强剂",
    "首次弹药制造",
    "铜",
    "否",
    "",
    ""
  ],
  [
    "D16",
    "装备/增强剂",
    "首次装备强化",
    "铜",
    "否",
    "",
    ""
  ],
  [
    "D17",
    "装备/增强剂",
    "制造首件改装件",
    "铜",
    "否",
    "",
    ""
  ],
  [
    "D18",
    "装备/增强剂",
    "集齐全部 45 件改装件",
    "传奇",
    "否",
    "",
    ""
  ],
  [
    "E01",
    "战斗",
    "首次通关战斗星带：苍穹劫团前哨站",
    "银",
    "否",
    "",
    ""
  ],
  [
    "E02",
    "战斗",
    "首次通关战斗星带：赤誓教团隐蔽所",
    "银",
    "否",
    "",
    ""
  ],
  [
    "E03",
    "战斗",
    "首次通关战斗星带：静默集群哨站",
    "银",
    "否",
    "",
    ""
  ],
  [
    "E04",
    "战斗",
    "首次通关战斗星带：苍穹劫团劫掠走廊",
    "银",
    "否",
    "",
    ""
  ],
  [
    "E05",
    "战斗",
    "首次通关战斗星带：赤誓教团献祭场",
    "银",
    "否",
    "",
    ""
  ],
  [
    "E06",
    "战斗",
    "首次通关战斗星带：静默集群控制节点",
    "银",
    "否",
    "",
    ""
  ],
  [
    "E07",
    "战斗",
    "首次通关战斗星带：苍穹劫团猎杀空域",
    "银",
    "否",
    "",
    ""
  ],
  [
    "E08",
    "战斗",
    "首次通关战斗星带：赤誓教团深红圣堂",
    "银",
    "否",
    "",
    ""
  ],
  [
    "E09",
    "战斗",
    "首次通关战斗星带：静默集群同化枢纽",
    "银",
    "否",
    "",
    ""
  ],
  [
    "E10",
    "战斗",
    "首次通关战斗星带：苍穹劫团破阵战场",
    "银",
    "否",
    "",
    ""
  ],
  [
    "E11",
    "战斗",
    "首次通关战斗星带：赤誓教团铁血圣殿",
    "银",
    "否",
    "",
    ""
  ],
  [
    "E12",
    "战斗",
    "首次通关战斗星带：静默集群统御矩阵",
    "银",
    "否",
    "",
    ""
  ],
  [
    "E13",
    "战斗",
    "首次通关战斗星带：苍穹劫团外环侵袭区",
    "银",
    "否",
    "",
    ""
  ],
  [
    "E14",
    "战斗",
    "首次通关战斗星带：赤誓教团外环圣库",
    "银",
    "否",
    "",
    ""
  ],
  [
    "E15",
    "战斗",
    "首次通关战斗星带：静默集群外环同化阵列",
    "银",
    "否",
    "",
    ""
  ],
  [
    "E16",
    "战斗",
    "首次通关战斗星带：苍穹劫团深域王庭",
    "银",
    "否",
    "",
    ""
  ],
  [
    "E17",
    "战斗",
    "首次通关战斗星带：赤誓教团深域圣殿",
    "银",
    "否",
    "",
    ""
  ],
  [
    "E18",
    "战斗",
    "首次通关战斗星带：静默集群深域主脑",
    "银",
    "否",
    "",
    ""
  ],
  [
    "E19",
    "战斗",
    "通关全部 18 个战斗星带",
    "传奇",
    "否",
    "",
    ""
  ],
  [
    "E20",
    "战斗",
    "在某星带打到第 20 波",
    "银",
    "否",
    "",
    ""
  ],
  [
    "E21",
    "战斗",
    "用激光炮通关一个星带",
    "银",
    "否",
    "",
    ""
  ],
  [
    "E22",
    "战斗",
    "用火炮通关一个星带",
    "银",
    "否",
    "",
    ""
  ],
  [
    "E23",
    "战斗",
    "用导弹通关一个星带",
    "银",
    "否",
    "",
    ""
  ],
  [
    "E24",
    "战斗",
    "击杀首艘旗舰级敌人",
    "金",
    "否",
    "",
    ""
  ],
  [
    "E25",
    "战斗",
    "击杀首艘超级旗舰级敌人",
    "传奇",
    "否",
    "",
    ""
  ],
  [
    "E26",
    "战斗",
    "首次进入死亡空间",
    "银",
    "否",
    "",
    ""
  ],
  [
    "E27",
    "战斗",
    "完整通关一次死亡空间",
    "金",
    "否",
    "",
    ""
  ],
  [
    "E29",
    "战斗",
    "无伤通关一个星带",
    "传奇",
    "是",
    "",
    ""
  ],
  [
    "E30",
    "战斗",
    "单场战斗累计造成伤害 ≥ 1,000,000",
    "金",
    "否",
    "",
    ""
  ],
  [
    "E31",
    "战斗",
    "击败苍穹劫团阵营 boss",
    "金",
    "否",
    "",
    ""
  ],
  [
    "E32",
    "战斗",
    "击败赤誓教团阵营 boss",
    "金",
    "否",
    "",
    ""
  ],
  [
    "E33",
    "战斗",
    "击败静默集群阵营 boss",
    "金",
    "否",
    "",
    ""
  ],
  [
    "F01",
    "考古",
    "首次扫描遗迹",
    "铜",
    "否",
    "",
    ""
  ],
  [
    "F02",
    "考古",
    "首次解析遗迹：失落信标残骸",
    "银",
    "否",
    "",
    ""
  ],
  [
    "F03",
    "考古",
    "首次解析遗迹：远古殖民舱",
    "银",
    "否",
    "",
    ""
  ],
  [
    "F04",
    "考古",
    "首次解析遗迹：漂流货柜群",
    "银",
    "否",
    "",
    ""
  ],
  [
    "F05",
    "考古",
    "首次解析遗迹：破碎巡防站",
    "银",
    "否",
    "",
    ""
  ],
  [
    "F06",
    "考古",
    "首次解析遗迹：废弃采矿平台",
    "银",
    "否",
    "",
    ""
  ],
  [
    "F07",
    "考古",
    "首次解析遗迹：星图中继塔",
    "银",
    "否",
    "",
    ""
  ],
  [
    "F08",
    "考古",
    "首次解析遗迹：沉睡战列残骸",
    "银",
    "否",
    "",
    ""
  ],
  [
    "F09",
    "考古",
    "首次解析遗迹：湮灭实验室",
    "银",
    "否",
    "",
    ""
  ],
  [
    "F10",
    "考古",
    "首次解析遗迹：深空方尖碑",
    "银",
    "否",
    "",
    ""
  ],
  [
    "F11",
    "考古",
    "首次解析遗迹：湮灭旗舰坟场",
    "银",
    "否",
    "",
    ""
  ],
  [
    "F12",
    "考古",
    "首次解析遗迹：虚空研究所",
    "银",
    "否",
    "",
    ""
  ],
  [
    "F13",
    "考古",
    "首次解析遗迹：远古跃迁枢纽",
    "银",
    "否",
    "",
    ""
  ],
  [
    "F14",
    "考古",
    "首次解析遗迹：失落文明圣殿",
    "银",
    "否",
    "",
    ""
  ],
  [
    "F15",
    "考古",
    "首次解析遗迹：湮灭母舰核心",
    "银",
    "否",
    "",
    ""
  ],
  [
    "F16",
    "考古",
    "首次解析遗迹：深渊观测站",
    "银",
    "否",
    "",
    ""
  ],
  [
    "F17",
    "考古",
    "完成全部 5 档考古",
    "金",
    "否",
    "",
    ""
  ],
  [
    "F18",
    "考古",
    "首次出售文物",
    "铜",
    "否",
    "",
    ""
  ],
  [
    "F19",
    "考古",
    "累计出售 100 文物",
    "银",
    "否",
    "",
    ""
  ],
  [
    "F20",
    "考古",
    "累计获得 10,000 功勋",
    "银",
    "否",
    "",
    ""
  ],
  [
    "F21",
    "考古",
    "触发首次稀有掉落",
    "金",
    "否",
    "",
    ""
  ],
  [
    "F22",
    "考古",
    "考古达 Lv.99",
    "金",
    "否",
    "",
    ""
  ],
  [
    "G01",
    "行星",
    "首次殖民 熔岩行星",
    "铜",
    "否",
    "好球",
    ""
  ],
  [
    "G02",
    "行星",
    "首次殖民 气态行星",
    "铜",
    "否",
    "这球好白，哦不，好大",
    ""
  ],
  [
    "G03",
    "行星",
    "首次殖民 冰行星",
    "铜",
    "否",
    "也是好球",
    ""
  ],
  [
    "G04",
    "行星",
    "首次殖民 等离子行星",
    "铜",
    "否",
    "真正的好球",
    ""
  ],
  [
    "G05",
    "行星",
    "首次殖民 温带行星",
    "铜",
    "否",
    "我是来种菜的，你是要干什么",
    ""
  ],
  [
    "G06",
    "行星",
    "首次殖民 风暴行星",
    "铜",
    "否",
    "人称小气球",
    ""
  ],
  [
    "G07",
    "行星",
    "同时运营 5 颗行星",
    "银",
    "否",
    "你的粪勺请拿好",
    ""
  ],
  [
    "G09",
    "行星",
    "累计行星产出 1,000,000",
    "银",
    "否",
    "只要粪勺舞得好，哪有行星挖不倒",
    ""
  ],
  [
    "G10",
    "行星",
    "解锁全部行星槽位",
    "金",
    "否",
    "黄金粪勺",
    ""
  ],
  [
    "H01",
    "空间站",
    "建成空间站本体 Lv.1",
    "铜",
    "否",
    "",
    ""
  ],
  [
    "H02",
    "空间站",
    "本体升至 Lv.3",
    "银",
    "否",
    "",
    ""
  ],
  [
    "H03",
    "空间站",
    "资源调度中心 升至 Lv.3",
    "金",
    "否",
    "",
    ""
  ],
  [
    "H04",
    "空间站",
    "行星管控中心 升至 Lv.3",
    "金",
    "否",
    "",
    ""
  ],
  [
    "H05",
    "空间站",
    "冶炼精炼厂 升至 Lv.3",
    "金",
    "否",
    "",
    ""
  ],
  [
    "H06",
    "空间站",
    "装备制造厂 升至 Lv.3",
    "金",
    "否",
    "",
    ""
  ],
  [
    "H07",
    "空间站",
    "增强剂制造厂 升至 Lv.3",
    "金",
    "否",
    "",
    ""
  ],
  [
    "H08",
    "空间站",
    "考古实验室 升至 Lv.3",
    "金",
    "否",
    "",
    ""
  ],
  [
    "H09",
    "空间站",
    "作战指挥中心 升至 Lv.3",
    "金",
    "否",
    "",
    ""
  ],
  [
    "H10",
    "空间站",
    "舰船船坞 升至 Lv.3",
    "金",
    "否",
    "",
    ""
  ],
  [
    "H11",
    "空间站",
    "完成首次建设队列",
    "铜",
    "否",
    "",
    ""
  ],
  [
    "H12",
    "空间站",
    "三条自动线同时运转",
    "银",
    "否",
    "",
    ""
  ],
  [
    "H13",
    "空间站",
    "综合后勤倍率达 +3%",
    "金",
    "否",
    "",
    ""
  ],
  [
    "H15",
    "空间站",
    "完成一次 >8h 离线结算",
    "银",
    "否",
    "",
    ""
  ],
  [
    "H16",
    "空间站",
    "舰船船坞升至 Lv.3",
    "金",
    "否",
    "",
    ""
  ],
  [
    "I04",
    "经济",
    "持有 标准钛材 各 ≥ 1,000",
    "铜",
    "否",
    "",
    ""
  ],
  [
    "I05",
    "经济",
    "持有 银镍合金 各 ≥ 1,000",
    "铜",
    "否",
    "",
    ""
  ],
  [
    "I06",
    "经济",
    "持有 晶格聚合物 各 ≥ 1,000",
    "铜",
    "否",
    "",
    ""
  ],
  [
    "I07",
    "经济",
    "持有 同位复材 各 ≥ 1,000",
    "铜",
    "否",
    "",
    ""
  ],
  [
    "I08",
    "经济",
    "持有 诺瓦陶金 各 ≥ 1,000",
    "铜",
    "否",
    "",
    ""
  ],
  [
    "I09",
    "经济",
    "持有 重锆晶材 各 ≥ 1,000",
    "铜",
    "否",
    "",
    ""
  ],
  [
    "I10",
    "经济",
    "持有 奇点合金 各 ≥ 1,000",
    "铜",
    "否",
    "",
    ""
  ],
  [
    "I01",
    "经济",
    "持有 1,000,000 星币",
    "铜",
    "否",
    "",
    ""
  ],
  [
    "I02",
    "经济",
    "持有 100,000,000 星币",
    "银",
    "否",
    "",
    ""
  ],
  [
    "I03",
    "经济",
    "持有 1,000,000,000 星币",
    "金",
    "否",
    "",
    ""
  ],
  [
    "I11",
    "经济",
    "集齐全部月矿材料(铷/暗质晶核/等离子体/磁场聚合物)",
    "银",
    "否",
    "",
    ""
  ],
  [
    "I12",
    "经济",
    "物资总量首次突破 1,000,000",
    "银",
    "否",
    "",
    ""
  ],
  [
    "J01",
    "综合",
    "累计在线 24 小时",
    "铜",
    "否",
    "",
    ""
  ],
  [
    "J02",
    "综合",
    "累计在线 7 天",
    "银",
    "否",
    "",
    ""
  ],
  [
    "J03",
    "综合",
    "首次离线收益结算",
    "铜",
    "否",
    "",
    ""
  ],
  [
    "J04",
    "综合",
    "累计离线等价 7 天",
    "银",
    "否",
    "",
    ""
  ],
  [
    "J05",
    "综合",
    "动作队列排满 25 项",
    "银",
    "否",
    "",
    ""
  ],
  [
    "J06",
    "综合",
    "首次重创后维修并恢复出击",
    "金",
    "否",
    "",
    ""
  ],
  [
    "J10",
    "综合",
    "达成 50 项成就",
    "金",
    "否",
    "",
    ""
  ],
  [
    "J11",
    "综合",
    "达成 100 项成就",
    "传奇",
    "否",
    "",
    ""
  ],
  [
    "J12",
    "综合",
    "完成全部成就",
    "传奇",
    "是",
    "",
    "隐藏"
  ]
]


def frozen_norm():
    arr = []
    for r in FROZEN_ROWS:
        arr.append([r[0], r[1], r[2], r[3], r[4], r[5], r[6]])
    return arr


def freeze_hash(arr):
    js = json.dumps(arr, ensure_ascii=False, separators=(",", ":"))
    b = js.encode("utf-8")
    return hashlib.sha256(b).hexdigest(), len(b)


def display_name(idv):
    if idv in PROVISIONAL_NAMES:
        return PROVISIONAL_NAMES[idv]
    return PLACEHOLDER_PREFIX + idv


def name_status(idv):
    return "provisional" if idv in PROVISIONAL_NAMES else "placeholder"


def tier_of(tier_label):
    return TIER_MAP.get(tier_label, "bronze")


def reward_hours_of(cat, tier_label):
    """按分类 + 难度档确定性推导一次性科研工时；研究类返回 None（reward=null）。"""
    if cat in REWARD_EXCLUDED_CATEGORIES:
        return None
    return TIER_REWARD_HOURS.get(tier_of(tier_label))


def reward_csv_cell(cat, tier_label):
    hours = reward_hours_of(cat, tier_label)
    if hours is None:
        return ""
    return json.dumps({"type": REWARD_TYPE, "hours": hours}, ensure_ascii=False, separators=(",", ":"))


def reward_js_literal(cat, tier_label):
    hours = reward_hours_of(cat, tier_label)
    if hours is None:
        return "null"
    return "Object.freeze({ type: " + json.dumps(REWARD_TYPE, ensure_ascii=False) + ", hours: " + json.dumps(hours) + " })"


def csv_row_for(r):
    idv, cat, cond, tier, hidden, name, note = r
    return [
        idv, cat, cond, tier, hidden, display_name(idv), note, name_status(idv),
        "", reward_csv_cell(cat, tier), "否", "", "", "",
    ]


def build_csv_text():
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(HEADER)
    for r in FROZEN_ROWS:
        w.writerow(csv_row_for(r))
    return "\ufeff" + buf.getvalue()


def build_js_text():
    lines = []
    lines.append("(function () {")
    lines.append('  "use strict";')
    lines.append("  const SCHEMA_VERSION = 1;")
    lines.append('  const PLACEHOLDER_NAME_PREFIX = "待命名成就 · ";')
    cats = []
    for r in FROZEN_ROWS:
        if r[1] not in cats:
            cats.append(r[1])
    lines.append("  const CATEGORIES = Object.freeze([")
    lines.append("    " + ", ".join(json.dumps(c, ensure_ascii=False) for c in cats))
    lines.append("  ]);")
    lines.append("  const TIERS = Object.freeze({")
    lines.append('    bronze: Object.freeze({ code: "bronze", label: "铜" }),')
    lines.append('    silver: Object.freeze({ code: "silver", label: "银" }),')
    lines.append('    gold:   Object.freeze({ code: "gold", label: "金" }),')
    lines.append('    legendary: Object.freeze({ code: "legendary", label: "传奇" }),')
    lines.append("  });")
    lines.append("  const ACHIEVEMENTS = Object.freeze([")
    for r in FROZEN_ROWS:
        idv, cat, cond, tier, hidden, name, note = r
        tier_code = tier_of(tier)
        hidden_bool = "true" if hidden == "是" else "false"
        obj = (
            "    Object.freeze({"
            " id: " + json.dumps(idv, ensure_ascii=False) +
            ", category: " + json.dumps(cat, ensure_ascii=False) +
            ", conditionText: " + json.dumps(cond, ensure_ascii=False) +
            ", tier: " + json.dumps(tier_code, ensure_ascii=False) +
            ", tierLabel: " + json.dumps(tier, ensure_ascii=False) +
            ", hidden: " + hidden_bool +
            ", name: " + json.dumps(display_name(idv), ensure_ascii=False) +
            ", nameStatus: " + json.dumps(name_status(idv), ensure_ascii=False) +
            ", trigger: null, reward: " + reward_js_literal(cat, tier) +
            ", steam: Object.freeze({ enabled: false, apiName: null, progressStatApiName: null, progressMax: null })" +
            ", note: " + json.dumps(note, ensure_ascii=False) +
            " }),"
        )
        lines.append(obj)
    lines.append("  ]);")
    lines.append("  const ACHIEVEMENTS_BY_ID = Object.freeze((function () {")
    lines.append("    const m = {};")
    lines.append("    for (const a of ACHIEVEMENTS) m[a.id] = a;")
    lines.append("    return m;")
    lines.append("  })());")
    lines.append("  const AchievementData = Object.freeze({")
    lines.append("    SCHEMA_VERSION,")
    lines.append("    ACHIEVEMENTS,")
    lines.append("    ACHIEVEMENTS_BY_ID,")
    lines.append("    CATEGORIES,")
    lines.append("    TIERS,")
    lines.append("    PLACEHOLDER_NAME_PREFIX,")
    lines.append("  });")
    lines.append('  if (typeof globalThis !== "undefined") globalThis.AchievementData = AchievementData;')
    lines.append('  if (typeof window !== "undefined") window.AchievementData = AchievementData;')
    lines.append("})();")
    lines.append("")
    return "\n".join(lines)


def main():
    args = sys.argv[1:]
    if len(args) != 1 or args[0] not in ("--check", "--write"):
        sys.stderr.write("未知参数：%s（可用：--check --write）\n" % " ".join(args))
        sys.exit(2)
    mode = args[0]

    norm = frozen_norm()
    h, nbytes = freeze_hash(norm)
    placeholder_count = sum(1 for r in FROZEN_ROWS if name_status(r[0]) == "placeholder")
    provisional_count = sum(1 for r in FROZEN_ROWS if name_status(r[0]) == "provisional")
    reward_tier_counts = {}
    reward_total_hours = 0.0
    reward_null_count = 0
    for r in FROZEN_ROWS:
        hrs = reward_hours_of(r[1], r[3])
        if hrs is None:
            reward_null_count += 1
            continue
        reward_tier_counts[tier_of(r[3])] = reward_tier_counts.get(tier_of(r[3]), 0) + 1
        reward_total_hours += float(hrs)
    reward_summary = "奖励档位: " + " ".join(
        "%s=%d" % (k, reward_tier_counts.get(k, 0)) for k in ("bronze", "silver", "gold", "legendary")
    ) + " null=%d 总工时=%s" % (reward_null_count, ("%g" % reward_total_hours))

    if mode == "--check":
        ok = True
        if not os.path.exists(CSV_PATH):
            sys.stderr.write("CSV 不存在: %s\n" % CSV_PATH); ok = False
        else:
            with open(CSV_PATH, "rb") as f:
                raw = f.read()
            if raw.startswith(b"\xef\xbb\xbf"):
                raw = raw[3:]
            reader = list(csv.reader(io.StringIO(raw.decode("utf-8"))))
            got_header = reader[0]
            got_rows = reader[1:]
            if got_header != HEADER:
                sys.stderr.write("CSV 表头不一致\n"); ok = False
            if len(got_rows) != len(FROZEN_ROWS):
                sys.stderr.write("CSV 行数不一致 %d != %d\n" % (len(got_rows), len(FROZEN_ROWS))); ok = False
            else:
                for i, gr in enumerate(got_rows):
                    fr = FROZEN_ROWS[i]
                    exp = csv_row_for(fr)
                    if gr != exp:
                        sys.stderr.write("CSV 第 %d 行不一致: %r != %r\n" % (i + 2, gr, exp)); ok = False; break
        if not os.path.exists(JS_PATH):
            sys.stderr.write("JS 不存在: %s\n" % JS_PATH); ok = False
        else:
            with open(JS_PATH, "rb") as f:
                js_bytes = f.read()
            if js_bytes != build_js_text().encode("utf-8"):
                sys.stderr.write("JS 内容与期望不一致\n"); ok = False
        if h != FREEZE_TARGET_HASH or nbytes != FREEZE_TARGET_BYTES:
            sys.stderr.write("冻结哈希/字节数异常\n"); ok = False
        print("行数: %d" % len(FROZEN_ROWS))
        print("占位名数量: %d" % placeholder_count)
        print("provisional 数量: %d" % provisional_count)
        print("冻结哈希: %s" % h)
        print("冻结 JSON 字节数: %d" % nbytes)
        print(reward_summary)
        sys.exit(0 if ok else 1)

    # --write（二进制写入，避免 Windows 文本模式把 \n 翻成 \r\n 破坏字节一致性）
    with open(CSV_PATH, "wb") as f:
        f.write(build_csv_text().encode("utf-8"))
    with open(JS_PATH, "wb") as f:
        f.write(build_js_text().encode("utf-8"))
    print("已生成: %s" % CSV_PATH)
    print("已生成: %s" % JS_PATH)
    print("行数: %d  占位名: %d  provisional: %d" % (len(FROZEN_ROWS), placeholder_count, provisional_count))
    print("冻结哈希: %s" % h)
    print(reward_summary)
    sys.exit(0)


if __name__ == "__main__":
    main()
