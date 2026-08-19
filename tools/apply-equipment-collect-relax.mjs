// 实装 v2：解析每个违规件的 cost / rig IV minerals → 降档替换+数量凑0/5 → 重写块
// 不依赖手写 from 串，规避空格/格式差异；输出统一为紧凑 JSON 风格（与原文件一致）。
import fs from "fs";
import path from "path";

const FILE = path.join(process.cwd(), "js", "data", "equipment.js");
let src = fs.readFileSync(FILE, "utf8");

const COLLECT_LEVEL = {
  "三钛合金":1,"类银超金属":10,"类晶体胶矿":20,"同位聚合体":40,"超新星诺克石":55,"基腹断岩":70,"超噬矿":85,
  "镓":20,"铂":20,"铪":40,"锇":40,"钷":55,"铷":70,
  "粗制富勒烯":1,"氦同位素":10,"稳定富勒烯":20,"氢同位素":40,"高纯富勒烯":55,"聚合气体":70,"超纯聚合气体":85,
  "重金属":1,"稀有气体":1,"同位素":20,"等离子体":40,"生物质":60,"磁场聚合物":80
};
const FAMILY_LADDER = {
  mineral:["三钛合金","类银超金属","类晶体胶矿","同位聚合体","超新星诺克石","基腹断岩","超噬矿"],
  moon:["镓","铂","铪","锇","钷","铷"],
  gas:["粗制富勒烯","氦同位素","稳定富勒烯","氢同位素","高纯富勒烯","聚合气体","超纯聚合气体"],
  planet:["重金属","稀有气体","同位素","等离子体","生物质","磁场聚合物"]
};
const MAT_FAMILY = {};
for (const fam of Object.keys(FAMILY_LADDER)) for (const m of FAMILY_LADDER[fam]) MAT_FAMILY[m] = fam;
function lowerTierMaterial(mat){
  const ladder = FAMILY_LADDER[MAT_FAMILY[mat]];
  const idx = ladder.indexOf(mat);
  return idx > 0 ? ladder[idx-1] : null;
}
const NON_COLLECT = /许可|加密数据|密钥|校准|残液|莫尔石|calibration/;
const DESTROYER_MAX = 15, RELAXED = 20, STRICT = 10;

function transformCost(cost, L){
  const allowedGap = (L <= DESTROYER_MAX) ? RELAXED : STRICT;
  const out = { ...cost };
  for (const mat of Object.keys(cost)){
    if (NON_COLLECT.test(mat)) continue;
    const mLevel = COLLECT_LEVEL[mat];
    if (mLevel === undefined) continue;
    if (mLevel > L + allowedGap){
      const newMat = lowerTierMaterial(mat);
      if (!newMat) continue;
      const add = Math.ceil((cost[mat] * 1.2) / 5) * 5;
      delete out[mat];
      out[newMat] = (out[newMat] !== undefined) ? out[newMat] + add : add;
    }
  }
  return out;
}
function serialize(obj){
  return "{" + Object.keys(obj).map(k => JSON.stringify(k) + ":" + obj[k]).join(",") + "}";
}
function replaceBlock(src, startIdx, openToken, closeToken){
  const c = src.indexOf(openToken, startIdx);
  let d = 0, i = c, e = -1;
  for (; i < src.length; i++){
    if (src[i] === openToken) d++;
    else if (src[i] === closeToken){ d--; if (d === 0){ e = i; break; } }
  }
  return { c, e };
}

const STATIC_IDS = [
  "archaeo_decoder_i","archaeo_decoder_ii","blood_drone_link_sacrifice","blood_servant_drone_link_sacrifice",
  "sansha_gas_assimilation_node","sansha_mineral_assimilation_node","sansha_salvage_injector_node",
  "archaeo_decoder_fleet_iii","archaeo_decoder_iii","blood_gas_assimilation_nexus","blood_mineral_assimilation_nexus",
  "blood_salvage_injector_nexus","archaeo_analyzer_forbidden_iv","archaeo_analyzer_iv","archaeo_decoder_iv",
  "archaeo_stabilizer_iv","t4_drone_link","t4_gas_booster","t4_gas_harvester","t4_mining_booster","t4_mining_laser",
  "t4_salvage_arm","alliance_salvage_injector"
];
let changed = 0;
for (const id of STATIC_IDS){
  const k = src.indexOf(`"${id}":`);
  if (k < 0){ console.error("⚠️ 找不到 id:", id); process.exit(1); }
  const { c, e } = replaceBlock(src, k, "{", "}");
  // 在对象块内找 cost:{...}
  const costStart = src.indexOf("cost:{", c);
  if (costStart < c || costStart > e){ console.error("⚠️ 找不到 cost:", id); process.exit(1); }
  const cs = costStart + 5; // 跳过 "cost:"
  let d = 0, i = cs, ce = -1;
  for (; i < src.length; i++){ if (src[i] === "{") d++; else if (src[i] === "}"){ d--; if (d===0){ ce = i; break; } } }
  const costObj = new Function("return " + src.slice(cs, ce+1) + ";")();
  // 取装备 level（对象块内 level:N）
  const lvMatch = src.slice(c, e).match(/level:(\d+)/);
  const L = lvMatch ? parseInt(lvMatch[1],10) : 0;
  const newCost = transformCost(costObj, L);
  if (JSON.stringify(newCost) !== JSON.stringify(costObj)){
    const newText = "cost:" + serialize(newCost);
    src = src.slice(0, costStart) + newText + src.slice(ce+1);
    changed++;
  }
}

// rig IV 档 minerals
const rigIdx = src.indexOf('suffix:"iv"');
const { c:rc, e:re } = replaceBlock(src, rigIdx, "{", "}");
const minStart = src.indexOf("minerals:{", rc);
const ms = minStart + 9;
let d=0,i=ms,me=-1;
for(;i<src.length;i++){ if(src[i]==="{")d++; else if(src[i]==="}"){d--; if(d===0){me=i;break;}} }
const minObj = new Function("return " + src.slice(ms, me+1) + ";")();
const lvMatch = src.slice(rc, re).match(/level:(\d+)/);
const rigL = lvMatch ? parseInt(lvMatch[1],10) : 0;
const newMin = transformCost(minObj, rigL);
if (JSON.stringify(newMin) !== JSON.stringify(minObj)){
  const newText = "minerals:" + serialize(newMin);
  src = src.slice(0, minStart) + newText + src.slice(me+1);
  changed++;
}

fs.writeFileSync(FILE, src, "utf8");
console.log(`✅ 已重写 ${changed} 个 cost / minerals 块，写回 ${FILE}`);
