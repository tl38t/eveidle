/* ================================================================
   限次蓝图抄本（BPC）— 流程次数（runs）通用原语
   ================================================================
   背景（EVE 对照）：EVE 蓝图分 BPO（原版，无限 runs，可复制/科研）与
   BPC（抄本，有限 runs，最后一次生产后销毁、不归还）。LP/忠诚点商店卖的就是 BPC。
   本游戏首个「会消耗的抄本」= 势力探针蓝图，为免以后各类限次抄本各写一套，
   抽出此原语；手动线（行动槽）与空间站自动线共用同一套语义。

   状态容器：state.blueprintCharges = { [blueprintId]: 剩余 runs }
   - 与 state.ownedBlueprints（永久 BPO，string[]）完全分离，互不污染；
     现有 50+ 装备/增强剂永久蓝图继续走 ownedBlueprints，零回归风险。
   - 旧档无此字段 → 恒为 {}，无需迁移（additive）。

   id 约定（沿用现有前缀体系）：
   - "probe:<recipeId>"    势力探针抄本（首个使用者）
   - 未来 "equipment:<id>" / "booster:<id>" / "ship:<id>" 直接复用本模块。

   生命周期（预留制，防并发双重占用）：
   1. 功勋商店买 N 流程 → grantBlueprintRuns(state, id, N)
   2. 制造周期启动     → reserveBlueprintRun(state, id)  // 预留：立即离开可用池
   3. 周期完成产出     → 预留自然消耗，无需额外调用
   4. 周期未完成（取消 / 中断 / 材料不足 / 离线停止）
                       → refundBlueprintRun(state, id)  // 未产出则不扣

   为什么是「启动时预留」而非「完成时扣」：
   手动线与自动线可并行跑同一张 BPC。若完成时才扣，两边启动门控都看到
   runs=1 而同时通过，到完成时只有一边扣得到 → 并发双重占用。
   预留制让 runs 在启动瞬间离池，第二路径要么被门控拦下、要么完成失败。
   ================================================================ */

// 读取剩余流程次数（无记录恒为 0）
function getBlueprintRuns(state, blueprintId) {
  if (!state || !blueprintId) return 0;
  const charges = state.blueprintCharges;
  if (!charges) return 0;
  const runs = Number(charges[blueprintId]);
  return Number.isFinite(runs) && runs > 0 ? runs : 0;
}

// 是否还有可用流程（启动门控用）
function hasBlueprintAvailable(state, blueprintId) {
  return getBlueprintRuns(state, blueprintId) > 0;
}

// 授予流程次数（功勋商店购买 / 掉落 / 补偿）。runs 归零后允许再次授予（重买）。
function grantBlueprintRuns(state, blueprintId, amount) {
  const n = Math.floor(Number(amount));
  if (!state || !blueprintId || !Number.isFinite(n) || n <= 0) return 0;
  if (!state.blueprintCharges) state.blueprintCharges = {};
  const next = getBlueprintRuns(state, blueprintId) + n;
  state.blueprintCharges[blueprintId] = next;
  if (typeof state._dirty !== "undefined") state._dirty = true;
  return next;
}

// 预留 1 流程（制造周期启动时调用）。成功返回 true 并扣减；无可用流程返回 false。
// 归零即删除该键 —— 对应 BPC「用完消失」，并让功勋商店允许重新购买。
function reserveBlueprintRun(state, blueprintId) {
  const current = getBlueprintRuns(state, blueprintId);
  if (current <= 0) return false;
  if (!state.blueprintCharges) state.blueprintCharges = {};
  const next = current - 1;
  if (next > 0) state.blueprintCharges[blueprintId] = next;
  else delete state.blueprintCharges[blueprintId];
  if (typeof state._dirty !== "undefined") state._dirty = true;
  return true;
}

// 退还 1 流程（周期未完成：取消 / 中断 / 材料不足 → 未产出则不扣）
function refundBlueprintRun(state, blueprintId) {
  if (!state || !blueprintId) return 0;
  if (!state.blueprintCharges) state.blueprintCharges = {};
  const next = getBlueprintRuns(state, blueprintId) + 1;
  state.blueprintCharges[blueprintId] = next;
  if (typeof state._dirty !== "undefined") state._dirty = true;
  return next;
}

// 批量预留（离线结算用）：一次预留 n 个周期的流程，返回实际预留到的数量（受存量限制）。
function reserveBlueprintRuns(state, blueprintId, cycles) {
  const want = Math.floor(Number(cycles));
  if (!state || !blueprintId || !Number.isFinite(want) || want <= 0) return 0;
  const available = getBlueprintRuns(state, blueprintId);
  const granted = Math.min(want, available);
  for (let i = 0; i < granted; i++) reserveBlueprintRun(state, blueprintId);
  return granted;
}

window.getBlueprintRuns = getBlueprintRuns;
window.hasBlueprintAvailable = hasBlueprintAvailable;
window.grantBlueprintRuns = grantBlueprintRuns;
window.reserveBlueprintRun = reserveBlueprintRun;
window.refundBlueprintRun = refundBlueprintRun;
window.reserveBlueprintRuns = reserveBlueprintRuns;
