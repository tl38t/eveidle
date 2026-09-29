// 成就多语文案（Display Name + Condition）机器翻译 → 直接生成 js/data/achievement-locales-<lang>.js
//
//   node tools/gen-achievement-locales-mt.mjs --langs ja,de,ru,fr
//
// 数据源：steam-achievements-en.csv（英文权威列：Display Name / Condition）
// 产出：  js/data/achievement-locales-ja.js  等，注册方式与 achievement-locales-tw.js 完全一致：
//            root.AchievementLocales = Object.assign(root.AchievementLocales || {}, { "ja": {...} })
//        该文件必须在 js/data/achievement-locales.js 之后、shell-render.js 之前引入（见 index.html）。
//
// 🔴 为什么不用 localization/mt-translate.mjs：那脚本的 checkpoint 文件名是 mt-<lang>.checkpoint.json，
//    --lang ja 会**读写 ja 的宽表 checkpoint**（7864 条真译文），污染风险极高。
//    ⇒ 这里输入输出完全隔离（只读 steam-achievements-en.csv，不碰 localization-master.csv）。
//
// gtx 要点（2026-09-28 实测）：
//   · 429 限的是**请求次数** ⇒ 必须批量（一次传多行）而不是降速逐条发。
//   · 多行返回的 j[0] 是句子元组流，外层长度 ≠ 输入行数且含噪声 ⇒ 用「原文特征前缀 + 顺序归属」。
// 🔴🔴 **本机必须直连 gtx，绝不能走 HTTP 代理**（2026-09-28 实测）：
//   本机环境变量 http(s)_proxy = 127.0.0.1:52051，该代理出口 IP 已被 gtx 封死
//   （`NODE_USE_ENV_PROXY=1` 走代理 ⇒ 恒 429；node fetch 默认本就不读代理 ⇒ 直连 10/10 200、221ms）。
//   ⚠️ 因此**不要用 curl 探测通道**（curl 默认吃代理环境变量）：curl 通 ≠ gtx 通，是假阳性。
//   ⚠️ 兜底冷却别设太长：整组作废后若逐条兜底每条都 429，45s×20 条 = 15 分钟死等。
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const argv = process.argv.slice(2);
// 🔴 同时支持 `--k=v` 与 `--k v` 两种写法。只认 `--k=v` 时，写成空格式会**静默回落默认值**
//    （实测 `--langs de,ru,fr` 被解析成默认 ja，跑完一轮才发现跑错了语言，无任何报错）。
const opt = (k, d = "") => {
  const eq = argv.find((a) => a.startsWith("--" + k + "="));
  if (eq) { const v = eq.slice(k.length + 3); if (v) return v; }
  const i = argv.indexOf("--" + k);
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--")) return argv[i + 1];
  return d;
};
const LANGS = opt("langs", "ja").split(",").map((s) => s.trim()).filter(Boolean);
const CSV = path.join(root, "steam-achievements-en.csv");
const GAP = parseInt(opt("gap", "700"), 10); // ≥1 请求/秒，给宽表跑批留额度
const BULK = parseInt(opt("bulk", "20"), 10);

function sp(line) {
  const out = [];
  let cell = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { out.push(cell); cell = ""; }
    else cell += c;
  }
  out.push(cell);
  return out;
}

const raw = fs.readFileSync(CSV, "utf8").split(/\r?\n/);
const I = {};
sp(raw[0]).forEach((h, i) => (I[h.trim()] = i));
const items = [];
for (let i = 1; i < raw.length; i++) {
  if (!raw[i].trim()) continue;
  const f = sp(raw[i]);
  const id = (f[I.ID] || "").trim();
  const name = (f[I["Display Name"]] || "").trim();
  const cond = (f[I.Condition] || "").trim();
  if (!id || (!name && !cond)) continue;
  if (name) items.push({ id, field: "name", text: name });
  if (cond) items.push({ id, field: "description", text: cond });
}
console.log(`源条目 ${items.length} 条（${new Set(items.map((x) => x.id)).size} 个成就 × 名称/条件）`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let coolUntil = 0;
async function gtxWait() {
  const wait = coolUntil - Date.now();
  if (wait > 0) { console.log(`  (gtx 冷却 ${Math.ceil(wait / 1000)}s)`); await sleep(wait); }
}
function gtxBackoff(sec) { coolUntil = Math.max(coolUntil, Date.now() + sec * 1000); }

async function callOne(text, lang) {
  const url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=" + lang +
    "&dt=t&q=" + encodeURIComponent(text);
  for (let att = 1; att <= 3; att++) {
    await gtxWait();
    try {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) {
        const ra = parseInt(r.headers.get("retry-after") || "", 10);
        gtxBackoff(Number.isFinite(ra) ? ra + 10 : Math.min(60, 15 * att));
        await sleep((Number.isFinite(ra) ? ra : Math.min(20, 5 * att)) * 1000);
        continue;
      }
      const j = await r.json();
      const tuples = Array.isArray(j) && Array.isArray(j[0]) ? j[0] : [];
      for (const t of tuples) if (Array.isArray(t) && String(t[0] || "").trim()) return String(t[0]).trim();
      return "";
    } catch (e) {
      gtxBackoff(20);
      await sleep(2000 * att);
    }
  }
  return "";
}

const norm = (s) => String(s || "").replace(/\s+/g, "");

// 🔴🔴 关键（2026-09-28 实测）：gtx 把「\n 拼起来的多行」**当作一整段文本**返回
//   （j[0] 常常只有一个 tuple，译文里原样保留 \n），**不会**逐行切分。
//   ⇒ 老的「句子流前缀归属」算法会让第 1 行吃掉整块译文，其余行全部归属失败，
//      进而触发整组逐条兜底 = 请求风暴 = 429 死亡螺旋（成就脚本曾因此卡死 15 分钟）。
//   正解：把每个 tuple 的 (译文, 原文) **各自按 \n 切开**，逐段配对成对齐单位；
//         三段数不等时退化成「整段一对」，由下面的顺序归属兜住。
//   实测：10 行输入 → 10 个对齐单位，连续 3 轮 10/10 全部命中。
function unitsOf(j) {
  const out = [];
  const outer = Array.isArray(j) ? j : [];
  for (const segs of outer) {
    if (!Array.isArray(segs) || !segs.length) continue;
    for (const sgm of segs) {
      if (!Array.isArray(sgm)) continue;
      const tRaw = String(sgm[0] || "");
      const sRaw = String(sgm[1] || "");
      const tParts = tRaw.split("\n").map((x) => x.trim()).filter(Boolean);
      const sParts = sRaw.split("\n").map(norm).filter(Boolean);
      if (tParts.length && sParts.length === tParts.length) {
        for (let i = 0; i < tParts.length; i++) out.push({ s: sParts[i], t: tParts[i] });
      } else {
        out.push({ s: norm(sRaw), t: tRaw.trim() });
      }
    }
  }
  return out;
}

async function fetchJson(lang, text) {
  const url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=" + lang +
    "&dt=t&q=" + encodeURIComponent(text);
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(25000) });
  if (!r.ok) {
    const ra = parseInt(r.headers.get("retry-after") || "", 10);
    gtxBackoff(Number.isFinite(ra) ? ra + 10 : 45);
    await sleep((Number.isFinite(ra) ? ra : 8) * 1000);
    return null;
  }
  return r.json();
}

// 顺序归属：从 pos 起找「原文归一化后整等或前缀命中」的第一个对齐单位
function attribute(units, group) {
  const out = new Array(group.length).fill("");
  let pos = 0;
  const missing = [];
  for (let k = 0; k < group.length; k++) {
    const want = norm(group[k].text);
    let idx = -1;
    for (let x = pos; x < units.length; x++) {
      const s = units[x].s;
      if (s === want || (want.length >= 8 && s.startsWith(want.slice(0, 24)))) { idx = x; break; }
    }
    if (idx < 0) { missing.push(k); continue; }
    out[k] = units[idx].t;
    pos = idx + 1;
  }
  return { out, missing };
}

// 返回 { out, missing }；重试一次后再决定要不要逐条兜底（避免请求风暴）
async function callBulk(group, lang) {
  await gtxWait();
  const q = group.map((g) => g.text).join("\n");
  let j = null;
  try { j = await fetchJson(lang, q); }
  catch (e) { j = null; }
  if (!j) { await sleep(4000); try { j = await fetchJson(lang, q); } catch (e) { j = null; } }

  if (j) {
    const { out, missing } = attribute(unitsOf(j), group);
    if (!missing.length) return { out, missing };
    // 归属不全：先原样重试一次（3s），仍不全才逐条补（逐条是最后手段，会打额度）
    console.log(`  (i) 归属不全 ${missing.length}/${group.length} 行，原样重试…`);
    await sleep(3000);
    try {
      const j2 = await fetchJson(lang, q);
      if (j2) {
        const r2 = attribute(unitsOf(j2), group);
        r2.out.forEach((v, k) => { if (v) out[k] = v; });
        return { out, missing: r2.missing.filter((k) => !out[k]) };
      }
    } catch (e) { /* 沿用第一次结果 */ }
    return { out, missing };
  }
  // 两次都失败：整组作废，才走逐条兜底
  const out = [];
  for (const g of group) { out.push(await callOne(g.text, lang)); await sleep(GAP); }
  return { out, missing: out.map((v, k) => (!v ? k : -1)).filter((k) => k >= 0) };
}

for (const lang of LANGS) {
  const map = {};
  let done = 0, failed = 0;
  for (let s = 0; s < items.length; s += BULK) {
    const group = items.slice(s, s + BULK);
    const { out } = await callBulk(group, lang);
    group.forEach((g, k) => {
      const v = (out[k] || "").trim();
      if (!v) { failed++; console.log(`  (!) 行 ${s + k} 译文为空：[${g.text.slice(0, 50)}]`); return; }
      map[g.id] = map[g.id] || {};
      map[g.id][g.field] = v;
      done++;
    });
    await sleep(GAP);
  }

  // 收尾补漏：批量归属偶发漏 1~2 行（gtx 把某句切成多段导致顺序错位），逐条单独兜底。
  // 🔴 必须放在整轮之后：此时请求已经稀疏，不会打乱额度；且只补真正缺的条目。
  const repair = items.filter((g) => {
    const slot = map[g.id];
    return !slot || !slot[g.field];
  });
  for (const g of repair) {
    const v = (await callOne(g.text, lang) || "").trim();
    if (v) { map[g.id] = map[g.id] || {}; map[g.id][g.field] = v; done++; }
    else failed++;
    console.log(`  (补) [${lang}] ${g.text.slice(0, 46)} → ${v ? v.slice(0, 46) : "仍失败"}`);
    await sleep(GAP);
  }
  const entries = Object.keys(map)
    .sort()
    .map((id) => `    ${JSON.stringify(id)}: Object.freeze({ name:${JSON.stringify(map[id].name || "")}, description:${JSON.stringify(map[id].description || "")} })`);
  const jsVar = lang.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  const outFile = path.join(root, "js", "data", `achievement-locales-${lang}.js`);
  fs.writeFileSync(outFile, `(function(){\n  const ${jsVar} = Object.freeze({\n${entries.join(",\n")}\n  });\n  const root = typeof window !== "undefined" ? window : globalThis;\n  root.AchievementLocales = Object.assign({}, root.AchievementLocales || {}, { ${JSON.stringify(lang)}: ${jsVar} });\n})();\n`, "utf8");
  const noName = Object.keys(map).filter((id) => !map[id].name).length;
  const noDesc = Object.keys(map).filter((id) => !map[id].description).length;
  console.log(`[${lang}] 成功 ${done} / 失败 ${failed} | 覆盖 ${Object.keys(map).length} 个（缺名 ${noName} / 缺条件 ${noDesc}）→ ${path.relative(root, outFile)}`);
}
