# -*- coding: utf-8 -*-
"""Achievements data generator — 成就系统 Batch A 冻结目录生成器。

权威来源：本文件内嵌的 FROZEN_ROWS（当前 achievements-template.csv 的 195 行）。
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

FREEZE_TARGET_HASH = "4d7558d1dbd50181e56107d8d7db9bdf2e7ed26c13dce43499ea5346bf9bbec1"
FREEZE_TARGET_BYTES = 8690

# Steam 成就元数据来源：steam-achievements-named.csv（项目根，相对本脚本上一级）。
# 该 CSV 提供每条内部成就的 Steam API 名 / 进度统计名 / 进度上限，
# 由生成器发射进 js/data/achievements.js 的 steam 字段，作为“实装进游戏”的落点。
# 文件缺失或解析失败时回退为空（所有 steam 字段保持 null / 不同步），不阻断生成。
STEAM_CSV_PATH = os.path.abspath(os.path.join(HERE, "..", "steam-achievements-named.csv"))

# 实装时是否默认启用 Steam 同步。当前 Steam 适配层（SteamAchievementProvider）尚未实现，
# 且 platform-achievement-map.js 的 steam 后台 ID 仍为 null，故 enabled=true 在运行期实际 inert；
# 这里按“实装进游戏”的语义置 true，若需遵循‘第一阶段默认不同步’纪律可改为 False。
STEAM_ENABLED_DEFAULT = True


def load_steam_meta():
    """读取 steam-achievements-named.csv，返回 {内部ID: {apiName, stat, max}}。"""
    meta = {}
    if not os.path.exists(STEAM_CSV_PATH):
        sys.stderr.write("提示: Steam 元数据文件缺失，steam 字段将全部置 null: %s\n" % STEAM_CSV_PATH)
        return meta
    try:
        with open(STEAM_CSV_PATH, "r", encoding="utf-8-sig", newline="") as f:
            reader = csv.reader(f)
            header = next(reader, None)
            if not header:
                return meta
            for row in reader:
                if not row or not row[0].strip():
                    continue
                aid = row[0].strip()
                # 列序: 0编号 1分类 2触发条件 3难度档 4隐藏 5成就名 6备注
                #        7 Steam API Name 8 Steam进度Stat 9 进度上限 10 批次
                api_name = (row[7].strip() if len(row) > 7 else "") or None
                stat_name = (row[8].strip() if len(row) > 8 else "") or None
                max_raw = (row[9].strip() if len(row) > 9 else "") or ""
                max_val = None
                if max_raw:
                    try:
                        max_val = int(max_raw)
                    except ValueError:
                        try:
                            max_val = float(max_raw)
                        except ValueError:
                            max_val = None
                # 2026-09-05：同时捕获第 5 列「成就名（待填）」——用户已在 named CSV 填好 116 个显示名，
                # 此前只读 Steam 元数据（7/8/9 列）漏了名字，导致游戏内一直显示「待命名成就 · AXX」。
                display_name_csv = (row[5].strip() if len(row) > 5 else "") or ""
                meta[aid] = {"apiName": api_name, "stat": stat_name, "max": max_val, "displayName": display_name_csv}
    except Exception as e:
        sys.stderr.write("警告: 读取 Steam 元数据失败，回退 null: %s\n" % e)
        return {}
    return meta


STEAM_META = load_steam_meta()


def steam_js_literal(aid):
    """为某内部成就生成 steam 字段的 JS 字面量。有 API 名→启用并填元数据，否则 null。"""
    sm = STEAM_META.get(aid)
    if sm and sm.get("apiName"):
        api = json.dumps(sm["apiName"], ensure_ascii=False)
        stat = json.dumps(sm["stat"], ensure_ascii=False) if sm.get("stat") else "null"
        mx = str(sm["max"]) if sm.get("max") is not None else "null"
        return "Object.freeze({ enabled: %s, apiName: %s, progressStatApiName: %s, progressMax: %s })" % (
            "true" if STEAM_ENABLED_DEFAULT else "false", api, stat, mx)
    return "Object.freeze({ enabled: false, apiName: null, progressStatApiName: null, progressMax: null })"

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
    "A22": "鹰酱称之曰：能",
    "G01": "好球",
    "G02": "这球好白，哦不，好大",
    "G03": "也是好球",
    "G04": "真正的好球",
    "G05": "我是来种菜的，你是要干什么",
    "G06": "人称小气球",
    "G07": "你的粪勺请拿好",
    "G08": "只要粪勺舞得好，哪有行星挖不倒",
    "G09": "黄金粪勺"
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
    "",
  ],
  [
    "A02",
    "技能",
    "技能 <行星开发> 达到 50 级",
    "银",
    "否",
    "如果你能开100个球种水，你还会是现在这样？",
    "",
  ],
  [
    "A03",
    "技能",
    "技能 <冶炼> 达到 50 级",
    "银",
    "否",
    "",
    "",
  ],
  [
    "A04",
    "技能",
    "技能 <气体采集> 达到 50 级",
    "银",
    "否",
    "",
    "",
  ],
  [
    "A05",
    "技能",
    "技能 <舰船工程> 达到 50 级",
    "银",
    "否",
    "",
    "",
  ],
  [
    "A06",
    "技能",
    "技能 <装备制造> 达到 50 级",
    "银",
    "否",
    "",
    "",
  ],
  [
    "A08",
    "技能",
    "技能 <增强剂工程> 达到 50 级",
    "银",
    "否",
    "",
    "",
  ],
  [
    "A10",
    "技能",
    "技能 <激光炮操作> 达到 50 级",
    "银",
    "否",
    "",
    "",
  ],
  [
    "A11",
    "技能",
    "技能 <火炮操作> 达到 50 级",
    "银",
    "否",
    "",
    "",
  ],
  [
    "A12",
    "技能",
    "技能 <导弹操作> 达到 50 级",
    "银",
    "否",
    "",
    "",
  ],
  [
    "A13",
    "技能",
    "技能 <防御> 达到 50 级",
    "银",
    "否",
    "",
    "",
  ],
  [
    "A14",
    "技能",
    "技能 <护盾操作> 达到 50 级",
    "银",
    "否",
    "",
    "",
  ],
  [
    "A15",
    "技能",
    "技能 <装甲强化> 达到 50 级",
    "银",
    "否",
    "",
    "",
  ],
  [
    "A16",
    "技能",
    "技能 <舰船结构工程> 达到 50 级",
    "银",
    "否",
    "",
    "",
  ],
  [
    "A17",
    "技能",
    "技能 <锁定> 达到 50 级",
    "银",
    "否",
    "",
    "",
  ],
  [
    "A18",
    "技能",
    "技能 <驾驶> 达到 50 级",
    "银",
    "否",
    "",
    "",
  ],
  [
    "A19",
    "技能",
    "技能 <电容管理> 达到 50 级",
    "银",
    "否",
    "",
    "",
  ],
  [
    "A20",
    "技能",
    "技能 <考古> 达到 50 级",
    "银",
    "否",
    "",
    "",
  ],
  [
    "A21",
    "技能",
    "技能 <采矿> 达到 99 级",
    "金",
    "否",
    "",
    "",
  ],
  [
    "A22",
    "技能",
    "技能 <行星开发> 达到 99 级",
    "金",
    "否",
    "鹰酱称之曰：能",
    "",
  ],
  [
    "A23",
    "技能",
    "技能 <冶炼> 达到 99 级",
    "金",
    "否",
    "",
    "",
  ],
  [
    "A24",
    "技能",
    "技能 <气体采集> 达到 99 级",
    "金",
    "否",
    "",
    "",
  ],
  [
    "A25",
    "技能",
    "技能 <舰船工程> 达到 99 级",
    "金",
    "否",
    "",
    "",
  ],
  [
    "A26",
    "技能",
    "技能 <装备制造> 达到 99 级",
    "金",
    "否",
    "",
    "",
  ],
  [
    "A28",
    "技能",
    "技能 <增强剂工程> 达到 99 级",
    "金",
    "否",
    "",
    "",
  ],
  [
    "A30",
    "技能",
    "技能 <激光炮操作> 达到 99 级",
    "金",
    "否",
    "",
    "",
  ],
  [
    "A31",
    "技能",
    "技能 <火炮操作> 达到 99 级",
    "金",
    "否",
    "",
    "",
  ],
  [
    "A32",
    "技能",
    "技能 <导弹操作> 达到 99 级",
    "金",
    "否",
    "",
    "",
  ],
  [
    "A33",
    "技能",
    "技能 <防御> 达到 99 级",
    "金",
    "否",
    "",
    "",
  ],
  [
    "A34",
    "技能",
    "技能 <护盾操作> 达到 99 级",
    "金",
    "否",
    "",
    "",
  ],
  [
    "A35",
    "技能",
    "技能 <装甲强化> 达到 99 级",
    "金",
    "否",
    "",
    "",
  ],
  [
    "A36",
    "技能",
    "技能 <舰船结构工程> 达到 99 级",
    "金",
    "否",
    "",
    "",
  ],
  [
    "A37",
    "技能",
    "技能 <锁定> 达到 99 级",
    "金",
    "否",
    "",
    "",
  ],
  [
    "A38",
    "技能",
    "技能 <驾驶> 达到 99 级",
    "金",
    "否",
    "",
    "",
  ],
  [
    "A39",
    "技能",
    "技能 <电容管理> 达到 99 级",
    "金",
    "否",
    "",
    "",
  ],
  [
    "A40",
    "技能",
    "技能 <考古> 达到 99 级",
    "金",
    "否",
    "",
    "",
  ],
  [
    "A46",
    "技能",
    "全部技能达 Lv.99",
    "传奇",
    "否",
    "",
    "终极",
  ],
  [
    "B01",
    "采矿工业",
    "首次采集 铁硅原矿",
    "铜",
    "否",
    "",
    "",
  ],
  [
    "B08",
    "采矿工业",
    "首次冶炼 标准钛材",
    "铜",
    "否",
    "",
    "",
  ],
  [
    "B15",
    "采矿工业",
    "累计采矿 1,000,000",
    "银",
    "否",
    "",
    "",
  ],
  [
    "B16",
    "采矿工业",
    "累计采矿 100,000,000",
    "金",
    "否",
    "",
    "",
  ],
  [
    "B17",
    "采矿工业",
    "首次气体采集",
    "铜",
    "否",
    "",
    "",
  ],
  [
    "B18",
    "采矿工业",
    "累计气体 1,000,000",
    "银",
    "否",
    "",
    "",
  ],
  [
    "C01",
    "舰船工程",
    "制造首个舰船部件",
    "铜",
    "否",
    "",
    "",
  ],
  [
    "C02",
    "舰船工程",
    "总装首艘舰船",
    "铜",
    "否",
    "",
    "",
  ],
  [
    "C03",
    "舰船工程",
    "总装首艘 天穹级",
    "银",
    "否",
    "",
    "",
  ],
  [
    "C04",
    "舰船工程",
    "总装首艘 重垒级",
    "银",
    "否",
    "",
    "",
  ],
  [
    "C05",
    "舰船工程",
    "总装首艘 裂界级",
    "银",
    "否",
    "",
    "",
  ],
  [
    "C06",
    "舰船工程",
    "总装首艘 山海级",
    "银",
    "否",
    "",
    "",
  ],
  [
    "C07",
    "舰船工程",
    "总装首艘 启明级",
    "银",
    "否",
    "",
    "",
  ],
  [
    "C08",
    "舰船工程",
    "总装首艘 星冕级",
    "金",
    "否",
    "",
    "",
  ],
  [
    "C09",
    "舰船工程",
    "总装首艘 恒城级",
    "金",
    "否",
    "",
    "",
  ],
  [
    "C10",
    "舰船工程",
    "总装首艘 裁决级",
    "金",
    "否",
    "",
    "",
  ],
  [
    "C11",
    "舰船工程",
    "获得首张蓝图",
    "铜",
    "否",
    "",
    "",
  ],
  [
    "C13",
    "舰船工程",
    "累计建造 25 艘超级旗舰",
    "传奇",
    "否",
    "",
    "",
  ],
  [
    "D11",
    "装备/增强剂",
    "制造首个任意增强剂",
    "铜",
    "否",
    "",
    "",
  ],
  [
    "D12",
    "装备/增强剂",
    "累计制造 1,000 个增强剂",
    "银",
    "否",
    "",
    "",
  ],
  [
    "D13",
    "装备/增强剂",
    "首次装备制造",
    "铜",
    "否",
    "",
    "",
  ],
  [
    "D14",
    "装备/增强剂",
    "首次燃料制造",
    "铜",
    "否",
    "",
    "",
  ],
  [
    "D15",
    "装备/增强剂",
    "首次弹药制造",
    "铜",
    "否",
    "",
    "",
  ],
  [
    "D16",
    "装备/增强剂",
    "首次装备强化",
    "铜",
    "否",
    "",
    "",
  ],
  [
    "D17",
    "装备/增强剂",
    "制造首件改装件",
    "铜",
    "否",
    "",
    "",
  ],
  [
    "E01",
    "战斗",
    "首次通关战斗星带：苍穹劫团前哨站",
    "银",
    "否",
    "",
    "",
  ],
  [
    "E02",
    "战斗",
    "首次通关战斗星带：赤誓教团隐蔽所",
    "银",
    "否",
    "",
    "",
  ],
  [
    "E03",
    "战斗",
    "首次通关战斗星带：静默集群哨站",
    "银",
    "否",
    "",
    "",
  ],
  [
    "E04",
    "战斗",
    "首次通关战斗星带：苍穹劫团劫掠走廊",
    "银",
    "否",
    "",
    "",
  ],
  [
    "E05",
    "战斗",
    "首次通关战斗星带：赤誓教团献祭场",
    "银",
    "否",
    "",
    "",
  ],
  [
    "E06",
    "战斗",
    "首次通关战斗星带：静默集群控制节点",
    "银",
    "否",
    "",
    "",
  ],
  [
    "E07",
    "战斗",
    "首次通关战斗星带：苍穹劫团猎杀空域",
    "银",
    "否",
    "",
    "",
  ],
  [
    "E08",
    "战斗",
    "首次通关战斗星带：赤誓教团深红圣堂",
    "银",
    "否",
    "",
    "",
  ],
  [
    "E09",
    "战斗",
    "首次通关战斗星带：静默集群同化枢纽",
    "银",
    "否",
    "",
    "",
  ],
  [
    "E10",
    "战斗",
    "首次通关战斗星带：苍穹劫团破阵战场",
    "银",
    "否",
    "",
    "",
  ],
  [
    "E11",
    "战斗",
    "首次通关战斗星带：赤誓教团铁血圣殿",
    "银",
    "否",
    "",
    "",
  ],
  [
    "E12",
    "战斗",
    "首次通关战斗星带：静默集群统御矩阵",
    "银",
    "否",
    "",
    "",
  ],
  [
    "E13",
    "战斗",
    "首次通关战斗星带：苍穹劫团外环侵袭区",
    "银",
    "否",
    "",
    "",
  ],
  [
    "E14",
    "战斗",
    "首次通关战斗星带：赤誓教团外环圣库",
    "银",
    "否",
    "",
    "",
  ],
  [
    "E15",
    "战斗",
    "首次通关战斗星带：静默集群外环同化阵列",
    "银",
    "否",
    "",
    "",
  ],
  [
    "E16",
    "战斗",
    "首次通关战斗星带：苍穹劫团深域王庭",
    "银",
    "否",
    "",
    "",
  ],
  [
    "E17",
    "战斗",
    "首次通关战斗星带：赤誓教团深域圣殿",
    "银",
    "否",
    "",
    "",
  ],
  [
    "E18",
    "战斗",
    "首次通关战斗星带：静默集群深域主脑",
    "银",
    "否",
    "",
    "",
  ],
  [
    "E19",
    "战斗",
    "通关全部 18 个战斗星带",
    "传奇",
    "否",
    "",
    "",
  ],
  [
    "E24",
    "战斗",
    "击杀首艘旗舰级敌人",
    "金",
    "否",
    "",
    "",
  ],
  [
    "E25",
    "战斗",
    "击杀首艘超级旗舰级敌人",
    "传奇",
    "否",
    "",
    "",
  ],
  [
    "E26",
    "战斗",
    "首次进入死亡空间",
    "银",
    "否",
    "",
    "",
  ],
  [
    "E27",
    "战斗",
    "完整通关一次死亡空间",
    "金",
    "否",
    "",
    "",
  ],
  [
    "F01",
    "考古",
    "首次扫描遗迹",
    "铜",
    "否",
    "",
    "",
  ],
  [
    "F17",
    "考古",
    "完成全部 5 档考古",
    "金",
    "否",
    "",
    "",
  ],
  [
    "F18",
    "考古",
    "首次出售文物",
    "铜",
    "否",
    "",
    "",
  ],
  [
    "F21",
    "考古",
    "触发首次稀有掉落",
    "金",
    "否",
    "",
    "",
  ],
  [
    "G01",
    "行星",
    "首次殖民 熔岩行星",
    "铜",
    "否",
    "好球",
    "",
  ],
  [
    "G02",
    "行星",
    "首次殖民 气态行星",
    "铜",
    "否",
    "这球好白，哦不，好大",
    "",
  ],
  [
    "G03",
    "行星",
    "首次殖民 冰行星",
    "铜",
    "否",
    "也是好球",
    "",
  ],
  [
    "G04",
    "行星",
    "首次殖民 等离子行星",
    "铜",
    "否",
    "真正的好球",
    "",
  ],
  [
    "G05",
    "行星",
    "首次殖民 温带行星",
    "铜",
    "否",
    "我是来种菜的，你是要干什么",
    "",
  ],
  [
    "G06",
    "行星",
    "首次殖民 风暴行星",
    "铜",
    "否",
    "人称小气球",
    "",
  ],
  [
    "G07",
    "行星",
    "同时运营 5 颗行星",
    "银",
    "否",
    "你的粪勺请拿好",
    "",
  ],
  [
    "G08",
    "行星",
    "累计行星产出 1,000,000",
    "银",
    "否",
    "只要粪勺舞得好，哪有行星挖不倒",
    "",
  ],
  [
    "G09",
    "行星",
    "解锁全部行星槽位",
    "金",
    "否",
    "黄金粪勺",
    "",
  ],
  [
    "H01",
    "空间站",
    "建成空间站本体 Lv.1",
    "铜",
    "否",
    "",
    "",
  ],
  [
    "H02",
    "空间站",
    "本体升至 Lv.3",
    "银",
    "否",
    "",
    "",
  ],
  [
    "H03",
    "空间站",
    "资源调度中心 升至 Lv.3",
    "金",
    "否",
    "",
    "",
  ],
  [
    "H04",
    "空间站",
    "行星管控中心 升至 Lv.3",
    "金",
    "否",
    "",
    "",
  ],
  [
    "H05",
    "空间站",
    "冶炼精炼厂 升至 Lv.3",
    "金",
    "否",
    "",
    "",
  ],
  [
    "H06",
    "空间站",
    "装备制造厂 升至 Lv.3",
    "金",
    "否",
    "",
    "",
  ],
  [
    "H07",
    "空间站",
    "增强剂制造厂 升至 Lv.3",
    "金",
    "否",
    "",
    "",
  ],
  [
    "H08",
    "空间站",
    "考古实验室 升至 Lv.3",
    "金",
    "否",
    "",
    "",
  ],
  [
    "H09",
    "空间站",
    "作战指挥中心 升至 Lv.3",
    "金",
    "否",
    "",
    "",
  ],
  [
    "H10",
    "空间站",
    "舰船船坞 升至 Lv.3",
    "金",
    "否",
    "",
    "",
  ],
  [
    "I01",
    "经济",
    "历史峰值持有 1,000,000 星币",
    "铜",
    "否",
    "",
    "",
  ],
  [
    "I02",
    "经济",
    "历史峰值持有 100,000,000 星币",
    "银",
    "否",
    "",
    "",
  ],
  [
    "I03",
    "经济",
    "历史峰值持有 1,000,000,000 星币",
    "金",
    "否",
    "",
    "",
  ],
  [
    "J01",
    "综合",
    "累计在线 24 小时",
    "铜",
    "否",
    "",
    "",
  ],
  [
    "J02",
    "综合",
    "累计在线 7 天",
    "银",
    "否",
    "",
    "",
  ],
  [
    "J05",
    "综合",
    "动作队列排满 25 项",
    "银",
    "否",
    "",
    "",
  ],
  [
    "J06",
    "综合",
    "首次重创后维修并恢复出击",
    "金",
    "否",
    "",
    "",
  ],
  [
    "J07",
    "综合",
    "达成 50 项成就",
    "金",
    "否",
    "",
    "",
  ],
  [
    "J08",
    "综合",
    "达成 100 项成就",
    "传奇",
    "否",
    "",
    "",
  ],
  [
    "J09",
    "综合",
    "完成全部成就",
    "传奇",
    "是",
    "",
    "隐藏",
  ],
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
    # 2026-09-05：优先取 named CSV 里用户已填的成就名（116 个 Steam 候选全覆盖）；
    # 不在 CSV 的仅游戏内成就走 PROVISIONAL_NAMES（用户梗名），其余（已裁掉）才输出占位。
    sm = STEAM_META.get(idv)
    if sm:
        dn = (sm.get("displayName") or "").strip()
        if dn:
            return dn
    return PLACEHOLDER_PREFIX + idv


def name_status(idv):
    if idv in PROVISIONAL_NAMES:
        return "provisional"
    sm = STEAM_META.get(idv)
    if sm and (sm.get("displayName") or "").strip():
        return "confirmed"
    return "placeholder"


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
            ", steam: " + steam_js_literal(idv) +
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
