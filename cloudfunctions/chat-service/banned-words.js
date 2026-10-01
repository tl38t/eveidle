"use strict";

/*
 * 自建敏感词库（CHAT_SYSTEM_SPEC.md v0.2 §6/§9：决策 ⑥ 自建，仅服务端持有）。
 *
 * 策略：命中即打星（mask），不拒发 —— 对玩家更友好，也能保留上下文供审核。
 * 词库分层：
 *   HARD_BLOCK：命中整条拒发（当前为空，预留：未来放不能以任何形式出现的内容）
 *   MASK_WORDS：命中替换为等长 '*'（广告引流、常见脏话等）
 *
 * 维护约定：
 *   * 只加小写形式，匹配时对原文统一 toLowerCase（中英混排均生效）
 *   * 词项用字面量正则安全字符串（不写正则元字符），匹配时会 escape
 */

const HARD_BLOCK = [];

const MASK_WORDS = [
  // 引流 / 广告
  "加微信", "加qq", "加q群", "代充", "代练", "低价充值", " BTC ", "usdt",
  // 常见脏话（中文）
  "傻逼", "煞笔", "傻b", "妈的", "他妈", "卧槽你", "我操", "滚蛋", "去死",
  // 常见脏话（英文）
  "fuck", "shit", "bitch", "asshole", "nigger", "cunt"
];

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildMatcher(words) {
  if (!words.length) return null;
  return new RegExp("(" + words.map(escapeRegExp).join("|") + ")", "gi");
}

const HARD_BLOCK_RE = buildMatcher(HARD_BLOCK);
const MASK_RE = buildMatcher(MASK_WORDS);

// 返回 { blocked, masked }
//   blocked=true  ：命中 HARD_BLOCK，调用方应拒绝该消息
//   masked        ：打星后的文本（blocked=false 时原样返回或已打星）
function apply(text) {
  const raw = String(text == null ? "" : text);
  if (!raw) return { blocked: false, masked: "" };
  if (HARD_BLOCK_RE && HARD_BLOCK_RE.test(raw)) {
    HARD_BLOCK_RE.lastIndex = 0;
    return { blocked: true, masked: "" };
  }
  HARD_BLOCK_RE && (HARD_BLOCK_RE.lastIndex = 0);
  let masked = raw;
  if (MASK_RE) {
    masked = raw.replace(MASK_RE, function (match) {
      return "*".repeat(Math.max(1, Array.from(match).length));
    });
  }
  return { blocked: false, masked: masked };
}

module.exports = { apply, HARD_BLOCK, MASK_WORDS };
