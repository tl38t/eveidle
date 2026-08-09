/* ================================================================
   统一回收舱（考古重做 · 定点返修 · 唯一公共回收入口）

   设计约束（见用户需求 #1 / #6）：
   - getRecycleQuote(state, items)：纯读，返回 {base, bonus, final, byCurrency}。
     bonus 即凭证加成；final = base + bonus（严格 ×1.10）。
   - recycleItems(state, items, meta)：唯一写入口，改 currency:*，emit item:recycled。
   - 两件唯一凭证（voucher_pan_galactic=isk / voucher_galactic_kin=lp）最终收益严格 ×1.10；
     仅凭持有 special:voucher_<id> 资源生效，不影响直接货币奖励（掉落/补偿等）。
   - 凭证使用 special: 命名空间（与货柜/神经植入体一致），不保留 state.vouchers 第二套布尔账本。
   - 考古单件/批量/自动出售兑换、cargoLoot 星币/功勋回收全部委托本模块。

   items 元素：{ currency:"isk"|"lp", amount:Number }。amount 为回收标的的原始基础价值。
   ================================================================ */

const RECYCLE_VOUCHERS = Object.freeze({
  isk: "voucher_pan_galactic",
  lp:  "voucher_galactic_kin"
});

// 凭证倍率：持有对应 special:voucher_<id> 资源即 ×1.10，否则 ×1.0。
function getRecycleVoucherMultiplier(state, currency) {
  const vid = currency === "lp" ? RECYCLE_VOUCHERS.lp : RECYCLE_VOUCHERS.isk;
  if (typeof ResourceRegistry === "undefined") return 1;
  return ResourceRegistry.get(state, "special:" + vid) > 0 ? 1.10 : 1.0;
}

// 纯读：计算每个币种的 base / 凭证 bonus / final。
function getRecycleQuote(state, items) {
  const byCurrency = {};
  let base = 0, bonus = 0, final = 0;
  const list = Array.isArray(items) ? items : [];
  for (const it of list) {
    const cur = (it && it.currency) || "isk";
    const amt = Math.max(0, Math.round(Number(it && it.amount) || 0));
    if (amt <= 0) continue;
    const mult = getRecycleVoucherMultiplier(state, cur);
    const f = Math.round(amt * mult);
    const b = f - amt;
    base += amt; bonus += b; final += f;
    if (!byCurrency[cur]) byCurrency[cur] = { base:0, bonus:0, final:0, multiplier: mult };
    byCurrency[cur].base += amt;
    byCurrency[cur].bonus += b;
    byCurrency[cur].final += f;
  }
  return { base, bonus, final, byCurrency };
}

// 唯一写入口：将 items 折算为对应货币入账，并 emit item:recycled（仅当确有收益）。
function recycleItems(state, items, meta) {
  const list = Array.isArray(items) ? items : [];
  const quote = getRecycleQuote(state, list);
  for (const it of list) {
    const cur = (it && it.currency) || "isk";
    const amt = Math.max(0, Math.round(Number(it && it.amount) || 0));
    if (amt <= 0 || (cur !== "isk" && cur !== "lp")) continue;
    const mult = getRecycleVoucherMultiplier(state, cur);
    ResourceRegistry.add(state, "currency:" + cur, Math.round(amt * mult));
  }
  if (typeof GameEvents !== "undefined" && quote.final > 0) {
    GameEvents.emit("item:recycled", {
      isk:        quote.byCurrency.isk ? quote.byCurrency.isk.final : 0,
      lp:         quote.byCurrency.lp ? quote.byCurrency.lp.final : 0,
      iskBase:    quote.byCurrency.isk ? quote.byCurrency.isk.base : 0,
      lpBase:     quote.byCurrency.lp ? quote.byCurrency.lp.base : 0,
      iskBonus:   quote.byCurrency.isk ? quote.byCurrency.isk.bonus : 0,
      lpBonus:    quote.byCurrency.lp ? quote.byCurrency.lp.bonus : 0,
      totalBase:  quote.base,
      totalBonus: quote.bonus,
      totalFinal: quote.final
    }, meta || {});
  }
  return quote;
}

// ---- cargoLoot 回收（需求 #1：cargoLoot 的星币/功勋回收也必须委托统一入口） ----
// opts: { all?:boolean, kind?:("isk"|"lp"), ids?:[string] }
// 返回 { changed, isk, lp, count, base, bonus, final }。
function recycleCargoLoot(state, opts) {
  if (!state.cargoLoot || !Array.isArray(state.cargoLoot)) return { changed:false, reason:"no-loot" };
  const o = opts && typeof opts === "object" ? opts : {};
  const targets = state.cargoLoot.filter(item => {
    if (!item || !item.kind || (item.kind !== "isk" && item.kind !== "lp")) return false;
    if (o.kind && item.kind !== o.kind) return false;
    if (Array.isArray(o.ids) && o.ids.length && o.ids.indexOf(item.id) < 0) return false;
    return true;
  });
  if (!targets.length) return { changed:false, reason:"nothing-to-recycle" };
  const items = targets.map(t => ({ currency: t.kind, amount: t.value }));
  const quote = recycleItems(state, items, { source:"cargo-bay" });
  const removedIds = new Set(targets.map(t => t.id));
  state.cargoLoot = state.cargoLoot.filter(t => !removedIds.has(t.id));
  state._dirty = true;
  return {
    changed:true,
    count: targets.length,
    isk:  quote.byCurrency.isk ? quote.byCurrency.isk.final : 0,
    lp:   quote.byCurrency.lp ? quote.byCurrency.lp.final : 0,
    base: quote.base,
    bonus: quote.bonus,
    final: quote.final
  };
}

if (typeof window !== "undefined") {
  window.RECYCLE_VOUCHERS = RECYCLE_VOUCHERS;
  window.getRecycleVoucherMultiplier = getRecycleVoucherMultiplier;
  window.getRecycleQuote = getRecycleQuote;
  window.recycleItems = recycleItems;
  window.recycleCargoLoot = recycleCargoLoot;
}
