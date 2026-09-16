/* 自动生成，勿手改：D:/EVE-IDLE/wx-p2-tools/gen-dom-kernel.mjs
 * ==========================================================================
 * 微信小游戏的「DOM 渲染内核」——零依赖，无 DOM/BOM，无 require。
 *
 * 职责：把一棵 {type:'element'|'text', tag, classes, attrs, style} 树
 *   → 解析样式表 → 计算样式 → 排版出几何（写 node.__box）→ 绘制到 2D 画布。
 * 不含 HTML 解析：宿主侧由 wx/shim.js 的 parseFragment 负责（禁止第二份实现）。
 *
 * 来源（**真值方向 = POC → 本文件**；要改内核请改 mini-dom-poc/*.mjs 后重跑本生成器，
 *   直接手改仓库内 dom-kernel.js 会被下一次生成覆盖，并用 --check 检测为漂移）：
 *   · css-parse.mjs     20449 B / 533 行
 *   · layout.mjs        41813 B / 913 行
 *   · paint.mjs         12966 B / 318 行
 *
 * 语法基线：保留原 POC 写法（const/箭头函数）。依据 = 本内核的原型版已随
 *   first-screen.js 在**真·微信小游戏宿主**里成功渲染（2026-09-14 实测），
 *   且打包器会对自己支持的 ?. / ?? 形状做 ES5 降级（本文件当前 0 处）。
 *
 * 发布：GameGlobal.__WX_DOM_KERNEL__（宿主内诊断用）+ module.exports（供 wx/dom-render.js）
 * ==========================================================================
 * 导出清单（19 个，构建期自动收集，勿手改）：stripComments · parseDeclarations · parseSelector · matchesSelector · evalMedia · parseStylesheet · buildRuleIndex · computeStyles · applyInlineAndUAStyles · resolveVars · resolveVarsInTree · parseSides · resolveLen · sides · layoutTree · parseColor · paintTree · stackOrder · countBoxes
 * ========================================================================== */
;(function () {
"use strict";

/* ==================== css-parse.mjs ==================== */
/* ============================================================================
 * css-parse.mjs —— 极简 CSS 解析 / 选择器匹配 / 层叠计算（原型）
 *
 * 零依赖，代码以后要原样搬进 tools/wechat/shim.js。
 * 覆盖：注释、@media（带求值）、@supports、@keyframes/@font-face（跳过）、
 *      选择器（tag / .class / #id / [attr] / 后代 / 子 / 逗号分组）、specificity、
 *      !important、CSS 自定义属性（var()）。
 * 明确不做：伪类/伪元素（含 ':' 的选择器整条跳过 —— 静态首屏不涉及交互态），
 *          简写展开（留给 layout 按需解析）。
 * ==========================================================================*/

const COMMENT_RE = /\/\*[\s\S]*?\*\//g;
const stripComments = (css) => css.replace(COMMENT_RE, " ");

/* ---------- 1. 块级扫描：把 CSS 切成 { prelude, body } 列表 ---------- */
function splitBlocks(text) {
  const out = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    while (i < n && /\s/.test(text[i])) i++;
    if (i >= n) break;
    // 读 prelude，直到 '{' 或（at-rule 的）';'
    let prelude = "";
    let terminated = false;
    while (i < n) {
      const c = text[i];
      if (c === "{") { terminated = true; i++; break; }
      if (c === ";") { i++; break; }
      prelude += c;
      i++;
    }
    if (!terminated) continue; // @import x; 这类无块 at-rule
    // 配对读 body
    let body = "";
    let d = 1;
    while (i < n && d > 0) {
      const c = text[i];
      if (c === "{") d++;
      else if (c === "}") { d--; if (d === 0) { i++; break; } }
      body += c;
      i++;
    }
    out.push({ prelude: prelude.trim(), body });
  }
  return out;
}

/* ---------- 2. 声明解析 ---------- */
function parseDeclarations(body) {
  const out = Object.create(null);
  const parts = [];
  let depth = 0, cur = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === ";" && depth === 0) { parts.push(cur); cur = ""; }
    else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  for (const p of parts) {
    const idx = p.indexOf(":");
    if (idx < 0) continue;
    const k = p.slice(0, idx).trim().toLowerCase();
    let v = p.slice(idx + 1).trim();
    if (!k) continue;
    let important = false;
    if (/!\s*important$/i.test(v)) { important = true; v = v.replace(/!\s*important$/i, "").trim(); }
    out[k] = { value: v, important };
  }
  return out;
}

/* ---------- 3. 选择器 ---------- */
function parseCompound(s) {
  const m = { tag: null, id: null, classes: [], attrs: [] };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "#") { let b = ""; i++; while (i < s.length && /[\w-]/.test(s[i])) b += s[i++]; m.id = b; }
    else if (c === ".") { let b = ""; i++; while (i < s.length && /[\w-]/.test(s[i])) b += s[i++]; if (b) m.classes.push(b); }
    else if (c === "[") { const e = s.indexOf("]", i); m.attrs.push(s.slice(i + 1, e < 0 ? s.length : e)); i = (e < 0 ? s.length : e + 1); }
    else {
      let b = "";
      while (i < s.length && /[\w*-]/.test(s[i])) b += s[i++];
      if (b) m.tag = b.toLowerCase();
      else i++;
    }
  }
  return m;
}

/** 一条完整选择器 → { parts:[{compound, comb}] }；含伪类/伪元素则返回 null
 *  ⚠️ :not(...) 必须支持 —— 实测 CSS 里用了 52 次，且 `.panel:not(.active){display:none}`
 *     这类「隐藏规则」一旦失效，所有面板会同时显示并堆叠，画面完全不可读。 */
function parseSelector(sel) {
  let s = String(sel).trim();
  if (!s) return null;
  s = s.replace(/:root\b/g, "html");           // :root 当作 html 处理
  const nots = [];
  s = s.replace(/:not\(([^()]*)\)/g, (_m, inner) => { nots.push(inner.trim()); return ""; });
  /* ⚠️ :empty 必须支持 —— 实测 CSS 里 5 处，其中 3 处是「容器的关闭态隐藏」：
     `.research-detail:empty{display:none}`、`.tutorial-widget .tw-actions:empty{display:none}`、
     `.setting-changelog:empty{display:none}`。最致命的是第一条：.research-detail 是
     position:fixed;inset:0;z-index:2100 的**全屏层**，规则一旦被跳过，它**空着的时候照样算
     全屏可见** ⇒ 吞掉顶层所有点击（实测 ☰ 按钮中心 (24,18) 命中 aside#research-detail，
     而该节点 childNodes=0）⇒ 玩家症状「界面看着正常、但很多东西点不了」。
     只支持出现在选择器**最右 compound** 的形式（覆盖全部实际用法），其余仍在下一行整条跳过。 */
  let wantsEmpty = false;
  s = s.replace(/:empty\b/g, () => { wantsEmpty = true; return ""; });
  if (/::?[a-zA-Z-]/.test(s)) return null;      // 其余伪类/伪元素 → 跳过
  s = s.replace(/\s*>\s*/g, " > ").replace(/\s*\+\s*/g, " > ").replace(/\s+/g, " ").trim();
  const raw = s.split(" ").filter(Boolean);
  const parts = [];
  let pending = null;
  for (const t of raw) {
    if (t === ">") { pending = ">"; continue; }
    parts.push({ compound: parseCompound(t), comb: pending || " " });
    pending = null;
  }
  if (nots.length && parts.length) {
    const last = parts[parts.length - 1].compound;
    last.not = (last.not || []).concat(nots);
  }
  if (wantsEmpty && parts.length) parts[parts.length - 1].compound.empty = true;
  return parts.length ? { parts } : null;
}

function matchAttr(el, expr) {
  const m = /^([\w-]+)\s*(?:([~^$*|]?=)\s*(.*))?$/.exec(expr.trim());
  if (!m) return true;
  const [, name, op, rawVal] = m;
  const have = el.attrs[name];
  if (have === undefined) return false;
  if (!op) return true;
  const want = rawVal.replace(/^["']|["']$/g, "");
  switch (op) {
    case "=": return have === want;
    case "^=": return have.startsWith(want);
    case "$=": return have.endsWith(want);
    case "*=": return have.includes(want);
    case "~=": return have.split(/\s+/).includes(want);
    case "|=": return have === want || have.startsWith(want + "-");
    default: return false;
  }
}

function matchCompound(el, c) {
  if (c.tag && c.tag !== "*" && el.tag !== c.tag) return false;
  if (c.id && el.attrs.id !== c.id) return false;
  for (const cl of c.classes) if (!el.classes.includes(cl)) return false;
  for (const a of c.attrs) if (!matchAttr(el, a)) return false;
  if (c.empty) {
    /* CSS :empty = **零子节点**（元素与文本都算内容）。内核节点 children 同时含元素与文本节点
       ⇒ 直接看长度；只要有任一子节点就不匹配。 */
    if (el.children && el.children.length) return false;
  }
  if (c.not) {
    for (const n of c.not) {
      const np = parseCompound(n);
      if ((np.tag || np.id || np.classes.length || np.attrs.length) && matchCompound(el, np)) return false;
    }
  }
  return true;
}

function matchesSelector(el, parts) {
  let i = parts.length - 1;
  if (!matchCompound(el, parts[i].compound)) return false;
  let node = el.parent;
  i--;
  while (i >= 0) {
    const comb = parts[i + 1].comb;
    const target = parts[i].compound;
    if (comb === ">") {
      if (!node || !matchCompound(node, target)) return false;
      node = node.parent;
    } else {
      let found = false;
      while (node) {
        if (matchCompound(node, target)) { found = true; node = node.parent; break; }
        node = node.parent;
      }
      if (!found) return false;
    }
    i--;
  }
  return true;
}

const specOf = (parts) => {
  let a = 0, b = 0, c = 0;
  for (const p of parts) {
    if (p.compound.id) a++;
    b += p.compound.classes.length + p.compound.attrs.length;
    /* ⚠️ :empty 是伪类 ⇒ 按 CSS 规范计入 class 层级（b）。**必须加**：
       `.research-detail:empty{display:none}` 出现在 `.research-detail{display:flex}` **之前**，
       若不抬特异性，后者会凭「同特异性取后出现」把它盖掉 ⇒ 修了也不生效。 */
    if (p.compound.empty) b++;
    if (p.compound.tag && p.compound.tag !== "*") c++;
  }
  return [a, b, c];
};
const cmpSpec = (x, y) => (x[0] - y[0]) || (x[1] - y[1]) || (x[2] - y[2]);

/* ---------- 4. @media 求值 ---------- */
function evalMedia(cond, env) {
  const ors = String(cond).split(",");
  for (const or of ors) {
    const ands = or.split(/\s+and\s+/i);
    let ok = true;
    for (const term of ands) {
      const m = /\(\s*([\w-]+)\s*:\s*([^)]+)\)/.exec(term);
      if (!m) { ok = false; break; }
      const feat = m[1].toLowerCase(), val = m[2].trim().toLowerCase();
      const px = (s) => parseFloat(s);
      switch (feat) {
        case "max-width": ok = env.width <= px(val); break;
        case "min-width": ok = env.width >= px(val); break;
        case "max-height": ok = env.height <= px(val); break;
        case "min-height": ok = env.height >= px(val); break;
        case "hover": ok = env.hover ? val !== "none" : val === "none"; break;
        case "pointer": ok = env.hover ? val === "fine" : val === "coarse"; break;
        case "prefers-reduced-motion": ok = (val === "reduce") === !!env.reducedMotion; break;
        case "orientation": {
          const landscape = env.width > env.height;
          ok = (val === "landscape") === landscape;
          break;
        }
        default: ok = false; // 未知特性一律判否（保守）
      }
      if (!ok) break;
    }
    if (ok) return true;
  }
  return false;
}

/* ---------- 5. 主入口：解析样式表 ---------- */
function parseStylesheet(cssText, env, orderRef = { i: 0 }) {
  const rules = [];
  const vars = Object.create(null);
  const stats = { total: 0, active: 0, skippedPseudo: 0, mediaSkipped: 0 };

  const walk = (blocks) => {
    for (const b of blocks) {
      const pre = b.prelude;
      if (!pre) continue;
      if (pre[0] === "@") {
        const at = pre.split(/[\s(]/)[0].toLowerCase();
        if (at === "@media") {
          const cond = pre.slice(6).trim();
          if (!evalMedia(cond, env)) { stats.mediaSkipped++; continue; }
          walk(splitBlocks(b.body));
        } else if (at === "@supports") {
          walk(splitBlocks(b.body));
        } else if (at === "@keyframes" || at === "@font-face" || at === "@charset" || at === "@import") {
          /* 跳过 */
        } else {
          walk(splitBlocks(b.body));
        }
        continue;
      }
      stats.total++;
      const decls = parseDeclarations(b.body);
      // 收集自定义属性（全局简化：任何位置的 --x 都当全局变量）
      for (const k in decls) if (k.startsWith("--")) vars[k] = decls[k].value;
      const sels = [];
      for (const s of pre.split(",")) {
        const p = parseSelector(s);
        if (p) sels.push({ parts: p.parts, spec: specOf(p.parts) });
        else stats.skippedPseudo++;
      }
      if (!sels.length) continue;
      // src: 规则来源标签（app CSS / vendor CSS / inline <style>）——诊断用，不影响层叠
      rules.push({ selectors: sels, decls, order: orderRef.i++, media: null, src: orderRef.src || null });
      stats.active++;
    }
  };
  walk(splitBlocks(stripComments(cssText)));
  return { rules, vars, stats };
}

/* ---------- 6. 层叠计算：给元素树挂 el.style ---------- */
/* ---------- 6. 级联 ----------
 * 🔴 性能：这一步是全流程最贵的（实测真机口径 ≈120ms / 帧，占一次全量渲染的一半以上）。
 *    原因 = 对每个元素跑**全部**规则做选择器匹配（1248 元素 × 2580 规则 ≈ 320 万次），
 *    而挂机游戏里绝大多数帧只有**文本**在变，元素自身的属性与结构完全没动
 *    ⇒ 匹配结果逐帧重复计算，纯浪费。
 *
 * 缓存设计（可选，第三参传入 WeakMap 即启用；不传 = 原行为，便于 POC/探针继续用）：
 *   key   = 元素自身（`node.src`，即宿主侧的 shim 元素对象，跨帧稳定，WeakMap 自动回收）
 *   value = { sig, style, wins }
 * 命中条件 = sig 逐字符相同。sig = 结构签名，必须覆盖**选择器能看到的全部输入**：
 *   ① 自身：tag / id / class / **全部属性**（支持 [attr] [attr=v] [attr^=] 等形式）/ 内联 style
 *   ② 祖先链（后代与子组合器 `.a .b`、`.a > .b`）
 *   ③ **前面的兄弟链**（相邻与通用兄弟组合器 `.a + .b`、`.a ~ .b`）
 * ⚠️ 内联 style **必须进签名**，否则会踩这个坑：某帧把内联样式去掉后，
 *    复用的 style 对象里仍残留上一帧由 applyInlineAndUAStyles 写入的值 ——
 *    非缓存版每帧新建对象所以看不出来，缓存版会静默画出错误样式。
 * 用两级 32 位哈希凑 ~64 位：1248 元素量级下碰撞概率可忽略（缓存命错 = 样式错乱，不能赌）。 */
function fnva(str, h) {
  h = h >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}
function mixSig(a, b) {
  let h = ((a >>> 0) ^ 0x9e3779b9) >>> 0;
  h = (h + (((b >>> 0) ^ 0x85ebca6b) >>> 0)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2545f491) >>> 0; h ^= h >>> 13;
  return h >>> 0;
}
/** 自身签名串：把影响选择器匹配的一切都写进去（属性按名排序，避免顺序抖动造成假 miss） */
function ownSigOf(c) {
  const a = c.attrs || {};
  const keys = [];
  for (const k in a) if (k !== "id" && k !== "class" && k !== "style" && k !== "__styleErr") keys.push(k);
  keys.sort();
  let s = c.tag + "\u0001" + (a.id || "") + "\u0001" + (a["class"] || "") + "\u0001" + (a.style || "");
  for (const k of keys) s += "\u0002" + k + "=" + a[k];
  return s;
}
/* 🔴🔴 这里曾经踩过一个致命坑（2026-09-15 真机卡顿优化时发现，已修）：
 *    上一版把「父签名 / 兄弟链签名」当**字符串**传进 mixSig，而 mixSig 里写的是
 *      let h = ((a >>> 0) ^ 0x9e3779b9) >>> 0;
 *    字符串走 `>>> 0` 会**静默变成 0**（ToNumber("1hr54hx") = NaN → 0）⇒
 *    祖先链与兄弟链的信息被**整个丢光**，签名退化成「只看元素自身」。
 *    后果：凡依赖祖先的选择器（`body.boot-loading .main-container` 之类）缓存判等恒成立
 *    ⇒ 复用了**上一种状态**的样式 ⇒ 界面在首帧后塌缩（实测 boxes 1248 → 54）。
 *    取证方式：把签名打出来对比两帧 —— body 的 class 从 "boot-loading" 变成 ""，
 *    而 .main-container 的 sig 一字未变。
 *    修法：全程用**数值**哈希传递（h1/h2 两个 32 位），不拼接、不转型。
 *    ⚠️ 教训：任何 `>>> 0` / `| 0` / `~~` 作用在「本以为不是字符串」的值上都要先确证类型。 */
function sigOf(c, ph1, ph2, s1, s2) {
  const own = ownSigOf(c);
  const h1 = fnva(own, mixSig(ph1, mixSig(ph2, mixSig(s1, s2))));
  const h2 = fnva(own, mixSig(s2, mixSig(s1, mixSig(ph2, ph1 ^ 0x5bf03635))));
  return [h1, h2];
}

/* ---------- 6a. 选择器索引（2026-09-15：修「交互 180ms」）----------
 * 症状：交互（开抽屉/切页）时一帧 180~225ms，而缓存全命中的帧只要 44ms。
 *       差别全在**样式**：body 换 class ⇒ 所有后代的级联签名都变（祖先链进签名，这是必须的）
 *       ⇒ 整棵树冷算：1248 元素 × 2580 规则全部选择器 ≈ 320 万次匹配。
 * 做法：按**最右复合选择器**建桶。matchesSelector 第一步就是拿最右 compound 匹配元素本身，
 *       而 compound 要求的 tag/id/class 只要元素没有，整条选择器必然不匹配
 *       ⇒ 按 tag/id/class 分桶**不可能漏**（关键性质，由「索引开/关逐元素样式等价」判据证伪）。
 * ⚠️ 最右 compound 只带属性选择器 / `:not()` / `*` 时无法归桶 ⇒ 进 universal，永远参选。
 * ⚠️ 最右 compound 有多个 class 时会落进多个桶 ⇒ 候选可能重复；用 (id,gen) stamp 去重。
 * ✅ 候选**顺序不影响结果**：级联判据是 (important, spec, rule.order)，而 order 每规则唯一
 *    ⇒ 与其遍历顺序无关（同 order 只可能是同一规则本身）。
 * 注：`:not()` 里的 class 由 parseSelector 从串里剥离后挂在同一 compound 的 `not` 上，
 *     不会进 `classes` ⇒ 不会把「否定条件」误当正条件分桶。 */
function pushTo(map, k, v) { const a = map.get(k); if (a) a.push(v); else map.set(k, [v]); }
function buildRuleIndex(rules) {
  const byClass = new Map(), byId = new Map(), byTag = new Map(), universal = [];
  let n = 0;
  for (let ri = 0; ri < rules.length; ri++) {
    const r = rules[ri];
    const sels = r.selectors || [];
    for (let si = 0; si < sels.length; si++) {
      const sel = sels[si];
      if (!sel || !sel.parts || !sel.parts.length) continue;
      const last = sel.parts[sel.parts.length - 1].compound;
      const pair = { r: r, sel: sel, id: n++ };
      if (last.id) pushTo(byId, last.id, pair);
      else if (last.classes.length) { for (const cl of last.classes) pushTo(byClass, cl, pair); }
      else if (last.tag && last.tag !== "*") pushTo(byTag, last.tag, pair);
      else universal.push(pair);
    }
  }
  return {
    byClass: byClass, byId: byId, byTag: byTag, universal: universal, n: n,
    seen: new Int32Array(n), gen: 0, buf: [],
    stats: { pairs: n, ids: byId.size, classes: byClass.size, tags: byTag.size, universal: universal.length },
  };
}
function candidatesFor(el, idx) {
  const out = idx.buf;
  out.length = 0;
  for (let i = 0; i < idx.universal.length; i++) out.push(idx.universal[i]);
  const id = el.attrs && el.attrs.id;
  if (id) { const a = idx.byId.get(id); if (a) for (let i = 0; i < a.length; i++) out.push(a[i]); }
  const cls = el.classes;
  if (cls) for (let i = 0; i < cls.length; i++) { const a = idx.byClass.get(cls[i]); if (a) for (let j = 0; j < a.length; j++) out.push(a[j]); }
  const bt = idx.byTag.get(el.tag); if (bt) for (let i = 0; i < bt.length; i++) out.push(bt[i]);
  return out;
}
/** 把一条已命中选择器的规则并入级联。抽成函数是为了让「有索引 / 无索引」两条路径
 *  共用**同一份**级联逻辑 —— 两份实现必然漂移（这是本项目反复踩过的坑）。 */
function applyRule(r, sel, wins, style) {
  for (const k in r.decls) {
    const d = r.decls[k];
    const prev = wins[k];
    let better;
    if (!prev) better = true;
    else if (d.important !== prev.important) better = d.important;
    else if (cmpSpec(sel.spec, prev.spec) > 0) better = true;
    else if (cmpSpec(sel.spec, prev.spec) === 0 && r.order >= prev.order) better = true;
    else better = false;
    if (better) {
      wins[k] = { spec: sel.spec, order: r.order, important: d.important };
      style[k] = d.value;
    }
  }
}

function computeStyles(root, rules, cache, idx) {
  const stat = { hit: 0, miss: 0 };
  const visit = (node, ph1, ph2) => {
    let s1 = 0, s2 = 0;   // 前面兄弟链的累积哈希（数值；用数字而非字符串，避免拼接随深度膨胀）
    for (const c of node.children) {
      if (c.type !== "element") continue;
      const hh = sigOf(c, ph1, ph2, s1, s2);
      const sig = hh[0].toString(36) + "." + hh[1].toString(36);
      c.__sig = sig;
      s1 = mixSig(s1, hh[0]); s2 = mixSig(s2, hh[1]);
      let reused = null;
      if (cache && c.src) {
        const hit = cache.get(c.src);
        if (hit && hit.sig === sig) reused = hit;
      }
      if (reused) {
        c.style = reused.style;
        c.__wins = reused.wins;
        c.__cacheHit = true;
        stat.hit++;
      } else {
        const wins = Object.create(null);
        const style = Object.create(null);
        if (idx) {
          const cand = candidatesFor(c, idx);
          const gen = ++idx.gen, seen = idx.seen;
          for (let pi = 0; pi < cand.length; pi++) {
            const pr = cand[pi];
            if (seen[pr.id] === gen) continue;   // 多 class 会重复入桶，去重（重复本身无害，但白跑）
            seen[pr.id] = gen;
            if (!matchesSelector(c, pr.sel.parts)) continue;
            applyRule(pr.r, pr.sel, wins, style);
          }
        } else {
          for (const r of rules) {
            for (const sel of r.selectors) {
              if (!matchesSelector(c, sel.parts)) continue;
              applyRule(r, sel, wins, style);
            }
          }
        }
        c.style = style;
        c.__wins = wins;
        c.__cacheHit = false;
        stat.miss++;
        if (cache && c.src) cache.set(c.src, { sig: sig, style: style, wins: wins });
      }
      visit(c, hh[0], hh[1]);
    }
  };
  visit(root, 0, 0);
  return stat;
}

/* ---------- 6b. 元素自身 style="" + [hidden] 的 UA 默认 ----------
 * 🔴 必须有：实测 index.html 里未激活的面板用 `style="display:none;"` 隐藏
 *    （如 `<div class="panel planetary-panel" id="planetary-panel" style="display:none;">`），
 *    inline style 优先级高于所有 CSS 规则 —— 不处理的话所有面板会同时显示并堆叠。
 *    另外 `[hidden]` 属性靠浏览器 UA 样式表生效，我们的样式表里没有，要补默认值。
 *    JS 动态改样式（el.style.display = ...）走的也是这条通路。 */
function applyInlineAndUAStyles(root) {
  const visit = (n) => {
    for (const c of n.children) {
      if (c.type !== "element") continue;
      const st = c.style || (c.style = Object.create(null));
      const wins = c.__wins || Object.create(null);
      const raw = c.attrs && c.attrs.style;
      if (raw) {
        const d = parseDeclarations(raw);
        for (const k in d) {
          const prev = wins[k];
          if (prev && prev.important) continue; // CSS 里的 !important 仍胜出
          st[k] = d.value;
        }
      }
      if (c.attrs && c.attrs.hidden !== undefined && st.display === undefined) st.display = "none";
      visit(c);
    }
  };
  visit(root);
}

/* ---------- 7. 变量替换 ---------- */
function resolveVars(style, vars, depth = 0) {
  if (depth > 8) return style;
  let changed = false;
  for (const k in style) {
    const v = style[k];
    if (typeof v === "string" && v.indexOf("var(") >= 0) {
      const nv = v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g, (m, name, fb) => {
        const got = vars[name];
        if (got !== undefined && got !== "") return got;
        return fb !== undefined ? fb.trim() : "";
      });
      if (nv !== v) { style[k] = nv; changed = true; }
    }
  }
  return changed ? resolveVars(style, vars, depth + 1) : style;
}

function resolveVarsInTree(root, vars) {
  const visit = (n) => {
    for (const c of n.children) {
      if (c.type !== "element") continue;
      resolveVars(c.style || {}, vars);
      visit(c);
    }
  };
  visit(root);
}

/* ---------- 8. 常用简写解析工具（layout / paint 共用） ---------- */
function parseSides(v) {
  if (v === undefined || v === null || v === "") return [0, 0, 0, 0];
  const p = String(v).trim().split(/\s+/);
  const n = (x) => (x === "auto" ? "auto" : (parseFloat(x) || 0));
  if (p.length === 1) { const a = n(p[0]); return [a, a, a, a]; }
  if (p.length === 2) { const a = n(p[0]), b = n(p[1]); return [a, b, a, b]; }
  if (p.length === 3) { const a = n(p[0]), b = n(p[1]), c = n(p[2]); return [a, b, c, b]; }
  return [n(p[0]), n(p[1]), n(p[2]), n(p[3])];
}

/* ==================== layout.mjs ==================== */
/* ============================================================================
 * layout.mjs —— 极简布局引擎（原型，v2）
 *
 * 目标：把「元素树 + 计算样式」变成带绝对坐标的盒子，够渲出首屏即可。
 * 零依赖；文本测量交给注入的 measure(text, spec) —— 微信里换成 ctx.measureText。
 *
 * v2 相对 v1 修的四个硬伤（都是实测暴露的）：
 *   1. flex 改**两趟**：先完整布局每个 item 拿到真实尺寸，再分配/摆放、最后平移子树。
 *      （v1 用 height 估算，`height:auto` 的 item 高度恒为 0 ⇒ 全部叠在同一个 y）
 *   2. `position: absolute/fixed` 的子元素**从流里摘出来**单独定位。
 *      （v1 在 flex 容器里把它们当普通 item ⇒ topbar/main-container 的 top 被忽略）
 *   3. 百分比基准分离：width/left 用可用**宽**，height/top 用可用**高**。
 *   4. flex item 支持 shrink-to-fit（width:auto 时按内容宽，而不是撑满父宽）。
 *   5. flex 支持 **flex-wrap: wrap**（多行 + 每行独立 grow/justify/align。
 *      移动端布局几乎全靠它：`css/taptap-portrait.css` 里 `.topbar{flex-wrap:wrap}`
 *      + `.resources{flex:1 1 100%}` = 「资源整行下沉」，`.mining-target-strip` 的
 *      `flex:0 0 calc(33.333% - 4px)` = 「每行三列」。
 *      ⚠️ 两个必须同时做对，缺一行都不换：
 *        ① 断行要用 item 的**假设主轴尺寸**（有 flex-basis 就是 basis，否则内容宽），
 *           不能用「被行内剩余宽度挤压后」的尺寸 —— 后者恒「放得下」⇒ 永不换行；
 *        ② `flex` 简写的第 3 段就是 flex-basis，必须解析出来。
 *      ⚠️ `flex:0 0 auto` 的 grow 必须是 0。旧版用 /(^|\s)(1|auto)(\s|$)/ 猜 grow，
 *         会把末尾的 `auto` 当成 `flex:auto` ⇒ grow=1 ⇒ 本该按内容宽的项去抢剩余空间。
 *
 * 支持：display block / flex(row|column) / none / inline；width·height·min·max
 *      （px % vw vh rem em pt calc min max clamp env）；padding/margin/border-width；
 *      box-sizing；flex grow/basis、flex-wrap/align-content、justify-content、align-items、gap；
 *      position absolute/fixed（top/left/right/bottom）；overflow；transform translate；
 *      text-align；文本折行（中文逐字 / 西文按空格）。
 * 不做：grid、inline 完整行盒规则、float、sticky、writing-mode。
 * ==========================================================================*/

const INLINE_TAGS = new Set([
  "span", "i", "b", "strong", "em", "small", "label", "a", "code", "s", "u",
  "sup", "sub", "abbr", "cite", "q", "mark", "time", "br", "img", "svg", "button", "input",
]);

/* ---------- 单位 / 表达式 ---------- */
function tokenizeExpr(s) {
  const toks = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "+" || c === "-" || c === "*" || c === "/") { toks.push({ t: "op", v: c }); i++; continue; }
    if (c === "(") {
      let d = 1, j = i + 1, buf = "";
      while (j < s.length) {
        if (s[j] === "(") d++;
        else if (s[j] === ")") { d--; if (d === 0) break; }
        buf += s[j]; j++;
      }
      toks.push({ t: "group", v: buf }); i = j + 1; continue;
    }
    let j = i, buf = "";
    while (j < s.length && !/[\s+\-*/()]/.test(s[j])) { buf += s[j]; j++; }
    if (!buf && s[j] === "-") { buf = "-"; j++; while (j < s.length && !/[\s+\-*/()]/.test(s[j])) { buf += s[j]; j++; } }
    toks.push({ t: "val", v: buf }); i = j;
  }
  return toks;
}
const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : 0);

function evalTokens(toks, ctx) {
  const vals = [], ops = [];
  for (const t of toks) {
    if (t.t === "val") vals.push(resolveLen(t.v, ctx));
    else if (t.t === "group") vals.push(evalTokens(tokenizeExpr(t.v), ctx));
    else ops.push(t.v);
  }
  for (let i = 0; i < ops.length;) {
    if (ops[i] === "*" || ops[i] === "/") {
      const a = num(vals[i]), b = num(vals[i + 1]);
      vals.splice(i, 2, ops[i] === "*" ? a * b : (b === 0 ? 0 : a / b));
      ops.splice(i, 1);
    } else i++;
  }
  let acc = num(vals[0]);
  for (let i = 0; i < ops.length; i++) acc = ops[i] === "+" ? acc + num(vals[i + 1]) : acc - num(vals[i + 1]);
  return acc;
}

function splitArgs(s) {
  const out = []; let d = 0, cur = "";
  for (const c of s) {
    if (c === "(") d++; else if (c === ")") d--;
    if (c === "," && d === 0) { out.push(cur); cur = ""; } else cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out.map((x) => x.trim());
}

/* 按**顶层空格**切分（括号内的空格不算分隔符）。
   ⚠️ 为什么必须有它：`flex` 简写里 basis 段可以是 `calc(50% - 6px)` 这种**带空格的函数**。
   用 `String(v).split(/\s+/)` 会把它切成 ["1","1","calc(50%","-","6px)"] ⇒ 取 fp[2] 得到
   `"calc(50%"` ⇒ resolveLen 返回 null ⇒ basis 段整段丢失 ⇒ 本该「一行两项」的 tab 变成
   「一行一项」（实测 `.tw-tab{flex:1 1 calc(50% - 6px)}` 就是这么坏的）。
   🔴 命名必须叫 `splitTopWs`：`paint.mjs` 里已有一个**不同语义**的 `splitTop(s, sep)`
   （按任意字符切、且丢弃空段）。内核是三个模块**拼进同一个作用域**的，同名函数声明
   **后者胜出**（拼接序 css-parse → layout → paint）⇒ 我起名 `splitTop` 时被 paint 那份
   静默遮蔽，全部调用打到错实现上、整棵树不再换行。**跨模块同名 = 静默覆盖，改名才安全。** */
function splitTopWs(s) {
  const out = []; let d = 0, cur = "";
  for (const c of s) {
    if (c === "(") d++; else if (c === ")") d--;
    if (d === 0 && /\s/.test(c)) { if (cur) { out.push(cur); cur = ""; } continue; }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

/** 解析长度 → px；'auto' 原样返回；无法解析 null */
/* ---------- 纯函数记忆化 ------------------------------------------------------
 * 这三只函数每帧被调用上万次，输入是**高度重复的 CSS 字符串**（1248 个元素其实只共用
 * 几十种取值），而实现里是十几个正则 + String().trim() + split()。它们都是纯函数
 * ⇒ 记忆化零语义风险。
 * ⚠️ 缓存键必须覆盖**全部输入**。css-parse 那次（签名里 `>>> 0` 吃掉祖先链）就是反例：
 *    判等恒成立 ⇒ 整棵树塌缩成 54 个盒子。这里的输入只有
 *    raw / ctx.base / ctx.fontSize / env / rootFontSize / fontFamily，
 *    前两个进键，后三个靠 `ensureGen()` 换代清空 ⇒ 覆盖闭包完整。
 * ⚠️ 容量超限直接清空（CSS 取值集合有限，不会抖动），避免 LRU 记账开销。 */
const NULLV = { __v: null };
const LEN_CACHE = new Map();
const SIDES_CACHE = new Map();
const FONT_CACHE = new Map();
const CACHE_MAX = 4000;
let __gen = null;
function ensureGen(env, opts, measure) {
  const g = (env ? env.width + "x" + env.height : "") + "|" + (opts.rootFontSize || 16) + "|" + (opts.fontFamily || "");
  if (g !== __gen || __genMeasure !== measure) {
    __gen = g; __genMeasure = measure;
    LEN_CACHE.clear(); SIDES_CACHE.clear(); FONT_CACHE.clear();
  }
}
let __genMeasure = null;
function memo(cache, key, compute) {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const v = compute();
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(key, v);
  return v;
}

function resolveLen(raw, ctx) {
  if (raw == null) return null;
  const v = memo(LEN_CACHE, raw + "" + ctx.base + "" + ctx.fontSize, () => {
    const r = resolveLenRaw(raw, ctx);
    return r === null ? NULLV : r;
  });
  return v === NULLV ? null : v;
}
function resolveLenRaw(raw, ctx) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  /* 🔴 扁平化嵌套 env()（例如 calc 内部的 env(safe-area-inset-bottom, 0px)）。
   *    内核没有真实安全区域信息 ⇒ env 一律取后备值（无后备取 0）。
   *    否则 `calc(56px + env(safe-area-inset-bottom, 0px) + 8px)` 里 env 解析不掉，
   *    会被 tokenize 丢弃导致只剩第一项（实测 bottom 从 64 塌成 56），
   *    更糟的是 `--tp-safe-b` 这类「var 指向 env」的值会让整条 calc 解析失败 ⇒ 定位全错。 */
  const sFlat = s.replace(/env\(\s*[\w-]+\s*(?:,\s*([^()]*))?\)/g,
    (m, fb) => (fb !== undefined ? fb.trim() : "0"));
  if (sFlat !== s) return resolveLenRaw(sFlat, ctx);
  if (s === "auto") return "auto";
  if (s === "0") return 0;
  if (/^-?[\d.]+$/.test(s)) return parseFloat(s);
  let m;
  if ((m = /^(-?[\d.]+)px$/.exec(s))) return parseFloat(m[1]);
  if ((m = /^(-?[\d.]+)%$/.exec(s))) {
    // ⚠️ CSS 规范：父元素高度不确定时 `height:100%` 退化为 auto（不可解析）
    if (ctx.base == null) return null;
    return num(ctx.base) * parseFloat(m[1]) / 100;
  }
  if ((m = /^(-?[\d.]+)vw$/.exec(s))) return ctx.env.width * parseFloat(m[1]) / 100;
  if ((m = /^(-?[\d.]+)vh$/.exec(s))) return ctx.env.height * parseFloat(m[1]) / 100;
  if ((m = /^(-?[\d.]+)vmin$/.exec(s))) return Math.min(ctx.env.width, ctx.env.height) * parseFloat(m[1]) / 100;
  if ((m = /^(-?[\d.]+)vmax$/.exec(s))) return Math.max(ctx.env.width, ctx.env.height) * parseFloat(m[1]) / 100;
  if ((m = /^(-?[\d.]+)rem$/.exec(s))) return parseFloat(m[1]) * (ctx.rootFontSize || 16);
  if ((m = /^(-?[\d.]+)em$/.exec(s))) return parseFloat(m[1]) * (ctx.fontSize || 16);
  if ((m = /^(-?[\d.]+)pt$/.exec(s))) return parseFloat(m[1]) * 96 / 72;
  if (/^env\(/.test(s)) return 0;
  if ((m = /^min\(([\s\S]*)\)$/.exec(s))) return Math.min(...splitArgs(m[1]).map((a) => num(resolveLen(a, ctx))));
  if ((m = /^max\(([\s\S]*)\)$/.exec(s))) return Math.max(...splitArgs(m[1]).map((a) => num(resolveLen(a, ctx))));
  if ((m = /^clamp\(([\s\S]*)\)$/.exec(s))) {
    const a = splitArgs(m[1]).map((x) => num(resolveLen(x, ctx)));
    return Math.max(a[0], Math.min(a[1], a[2]));
  }
  if ((m = /^calc\(([\s\S]*)\)$/.exec(s))) return evalTokens(tokenizeExpr(m[1]), ctx);
  return null;
}

function sides(v) {
  if (v == null || v === "") return [0, 0, 0, 0];
  return memo(SIDES_CACHE, "s" + v, () => sidesRaw(v));
}
function sidesRaw(v) {
  /* ⚠️ 必须用 splitTop（括号感知）：`padding: calc(10px + env(...))` 这类值内部带空格，
     按 `\s+` 切会被拆成 4 段 ⇒ 当成「四边不同」⇒ padding-top 变成 `"calc(10px"`（→0）
     而 padding-bottom 捡到 `"0px))"`。同一类缺陷在 flex 简写上已实测踩过。 */
  const p = splitTopWs(String(v).trim()).map((x) => (x === "auto" ? "auto" : (parseFloat(x) || 0)));
  if (p.length === 1) return [p[0], p[0], p[0], p[0]];
  if (p.length === 2) return [p[0], p[1], p[0], p[1]];
  if (p.length === 3) return [p[0], p[1], p[2], p[1]];
  return [p[0], p[1], p[2], p[3]];
}
function resolveSides(v, ctx, autoAs = 0) {
  const r = sides(v);
  return r.map((x) => {
    if (x === "auto") return autoAs;
    const n = num(resolveLen(String(x), ctx));
    return x === "" ? 0 : n;
  });
}

/* ---------- 盒模型 longhand 合并 ----------------------------------------------
 * 🔴 必须有：app CSS 大量使用 `margin-top` / `padding-left` / `row-gap` 这类**单边**声明
 *    （实测覆盖 204 个元素，其中 margin-top 67 / margin-bottom 56 / margin-left 39 /
 *      padding-bottom 16 / padding-left 15）。只读简写 `margin`/`padding` 会把它们
 *      整块丢掉 ⇒ 元素位置静默偏移，而且「跑通了、看不出报错」。
 *    层叠口径必须与 computeStyles 一致：important > specificity > 声明顺序。
 *    （不能简单认为「longhand 一定覆盖简写」——被覆盖方可能来自更高优先级规则。）
 * ---------------------------------------------------------------------------- */
const cmpSpecL = (x, y) => (x[0] - y[0]) || (x[1] - y[1]) || (x[2] - y[2]);
const SIDE_NAMES = ["top", "right", "bottom", "left"];

function longhandWins(lw, sw) {
  if (!lw) return false;
  if (!sw) return true;
  if (!!lw.important !== !!sw.important) return !!lw.important;
  const c = cmpSpecL(lw.spec, sw.spec);
  if (c !== 0) return c > 0;
  return lw.order >= sw.order;
}

/** 该 longhand 是否应覆盖同族简写？
 *  - st 里有、__wins 里没有 ⇒ 来自 inline style ⇒ 最高优先级（inline 不进 __wins）
 *  - 其余情况才走 normal 层叠比较 */
function sideOverrides(el, st, wins, longProp, shortProp) {
  if (!(longProp in st)) return false;
  if (!(longProp in wins)) return true; // inline style
  return longhandWins(wins[longProp], wins[shortProp]);
}

/** 简写 + 四边 longhand 合并后解析成 [t,r,b,l] 像素值 */
function boxSides(el, st, prop, ctx, autoAs = 0) {
  const wins = (el && el.__wins) || {};
  const out = resolveSides(st[prop], ctx, autoAs);
  for (let i = 0; i < 4; i++) {
    const lp = prop + "-" + SIDE_NAMES[i];
    if (!sideOverrides(el, st, wins, lp, prop)) continue;
    const v = st[lp];
    out[i] = v === "auto" ? autoAs : num(resolveLen(String(v), ctx));
  }
  return out;
}

/** margin 的 auto 判定必须连 longhand 一起看（布局用它决定水平居中） */
function boxAutos(el, st, prop) {
  const wins = (el && el.__wins) || {};
  const autos = sides(st[prop]).map((x) => x === "auto");
  for (let i = 0; i < 4; i++) {
    const lp = prop + "-" + SIDE_NAMES[i];
    if (!sideOverrides(el, st, wins, lp, prop)) continue;
    autos[i] = String(st[lp]).trim() === "auto";
  }
  return autos;
}

/** gap 简写 + row-gap/column-gap longhand → [rowGap, colGap] */
function gapPair(el, st, ctx) {
  const wins = (el && el.__wins) || {};
  const g = resolveSides(st.gap, ctx, 0);
  const out = [g[0], g[1]];
  if (sideOverrides(el, st, wins, "row-gap", "gap")) out[0] = num(resolveLen(String(st["row-gap"]), ctx));
  if (sideOverrides(el, st, wins, "column-gap", "gap")) out[1] = num(resolveLen(String(st["column-gap"]), ctx));
  return out;
}

function borderWidths(st, ctx) {
  const bw = st["border-width"];
  if (bw) {
    const p = String(bw).trim().split(/\s+/).map((x) => num(resolveLen(x, ctx)));
    if (p.length === 1) return [p[0], p[0], p[0], p[0]];
    if (p.length === 2) return [p[0], p[1], p[0], p[1]];
    if (p.length === 3) return [p[0], p[1], p[2], p[1]];
    return p;
  }
  const one = (side) => {
    const v = st["border-" + side] || st.border;
    if (!v || /^(none|0)\b/.test(String(v).trim())) return 0;
    const m = /(-?[\d.]+)px/.exec(v);
    return m ? parseFloat(m[1]) : 0;
  };
  return [one("top"), one("right"), one("bottom"), one("left")];
}

function fontSpec(st, ctx) {
  const key = st["font-size"] + "" + st["font-weight"] + "" + st["font-family"] + "" +
    st["line-height"] + "" + st["letter-spacing"] + "" + ctx.fontSize;
  return memo(FONT_CACHE, key, () => fontSpecRaw(st, ctx));
}
function fontSpecRaw(st, ctx) {
  const fs = num(resolveLen(st["font-size"], ctx)) || ctx.fontSize || 14;
  const fw = st["font-weight"] || "400";
  const fam = String(st["font-family"] || ctx.fontFamily || "sans-serif").replace(/["']/g, "");
  const first = fam.split(",")[0].trim() || "sans-serif";
  /* line-height：app CSS 里 86 个元素显式设了（最常见取值 `1`）。
   * 忽略它会把文本盒子高估到 1.35 倍 ⇒ 面板被撑高 ⇒ 竖向溢出。
   * 规范：无单位数 = 字号倍数；px 是绝对值；normal/缺失 = 字号 × 1.35（近似） */
  let lh = fs * 1.35;
  const rawLh = st["line-height"];
  if (rawLh != null && rawLh !== "" && rawLh !== "normal") {
    const sLh = String(rawLh).trim();
    if (/^-?[\d.]+$/.test(sLh)) lh = fs * parseFloat(sLh);
    else if (/^-?[\d.]+px$/.test(sLh)) lh = parseFloat(sLh);
    else { const v = num(resolveLen(sLh, ctx)); if (v != null && v > 0) lh = v; }
  }
  /* letter-spacing：137 个元素在用，直接影响文本测量宽度（measure 会叠加） */
  const lsRaw = st["letter-spacing"];
  let ls = 0;
  if (lsRaw != null && lsRaw !== "" && lsRaw !== "normal") {
    const v = num(resolveLen(String(lsRaw), ctx));
    if (v) ls = v;
  }
  return { size: fs, weight: fw, family: first, lineHeight: lh, letterSpacing: ls, spec: fw + " " + fs + "px " + first };
}

/* ---------- 平移子树 Y（bottom 反推收尾；跳过视口锚定的 fixed 后代） ----------
 * ⚠️ 只挪 `el.__box.y` 而不挪后代，会让「后代仍在旧原点布局」⇒ 父盒裁剪把整棵子树剪光，
 *    表现为「DOM 有文本但一个像素都不画」的空壳深色块（实测 = #tutorial-widget 黑块）。
 *    这里连同后代一起挪，保证父子几何一致。 */
function shiftSubtreeY(el, dy) {
  if (!dy) return;
  if (el.__box) el.__box.y += dy;
  const shift = (n) => {
    for (const c of (n.children || [])) {
      const cst = c.style || {};
      if (cst.position === "fixed") continue; // 视口锚定 ⇒ 不随祖先平移
      if (c.__box) c.__box.y += dy;
      shift(c);
    }
  };
  shift(el);
}

/* ---------- 平移子树（flex 两趟布局的收尾） ---------- */
function translateSubtree(el, dx, dy) {
  if (!dx && !dy) return;
  const shift = (n) => {
    if (n.__box) { n.__box.x += dx; n.__box.y += dy; }
    for (const c of (n.children || [])) shift(c);
  };
  shift(el);
}

/* ---------- 主布局 ---------- */
function layoutTree(root, env, opts = {}) {
  const measure = opts.measure || ((t, sp) => ({ width: t.length * (sp.size || 14) * 0.55, height: (sp.size || 14) * 1.35 }));
  ensureGen(env, opts, opts.measure);
  const rootFontSize = opts.rootFontSize || 16;
  const fmt = { count: 0, texts: 0, positioned: 0 };
  const viewport = { x: 0, y: 0, w: env.width, h: env.height };

  function findBody(n) {
    for (const c of n.children) {
      if (c.type === "element") {
        if (c.tag === "body") return c;
        const r = findBody(c);
        if (r) return r;
      }
    }
    return null;
  }
  const bodyEl = findBody(root) || root;

  const displayOf = (el) => (el.style && el.style.display) || (INLINE_TAGS.has(el.tag) ? "inline" : "block");

  /** 布局一个元素到 (x, y)。返回 border-box 尺寸 {w,h} */
  function layoutNode(el, x, y, availW, availH, baseFont, cb, shrinkW) {
    const st = el.style || {};
    const fctx0 = { env, base: availW, fontSize: baseFont, rootFontSize, fontFamily: opts.fontFamily };
    const fs = num(resolveLen(st["font-size"], fctx0)) || baseFont || 14;
    const ctxW = { env, base: availW, fontSize: fs, rootFontSize, fontFamily: opts.fontFamily };
    const ctxH = { env, base: availH, fontSize: fs, rootFontSize, fontFamily: opts.fontFamily };
    const disp = displayOf(el);

    if (disp === "none") {
      el.__box = { x, y, w: 0, h: 0, display: "none" };
      return { w: 0, h: 0 };
    }

    const pad = boxSides(el, st, "padding", ctxW, 0);
    const marAuto = boxAutos(el, st, "margin");
    const mar = boxSides(el, st, "margin", ctxW, 0);
    const bdw = borderWidths(st, ctxW);
    const borderBox = (st["box-sizing"] || "border-box") === "border-box";

    // ---- 宽度 ----
    let wv = resolveLen(st.width, ctxW);
    let w;
    if (wv === "auto" || wv === null) {
      w = Math.max(0, availW - mar[1] - mar[3]);
      if (shrinkW) w = availW - mar[1] - mar[3]; // 先给满，收尾再回填
    } else {
      w = num(wv) + (borderBox ? 0 : pad[1] + pad[3] + bdw[1] + bdw[3]);
    }
    const minW = resolveLen(st["min-width"], ctxW);
    const maxW = resolveLen(st["max-width"], ctxW);
    if (minW != null && minW !== "auto") w = Math.max(w, num(minW));
    if (maxW != null && maxW !== "auto") w = Math.min(w, num(maxW));
    if (!(w >= 0)) w = 0;

    // ---- 高度 ----
    const hv = resolveLen(st.height, ctxH);
    let hFixed = null;
    // positioned 元素由 top/bottom 反推出的高度（父在定位阶段算好）优先
    if (el.__forcedH != null) hFixed = el.__forcedH;
    else if (hv !== "auto" && hv !== null) hFixed = num(hv) + (borderBox ? 0 : pad[0] + pad[2] + bdw[0] + bdw[2]);
    const minH = resolveLen(st["min-height"], ctxH);
    const maxH = resolveLen(st["max-height"], ctxH);

    const innerW = Math.max(0, w - pad[1] - pad[3] - bdw[1] - bdw[3]);
    const innerX = x + bdw[3] + pad[3];
    const innerY = y + bdw[0] + pad[0];
    // 传给子元素的「确定高度」：只有自己高度确定时才非 null（null ⇒ 子元素的 height:100% 退化为 auto）
    const innerAvailH = hFixed != null ? Math.max(0, hFixed - pad[0] - pad[2] - bdw[0] - bdw[2]) : null;

    // ---- 拆分流内子元素 / 定位子元素 ----
    const flow = [];
    const positioned = [];
    for (const c of el.children) {
      if (c.type === "text") { flow.push(c); continue; }
      const cd = displayOf(c);
      const cst = c.style || {};
      if (cd === "none") { c.__box = { x: 0, y: 0, w: 0, h: 0, display: "none" }; continue; }
      if (cst.position === "absolute" || cst.position === "fixed") positioned.push(c);
      else flow.push(c);
    }

    // 最近定位祖先的内容盒（绝对定位的包含块）
    const myCb = (st.position && st.position !== "static")
      ? { x: innerX, y: innerY, w: innerW, h: innerAvailH != null ? innerAvailH : (availH || 0) }
      : cb;

    let contentH = 0, contentW = 0;
    const isFlex = disp === "flex" || disp === "inline-flex";
    // white-space: nowrap / pre ⇒ 不换行（app CSS 里 62 个元素在用 `nowrap`）
    const nowrap = /nowrap|pre/.test(String(st["white-space"] || ""));

    if (isFlex) {
      const dir = String(st["flex-direction"] || "row").startsWith("column") ? "column" : "row";
      const isRow = dir === "row";
      const gapArr = gapPair(el, st, ctxW);
      const gapMain = isRow ? gapArr[1] : gapArr[0];
      const gapCross = isRow ? gapArr[0] : gapArr[1];
      const justify = st["justify-content"] || "flex-start";
      const alignItems = st["align-items"] || "stretch";
      // flex-wrap：只有 wrap / wrap-reverse 才多行；nowrap 与不写等价（旧行为逐字保持）
      const wrapMode = String(st["flex-wrap"] || "nowrap");
      const wraps = wrapMode === "wrap" || wrapMode === "wrap-reverse";
      const alignContent = String(st["align-content"] || "normal");

      const mainAvail = isRow ? innerW : (innerAvailH || 0);

      // ---- 第一趟：真实布局每个 item（wrap 时同时决定断行） ----
      const items = [];
      let usedMainSoFar = 0;   // nowrap 专用：与旧版语义逐字一致（只累计元素项）
      let lineUsed = 0;        // 当前行主轴占用（含 margin 与 gap；仅 wrap 用）
      let lineNo = 0;
      // 断行：放不进当前行就换行。⚠️ 判据必须是「假设主轴尺寸」（有 basis 就是 basis，
      // 否则是内容宽），不能用被行内剩余宽度挤压后的尺寸 —— 那恒「放得下」，永不换行。
      const startNewLine = (itMain) => {
        if (!wraps || lineUsed <= 0.001) return false;      // 空行不换（否则无限换行）
        if (lineUsed + itMain <= mainAvail + 0.5) return false;
        lineNo++; lineUsed = 0; return true;
      };
      for (const c of flow) {
        if (c.type === "text") {
          const t = c.text;
          if (!t.trim()) continue;
          const sp = fontSpec(st, ctxW);
          const r = wrapText(t, nowrap ? 0 : innerW, sp, measure);
          if (wraps) {   // nowrap 保持旧行为：旧版不把文本项计入 usedMainSoFar
            const tm = isRow ? r.width : r.height;
            startNewLine(tm);
            lineUsed += tm + gapMain;
          }
          items.push({ kind: "text", node: c, spec: sp, mw: r.width, mh: r.height, lines: r.lines, cm: [0, 0, 0, 0], line: lineNo });
          continue;
        }
        const cst = c.style || {};
        if (cst.position === "relative") { /* relative 仍占流 */ }
        const cm = boxSides(c, cst, "margin", ctxW, 0);
        const cwv = resolveLen(cst.width, { ...ctxW, base: innerW });

        // `flex` 简写按规范拆 grow / shrink / basis。
        // ⚠️ 旧版用 /(^|\s)(1|auto)(\s|$)/ 猜 grow ⇒ `flex:0 0 auto`（44 处）末尾的 auto 被当成
        //    `flex:auto` ⇒ grow=1 ⇒ 本该「按内容宽」的项去抢剩余空间；且简写的 basis 段整段丢失
        //    ⇒ `.topbar .resources{flex:1 1 100%}` 的「整行下沉」根本不成立。
        const fp = splitTopWs(String(cst.flex || "").trim());
        let grow = 0, basis = null;
        const tok = (v) => (v != null && v !== "auto" ? resolveLen(v, { ...ctxW, base: mainAvail }) : null);
        if (fp.length >= 3) { grow = parseFloat(fp[0]) || 0; basis = tok(fp[2]); }
        else if (fp.length === 2) { grow = parseFloat(fp[0]) || 0; if (!/^-?[\d.]+$/.test(fp[1])) basis = tok(fp[1]); }
        else if (fp.length === 1) {
          if (/^-?[\d.]+$/.test(fp[0])) grow = parseFloat(fp[0]) || 0;
          else if (fp[0] === "auto") grow = 1;
          else if (fp[0] === "none") grow = 0;
          else basis = tok(fp[0]);
        }
        // 长写覆盖简写（全仓库 flex-grow 0 处 / flex-basis 5 处）
        if (cst["flex-grow"] != null) grow = parseFloat(cst["flex-grow"]) || 0;
        const fbLong = tok(cst["flex-basis"]);
        if (fbLong != null) basis = fbLong;
        if (basis == null || basis === "auto") basis = null;

        // ⚠️ 可用主轴宽度必须扣掉「本行前面 item 已占用的部分」，否则靠后的大块会溢出容器
        //    （实测：topbar 里 brand 160px 之后，resources 仍拿到满宽 ⇒ 390 宽撑到 550 越界）
        const remainingMain = Math.max(0, mainAvail - (wraps ? lineUsed : usedMainSoFar));
        /* 主轴可用宽度**分两步**，顺序不能反：
           ① 量「假设主轴尺寸」(hypothetical main size)：柔性项（无 width/basis）用**整容器宽**量。
              这是浏览器定 flex base size 的口径（`flex-basis:auto` + `width:auto` ⇒ max-content）。
           ② 换行判定用①的尺寸；判完**再按本行剩余宽度收缩**重排。
           🔴 为什么不能直接用「本行剩余宽度」量（改前就是这么写的）：
              长文本会被**提前压窄折行** ⇒ 量出的宽偏小 ⇒ 换行判定恒「放得下」⇒ 该换的行不换。
              实测 `.skill-current .skill-info`：4 项本应 3+1 两行（浏览器），内核挤成一行。
           注：有 width / basis / grow 的项不受影响（它们的尺寸本来就与剩余宽度无关）。 */
        let passW;
        if (isRow) {
          if (cwv && cwv !== "auto") passW = num(cwv);
          else if (basis != null && basis !== "auto") passW = num(basis);
          else passW = Math.max(0, innerW - cm[1] - cm[3]);
        } else {
          passW = cwv && cwv !== "auto" ? num(cwv) : Math.max(0, innerW - cm[1] - cm[3]);
        }
        // ⚠️ column 方向也要传可用高度：`height:100%` 的百分比基准就是它，
        //    传 0 会让 `.main-container` 的子元素高度全塌成 0（实测症状：section.content 高度 0）。
        const canShrink = isRow && !(cwv && cwv !== "auto") && basis == null && grow === 0;
        let r = layoutNode(c, 0, 0, passW, innerAvailH, fs, myCb, canShrink);
        let realW = c.__box ? c.__box.w : r.w;
        let realH = c.__box ? c.__box.h : r.h;
        let itMain = isRow ? realW + cm[1] + cm[3] : realH + cm[0] + cm[2];
        if (wraps && startNewLine(itMain)) {
          // 换了行 ⇒ 它独占新行，本行可用宽回到满宽（不含 margin）。
          const full = Math.max(0, mainAvail - (isRow ? cm[1] + cm[3] : cm[0] + cm[2]));
          if (passW < full - 0.01 && !(cwv && cwv !== "auto") && basis == null) {
            r = layoutNode(c, 0, 0, full, innerAvailH, fs, myCb, canShrink);
            realW = c.__box ? c.__box.w : r.w;
            realH = c.__box ? c.__box.h : r.h;
            itMain = isRow ? realW + cm[1] + cm[3] : realH + cm[0] + cm[2];
          }
        } else if (canShrink && itMain > remainingMain + 0.01) {
          // ② 没换行、但按假设尺寸放不进本行剩余空间 ⇒ 收缩到剩余空间重排。
          //    （`flex-shrink` 默认 1；本内核不做 shrink 比例分配，按「最多用到剩余宽度」处理，
          //      与浏览器在「单行内一个柔性项收缩」时的结果一致。）
          r = layoutNode(c, 0, 0, remainingMain, innerAvailH, fs, myCb, canShrink);
          realW = c.__box ? c.__box.w : r.w;
          realH = c.__box ? c.__box.h : r.h;
          itMain = isRow ? realW + cm[1] + cm[3] : realH + cm[0] + cm[2];
        }
        lineUsed += itMain + gapMain;
        usedMainSoFar += (isRow ? realW : realH) + cm[1] + cm[3] + gapMain;
        items.push({
          kind: "el", node: c, cm, grow, line: lineNo,
          mw: (isRow ? (cwv && cwv !== "auto" ? num(cwv) : realW) : realW) + cm[1] + cm[3],
          mh: (isRow ? realH : (resolveLen(cst.height, ctxH) !== "auto" && resolveLen(cst.height, ctxH) != null ? realH : realH)) + cm[0] + cm[2],
          realW, realH,
        });
      }

      // ---- 分组到行（nowrap ⇒ 恰好一行，下面的每行计算与旧版逐字等价） ----
      const lines = [];
      for (const it of items) (lines[it.line] || (lines[it.line] = { items: [] })).items.push(it);
      const mainSizeOf = (it) => (isRow ? it.mw : it.mh);

      // ---- 每行各自分配主轴 grow ----
      // ⚠️ 不能用「全量 free」分配：那会把某一行的富余搬去撑大另一行的 item。
      for (const L of lines) {
        const used0 = L.items.reduce((s, it) => s + mainSizeOf(it), 0) + gapMain * Math.max(0, L.items.length - 1);
        const freeL = mainAvail - used0;
        if (!(freeL > 0.01)) continue;
        const growers = L.items.filter((it) => it.grow > 0);
        const sumG = growers.reduce((s, it) => s + it.grow, 0);
        if (!(sumG > 0)) continue;
        for (const it of growers) {
          const add = (freeL * it.grow) / sumG;
          if (isRow) it.mw += add; else it.mh += add;
        }
      }

      // ---- 行在交叉轴上的排布 ----
      const crossAvail = isRow ? (innerAvailH || 0) : innerW;   // nowrap 走旧值，与旧版一致
      for (const L of lines) L.cross = L.items.reduce((m, it) => Math.max(m, isRow ? it.mh : it.mw), 0);
      const totalCross = lines.reduce((s, L) => s + L.cross, 0) + gapCross * Math.max(0, lines.length - 1);
      let acCursor = 0, acExtra = 0;
      // ⚠️ align-content 只对**多行**容器生效（Chrome 对单行 flex 容器忽略它）⇒ 必须 gate 在 wraps 上，
      //    否则 nowrap 容器的既有布局会被凭空挪动。
      if (wraps) {
        const freeCross = crossAvail - totalCross;
        if (freeCross > 0.01) {
          if (alignContent === "center") acCursor = freeCross / 2;
          else if (alignContent === "flex-end" || alignContent === "end") acCursor = freeCross;
          else if (alignContent === "space-between" && lines.length > 1) acExtra = freeCross / (lines.length - 1);
          else if (alignContent === "space-around" && lines.length) { acExtra = freeCross / lines.length; acCursor = acExtra / 2; }
        }
      }

      // ---- 摆放 ----
      let li = -1, mainPos = 0, extraGap = 0, lineCrossOff = 0;
      for (const it of items) {
        if (it.line !== li) {                                   // 进入新的一行
          if (li >= 0) acCursor += lines[li].cross + gapCross + acExtra;
          li = it.line;
          const L = lines[li];
          const usedMainL = L.items.reduce((s, x) => s + mainSizeOf(x), 0) + gapMain * Math.max(0, L.items.length - 1);
          const slackL = mainAvail - usedMainL;
          mainPos = 0; extraGap = 0;
          if (justify === "center") mainPos = slackL / 2;
          else if (justify === "flex-end" || justify === "end") mainPos = slackL;
          else if (justify === "space-between" && L.items.length > 1) extraGap = slackL / (L.items.length - 1);
          else if (justify === "space-around" && L.items.length) { extraGap = slackL / L.items.length; mainPos = extraGap / 2; }
          else if (justify === "space-evenly" && L.items.length) { extraGap = slackL / (L.items.length + 1); mainPos = extraGap; }
          lineCrossOff = acCursor;
        }
        const itMain = mainSizeOf(it);
        const itCross = isRow ? it.mh : it.mw;
        const lineCrossSize = wraps ? lines[li].cross : crossAvail;
        let crossPos = lineCrossOff;
        if (alignItems === "center") crossPos += (lineCrossSize - itCross) / 2;
        else if (alignItems === "flex-end" || alignItems === "end") crossPos += lineCrossSize - itCross;
        if (!(crossPos >= 0)) crossPos = 0;

        if (it.kind === "text") {
          const tx = isRow ? innerX + mainPos : innerX + crossPos;
          const ty = isRow ? innerY + crossPos : innerY + mainPos;
          it.node.__box = { x: tx, y: ty, w: it.mw, h: it.mh };
          it.node.__lines = it.lines;
          it.node.__spec = it.spec;
          fmt.texts++;
        } else {
          const c = it.node;
          const bx = c.__box ? c.__box.x : 0;
          const by = c.__box ? c.__box.y : 0;
          let targetX, targetY;
          if (isRow) {
            targetX = innerX + mainPos + it.cm[3];
            targetY = innerY + crossPos + it.cm[0];
          } else {
            targetX = innerX + crossPos + it.cm[3];
            targetY = innerY + mainPos + it.cm[0];
          }
          translateSubtree(c, targetX - bx, targetY - by);
          // 交叉轴 stretch：宽/高补足
          if (alignItems === "stretch" && c.__box) {
            const cst = c.style || {};
            const cwv = resolveLen(cst.width, { ...ctxW, base: innerW });
            const chv = resolveLen(cst.height, ctxH);
            if (isRow) {
              if (!(cwv && cwv !== "auto")) c.__box.w = Math.max(0, it.mw - it.cm[1] - it.cm[3]);
            } else {
              if (!(chv && chv !== "auto")) c.__box.h = Math.max(0, it.mh - it.cm[0] - it.cm[2]);
            }
          }
        }

        const boxOf = it.kind === "text" ? it.node.__box : it.node.__box;
        if (isRow) {
          contentH = Math.max(contentH, (boxOf ? boxOf.h : it.mh) + (it.kind === "el" ? it.cm[0] + it.cm[2] : 0) + crossPos);
          contentW = Math.max(contentW, mainPos + itMain);
        } else {
          contentW = Math.max(contentW, (boxOf ? boxOf.w : it.mw) + (it.kind === "el" ? it.cm[1] + it.cm[3] : 0) + crossPos);
          contentH = Math.max(contentH, mainPos + itMain);
        }
        mainPos += itMain + gapMain + extraGap;
      }
    } else {
      // ---- block / inline 流 ----
      let curY = innerY;
      let lineX = innerX, lineY = innerY, lineH = 0, inlineRun = false;
      const flush = () => { if (inlineRun) { curY = Math.max(curY, lineY + lineH); lineX = innerX; lineH = 0; inlineRun = false; } };

      for (const c of flow) {
        if (c.type === "text") {
          const t = c.text;
          if (!t.trim()) continue;
          const sp = fontSpec(st, ctxW);
          const r = wrapText(t, nowrap ? 0 : Math.max(0, innerW - (lineX - innerX)), sp, measure);
          const isBlockText = st["text-align"] || r.lines.length > 1;
          if (isBlockText) {
            flush();
            let tx = innerX;
            const align = st["text-align"] || "left";
            const lineW = r.width;
            if (align === "center") tx = innerX + (innerW - lineW) / 2;
            else if (align === "right" || align === "end") tx = innerX + innerW - lineW;
            c.__box = { x: tx, y: curY, w: Math.max(r.width, 0), h: r.height };
            c.__lines = r.lines; c.__spec = sp; c.__align = align; c.__innerW = innerW; c.__innerX = innerX;
            curY += r.height;
            contentH = Math.max(contentH, curY - innerY);
            /* 🔴 contentW 必须一起更新（这里曾漏掉 ⇒ 静默塌宽）
               为什么关键：本函数末尾的 shrink-to-fit 回填是 `w = min(availW, contentW)`
               ⇒ 只要 contentW 是 0，**元素宽度直接变 0**（不是「变窄」而是「消失」）。
               触发条件是「该元素的文本折成多行」（`r.lines.length > 1`）或带 text-align。
               实测症状：`.skill-current .skill-info` 的 `span.skill-output`（"经验奖励：10 / 次"）
               在真机与探针里都宽 0 ⇒ 整行文字看不见；且它 0 宽 ⇒ 不参与 flex 换行累加
               ⇒ 同一行的兄弟元素也跟着换行位置错。
               （合成单测复现：把文本度量放大 1.4 倍让它折行 → box=[x,0,0,h]） */
            contentW = Math.max(contentW, (tx - innerX) + Math.max(r.width, 0));
          } else {
            c.__box = { x: lineX, y: lineY, w: r.width, h: r.height };
            c.__lines = r.lines; c.__spec = sp;
            lineX += r.width;
            lineH = Math.max(lineH, r.height);
            inlineRun = true;
            contentW = Math.max(contentW, lineX - innerX);
          }
          fmt.texts++;
          continue;
        }
        const cd = displayOf(c);
        if (cd === "inline" || cd === "inline-block" || cd === "inline-flex") {
          if (!inlineRun) { lineY = curY; lineX = innerX; inlineRun = true; }
          const cst = c.style || {};
          const cm = boxSides(c, cst, "margin", ctxW, 0);
          const safeW = Math.max(0, innerW - (lineX - innerX) - cm[1] - cm[3]);
          const r = layoutNode(c, lineX + cm[3], lineY + cm[0], safeW, innerAvailH, fs, myCb, true);
          lineX += r.w + cm[1] + cm[3];
          lineH = Math.max(lineH, r.h + cm[0] + cm[2]);
          contentW = Math.max(contentW, lineX - innerX);
          continue;
        }
        // block
        flush();
        const cst = c.style || {};
        const cmAuto = boxAutos(c, cst, "margin");
        const cm = boxSides(c, cst, "margin", ctxW, 0);
        const cwv = resolveLen(cst.width, { ...ctxW, base: innerW });
        let aw = cwv && cwv !== "auto" ? num(cwv) : Math.max(0, innerW - cm[1] - cm[3]);
        let cx = innerX + cm[3];
        if (cmAuto[1] === "auto" && cmAuto[3] === "auto") cx = innerX + (innerW - aw) / 2;
        // block 流同样传「父的确定高度」（null ⇒ 子元素 height:100% 退化为 auto，符合规范）
        layoutNode(c, cx, curY + cm[0], aw,
          innerAvailH == null ? null : Math.max(0, innerAvailH - (curY - innerY)), fs, myCb, false);
        const bh = c.__box ? c.__box.h : 0;
        curY += bh + cm[0] + cm[2];
        contentH = Math.max(contentH, curY - innerY);
        contentW = Math.max(contentW, aw + cm[1] + cm[3]);
      }
      flush();
      contentH = Math.max(contentH, curY - innerY); // ⚠️ 必须补：inline 行的最后一行高度靠 flush 才落到 curY
    }

    // ---- 定位子元素（脱离流） ----
    for (const c of positioned) {
      const cst = c.style || {};
      const isFixed = cst.position === "fixed";
      const cont = isFixed ? viewport : (myCb || viewport);
      const cctxW = { ...ctxW, base: cont.w };
      const cctxH = { ...ctxH, base: cont.h };
      const left = resolveLen(cst.left, cctxW);
      const right = resolveLen(cst.right, cctxW);
      const top = resolveLen(cst.top, cctxH);
      const bottom = resolveLen(cst.bottom, cctxH);
      const cwv = resolveLen(cst.width, cctxW);
      const chv = resolveLen(cst.height, cctxH);

      let cw;
      if (cwv && cwv !== "auto") cw = num(cwv);
      else if (left != null && left !== "auto" && right != null && right !== "auto") cw = Math.max(0, cont.w - num(left) - num(right));
      else cw = Math.max(0, cont.w - (left != null && left !== "auto" ? num(left) : 0) - (right != null && right !== "auto" ? num(right) : 0));

      let cx = isFixed ? 0 : cont.x;
      if (left != null && left !== "auto") cx += num(left);
      else if (right != null && right !== "auto") cx += cont.w - num(right) - cw;

      let cy = isFixed ? 0 : cont.y;
      if (top != null && top !== "auto") cy += num(top);
      else if (bottom != null && bottom !== "auto" && chv && chv !== "auto") cy += cont.h - num(bottom) - num(chv);

      // top + bottom 同时给出 ⇒ 高度由包含块高度减去两者（main-container 就靠这条）
      let ch = null;
      if (chv && chv !== "auto") ch = num(chv);
      else if (top != null && top !== "auto" && bottom != null && bottom !== "auto") ch = Math.max(0, cont.h - num(top) - num(bottom));
      if (ch != null) c.__forcedH = ch; // 让该元素内部的 height:100% 有确定基准
      layoutNode(c, cx, cy, cw, ch, fs, viewport, false);
      /* 🔴 `ch === 0` 是死代码：height:auto 时 `ch` 是 `null`（见 line 757 `let ch = null`），
       *    永不 === 0 ⇒ height:auto 的元素即使给了 bottom 也永远按 top:auto 处理 ⇒
       *    `#tutorial-widget{position:fixed;bottom:calc(...)}` 被顶到 y=0 盖住主界面。
       *    这里本意是「height 未显式给定时，按 bottom 反推 y」。改为 `ch == null`。
       * ⚠️ 反推必须**连后代一起挪**：后代的盒是按「父在 cy（=旧 y）」布的局，只改父盒 y
       *    会让后代替换到父盒之外、被父级裁剪剪光 ⇒ 空壳深色块（见 shiftSubtreeY 注释）。 */
      if (bottom != null && bottom !== "auto" && !(top != null && top !== "auto") && c.__box && ch == null) {
        const wantY = (isFixed ? 0 : cont.y) + cont.h - num(bottom) - c.__box.h;
        shiftSubtreeY(c, wantY - c.__box.y);
      }
      fmt.positioned++;
    }

    // ---- 高度收口 ----
    let h;
    if (hFixed != null) h = hFixed;
    else h = contentH + pad[0] + pad[2] + bdw[0] + bdw[2];
    if (minH != null && minH !== "auto") h = Math.max(h, num(minH));
    if (maxH != null && maxH !== "auto") h = Math.min(h, num(maxH));

    // ---- shrink-to-fit 回填宽度 ----
    if (shrinkW && (wv === "auto" || wv === null)) {
      const fit = contentW + pad[1] + pad[3] + bdw[1] + bdw[3];
      const capped = Math.min(w, Math.max(fit, 0));
      if (capped !== w) { w = capped; }
    }
    if (!(h >= 0)) h = 0;

    el.__box = { x, y, w, h, display: disp };
    /* ---------- 滚动度量：供 paint/hitTest 卷动后代 ----------
     * canvas 无原生滚动；这里算出「内容自然高度」与「可视内高」，触摸管线据 scrollTop
     * 卷动、paint 据 scrollTop 平移、hitTest 据 scrollTop 反推坐标。
     * 仅对 overflow 为 auto/scroll/hidden 的容器生效（overflow:visible 不需卷动）。 */
    var _ov = st["overflow-y"] || st.overflow || st["overflow-x"] || "";
    if (/auto|scroll|hidden/.test(String(_ov))) {
      el.__clientH = Math.max(0, h - bdw[0] - bdw[2]);
      el.__clientW = Math.max(0, w - bdw[1] - bdw[3]);
      el.__scrollH = Math.max(h, contentH + pad[0] + pad[2] + bdw[0] + bdw[2]);
      el.__scrollW = Math.max(w, contentW + pad[1] + pad[3] + bdw[1] + bdw[3]);
      /* 同步当前卷动位置：el.scrollTop/scrollLeft 由 toKernel 每帧从 shim 真值写入
       * （游戏自设 scrollTop / 触摸拖拽都走这条），这里钳制到 [0,maxY]/[0,maxX] 并落到
       * __scrollTop/__scrollLeft，使 paint 平移与 hitTest 坐标反推始终读一致来源——
       * 否则非触摸路径（游戏自己改 scrollTop）的改动不会反映在画面上。 */
      var _maxY = Math.max(0, el.__scrollH - el.__clientH);
      var _maxX = Math.max(0, el.__scrollW - el.__clientW);
      el.__scrollTop = Math.max(0, Math.min(Number(el.scrollTop) || 0, _maxY));
      el.__scrollLeft = Math.max(0, Math.min(Number(el.scrollLeft) || 0, _maxX));
    }
    fmt.count++;
    return { w, h };
  }

  layoutNode(bodyEl, 0, 0, env.width, env.height, opts.baseFontSize || 14, viewport, false);
  const htmlEl = root.children.find((c) => c.type === "element" && c.tag === "html");
  if (htmlEl) htmlEl.__box = { x: 0, y: 0, w: env.width, h: env.height, display: "block" };
  applyTransforms(bodyEl);
  return fmt;
}

/* ---------- transform: translate（抽屉侧栏靠它移出屏幕） ---------- */
function applyTransforms(node) {
  for (const c of node.children) {
    if (c.type !== "element") continue;
    const st = c.style || {};
    const tf = st.transform || st["-webkit-transform"];
    if (tf && /translate/.test(tf) && c.__box) {
      let dx = 0, dy = 0;
      const r = c.__box;
      const m2 = /translate\(\s*(-?[\d.]+)(px|%)(?:\s*,\s*(-?[\d.]+)(px|%))?\s*\)/g;
      let mm;
      while ((mm = m2.exec(tf))) {
        dx += mm[2] === "%" ? (parseFloat(mm[1]) * r.w) / 100 : parseFloat(mm[1]);
        if (mm[3] !== undefined) dy += mm[4] === "%" ? (parseFloat(mm[3]) * r.h) / 100 : parseFloat(mm[3]);
      }
      const mx = /translateX\(\s*(-?[\d.]+)(px|%)\s*\)/.exec(tf);
      if (mx) dx += mx[2] === "%" ? (parseFloat(mx[1]) * r.w) / 100 : parseFloat(mx[1]);
      const my = /translateY\(\s*(-?[\d.]+)(px|%)\s*\)/.exec(tf);
      if (my) dy += my[2] === "%" ? (parseFloat(my[1]) * r.h) / 100 : parseFloat(my[1]);
      translateSubtree(c, dx, dy);
    }
    applyTransforms(c);
  }
}

/* ---------- 文本折行 ---------- */
function wrapText(text, maxW, spec, measure) {
  const raw = String(text);
  if (!raw.trim()) return { lines: [], width: 0, height: 0 };
  // line-height 优先于 1.35 近似值；letter-spacing 逐字叠加（canvas 未必实现 ctx.letterSpacing）
  const lineH = spec.lineHeight || spec.size * 1.35;
  const ls = spec.letterSpacing || 0;
  const tw = (t) => {
    const w = measure(t, spec).width;
    return ls ? w + ls * t.length : w;
  };
  if (!(maxW > 0)) {
    const w = tw(raw.trim());
    return { lines: [raw.trim()], width: w, height: lineH };
  }
  const tokens = [];
  let buf = "";
  for (const ch of raw) {
    if (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch)) {
      if (buf) { tokens.push(buf); buf = ""; }
      tokens.push(ch);
    } else if (/\s/.test(ch)) {
      if (buf) { tokens.push(buf); buf = ""; }
      tokens.push(" ");
    } else buf += ch;
  }
  if (buf) tokens.push(buf);

  const lines = [];
  let cur = "";
  for (const t of tokens) {
    const test = cur + t;
    const w = tw(test);
    if (w > maxW && cur.trim()) { lines.push(cur.replace(/\s+$/, "")); cur = t === " " ? "" : t; }
    else cur = test;
  }
  if (cur.trim() || !lines.length) lines.push(cur.replace(/\s+$/, ""));
  let maxLineW = 0;
  for (const l of lines) maxLineW = Math.max(maxLineW, tw(l));
  return { lines, width: Math.min(maxLineW, maxW), height: lines.length * lineH };
}

/* ==================== paint.mjs ==================== */
/* ============================================================================
 * paint.mjs —— 极简绘制层（原型）
 *
 * 把布局结果画到任意 Canvas2D 上下文。**只使用标准 Canvas 2D API**，
 * 所以同一份代码在 @napi-rs/canvas（本地验证）与 wx.createCanvas()（微信）上都能跑。
 * ==========================================================================*/

/* ---------- 颜色 ---------- */
const NAMED = {
  transparent: [0, 0, 0, 0], black: [0, 0, 0, 1], white: [255, 255, 255, 1],
  red: [255, 0, 0, 1], green: [0, 128, 0, 1], blue: [0, 0, 255, 1],
  gray: [128, 128, 128, 1], grey: [128, 128, 128, 1], silver: [192, 192, 192, 1],
  orange: [255, 165, 0, 1], yellow: [255, 255, 0, 1], purple: [128, 0, 128, 1],
  teal: [0, 128, 128, 1], navy: [0, 0, 128, 1], gold: [255, 215, 0, 1],
  cyan: [0, 255, 255, 1], magenta: [255, 0, 255, 1], lime: [0, 255, 0, 1],
  brown: [165, 42, 42, 1], pink: [255, 192, 203, 1], crimson: [220, 20, 60, 1],
  darkgray: [169, 169, 169, 1], dimgray: [105, 105, 105, 1], lightgray: [211, 211, 211, 1],
};

function parseColor(v, current) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s === "currentColor") return current || [255, 255, 255, 1];
  if (s === "inherit") return null;
  if (s[0] === "#") {
    const h = s.slice(1);
    if (h.length === 3) return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16), 1];
    if (h.length === 4) return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16), parseInt(h[3] + h[3], 16) / 255];
    if (h.length === 6) return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
    if (h.length === 8) return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), parseInt(h.slice(6, 8), 16) / 255];
    return null;
  }
  let m = /^rgba?\(([^)]+)\)$/.exec(s);
  if (m) {
    const p = m[1].split(/[,/\s]+/).filter(Boolean);
    const chan = (x) => (String(x).endsWith("%") ? Math.round(parseFloat(x) * 2.55) : parseFloat(x));
    const a = p[3] === undefined ? 1 : (String(p[3]).endsWith("%") ? parseFloat(p[3]) / 100 : parseFloat(p[3]));
    return [chan(p[0]) || 0, chan(p[1]) || 0, chan(p[2]) || 0, Number.isFinite(a) ? a : 1];
  }
  m = /^hsla?\(([^)]+)\)$/.exec(s);
  if (m) {
    const p = m[1].split(/[,/\s]+/).filter(Boolean);
    const h = ((parseFloat(p[0]) % 360) + 360) % 360;
    const sat = parseFloat(p[1]) / 100, li = parseFloat(p[2]) / 100;
    const a = p[3] === undefined ? 1 : parseFloat(p[3]);
    const c = (1 - Math.abs(2 * li - 1)) * sat;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const mm = li - c / 2;
    let rgb = [0, 0, 0];
    if (h < 60) rgb = [c, x, 0]; else if (h < 120) rgb = [x, c, 0]; else if (h < 180) rgb = [0, c, x];
    else if (h < 240) rgb = [0, x, c]; else if (h < 300) rgb = [x, 0, c]; else rgb = [c, 0, x];
    return [Math.round((rgb[0] + mm) * 255), Math.round((rgb[1] + mm) * 255), Math.round((rgb[2] + mm) * 255), a];
  }
  const n = NAMED[s.toLowerCase()];
  return n ? n.slice() : null;
}

const css = (c) => (c ? "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + (c[3] == null ? 1 : c[3]) + ")" : "transparent");

/* ---------- 渐变 ---------- */
const DIRS = {
  "to bottom": 180, "to top": 0, "to right": 90, "to left": 270,
  "to bottom right": 135, "to top right": 45, "to bottom left": 225, "to top left": 315,
};

function parseGradientFn(g) {
  // 返回 { kind:'linear'|'radial', angle|shape, stops:[{color, pos}] }
  const inside = /^(linear|radial)-gradient\(([\s\S]*)\)$/.exec(g.trim());
  if (!inside) return null;
  const kind = inside[1];
  const args = splitTop(inside[2], ",");
  if (!args.length) return null;
  let angle = 180, rest = args;
  if (kind === "linear") {
    const first = args[0].trim();
    if (/deg$/.test(first)) { angle = parseFloat(first); rest = args.slice(1); }
    else if (DIRS[first.toLowerCase()] !== undefined) { angle = DIRS[first.toLowerCase()]; rest = args.slice(1); }
  } else {
    if (/^(circle|ellipse|closest|farthest|at\s)/i.test(args[0].trim())) rest = args.slice(1);
  }
  const stops = [];
  rest.forEach((a, i) => {
    const t = a.trim();
    const m = /^(.*?)\s+(-?[\d.]+)(%|px)?$/.exec(t);
    let colorStr = t, pos = null;
    if (m) { colorStr = m[1].trim(); pos = m[2] !== undefined ? parseFloat(m[2]) : null; }
    const c = parseColor(colorStr);
    if (!c) return;
    stops.push({ color: c, pos: pos == null ? null : (pos > 1 ? pos / 100 : pos) });
  });
  if (!stops.length) return null;
  // 补默认位置
  if (stops[0].pos == null) stops[0].pos = 0;
  if (stops[stops.length - 1].pos == null) stops[stops.length - 1].pos = 1;
  for (let i = 1; i < stops.length - 1; i++) if (stops[i].pos == null) stops[i].pos = i / (stops.length - 1);
  return { kind, angle, stops };
}

function splitTop(s, sep) {
  const out = []; let d = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") d++;
    else if (ch === ")") d--;
    if (ch === sep && d === 0) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.filter((x) => x.trim() !== "");
}

function makeGradient(ctx, spec, box) {
  if (!spec) return null;
  if (spec.kind === "linear") {
    const rad = ((spec.angle - 90) * Math.PI) / 180;
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    const len = Math.abs(box.w * Math.cos(rad)) + Math.abs(box.h * Math.sin(rad));
    const dx = (Math.cos(rad) * len) / 2, dy = (Math.sin(rad) * len) / 2;
    const g = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
    for (const s of spec.stops) g.addColorStop(Math.max(0, Math.min(1, s.pos)), css(s.color));
    return g;
  }
  const g = ctx.createRadialGradient(box.x + box.w / 2, box.y + box.h / 2, 0, box.x + box.w / 2, box.y + box.h / 2, Math.max(box.w, box.h) / 2);
  for (const s of spec.stops) g.addColorStop(Math.max(0, Math.min(1, s.pos)), css(s.color));
  return g;
}

/* ---------- 圆角矩形路径 ---------- */
function roundRect(ctx, x, y, w, h, r) {
  if (w <= 0 || h <= 0) return false;
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  if (rr <= 0.01) { ctx.rect(x, y, w, h); return true; }
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y); ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr); ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h); ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr); ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
  return true;
}

function radiusOf(st) {
  const r = st["border-radius"];
  if (!r) return 0;
  const first = String(r).trim().split(/[\s/]+/)[0];
  const n = parseFloat(first);
  return Number.isFinite(n) ? n : 0;
}

/* ---------- 主绘制 ---------- */
const SKIP_FONTS = /fa[srlb]?-|fas\b|far\b|fab\b/; // Font Awesome 图标字体本机没有，跳过

function paintTree(root, ctx, env, opts = {}) {
  const stats = { rects: 0, texts: 0, clipped: 0, gradients: 0 };
  const inheritColor = [230, 236, 245, 1];

  function paint(node, color, clips) {
    for (const c of node.children) {
      if (c.type === "element") paintEl(c, color, clips);
      else if (c.type === "text") { /* 文本在父元素内统一处理 */ }
    }
  }

  function paintEl(el, parentColor, clips) {
    const box = el.__box;
    if (!box || box.display === "none" || box.w <= 0 || box.h <= 0) {
      // 仍要递归（子元素可能 absolute 到别处）
      if (box && box.display !== "none") paintChildren(el, parentColor, clips);
      else if (!box) paintChildren(el, parentColor, clips);
      return;
    }
    const st = el.style || {};
    const cur = parseColor(st.color, parentColor) || parentColor;

    // 裁剪
    let myClips = clips;
    const ov = st.overflow || st["overflow-x"] || "";
    if (/hidden|clip|auto|scroll/.test(String(ov))) {
      ctx.save();
      roundRect(ctx, box.x, box.y, box.w, box.h, radiusOf(st));
      ctx.clip();
      stats.clipped++;
      myClips = clips + 1;
      // 卷动容器：内容按 -scroll 平移（子盒是内容坐标、未卷动；仅可视区被裁剪）
      var _so = el.__scrollTop || 0, _slo = el.__scrollLeft || 0;
      if (_so || _slo) {
        var _sh = el.__scrollH || 0, _ch = el.__clientH || box.h;
        var _maxY = Math.max(0, _sh - _ch);
        var _oy = Math.max(0, Math.min(_so, _maxY));
        ctx.translate(-(_slo || 0), -_oy);
      }
    }

    // 背景
    const bgVal = st.background || st["background-image"] || "";
    const grad = /gradient\(/.test(String(bgVal)) ? parseGradientFn(String(bgVal).match(/(?:linear|radial)-gradient\([\s\S]*\)/)[0]) : null;
    let bgColor = parseColor(st["background-color"]) || null;
    if (!bgColor && bgVal && !/gradient\(/.test(String(bgVal))) {
      // background: #123 / rgba(...) / url(...) 0 0 no-repeat —— 取其中的颜色
      const cm = String(bgVal).match(/(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))/);
      if (cm) bgColor = parseColor(cm[1]);
      const named = String(bgVal).trim().split(/\s+/).find((t) => NAMED[t.toLowerCase()]);
      if (!bgColor && named) bgColor = parseColor(named);
    }
    const radius = radiusOf(st);
    if (box.w > 0 && box.h > 0) {
      if (grad) {
        const g = makeGradient(ctx, grad, box);
        if (g) { ctx.fillStyle = g; roundRect(ctx, box.x, box.y, box.w, box.h, radius); ctx.fill(); stats.gradients++; }
        else if (bgColor) { ctx.fillStyle = css(bgColor); roundRect(ctx, box.x, box.y, box.w, box.h, radius); ctx.fill(); }
      } else if (bgColor && bgColor[3] > 0) {
        ctx.fillStyle = css(bgColor);
        roundRect(ctx, box.x, box.y, box.w, box.h, radius);
        ctx.fill();
      }
      if (!grad || !grad) { /* noop */ }
      if (bgColor || grad) stats.rects++;
    }

    // 边框（4 边，按各边宽度画）
    const bd = st.border;
    const bdColor = parseColor(st["border-color"] || (bd && /(#[0-9a-fA-F]{3,8}|rgba?\()/.test(bd) ? bd.match(/(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))/)[1] : null));
    if (bdColor && radius > 0) {
      const wpx = parseFloat((/([\d.]+)px/.exec(bd || st["border-width"] || "") || [0, 0])[1]) || 0;
      if (wpx > 0) {
        ctx.strokeStyle = css(bdColor);
        ctx.lineWidth = wpx;
        roundRect(ctx, box.x + wpx / 2, box.y + wpx / 2, box.w - wpx, box.h - wpx, Math.max(0, radius - wpx / 2));
        ctx.stroke();
      }
    }

    paintChildren(el, cur, myClips);

    if (myClips !== clips) ctx.restore();
  }

  function paintChildren(el, cur, clips) {
    for (const c of stackOrder(el.children)) {
      if (c.type === "text") {
        const b = c.__box;
        if (!b || !c.__lines || !c.__lines.length) continue;
        const spec = c.__spec || { spec: "14px sans-serif", size: 14 };
        ctx.font = spec.spec;
        ctx.fillStyle = css(cur);
        ctx.textBaseline = "alphabetic";
        const lineH = spec.size * 1.35;
        c.__lines.forEach((ln, i) => {
          if (!ln) return;
          ctx.fillText(ln, b.x, b.y + lineH * i + spec.size * 0.94);
          stats.texts++;
        });
      } else if (c.type === "element") {
        // Font Awesome 图标：本机无字体，跳过绘制避免乱码
        if ((c.classes || []).some((k) => SKIP_FONTS.test(k))) {
          // 画一个小方点占位，便于肉眼确认"这里有图标"
          const b = c.__box;
          if (b && b.w > 0 && b.h > 0) { /* 不画，保持干净 */ }
          continue;
        }
        paintEl(c, cur, clips);
      }
    }
  }

  paintEl(root.children.find((c) => c.type === "element" && c.tag === "body") || root, inheritColor, 0);
  return stats;
}

/* ---------- 叠放顺序（z-index）——绘制与命中的**唯一权威** ----------
 * 🔴 为什么必须有：css/taptap-portrait.css 大量用 z-index 表达「谁盖住谁」
 *    （抽屉 1400 > 遮罩 1300 > 底部栏 1100 > 内容区；顶栏 1500 最高）。
 *    不排序就会退化成纯 DOM 顺序，实测后果是**抽屉打开时整条左侧导航点不到**：
 *    绘制时 .content（DOM 靠后）盖住了抽屉，命中测试（dom-render.js 的 hitWalk，
 *    同样按 DOM 顺序判定「后面的兄弟覆盖前面的」）也把命中判给了 .content。
 *    因为 .content 背景多为透明，肉眼看画面「没错」⇒ 这类缺陷截图是看不出来的，
 *    只有「命中节点 ≠ 想点的节点」才暴露。
 *
 * 简化模型（与本项目实际用法一致，且与浏览器层叠规则同序）：
 *   ① 非定位元素 / 文本节点 → 层 0
 *   ② 定位且 z-index < 0      → 层 -1
 *   ③ 定位且 z-index auto/0   → 层 1
 *   ④ 定位且 z-index > 0      → 层 2
 *   同层内**保持 DOM 顺序**（稳定排序，用原索引兜底比较）。
 * ⚠️ 真实 CSS 还有层叠上下文（父 z-index 非 auto 会把子元素锁在父层内）。
 *    这里不建上下文：本项目没有嵌套 z-index 竞争，先按扁平模型走；
 *    若将来出现「子元素 z-index 再大也盖不住兄弟」，就是撞上了这一条。 */
function stackOrder(children) {
  const key = (c) => {
    if (c.type !== "element") return [0, 0];
    const st = c.style || {};
    const pos = st.position;
    if (!pos || pos === "static") return [0, 0];
    let z = parseInt(st["z-index"] != null ? st["z-index"] : st.zIndex, 10);
    if (isNaN(z)) z = 0;
    if (z < 0) return [-1, z];
    if (z === 0) return [1, 0];
    return [2, z];
  };
  return children
    .map((c, i) => ({ c, k: key(c), i }))
    .sort((a, b) => (a.k[0] - b.k[0]) || (a.k[1] - b.k[1]) || (a.i - b.i))
    .map((x) => x.c);
}

/** 统计元素/文本数量（用于对照） */
function countBoxes(root) {
  let els = 0, withBox = 0, texts = 0;
  (function walk(n) {
    for (const c of n.children) {
      if (c.type === "element") { els++; if (c.__box) withBox++; walk(c); }
      else if (c.__box) texts++;
    }
  })(root);
  return { els, withBox, texts };
}

var __WX_DOM_KERNEL__ = {
  stripComments: stripComments,
  parseDeclarations: parseDeclarations,
  parseSelector: parseSelector,
  matchesSelector: matchesSelector,
  evalMedia: evalMedia,
  parseStylesheet: parseStylesheet,
  buildRuleIndex: buildRuleIndex,
  computeStyles: computeStyles,
  applyInlineAndUAStyles: applyInlineAndUAStyles,
  resolveVars: resolveVars,
  resolveVarsInTree: resolveVarsInTree,
  parseSides: parseSides,
  resolveLen: resolveLen,
  sides: sides,
  layoutTree: layoutTree,
  parseColor: parseColor,
  paintTree: paintTree,
  stackOrder: stackOrder,
  countBoxes: countBoxes,
};

try { if (typeof GameGlobal !== "undefined" && GameGlobal) GameGlobal.__WX_DOM_KERNEL__ = __WX_DOM_KERNEL__; } catch (e0) {}
try { if (typeof globalThis !== "undefined" && globalThis) globalThis.__WX_DOM_KERNEL__ = __WX_DOM_KERNEL__; } catch (e1) {}
try { if (typeof module !== "undefined" && module && module.exports) module.exports = __WX_DOM_KERNEL__; } catch (e2) {}
})();
