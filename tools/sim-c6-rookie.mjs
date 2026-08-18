// 蒙特卡洛仿真：满装启程级（rookie_corvette）单次出击通过 C6（angel_outpost，连续清 4 波不被摧毁）的概率。
// 数值路径完全提炼自真实战斗代码（combat.js / selectors.js / capital-combat.js），仅保留满装启程级会触发的分支：
//  - 非旗舰船：selectCapitalCombatTarget 返回 living[0]；无护盾减免/反应装甲/武器特性/AOE。
//  - 玩家每 tick 只攻击当前单目标（living[0]）一次；所有存活敌人每 tick 各自反击一次；先手击毁者本 tick 不反击。
//  - 维修在反击之后结算（shield 30/tick、armor 20/tick × repairMult）。
//  - 激光 counterType="shield"：敌人 shield>0 时玩家伤害 ×1.25。
//  - 命中系数 = hit^1.4/(hit^1.4+dodge^1.4)，伤害 ×(0.9~1.1) 随机方差。
// 波次：highsec 编队池随机（2n 45% / 3n 45% / 2n+1e 8% / 3n+1e 2%），4 波不出 boss。

const RNG = Math.random;

function variance() { return 0.90 + (RNG() + RNG()) * 0.10; }
function calcDamage(attackerHit, targetDodge, baseDps, counterMult) {
  const hp = Math.pow(attackerHit, 1.4);
  const dp = Math.pow(targetDodge, 1.4);
  const coef = hp / (hp + dp);
  return Math.max(1, Math.round(baseDps * coef * counterMult * variance()));
}
function applyLayered(hp, amount) {
  let rem = Math.max(0, amount);
  for (const layer of ["shield", "armor", "structure"]) {
    if (rem <= 0 || hp[layer] <= 0) continue;
    const d = Math.min(rem, hp[layer]);
    hp[layer] -= d; rem -= d;
  }
}

// 敌人模板（angel_outpost：normal=scout, elite=raider；数值来自 ENEMY_DATABASE combat.js:6/7）
const ENEMY = {
  scout:  { name:"scout",  kind:"normal", hp:{shield:220,armor:88,structure:55},  hit:100, dodge:30, baseDamage:40 },
  raider: { name:"raider", kind:"elite",  hp:{shield:550,armor:220,structure:110}, hit:130, dodge:40, baseDamage:59 }
};
const HIGHSEC_FORMATIONS = [
  { normal:2, elite:0, chance:0.45 },
  { normal:3, elite:0, chance:0.45 },
  { normal:2, elite:1, chance:0.08 },
  { normal:3, elite:1, chance:0.02 }
];
function rollFormation() {
  const v = RNG();
  let cum = 0;
  for (const f of HIGHSEC_FORMATIONS) { cum += f.chance; if (v < cum) return f; }
  return HIGHSEC_FORMATIONS[HIGHSEC_FORMATIONS.length - 1];
}
function makeWave() {
  const f = rollFormation();
  const enemies = [];
  for (let i = 0; i < (f.normal || 0); i++) enemies.push(clone(ENEMY.scout));
  for (let i = 0; i < (f.elite || 0); i++) enemies.push(clone(ENEMY.raider));
  return enemies;
}
function clone(t) {
  return { name:t.name, kind:t.kind, hp:{...t.hp}, maxHp:{...t.hp}, hit:t.hit, dodge:t.dodge, baseDamage:t.baseDamage, defeated:false };
}

function simulateSortieDetailed(L) {
  // 与 simulateSortie 相同，但额外返回本场 4 波是否出现过精英(raider)编队
  const ship = { hpBase:{shield:240,armor:80,structure:80}, bonuses:{ shieldCapacity:0.05, laserDamage:0.02 } };
  const maxHp = {
    shield: Math.round(240 * (1 + ship.bonuses.shieldCapacity) * (1 + L * 0.03)),
    armor:  Math.round(80  * 1 * (1 + L * 0.03)),
    structure: Math.round(80 * 1 * (1 + L * 0.03))
  };
  const hp = { ...maxHp };
  const playerHit = 100 + L * 4 + L * 3;
  const dmgMult = (1 + L * 0.02) * (1 + ship.bonuses.laserDamage);
  const playerDodge = 22 + L * 1;
  const repMult = 1 + L * 0.02;
  const weaponBase = 120, shieldRepair = 30, armorRepair = 20;
  let ammo = 500, fuel = 100000;
  const volleyFuel = 3;
  let hadElite = false;
  for (let wave = 1; wave <= 4; wave++) {
    const f = rollFormation();
    if (f.elite > 0) hadElite = true;
    const enemies = [];
    for (let i = 0; i < (f.normal||0); i++) enemies.push(clone(ENEMY.scout));
    for (let i = 0; i < (f.elite||0); i++) enemies.push(clone(ENEMY.raider));
    let ticks = 0;
    while (true) {
      ticks++;
      if (ticks > 400) return { win:false, hadElite };
      const living = enemies.filter(e => !e.defeated && e.hp.structure > 0);
      if (living.length === 0) break;
      const target = living[0];
      if (fuel >= volleyFuel && ammo >= 1) {
        fuel -= volleyFuel; ammo -= 1;
        const counterMult = (target.hp.shield > 0) ? 1.25 : 1.0;
        const dmg = calcDamage(playerHit, target.dodge, weaponBase * dmgMult, counterMult);
        applyLayered(target.hp, dmg);
        if (target.hp.structure <= 0) target.defeated = true;
      }
      const attackers = enemies.filter(e => !e.defeated && e.hp.structure > 0);
      for (const e of attackers) {
        const edmg = calcDamage(e.hit, playerDodge, e.baseDamage, 1.0);
        applyLayered(hp, edmg);
        if (hp.structure <= 0) return { win:false, hadElite };
      }
      if (hp.shield < maxHp.shield) hp.shield = Math.min(maxHp.shield, hp.shield + Math.round(shieldRepair * repMult));
      if (hp.armor < maxHp.armor)   hp.armor   = Math.min(maxHp.armor,   hp.armor   + Math.round(armorRepair * repMult));
    }
  }
  return { win:true, hadElite };
}

function runDetailed(L, N) {
  let win=0, eliteWin=0, eliteN=0, noEliteWin=0, noEliteN=0;
  for (let i=0;i<N;i++){ const r=simulateSortieDetailed(L); if(r.win)win++; if(r.hadElite){eliteN++; if(r.win)eliteWin++;} else {noEliteN++; if(r.win)noEliteWin++;} }
  return { overall:win/N, elite: eliteN? eliteWin/eliteN : null, noElite: noEliteN? noEliteWin/noEliteN : null,
           eliteRate: eliteN/N };
}


function simulateSortie(L, nWeapons = 1) {
  // 技能等级 L（laserOps/targeting/defense/piloting/shieldOperation/armorReinforcement/hullEngineering/capacitorManagement 均=L）
  // nWeapons：已装高槽武器数（combat.js:1052 每轮对所有武器各开火一次 → 2 武器≈2x/tick 伤害）
  const ship = {
    hpBase: { shield:240, armor:80, structure:80 },
    bonuses: { shieldCapacity:0.05, laserDamage:0.02 } // 启程级
  };
  const maxHp = {
    shield: Math.round(240 * (1 + ship.bonuses.shieldCapacity) * (1 + L * 0.03)),
    armor:  Math.round(80  * 1 * (1 + L * 0.03)),
    structure: Math.round(80 * 1 * (1 + L * 0.03))
  };
  const hp = { ...maxHp };

  const playerHit = 100 + L * 4 + L * 3;           // baseHit 100 + laserOps*4 + targeting*3
  const dmgMult = (1 + L * 0.02) * (1 + ship.bonuses.laserDamage); // skill * ship bonus
  const playerDodge = 22 + L * 1;                   // ship.dodge 22 + piloting*1
  const repMult = 1 + L * 0.02;                     // defense*0.02
  const weaponBase = 120;                           // t1_small_laser baseDamage
  const shieldRepair = 30, armorRepair = 20;

  let ammo = 500, fuel = 100000;
  const volleyFuel = 3; // Math.max(1, round(3 * capMult(=1/(1+L*0.02)) * zoneMult(1))) ≈ 3

  for (let wave = 1; wave <= 4; wave++) {
    let enemies = makeWave();
    let ticks = 0;
    while (true) {
      ticks++;
      if (ticks > 400) return false; // 超时（异常卡死，判失败）
      // 选目标（living[0]）
      const living = enemies.filter(e => !e.defeated && e.hp.structure > 0);
      if (living.length === 0) break; // 本波清完
      const target = living[0];
      // 玩家开火（每轮所有武器各开火一次）
      if (fuel >= volleyFuel && ammo >= 1) {
        fuel -= volleyFuel; ammo -= 1;
        const counterMult = (target.hp.shield > 0) ? 1.25 : 1.0;
        for (let w = 0; w < nWeapons; w++) {
          const dmg = calcDamage(playerHit, target.dodge, weaponBase * dmgMult, counterMult);
          applyLayered(target.hp, dmg);
          if (target.hp.structure <= 0) { target.defeated = true; break; }
        }
      }
      // 敌人反击（仅仍存活者）
      const attackers = enemies.filter(e => !e.defeated && e.hp.structure > 0);
      for (const e of attackers) {
        const edmg = calcDamage(e.hit, playerDodge, e.baseDamage, 1.0);
        applyLayered(hp, edmg);
        if (hp.structure <= 0) return false; // 被摧毁
      }
      // 维修
      if (hp.shield < maxHp.shield) hp.shield = Math.min(maxHp.shield, hp.shield + Math.round(shieldRepair * repMult));
      if (hp.armor < maxHp.armor)   hp.armor   = Math.min(maxHp.armor,   hp.armor   + Math.round(armorRepair * repMult));
    }
  }
  return true; // 连续清 4 波且未被摧毁
}

function run(L, N, nWeapons = 1) {
  let win = 0;
  for (let i = 0; i < N; i++) if (simulateSortie(L, nWeapons)) win++;
  return win / N;
}

const N = 4000;
console.log("满装启程级 单次出击通过 C6(angel_outpost) 概率 — 蒙特卡洛 N=" + N);
console.log("(通过 = 连续清 4 波且中途船体 structure 始终 > 0；技能等级 L 统一取相同值)\n");
for (const L of [1, 3, 5, 8, 10, 15]) {
  const p1 = run(L, N, 1), p2 = run(L, N, 2);
  console.log(`技能 Lv${String(L).padStart(2)} :  1武器=${(p1*100).toFixed(1)}%   |   2武器(双炮)=>${(p2*100).toFixed(1)}%   (2武器提升+${( (p2-p1)*100).toFixed(1)}pt)`);
}
console.log("\n翻车点细分（按 4 波中是否刷出精英(raider)编队分组，N=" + N + "）：");
for (const L of [1, 5]) {
  const d = runDetailed(L, N);
  const pe = d.elite != null ? (d.elite * 100).toFixed(1) + "%" : "n/a";
  const pn = d.noElite != null ? (d.noElite * 100).toFixed(1) + "%" : "n/a";
  console.log(`技能 Lv${String(L).padStart(2)} : 全程无精英=${pn}  | 含≥1精英波=${pe}  (本场遇精英概率≈${(d.eliteRate*100).toFixed(1)}%)`);
}
