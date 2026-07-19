// Profile Consistency Test — Phase 3 Commit 2
//
// 验证数据闭环：buildProfile() → ctx.profile → HullGenerator → Hull Mesh
//   即 HullGenerator 实际读取的形状参数 === ctx.profile.hull。
//
// 价值（用户要求）：以后 Engine/Weapon/Ribbon 都会读 ctx.profile.<segment>；
//   若某天 ShipProfile 解析错（anchor 选错 / 字段错配 / 误回退到 HULL_PRESETS），
//   本测试会立刻在「Profile: / Generator:」两栏不一致时报 FAIL。
import { createShipContext } from "../js/render3d/shipfactory2/ShipContext.js";
import { generateHull } from "../js/render3d/shipfactory2/HullGenerator.js";

const specs = [
  { id: "rifter",    line: "player_shield", family: "shield", hull: "frigate",    weapon: "laser", highSlots: 2 },
  { id: "raylight",  line: "player_shield", family: "shield", hull: "destroyer",  weapon: "laser", highSlots: 3 },
  { id: "gale",      line: "player_shield", family: "shield", hull: "destroyer",  weapon: "laser", hybrid: true, highSlots: 3 },
  { id: "dawnlight", line: "player_shield", family: "shield", hull: "cruiser",    weapon: "laser", highSlots: 4 },
  { id: "sunlance",  line: "player_shield", family: "shield", hull: "battleship", weapon: "laser", highSlots: 5 }
];

// 参与比对的字段（HullGenerator 实际消费的形状 DNA）
const FIELDS = ["len", "noseFat", "mid", "tail", "wingSpan"];
const fmt = (p) => FIELDS.map((k) => `${k}=${p[k]}`).join("  ");

let failures = 0;
console.log("=== Profile Consistency (Hull) ===");
for (const spec of specs) {
  const ctx = createShipContext(spec);
  const hullGroup = generateHull(ctx);
  const read = hullGroup.userData.hullRead;

  if (!read) {
    console.log(`${spec.id.padEnd(10)} FAIL  (HullGenerator 未记录 hullRead)`);
    failures++;
    continue;
  }

  const src = ctx.profile.hull;
  const mismatches = FIELDS.filter((k) => read[k] !== src[k]);
  const ok = mismatches.length === 0;
  if (!ok) failures++;

  console.log(spec.id);
  console.log("  Profile:  " + fmt(src));
  console.log("  Generator:" + fmt(read));
  console.log("  " + (ok ? "PASS" : "FAIL  mismatched: " + mismatches.join(", ")));
}

// 确定性校验：同一 spec 两次构建 → profile.hull 必须完全一致（锚点不消费 rng 时尤其严格）
{
  const a = createShipContext(specs[0]).profile.hull;
  const b = createShipContext(specs[0]).profile.hull;
  const deterministic = JSON.stringify(a) === JSON.stringify(b);
  console.log("\nDeterminism (same spec → same profile.hull): " + (deterministic ? "PASS" : "FAIL"));
  if (!deterministic) failures++;
}

console.log("\n" + (failures === 0 ? "ALL_PASS" : `FAIL_COUNT=${failures}`));
process.exit(failures === 0 ? 0 : 1);
