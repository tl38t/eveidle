// 复现 taptap-portrait.js:175 崩溃
// 当 state.inventory.ships 中存在 config 查不到的 shipId 时，getHangarDisplayState 会
// 返回一个 stub { instanceId, shipId, unknown:true }，缺 assignedActions/industrial/
// archaeology/boundNpc/name/enhancement 等字段。
// 移动端 mobileRenderHangarPanel → tpSelectorHTML:175 直接 s.assignedActions.length → TypeError。
// 桌面端 shell-render.js:3378-3379 同样会炸（ship.assignedActions.length + .map）。
// 本探针只校验"是否触发 assignedActions undefined"，不引入 DOM。

const STARTER_SHIPS = { rifter: { name: "星矛级", tier: "T1", type: "shld_lsr" } };
const INDUSTRIAL_SHIPS = {};
const ARCHAEOLOGY_SHIPS = {};

function getShipConfigById(shipId) {
  return STARTER_SHIPS[shipId] || INDUSTRIAL_SHIPS[shipId]
    || (typeof ARCHAEOLOGY_SHIPS !== "undefined" ? ARCHAEOLOGY_SHIPS[shipId] : undefined);
}

// 简化的 select 路径：filter + map，对应 taptap-portrait.js:170-184
function tpSelectorHTML(display) {
  const list = display.ships.slice();
  const chips = list.map(function (s) {
    // 以下行就是 taptap-portrait.js:175
    if (s.assignedActions.length) {
      // ...
    }
    return "ok";
  }).join("");
  return chips;
}

// 简化的 getHangarDisplayState 镜像
function getHangarDisplayState(state) {
  const ships = (state.inventory && Array.isArray(state.inventory.ships)) ? state.inventory.ships : [];
  return {
    ships: ships.map(instance => {
      const config = getShipConfigById(instance.shipId);
      if (!config) return { instanceId: instance.instanceId, shipId: instance.shipId, unknown: true };
      return { instanceId: instance.instanceId, shipId: instance.shipId, assignedActions: [], industrial: false, archaeology: false, boundNpc: null, name: config.name };
    })
  };
}

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { console.log("  PASS " + label); pass++; }
  else      { console.log("  FAIL " + label); fail++; }
}

// Case 1：纯合法舰船 → 不应抛错
{
  const display = getHangarDisplayState({
    inventory: { ships: [{ instanceId: "i1", shipId: "rifter" }] }
  });
  let threw = null;
  try { tpSelectorHTML(display); } catch (e) { threw = e; }
  assert(!threw, "正常舰船不应抛错（got " + (threw ? threw.message : "no throw") + ")");
}

// Case 2：含一个 unknown shipId → 复现线上崩溃
{
  const display = getHangarDisplayState({
    inventory: { ships: [
      { instanceId: "i1", shipId: "rifter" },
      { instanceId: "i2", shipId: "removed_legacy_ship" }   // 模拟：旧存档里的 shipId 已被改名/移除
    ] }
  });
  let threw = null;
  try { tpSelectorHTML(display); } catch (e) { threw = e; }
  assert(threw && /reading 'length'/.test(threw.message || ""), "未知 shipId 应触发 assignedActions undefined（线上崩溃）");
}

// Case 3：null/undefined shipId 兜底（防止更多崩溃面）
{
  const display = getHangarDisplayState({
    inventory: { ships: [{ instanceId: "i1", shipId: undefined }] }
  });
  let threw = null;
  try { tpSelectorHTML(display); } catch (e) { threw = e; }
  assert(threw && /reading 'length'/.test(threw.message || ""), "shipId=undefined 也应触发同一崩溃");
}

// Case 4（修复预期·方案A 过滤）：getHangarDisplayState 先 filter 掉查不到配置的实例
{
  const shipsRaw = [
    { instanceId: "i1", shipId: "rifter" },
    { instanceId: "i2", shipId: "removed_legacy_ship" }
  ];
  const ships = shipsRaw.filter(i => Boolean(getShipConfigById(i.shipId)));
  const display = {
    count: ships.length,
    ships: ships.map(instance => {
      const config = getShipConfigById(instance.shipId);
      if (!config) return null;   // 兜底（理论上不会进入）
      return {
        instanceId: instance.instanceId,
        shipId: instance.shipId,
        assignedActions: [],
        name: config.name
      };
    }).filter(Boolean)
  };
  let threw = null;
  try { tpSelectorHTML(display); } catch (e) { threw = e; }
  assert(!threw, "方案A 修复后：含未知舰船也不抛错");
  assert(display.count === 1, "方案A：count 应收窄为 1（过滤掉 unknown）");
}

console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);