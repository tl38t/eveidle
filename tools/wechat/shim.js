/**
 * 微信小游戏 DOM shim（P4 探针版 → T2 迷你 DOM 内核）
 *
 * 依据 P1 探针实测结论（docs/WECHAT_PROBE_P1_LOGIC_SMOKE_v0.1.md）：
 *   逻辑层裸 document. 仅 5 个文件 / 149 处，全在函数体内，加载期不触发；
 *   唯二「加载期硬失败」= translator.js:23 的 URLSearchParams(window.location.search)
 *                        + persistence.js 顶层 document.addEventListener("visibilitychange")。
 *
 * 本文件在 S1 会替换为正式平台层；当前目标是「让整包能加载不抛错」。
 * ⛔ 禁止在此文件里实现任何游戏逻辑。
 *
 * ---------------------------------------------------------------------------
 * 2026-09-15：从「极简桩」升级为「迷你 DOM 内核」。
 * 起因（实测，不是推测）：派发事件后 299 个桩里有 10 个处理器抛错，根因不在游戏而在本文件：
 *   ① `box.querySelector(".dlg-cancel")` 恒返 null —— 弹窗把「确认/取消」写在 innerHTML 里，
 *      再靠元素级 querySelector 接线。返 null ⇒ 弹窗能显示但**点不动**（比抛错更坏）。
 *   ② 桩元素没有 `select()` / `files` —— 5 处 `input.select()`、1 处 `e.target.files[0]` 直接抛。
 * 而全仓实测的 DOM 依赖面（静态枚举，非抽样）：
 *   querySelector 180 · closest 138 · querySelectorAll 62 · matches 4
 *   innerHTML 赋值 241 · insertAdjacentHTML 2 · textContent 赋值 468 / 读 22
 *   classList 增删 110 · classList.contains 9 · dataset 读 208（写 0）
 *   children 读 41 · el.contains() 2
 * ⇒ 光「返个丢弃桩让异常归零」是**假绿**（按钮变死）。所以这里实现真节点树 + 真选择器匹配。
 * ⚠️ 已知边界：`getElementById` 命中的是 index.html 提供的元素，在 index.html 被解析进来之前
 *    只能给**无属性/无类**的空桩 ⇒ 依赖 `data-*` / 类的**事件委派**仍不会命中。
 *    这一层（把 index.html 喂给 shim）是下一步，不在本次范围内。
 * ---------------------------------------------------------------------------
 */
(function () {
  var G = typeof globalThis !== "undefined" ? globalThis : this;
  if (G.__WX_SHIM_INSTALLED__) return;
  G.__WX_SHIM_INSTALLED__ = true;

  // ---------- window / globalThis 互指 ----------
  if (typeof G.window === "undefined") G.window = G;
  if (typeof window !== "undefined" && !window.globalThis) window.globalThis = G;

  // ---------- 事件存储 ----------
  // node -> { [type]: [ {f, once}, … ] }
  var listeners = new WeakMap();
  var listenerErrors = 0;                        // 供探针读取；生产环境恒 0 也无害
  /* 宿主自报数据。为什么必须有：微信小游戏**没有 console 回传**，
   * 「按键点不动」这类假绿只能靠宿主自己把计数写出来给外部读。
   * 只增不减的计数器，不读用户数据、不影响行为。 */
  var STATS = { elements: 0, listeners: 0, byType: Object.create(null), errors: 0 };
  try { G.__WX_SHIM_STATS__ = STATS; } catch (e) {}
  try { G.__WX_SHIM_LISTENER_ERRORS__ = 0; } catch (e) {}

  function evMap(node) {
    var m = listeners.get(node);
    if (!m) { m = Object.create(null); listeners.set(node, m); }
    return m;
  }
  function addListener(node, t, fn, opts) {
    if (typeof fn !== "function") return;
    var m = evMap(node);
    (m[t] = m[t] || []).push({ f: fn, once: !!(opts && opts.once) });
    STATS.listeners++;
    STATS.byType[t] = (STATS.byType[t] || 0) + 1;
  }
  function removeListener(node, t, fn) {
    var m = listeners.get(node);
    if (!m || !m[t]) return;
    m[t] = m[t].filter(function (r) { return r.f !== fn; });
  }

  /* =====================================================================
   * 1. 选择器引擎
   *    支持（= 实测出现过的全部形状，未支持的**显式抛错**而不是静默返 null）：
   *      tag · * · #id · .class · 复合（.a.b / tag.a） ·
   *      [attr] · [attr=v] · [attr^=v] [attr$=v] [attr*=v] [attr~=v] [attr|=v] ·
   *      后代（空格） · 子（>） · 相邻兄弟（+） · 通用兄弟（~） ·
   *      逗号并集（,） · :not(单复合) · :scope
   *    ⚠️ 静默返 null 是本项目踩过的「假阴性制造机」：宁可抛错让门禁拦下，也不要装成功。
   * ===================================================================== */
  function selErr(sel, why) {
    var e = new Error("[shim] 选择器不支持 " + JSON.stringify(sel) + "：" + why);
    e.__selUnsupported = true;
    return e;
  }

  /** 按 sep 切分，忽略 [] () 内部的 sep（逗号并集用） */
  function splitTop(s, sep) {
    var out = [], depth = 0, cur = "";
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === "[" || c === "(") depth++;
      else if (c === "]" || c === ")") depth--;
      if (c === sep && depth === 0) { out.push(cur); cur = ""; continue; }
      cur += c;
    }
    out.push(cur);
    return out;
  }

  /** s[i] 为 '['，返回配对的 ']' 下标（跳过引号内的 ]）；失败返 -1 */
  function matchBracket(s, i) {
    var depth = 0, q = "";
    for (var k = i; k < s.length; k++) {
      var c = s.charAt(k);
      if (q) { if (c === "\\") { k++; continue; } if (c === q) q = ""; continue; }
      if (c === '"' || c === "'") { q = c; continue; }
      if (c === "[") depth++;
      else if (c === "]") { depth--; if (!depth) return k; }
    }
    return -1;
  }
  /** s[i] 为 '('，返回配对的 ')' 下标；失败返 -1 */
  function matchParen(s, i) {
    var depth = 0, q = "";
    for (var k = i; k < s.length; k++) {
      var c = s.charAt(k);
      if (q) { if (c === "\\") { k++; continue; } if (c === q) q = ""; continue; }
      if (c === '"' || c === "'") { q = c; continue; }
      if (c === "(") depth++;
      else if (c === ")") { depth--; if (!depth) return k; }
    }
    return -1;
  }

  var WORD_RE = /[-\w]/;
  var WORD_START_RE = /[A-Za-z]/;

  function parseAttrBody(body, sel) {
    body = String(body).replace(/^\s+|\s+$/g, "");
    if (!body) throw selErr(sel, "空属性");
    var m = /^([^\s~|^$*=\]]+)\s*([~|^$*]?=)\s*([\s\S]*)$/.exec(body);
    if (!m) return { name: body.toLowerCase(), op: null, val: null };
    var val = String(m[3]).replace(/^\s+|\s+$/g, "");
    if (val.length >= 2) {
      var a = val.charAt(0), b = val.charAt(val.length - 1);
      if ((a === '"' && b === '"') || (a === "'" && b === "'")) val = val.slice(1, -1);
    }
    return { name: String(m[1]).toLowerCase(), op: m[2], val: val };
  }

  /** 解析单个「复合选择器」（不含组合符） */
  function parseCompound(s, sel) {
    var comp = { tag: null, id: null, cls: [], attrs: [], nots: [], scope: false };
    var i = 0;
    if (s.charAt(0) === "*") { i = 1; }
    else if (WORD_START_RE.test(s.charAt(0))) {
      var j0 = i;
      while (j0 < s.length && WORD_RE.test(s.charAt(j0))) j0++;
      comp.tag = s.slice(i, j0).toUpperCase();
      i = j0;
    }
    while (i < s.length) {
      var c = s.charAt(i);
      if (c === "#") {
        var j1 = i + 1;
        while (j1 < s.length && WORD_RE.test(s.charAt(j1))) j1++;
        if (j1 === i + 1) throw selErr(sel, "# 后缺 id");
        comp.id = s.slice(i + 1, j1); i = j1;
      } else if (c === ".") {
        var j2 = i + 1;
        while (j2 < s.length && WORD_RE.test(s.charAt(j2))) j2++;
        if (j2 === i + 1) throw selErr(sel, ". 后缺类名");
        comp.cls.push(s.slice(i + 1, j2)); i = j2;
      } else if (c === "[") {
        var be = matchBracket(s, i);
        if (be < 0) throw selErr(sel, "[ 不配对");
        comp.attrs.push(parseAttrBody(s.slice(i + 1, be), sel));
        i = be + 1;
      } else if (c === ":") {
        var rest = s.slice(i);
        if (rest.indexOf(":scope") === 0) { comp.scope = true; i += 6; continue; }
        if (rest.indexOf(":not(") === 0) {
          var pe = matchParen(s, i + 4);
          if (pe < 0) throw selErr(sel, ":not( 不配对");
          var sub = parseCompound(s.slice(i + 5, pe), sel);
          if (sub.nots.length || sub.scope) throw selErr(sel, ":not() 内不支持嵌套 :not/:scope");
          comp.nots.push(sub);
          i = pe + 1;
          continue;
        }
        throw selErr(sel, "伪类 " + rest.slice(0, 14) + " 未实现");
      } else {
        throw selErr(sel, "位置 " + i + " 出现意外字符 " + JSON.stringify(c));
      }
    }
    if (!comp.tag && !comp.id && !comp.cls.length && !comp.attrs.length && !comp.nots.length && !comp.scope) {
      throw selErr(sel, "空复合选择器");
    }
    return comp;
  }

  /**
   * 解析完整选择器 → steps（左→右）
   *   steps[k] = { comp, comb }   comb = 本步相对**前一步**的关系（第一步为 null）
   * 匹配时从右往左回退（标准做法，右侧命中率最高）。
   */
  function parseComplex(s, sel) {
    var steps = [];
    var i = 0;
    while (i < s.length) {
      var comb = null, hadSpace = false;
      while (i < s.length && /\s/.test(s.charAt(i))) { i++; hadSpace = true; }
      if (i < s.length && ">+~".indexOf(s.charAt(i)) >= 0) { comb = s.charAt(i); i++; }
      else if (hadSpace) comb = " ";
      /* ⚠️ 组合符**前后都可能有空格**（`.p > .c` / `.a + .b` / `:scope > .x`）。
       * 只跳过前置空格会在 `> ` 之后立刻撞上空格 ⇒ 本复合选择器为空 ⇒ 误报「空复合选择器」。
       * 实测：全仓后代/子代/兄弟组合符 32 处，全是带空格写法。 */
      while (i < s.length && /\s/.test(s.charAt(i))) i++;
      if (i >= s.length) break;
      if (!steps.length && comb) throw selErr(sel, "选择器不能以组合符开头");
      /* 收集本复合选择器：到空白/组合符为止，但 [..] 与 :not(..) 内部不算 */
      var start = i;
      while (i < s.length) {
        var c = s.charAt(i);
        if (c === "[") { var be = matchBracket(s, i); if (be < 0) throw selErr(sel, "[ 不配对"); i = be + 1; continue; }
        if (c === ":") {
          if (s.slice(i, i + 6) === ":scope") { i += 6; continue; }
          if (s.slice(i, i + 5) === ":not(") { var pe = matchParen(s, i + 4); if (pe < 0) throw selErr(sel, ":not( 不配对"); i = pe + 1; continue; }
          throw selErr(sel, "伪类 " + s.slice(i, i + 14) + " 未实现");
        }
        if (/\s/.test(c) || ">+~".indexOf(c) >= 0) break;
        i++;
      }
      var part = s.slice(start, i);
      if (!part) throw selErr(sel, "空复合选择器");
      steps.push({ comp: parseCompound(part, sel), comb: steps.length ? (comb || " ") : null });
    }
    if (!steps.length) throw selErr(sel, "空选择器");
    return steps;
  }

  var SEL_CACHE = Object.create(null);
  function compile(sel) {
    sel = String(sel == null ? "" : sel).replace(/^\s+|\s+$/g, "");
    if (SEL_CACHE[sel]) return SEL_CACHE[sel];
    var parts = splitTop(sel, ",");
    var list = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].replace(/^\s+|\s+$/g, "");
      if (!p) continue;
      list.push(parseComplex(p, sel));
    }
    if (!list.length) throw selErr(sel, "空选择器");
    SEL_CACHE[sel] = list;
    return list;
  }

  /* ---------- 元素属性/类读取（选择器匹配用） ---------- */
  function classSet(el) {
    if (!el.__clsSet) {
      var set = Object.create(null);
      var t = String(el.className || "").split(/\s+/);
      for (var i = 0; i < t.length; i++) if (t[i]) set[t[i]] = 1;
      el.__clsSet = set;
    }
    return el.__clsSet;
  }
  function hasClass(el, c) { return classSet(el)[c] === 1; }

  /* 布尔属性：DOM 里 `el.disabled = true` 会**反射**到属性上 ⇒ `[disabled]` 才成立。
   * 实测用例：`.arch-location:not([disabled])`（8 处 [disabled] 查询）。 */
  var BOOL_ATTRS = { disabled: 1, checked: 1, selected: 1, hidden: 1, readonly: 1, open: 1, required: 1 };
  function attrRaw(el, name) {
    if (name === "id") return el.id ? el.id : null;
    if (name === "class") return el.className ? el.className : null;
    if (name === "title") return (name in el._attrs) ? el._attrs[name] : (el.title ? el.title : null);
    if (BOOL_ATTRS[name]) {
      if (name in el._attrs) return el._attrs[name];
      var prop = name === "readonly" ? "readOnly" : name;
      return el[prop] ? "" : null;
    }
    return (name in el._attrs) ? el._attrs[name] : null;
  }
  function matchAttr(el, a) {
    var v = attrRaw(el, a.name);
    if (v === null || v === undefined) return false;
    if (a.op === null) return true;
    v = String(v);
    var want = a.val;
    if (a.op === "=") return v === want;
    if (a.op === "~=") return (" " + v + " ").indexOf(" " + want + " ") >= 0;
    if (a.op === "^=") return want.length > 0 && v.indexOf(want) === 0;
    if (a.op === "$=") return want.length > 0 && v.length >= want.length && v.slice(v.length - want.length) === want;
    if (a.op === "*=") return want.length > 0 && v.indexOf(want) >= 0;
    if (a.op === "|=") return v === want || v.indexOf(want + "-") === 0;
    return false;
  }

  function matchesCompound(el, comp, scope) {
    if (!el || el.nodeType !== 1) return false;
    if (comp.tag && el.tagName !== comp.tag) return false;
    if (comp.scope && el !== scope) return false;
    if (comp.id && el.id !== comp.id) return false;
    var k;
    for (k = 0; k < comp.cls.length; k++) if (!hasClass(el, comp.cls[k])) return false;
    for (k = 0; k < comp.attrs.length; k++) if (!matchAttr(el, comp.attrs[k])) return false;
    for (k = 0; k < comp.nots.length; k++) if (matchesCompound(el, comp.nots[k], scope)) return false;
    return true;
  }

  function prevEl(el) {
    var p = el && el.parentNode;
    if (!p) return null;
    var kids = nodeList(p);
    var i = kids.indexOf(el);
    for (var k = i - 1; k >= 0; k--) if (kids[k].nodeType === 1) return kids[k];
    return null;
  }

  function matchAt(el, i, steps, scope) {
    if (!el || el.nodeType !== 1) return false;
    if (!matchesCompound(el, steps[i].comp, scope)) return false;
    if (i === 0) return true;
    var comb = steps[i].comb;
    if (comb === ">") return matchAt(el.parentNode, i - 1, steps, scope);
    if (comb === "+") return matchAt(prevEl(el), i - 1, steps, scope);
    if (comb === "~") {
      var s = prevEl(el);
      while (s) { if (matchAt(s, i - 1, steps, scope)) return true; s = prevEl(s); }
      return false;
    }
    /* 后代：沿祖先找任意命中 */
    var p = el.parentNode;
    while (p && p.nodeType === 1) {
      if (matchAt(p, i - 1, steps, scope)) return true;
      p = p.parentNode;
    }
    return false;
  }

  /** 单个元素是否命中任意一条（逗号并集）复杂选择器 */
  function testSel(el, list, scope) {
    for (var i = 0; i < list.length; i++) if (matchAt(el, list[i].length - 1, list[i], scope)) return true;
    return false;
  }

  function collect(root, list, scope, out) {
    var kids = nodeList(root);
    for (var i = 0; i < kids.length; i++) {
      var c = kids[i];
      if (c.nodeType !== 1) continue;
      if (testSel(c, list, scope)) out.push(c);
      collect(c, list, scope, out);
    }
    return out;
  }
  function queryIn(root, sel, scope) {
    var list = compile(sel);
    return collect(root, list, scope || root, []);
  }
  function queryOneIn(root, sel, scope) {
    var list = compile(sel);
    var walk = function (r) {
      var kids = nodeList(r);
      for (var i = 0; i < kids.length; i++) {
        var c = kids[i];
        if (c.nodeType !== 1) continue;
        if (testSel(c, list, scope || root)) return c;
        var deeper = walk(c);
        if (deeper) return deeper;
      }
      return null;
    };
    return walk(root);
  }

  /* =====================================================================
   * 2. HTML 片段解析（innerHTML / insertAdjacentHTML 用）
   *    懒解析：innerHTML 赋值时**只存字符串**，等真的有人读 children / querySelector
   *    才建节点（全仓 241 处 innerHTML 赋值，绝大多数写完就再也不查，建了纯浪费）。
   * ===================================================================== */
  var VOID_TAGS = { area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1, link: 1, meta: 1, param: 1, source: 1, track: 1, wbr: 1 };
  var RAW_TAGS = { script: 1, style: 1, textarea: 1, title: 1 };
  var RCDATA_TAGS = { textarea: 1, title: 1 };   // 解实体；RAW（script/style）不解

  var ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", copy: "\u00a9", hellip: "\u2026", mdash: "\u2014", ndash: "\u2013", times: "\u00d7", middot: "\u00b7" };
  function decodeEnt(s) {
    if (s.indexOf("&") < 0) return s;
    return String(s).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, function (m, body) {
      if (body.charAt(0) === "#") {
        var n = body.charAt(1) === "x" || body.charAt(1) === "X"
          ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
        return (n >= 0 && n <= 0x10ffff) ? String.fromCharCode(n) : m;
      }
      var k = body.toLowerCase();
      return (k in ENT) ? ENT[k] : m;
    });
  }

  /** s[i] 为 '<'，返回标签的 '>'（跳过引号内的 '>'）；失败返 -1 */
  function findTagEnd(s, i) {
    var q = "";
    for (var k = i + 1; k < s.length; k++) {
      var c = s.charAt(k);
      if (q) { if (c === q) q = ""; continue; }
      if (c === '"' || c === "'") { q = c; continue; }
      if (c === ">") return k;
    }
    return -1;
  }

  var ATTR_RE = /([^\s=\/]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]*))?/g;
  function parseAttrsInto(el, text) {
    ATTR_RE.lastIndex = 0;
    var m;
    while ((m = ATTR_RE.exec(text))) {
      var name = String(m[1]).toLowerCase();
      if (!name || name === "/") continue;
      var v = (m[2] === undefined) ? "" : String(m[2]);
      if (v.length >= 2) {
        var a = v.charAt(0), b = v.charAt(v.length - 1);
        if ((a === '"' && b === '"') || (a === "'" && b === "'")) v = v.slice(1, -1);
      }
      el._attrs[name] = decodeEnt(v);
    }
    if ("id" in el._attrs) el.id = el._attrs.id;
    if ("class" in el._attrs) el.className = el._attrs["class"];
    if ("value" in el._attrs) el.value = el._attrs.value;
    if ("type" in el._attrs) el.type = el._attrs.type;
    if ("title" in el._attrs) el.title = el._attrs.title;
    for (var bn in BOOL_ATTRS) if (bn in el._attrs) el[bn === "readonly" ? "readOnly" : bn] = true;
  }

  function textNode(t) { return { nodeType: 3, nodeValue: t, textContent: t, parentNode: null }; }

  function parseFragment(html) {
    html = String(html == null ? "" : html);
    var root = { nodeType: 11, tagName: "", _kids: [] };
    var stack = [root];
    function top() { return stack[stack.length - 1]; }
    /* ⚠️ 必须**同时**维护 _kids 与 _children**。
     *    踩过：解析器只 push `_kids`，于是 innerHTML 建出来的元素其 `_children` 恒为空，
     *    而 `children` / `firstElementChild` / `nextElementSibling` / `previousElementSibling`
     *    / `childElementCount` 全靠 `_children` ⇒ 一律读到空/负索引。
     *    这正是 titan-forge-integration.js:272 的 `boosters.previousElementSibling !== tabs`
     *    判据失真的来源（幂等守卫失效 ⇒ 可能反复搬节点）。 */
    function pushKid(parent, node) {
      parent._kids.push(node);
      if (node.nodeType === 1) {
        parent._children = parent._children || [];
        parent._children.push(node);
      }
    }
    function pushText(s) { if (s) pushKid(top(), textNode(decodeEnt(s))); }
    var i = 0;
    while (i < html.length) {
      var lt = html.indexOf("<", i);
      if (lt < 0) { pushText(html.slice(i)); break; }
      if (lt > i) pushText(html.slice(i, lt));
      var c1 = html.charAt(lt + 1);
      if (c1 === "!") {
        if (html.slice(lt, lt + 4) === "<!--") {
          var ce = html.indexOf("-->", lt + 4);
          i = (ce < 0) ? html.length : ce + 3;
        } else {
          var g0 = html.indexOf(">", lt);
          i = (g0 < 0) ? html.length : g0 + 1;
        }
        continue;
      }
      if (c1 === "/") {
        var g1 = html.indexOf(">", lt);
        var name1 = html.slice(lt + 2, g1 < 0 ? html.length : g1).replace(/\s+$/, "").toLowerCase();
        for (var s = stack.length - 1; s > 0; s--) {
          if (String(stack[s].tagName).toLowerCase() === name1) { stack.length = s; break; }
        }
        i = (g1 < 0) ? html.length : g1 + 1;
        continue;
      }
      var g = findTagEnd(html, lt);
      if (g < 0) break;
      var inner = html.slice(lt + 1, g);
      var selfClose = /\/\s*$/.test(inner);
      if (selfClose) inner = inner.replace(/\/\s*$/, "");
      var sp = inner.search(/[\s/]/);
      var tag = (sp < 0 ? inner : inner.slice(0, sp)).toLowerCase();
      var attrText = (sp < 0) ? "" : inner.slice(sp);
      i = g + 1;
      if (!tag || !WORD_START_RE.test(tag.charAt(0))) continue;
      var el = makeElement(tag);
      parseAttrsInto(el, attrText);
      pushKid(top(), el);
      el.parentNode = top();
      if (VOID_TAGS[tag] || selfClose) continue;
      if (RAW_TAGS[tag]) {
        /* ⚠️ RAW 标签（script/style/textarea/title）**不入栈** —— 直接往 el 里塞文本。
         *    踩过：用 top()._kids.push(...) 会把脚本内容挂到**父节点**上，造成错位。
         *    ⚠️ 两类语义不同（HTML 规范）：RCDATA（textarea/title）**解实体**，
         *    RAW（script/style）**不解**。踩过：混为一谈导致 `<textarea>&lt;a&gt;b</textarea>`
         *    的 value 变成字面量 "&lt;a&gt;b"。 */
        var m2 = new RegExp("</" + tag + "\\s*>", "i").exec(html.slice(i));
        var raw = "";
        if (m2) { raw = html.slice(i, i + m2.index); i += m2.index + m2[0].length; }
        else { raw = html.slice(i); i = html.length; }
        var txt = RCDATA_TAGS[tag] ? decodeEnt(raw) : raw;
        pushKid(el, textNode(txt));
        if (tag === "textarea") el.value = txt;
        continue;
      }
      stack.push(el);
    }
    return root._kids;
  }

  /* =====================================================================
   * 3. 元素工厂
   * ===================================================================== */
  function makeElement(tag) {
    STATS.elements++;
    var el = {
      tagName: String(tag || "div").toUpperCase(),
      nodeType: 1,
      id: "",
      title: "",
      value: "",
      type: "",
      name: "",
      checked: false,
      disabled: false,
      hidden: false,
      selected: false,
      readOnly: false,
      multiple: false,
      files: [],                  // <input type=file> 未选文件时是**空列表** ⇒ files[0] === undefined
      offsetWidth: 0,
      offsetHeight: 0,
      clientWidth: 0,
      clientHeight: 0,
      scrollTop: 0,
      scrollLeft: 0,
      scrollHeight: 0,
      scrollWidth: 0,
      tabIndex: -1,
      parentNode: null,
      style: {},                  // 就地升级出 setProperty/getPropertyValue（不用访问器：defineProperty 失败会静默丢 style）
      _attrs: {},
      _kids: [],                  // 全部子节点（含文本）
      _children: [],              // 仅元素子节点（与 _kids 同步维护）
      _html: "",
      _dirty: false,
      __clsSet: null,
      __ds: null,
    };
    /* ⚠️ 带连字符的 CSS 属性名要转驼峰存取（`z-index` ⇄ `zIndex`）。
     *    踩过：cssText 里 `z-index:99999` 原样写进 `style["z-index"]`，
     *    于是 `style.zIndex` 读到 undefined ⇒ 以后样式一条都读不回来。
     *    自定义属性（`--x`）**不转**，真浏览器也是原样。 */
    el.style.setProperty = function (k, v) { el.style[cssProp(k)] = String(v); };
    el.style.getPropertyValue = function (k) { var v = el.style[cssProp(k)]; return v === undefined ? "" : String(v); };
    el.style.removeProperty = function (k) { delete el.style[cssProp(k)]; };
    el.style.item = function (i) { var ks = styleKeys(el), n = +i; return (n >= 0 && n < ks.length) ? ks[n] : ""; };
    /* cssText：真实用途见 js/core/bootstrap-launch.js（错误浮层整块样式一次写） */
    try {
      Object.defineProperty(el.style, "cssText", {
        get: function () { return styleText(el); },
        set: function (v) {
          var ks = styleKeys(el);
          for (var i = 0; i < ks.length; i++) delete el.style[ks[i]];
          var decls = String(v == null ? "" : v).split(";");
          for (var j = 0; j < decls.length; j++) {
            var d = decls[j], c = d.indexOf(":");
            if (c < 0) continue;
            var k = cssProp(d.slice(0, c)), val = d.slice(c + 1).replace(/^\s+|\s+$/g, "");
            if (k) el.style[k] = val;
          }
        },
      });
    } catch (eStyle) { el.style.cssText = ""; }   // 极旧宿主兜底：至少不抛错

    /* ---------- 属性 ---------- */
    el.getAttribute = function (k) {
      var name = String(k).toLowerCase();
      if (name === "id") return el.id ? el.id : null;
      if (name === "class") return el.className ? el.className : null;
      if (name === "style") { var st = styleText(el); return st || null; }
      if (BOOL_ATTRS[name]) {
        var prop = name === "readonly" ? "readOnly" : name;
        if (el[prop]) return String(el._attrs[name] === undefined ? "" : el._attrs[name]);
      }
      return el._attrs[name] === undefined ? null : String(el._attrs[name]);
    };
    el.hasAttribute = function (k) { return el.getAttribute(k) !== null; };
    el.setAttribute = function (k, v) {
      var name = String(k).toLowerCase();
      el._attrs[name] = (v === undefined || v === null) ? "" : String(v);
      el.__ds = null;
      if (name === "id") el.id = el._attrs[name];
      else if (name === "class") el.className = el._attrs[name];
      else if (name === "value") el.value = el._attrs[name];
      else if (name === "type") el.type = el._attrs[name];
      else if (name === "title") el.title = el._attrs[name];
      else if (BOOL_ATTRS[name]) el[name === "readonly" ? "readOnly" : name] = true;
    };
    el.removeAttribute = function (k) {
      var name = String(k).toLowerCase();
      delete el._attrs[name];
      el.__ds = null;
      if (name === "id") el.id = "";
      else if (name === "class") el.className = "";
      else if (BOOL_ATTRS[name]) el[name === "readonly" ? "readOnly" : name] = false;
    };

    /* ---------- 类 ---------- */
    el.classList = {
      add: function () {
        var set = classSet(el), changed = false;
        for (var i = 0; i < arguments.length; i++) {
          var c = String(arguments[i]);
          if (c && !set[c]) { set[c] = 1; changed = true; }
        }
        if (changed) syncClassName(el);
      },
      remove: function () {
        var set = classSet(el), changed = false;
        for (var i = 0; i < arguments.length; i++) {
          var c = String(arguments[i]);
          if (c && set[c]) { delete set[c]; changed = true; }
        }
        if (changed) syncClassName(el);
      },
      toggle: function (c, force) {
        var set = classSet(el);
        c = String(c);
        var on = set[c] === 1;
        var want = (force === undefined) ? !on : !!force;
        if (want === on) return want;
        if (want) set[c] = 1; else delete set[c];
        syncClassName(el);
        return want;
      },
      contains: function (c) { return hasClass(el, String(c)); },
      item: function (i) { return el.className ? (String(el.className).split(/\s+/)[i] || null) : null; },
      get length() { return el.className ? String(el.className).split(/\s+/).filter(Boolean).length : 0; },
    };

    /* ---------- 子节点访问（触发懒解析） ---------- */
    function materialize() {
      if (!el._dirty) return;
      el._dirty = false;
      var kids = parseFragment(el._html);
      el._kids = kids;
      el._children = [];
      for (var i = 0; i < kids.length; i++) {
        kids[i].parentNode = el;
        if (kids[i].nodeType === 1) el._children.push(kids[i]);
      }
      el.__clsSet = null;
    }
    el.__materialize = materialize;

    function rebuild() {
      materialize();
      el._children = [];
      for (var i = 0; i < el._kids.length; i++) if (el._kids[i].nodeType === 1) el._children.push(el._kids[i]);
    }
    el.__rebuild = rebuild;
    /** 真 DOM 语义：插入前必须先从**原父节点**摘掉（否则同一节点有两份引用，
     *  查询会重复命中、remove 也只摘一边）。 */
    function detach(c) {
      if (!c || !c.parentNode) return;
      var p = c.parentNode;
      p.__materialize && p.__materialize();
      var i = p._kids.indexOf(c);
      if (i >= 0) p._kids.splice(i, 1);
      p.__rebuild && p.__rebuild();
      c.parentNode = null;
    }
    el.appendChild = function (c) {
      materialize();
      if (!c) return c;
      detach(c);
      if (el._kids.indexOf(c) < 0) el._kids.push(c);
      rebuild();
      c.parentNode = el;
      return c;
    };
    el.insertBefore = function (c, ref) {
      materialize();
      if (!c) return c;
      if (c === ref) return c;
      detach(c);
      var i = ref ? el._kids.indexOf(ref) : -1;
      if (i < 0) el._kids.push(c); else el._kids.splice(i, 0, c);
      rebuild();
      c.parentNode = el;
      return c;
    };
    el.removeChild = function (c) {
      materialize();
      var i = el._kids.indexOf(c);
      if (i >= 0) el._kids.splice(i, 1);
      rebuild();
      if (c) c.parentNode = null;
      return c;
    };
    el.remove = function () { if (el.parentNode) el.parentNode.removeChild(el); };
    el.replaceChildren = function () {
      el._kids.length = 0; el._children.length = 0; el._html = ""; el._dirty = false;
    };
    el.replaceWith = function (n) {
      var p = el.parentNode;
      if (!p) return;
      p.insertBefore(n, el);
      el.remove();
    };
    /* ---------- 现代插入 API ----------
     * ⚠️ 这几条**必须实现**，不能靠「查不到就返 null 顺带跳过」蒙过去：
     *    实测 titan-forge-integration.js:272 的 `tabs.after(boosters)` 原先之所以不报错，
     *    只是因为当时 `document.querySelector("#shipeng-panel .panel-body")` 返 null，
     *    让整条 `&&` 短路了 —— 一旦选择器开始返真元素（= 对齐浏览器），缺方法就立刻炸。
     *    这正是「假绿」：异常数少不等于对。 */
    function toNode(x) { return (typeof x === "string") ? textNode(x) : x; }
    el.before = function () {
      var p = el.parentNode;
      if (!p) return;
      var i = p._kids.indexOf(el);
      for (var k = arguments.length - 1; k >= 0; k--) {
        var n = toNode(arguments[k]);
        if (!n) continue;
        p.insertBefore(n, (i >= 0 && p._kids[i] === el) ? el : p._kids[i] || null);
      }
    };
    el.after = function () {
      var p = el.parentNode;
      if (!p) return;
      materialize();
      for (var k = 0; k < arguments.length; k++) {
        var n = toNode(arguments[k]);
        if (!n) continue;
        p.__materialize && p.__materialize();
        var i = p._kids.indexOf(el);
        detach(n);
        if (i < 0) p._kids.push(n); else p._kids.splice(i + 1 + k, 0, n);
        p.__rebuild && p.__rebuild();
        n.parentNode = p;
      }
    };
    el.prepend = function () {
      materialize();
      for (var k = arguments.length - 1; k >= 0; k--) {
        var n = toNode(arguments[k]);
        if (n) el.insertBefore(n, el._kids.length ? el._kids[0] : null);
      }
    };
    el.append = function () {
      materialize();
      for (var k = 0; k < arguments.length; k++) {
        var n = toNode(arguments[k]);
        if (n) el.appendChild(n);
      }
    };
    el.cloneNode = function (deep) {
      materialize();
      var c = makeElement(el.tagName.toLowerCase());
      for (var k in el._attrs) c._attrs[k] = el._attrs[k];
      c.id = el.id; c.className = el.className; c.value = el.value;
      if (deep) for (var i = 0; i < el._kids.length; i++) c.appendChild(el._kids[i].cloneNode ? el._kids[i].cloneNode(true) : textNode(el._kids[i].textContent));
      return c;
    };
    el.contains = function (n) {
      var p = n;
      while (p) { if (p === el) return true; p = p.parentNode; }
      return false;
    };

    /* ---------- 查询 ---------- */
    el.querySelector = function (s) { return queryOneIn(el, s, el); };
    el.querySelectorAll = function (s) { return queryIn(el, s, el); };
    el.getElementsByClassName = function (c) { return queryIn(el, "." + String(c).replace(/\s+/g, "."), el); };
    el.getElementsByTagName = function (t) { return queryIn(el, String(t), el); };
    el.matches = function (s) { return testSel(el, compile(s), el); };
    el.closest = function (s) {
      var list = compile(s);
      var n = el;
      while (n && n.nodeType === 1) { if (testSel(n, list, el)) return n; n = n.parentNode; }
      return null;
    };
    el.insertAdjacentHTML = function (pos, html) {
      materialize();
      var nodes = parseFragment(html);
      var p = String(pos || "beforeend").toLowerCase();
      var i, k;
      for (k = 0; k < nodes.length; k++) nodes[k].parentNode = el;
      if (p === "beforeend") { for (k = 0; k < nodes.length; k++) el._kids.push(nodes[k]); }
      else if (p === "afterbegin") { for (k = nodes.length - 1; k >= 0; k--) el._kids.unshift(nodes[k]); }
      else if (p === "beforebegin" || p === "afterend") {
        var par = el.parentNode;
        if (par) {
          par.__materialize && par.__materialize();
          i = par._kids.indexOf(el);
          if (i < 0) i = par._kids.length; else if (p === "afterend") i += 1;
          for (k = 0; k < nodes.length; k++) { nodes[k].parentNode = par; par._kids.splice(i + k, 0, nodes[k]); }
          par._children = par._kids.filter(function (x) { return x.nodeType === 1; });
        }
      }
      rebuild();
    };

    /* ---------- 几何 / 焦点（几何仍是零值，待布局层） ---------- */
    el.getBoundingClientRect = function () { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }; };
    el.scrollIntoView = function () {};
    el.focus = function () {};
    el.blur = function () {};
    el.select = function () {};
    el.setSelectionRange = function () {};
    el.setRangeText = function () {};
    el.click = function () { el.dispatchEvent({ type: "click", target: el, currentTarget: el }); };

    /* ---------- 事件（含冒泡 + once） ---------- */
    el.addEventListener = function (t, fn, opts) { addListener(el, t, fn, opts); };
    el.removeEventListener = function (t, fn) { removeListener(el, t, fn); };
    el.dispatchEvent = function (ev) {
      ev = ev || {};
      if (!ev.target) ev.target = el;
      if (typeof ev.preventDefault !== "function") ev.preventDefault = function () {};
      if (typeof ev.stopPropagation !== "function") ev.stopPropagation = function () {};
      var stopped = false;
      var origStop = ev.stopPropagation;
      try {
        ev.stopPropagation = function () { stopped = true; try { origStop.call(ev); } catch (e0) {} };
      } catch (e1) {}
      /* 冒泡：target → … → document（游戏大量用**委派**：document 上挂 click 再 closest([data-x])） */
      var path = [], n = el;
      while (n) { path.push(n); n = n.parentNode; }
      var doc = null;
      try { doc = (typeof document !== "undefined" && document) ? document : null; } catch (e2) {}
      if (doc && path.indexOf(doc) < 0) path.push(doc);
      for (var i = 0; i < path.length && !stopped; i++) {
        var node = path[i];
        var m = listeners.get(node);
        var arr = m && m[ev.type];
        /* ---- 内联 on* 属性（2026-09-15 补）----
           浏览器里 `el.onclick = fn` 与 addEventListener 是**两条独立通道**，都参与派发。
           本文件原先只走 addEventListener ⇒ 逻辑层 39 处 `.onclick =` 全是死接线
           （实测取证：赋值真函数 → 派发 click → 调用次数 0；同用例的 addEventListener 为 1）。
           受害面是**弹窗类交互**：诊断浮层、联盟面板、奖励/装备弹窗、战斗按钮、广告挂件
           （js/ui/alliance-render.js 26 处、shell-render.js 5、diagnostics.js 4 …）——
           表现为「弹窗能显示但按钮点不动」，与 2026-09-15 那次 querySelector 恒 null 同型。
           ⚠️ 取值必须在下面 `continue` **之前**：只有 onclick、没有 addEventListener 的元素
              正是最常见的一类，先 continue 就永远读不到它。 */
        var inline = null;
        try { var h = node["on" + ev.type]; if (typeof h === "function") inline = h; } catch (eH) {}
        if ((!arr || !arr.length) && !inline) continue;
        var copy = arr ? arr.slice() : [];
        for (var j = 0; j < copy.length && !stopped; j++) {
          if (copy[j].once) removeListener(node, ev.type, copy[j].f);
          try {
            ev.currentTarget = node;
            copy[j].f.call(node, ev);
          } catch (err) {
            listenerErrors++;
            STATS.errors++;
            try { G.__WX_SHIM_LISTENER_ERRORS__ = listenerErrors; } catch (e3) {}
            console.warn("[shim] listener error", err);
          }
        }
        /* 顺序约定：同一节点上先跑 addEventListener 的，再跑内联 on*。
           浏览器里两者按「注册时刻」交错，这里取一个稳定近似（游戏里两者从不并存同一事件）。 */
        if (inline && !stopped) {
          try {
            ev.currentTarget = node;
            inline.call(node, ev);
          } catch (err2) {
            listenerErrors++;
            STATS.errors++;
            try { G.__WX_SHIM_LISTENER_ERRORS__ = listenerErrors; } catch (e4) {}
            console.warn("[shim] inline listener error", err2);
          }
        }
      }
      return !ev.defaultPrevented;
    };

    el.getContext = function (type, attrs) {
      if (el._ctx) return el._ctx;
      // 小游戏没有 DOM canvas；用 wx.createCanvas() 造真画布并把上下文交回，
      // 使 canvas.getContext("2d") 这类 DOM 写法的语义成立（S1 会把绘制接到同一批画布上）。
      try {
        if (typeof wx !== "undefined" && typeof wx.createCanvas === "function") {
          var c = wx.createCanvas();
          if (c && typeof c.getContext === "function") {
            el._canvas = c;
            el._ctx = c.getContext(type || "2d", attrs);
            return el._ctx;
          }
        }
      } catch (e) {}
      return null;
    };
    el.toDataURL = function () { return ""; };
    el.toBlob = function (cb) { if (typeof cb === "function") cb(null); };

    /* ---------- 访问器（v2 新增：正文/类/属性表要真联动） ---------- */
    function define2(name, getter, setter) {
      try {
        Object.defineProperty(el, name, { get: getter, set: setter, configurable: true, enumerable: true });
      } catch (e) {}
    }
    define2("className",
      function () { return el.__cls === undefined ? "" : el.__cls; },
      function (v) { el.__cls = (v === undefined || v === null) ? "" : String(v); el.__clsSet = null; });
    define2("class", function () { return el.className; }, function (v) { el.className = v; });
    define2("children", function () { materialize(); return el._children; }, function (v) {
      el._html = ""; el._dirty = false;
      el._kids = (v || []).slice(); rebuild();
    });
    define2("childNodes", function () { materialize(); return el._kids; }, function (v) {
      el._html = ""; el._dirty = false;
      el._kids = (v || []).slice(); rebuild();
    });
    define2("firstChild", function () { materialize(); return el._kids.length ? el._kids[0] : null; });
    define2("lastChild", function () { materialize(); return el._kids.length ? el._kids[el._kids.length - 1] : null; });
    define2("firstElementChild", function () { materialize(); return el._children.length ? el._children[0] : null; });
    define2("lastElementChild", function () { materialize(); return el._children.length ? el._children[el._children.length - 1] : null; });
    define2("childElementCount", function () { materialize(); return el._children.length; });
    define2("nextSibling", function () {
      var p = el.parentNode; if (!p || !p.__materialize) return null;
      p.__materialize();
      var i = p._kids.indexOf(el);
      return (i >= 0 && i + 1 < p._kids.length) ? p._kids[i + 1] : null;
    });
    define2("previousSibling", function () {
      var p = el.parentNode; if (!p || !p.__materialize) return null;
      p.__materialize();
      var i = p._kids.indexOf(el);
      return (i > 0) ? p._kids[i - 1] : null;
    });
    define2("nextElementSibling", function () {
      var p = el.parentNode; if (!p || !p.__materialize) return null;
      p.__materialize();
      var i = p._children.indexOf(el);
      return (i >= 0 && i + 1 < p._children.length) ? p._children[i + 1] : null;
    });
    define2("previousElementSibling", function () {
      var p = el.parentNode; if (!p || !p.__materialize) return null;
      p.__materialize();
      var i = p._children.indexOf(el);
      return (i > 0) ? p._children[i - 1] : null;
    });
    define2("parentElement", function () { return el.parentNode && el.parentNode.nodeType === 1 ? el.parentNode : null; });
    define2("innerHTML",
      function () {
        if (el._dirty) return el._html;
        if (!el._kids.length) return "";
        var out = [];
        serialize(el._kids, out);
        return out.join("");
      },
      function (v) {
        el._html = (v === undefined || v === null) ? "" : String(v);
        el._dirty = true;
        el._kids = [];
        el._children = [];
      });
    define2("outerHTML",
      function () {
        var out = [];
        serialize([el], out);
        return out.join("");
      },
      function (v) {
        var p = el.parentNode;
        if (!p) return;
        var nodes = parseFragment(v);
        p.__materialize && p.__materialize();
        var i = p._kids.indexOf(el);
        if (i < 0) return;
        for (var k = 0; k < nodes.length; k++) { nodes[k].parentNode = p; }
        p._kids.splice.apply(p._kids, [i, 1].concat(nodes));
        p._children = p._kids.filter(function (x) { return x.nodeType === 1; });
      });
    define2("textContent",
      function () {
        materialize();
        var s = "";
        gatherText(el._kids, function (t) { s += t; });
        return s;
      },
      function (v) {
        el._kids = []; el._children = []; el._html = ""; el._dirty = false;
        if (v !== undefined && v !== null && String(v) !== "") el._kids.push(textNode(String(v)));
      });
    define2("innerText",
      function () { return el.textContent; },
      function (v) { el.textContent = v; });
    define2("nodeValue", function () { return null; }, function () {});
    define2("dataset", function () {
      if (el.__ds) return el.__ds;
      var d = {};
      for (var k in el._attrs) {
        if (k.indexOf("data-") === 0 && k.length > 5) {
          var camel = k.slice(5).replace(/-([a-z])/g, function (_m, c) { return c.toUpperCase(); });
          d[camel] = el._attrs[k];
        }
      }
      el.__ds = d;
      return d;
    });

    return el;
  }

  /** 与 _kids 同步的唯一入口：任何结构变化后都要调它重建 _children */
  function nodeList(n) {
    if (n.__materialize) n.__materialize();
    return n._kids || [];
  }

  /** CSS 属性名 ⇄ JS 驼峰名（`z-index` → `zIndex`；`--x` 自定义属性保持原样） */
  function cssProp(k) {
    k = String(k);
    if (k.indexOf("--") === 0 || k.indexOf("-") < 0) return k;
    return k.replace(/-([a-z])/g, function (_m, c) { return c.toUpperCase(); });
  }
  function cssName(k) {
    k = String(k);
    if (k.indexOf("--") === 0) return k;
    return k.replace(/[A-Z]/g, function (c) { return "-" + c.toLowerCase(); });
  }

  /** 行内样式的有效声明名（真浏览器语义：空串等于「移除该声明」） */
  function styleKeys(el) {
    var out = [], s = el.style;
    if (!s) return out;
    for (var k in s) {
      if (!Object.prototype.hasOwnProperty.call(s, k)) continue;
      var v = s[k];
      if (typeof v === "function") continue;                  // setProperty / item 等方法
      if (v === undefined || v === null || String(v) === "") continue;
      out.push(k);
    }
    return out;
  }
  function styleText(el) {
    var ks = styleKeys(el), out = [];
    for (var i = 0; i < ks.length; i++) out.push(cssName(ks[i]) + ":" + String(el.style[ks[i]]));
    return out.join(";");
  }

  function serialize(nodes, out) {
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (!n || n.nodeType !== 1) { out.push(n ? String(n.textContent) : ""); continue; }
      var tag = String(n.tagName).toLowerCase();
      out.push("<" + tag);
      var at = {};
      for (var k in n._attrs) at[k] = n._attrs[k];
      if (n.id) at.id = n.id;
      if (n.className) at["class"] = n.className;
      var st = styleText(n);
      if (st) at.style = st;
      for (var a in at) out.push(" " + a + '="' + String(at[a]).replace(/"/g, "&quot;") + '"');
      out.push(">");
      if (VOID_TAGS[tag]) continue;
      serialize(nodeList(n), out);
      out.push("</" + tag + ">");
    }
  }
  function gatherText(nodes, sink) {
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (!n) continue;
      if (n.nodeType === 1) gatherText(nodeList(n), sink);
      else sink(String(n.textContent === undefined ? "" : n.textContent));
    }
  }

  function syncClassName(el) {
    var set = classSet(el), out = [];
    for (var k in set) out.push(k);
    el.__cls = out.join(" ");
  }
  /* 反向：className 被直接赋值 ⇒ 清缓存（在 define2 的 setter 里已做） */

  // ---------- document ----------
  // 🔴 判据必须锚「能力是否齐备」而不是「对象是否存在」：
  //    微信小游戏（IDE 模拟器）**自带一份部分实现的 document** —— 有 createElement，
  //    但没有 getElementById / querySelector（实测快照：doc=object, createElement=function,
  //    getElementById=undefined）。旧判据 `typeof G.document === "undefined"` 因此为假，
  //    整个桩被跳过 ⇒ 逻辑层里大量**顶层无保护**的 document.getElementById("x").addEventListener(…)
  //    直接 TypeError ⇒ 整包起不来（现象：控制台一条无消息堆栈 + 纯黑屏）。
  //    ⇒ 只**补齐缺失项**，不整体替换（保留宿主已有实现，如真实 createElement）。
  // ⚠️ 而且必须取「逻辑层实际看到的那个 document」：优先**裸标识符**——
  //    若宿主以模块参数注入 document，它与 globalThis.document 可能不是同一对象，
  //    只补 globalThis 等于白补（实测：flag 已置位、getById 仍是 undefined）。
  // ⚠️ 微信小游戏（含 IDE 模拟器）要么没有 document，要么只有一份**部分实现**的原生 document。
  // 这份原生 document 的 createElement 产出的节点不带内核需要的 _kids/_attrs 结构，
  // 且 documentElement 是原生空 <html> ⇒ 画布内核读不到界面树 ⇒ 纯黑屏
  // （2026-09-16 实测诊断：tree.boxes=1、fatal=DOMContentLoaded 未派发只是表象，根因在此）。
  // 因此**永远自建虚拟文档**（不继承宿主原生 document），让模拟器与真机走同一条路径。
  // 真机本来就没有 document ⇒ 等价；模拟器里原生 document 必须被整体替换
  // （getter-only 用 defineProperty 强制覆盖，见本段下方）。
  // ⚠️ 2026-09-16 更正：微信模拟器的 `window.document` 是 **non-configurable getter**，
  //    且模块包装器把这份原生 document 作为 `document` 参数注入每个模块。
  //    「新建虚拟文档再覆盖 G.document」会因 non-configurable **静默失败**（override=false），
  //    挂的方法全落在孤儿对象上，bundle 用的原生 document 依然缺 getElementById ⇒ boot 崩溃。
  //    ⇒ 正确做法：**原地补齐** bundle 实际看到的那个 document 对象（= G.document 本身），
  //      强制换掉 documentElement/head/body、补齐 getElementById 等；真机无 document 时退回新建虚拟文档并挂载。
  var WX_DOC = (G.document && typeof G.document === "object") ? G.document : {};
  var needDocPatch = !WX_DOC ||
    (typeof WX_DOC.getElementById !== "function") ||
    (typeof WX_DOC.querySelector !== "function") ||
    (typeof WX_DOC.createElement !== "function");
  try { G.__WX_SHIM_DOC_STEP__ = "needPatch=" + needDocPatch + "|bareEqGlobal=" + (WX_DOC === G.document); } catch (e) {}
  if (needDocPatch) {
    var docEl = makeElement("html");
    var headEl = makeElement("head");
    var bodyEl = makeElement("body");
    docEl.appendChild(headEl);
    docEl.appendChild(bodyEl);

    // ⚠️ DOM 查询必须返回「桩元素」而不是 null：
    //    逻辑/UI 层大量存在**顶层无保护**的 document.getElementById("x").addEventListener(…)
    //    （如 action-modal.js:194 的 bindActionModal），在浏览器里这些元素由 index.html 提供，
    //    返回 null 会在加载期直接 TypeError ⇒ 整包起不来。这里返回缓存桩元素以对齐浏览器事实，
    //    并打印一次性告警——避免「静默降级」难以察觉。
    var idCache = Object.create(null);
    var warnedIds = Object.create(null);
    function stubById(id) {
      var k = String(id);
      // 先查**真节点树**（createElement + 挂载出来的元素应当能被 getElementById 找到），
      // 查不到再回退到「index.html 提供的元素」的占位桩。
      var found = null;
      try {
        var all = [docEl];
        while (all.length) {
          var n = all.pop();
          if (n.nodeType === 1 && n.id === k) { found = n; break; }
          var ks = nodeList(n);
          for (var i = 0; i < ks.length; i++) if (ks[i].nodeType === 1) all.push(ks[i]);
        }
      } catch (e) {}
      if (found) return found;
      if (!idCache[k]) {
        idCache[k] = makeElement("div");
        idCache[k].id = k;
      }
      if (!warnedIds[k]) {
        warnedIds[k] = true;
        // 2026-09-15 修订：index.html 现在**已被渲染层注入**（wx/dom-render.js 的 install()，
        //   在逻辑层之前执行），所以「查不到 id」不再等于「index.html 没接入」。剩下的两种情况：
        //     ① 该元素由逻辑层在稍后动态创建（弹窗类 id 全是这种，属正常）；
        //     ② 真的拼错了 id（此时才是缺陷）。告警保留，但措辞不再指向「未接入」。
        if (typeof console !== "undefined" && console.warn) console.warn('[shim] #' + k + " → 占位桩（此时真节点树里没有它；可能是逻辑层稍后动态创建）");
      }
      return idCache[k];
    }

    // ⚠️ 绝不能写 G.document：浏览器/模拟器里 window.document 是 **getter-only**
    //    （实测 TypeError: Cannot set property document of #<Window> which has only a getter）。
    //    该文档对象本身可自由加属性（实测 assignable=yes）⇒ 只往它身上**补缺失方法**。
    if (!WX_DOC) WX_DOC = {};
    var D = WX_DOC;
    // ⚠️ 模拟器（Chromium）里 window.document 是**原生文档**、且 getter-only。
    //    普通赋值 G.document = D 会**静默失败**（不抛错、也无效）⇒ 游戏继续用原生 document
    //    建界面，而画布内核读 G.document.documentElement（原生空文档）⇒ tree.boxes=1、纯黑屏
    //    （2026-09-16 实测诊断：fatal=DOMContentLoaded 未派发只是表象，根因是 document 没换成虚拟文档）。
    //    必须用 defineProperty 强制覆盖；若仍失败再尝试 delete+赋值；再失败则用 get 访问器恒返回 D。
    //    真机 G.document 本就不存在 ⇒ 首次普通赋值直接成功，下面兜底链全部跳过。
    if (G.document !== D) {
      try { G.document = D; } catch (e) {}
      if (G.document !== D) {
        try { Object.defineProperty(G, "document", { value: D, writable: true, configurable: true }); } catch (e2) {}
      }
      if (G.document !== D) {
        try { delete G.document; G.document = D; } catch (e3) {}
      }
      if (G.document !== D) {
        try { Object.defineProperty(G, "document", { get: function () { return D; }, set: function () {}, configurable: true }); } catch (e4) {}
      }
      try { G.__WX_SHIM_DOC_OVERRIDE__ = (G.document === D); } catch (e) {}
    }
    var docDefaults = {
      nodeType: 9,
      documentElement: docEl,
      head: headEl,
      body: bodyEl,
      readyState: "complete",
      title: "",
      cookie: "",
      activeElement: bodyEl,
    };
    // ⚠️ documentElement/head/body 必须**强制**换成虚拟节点：内核只读 G.document.documentElement，
    //    原生空 <html> 会让内核读到空树 ⇒ 纯黑屏（boxes=1）。这三项在原生 document 上「有值但为空」，
    //    普通 `!(dk in D)` 判据不会覆盖它们，必须用 defineProperty 强写（已确认 documentElement 可配置）。
    //    其余项按「缺失才补」处理，避免覆盖宿主已有实现。
    for (var dk in docDefaults) {
      try {
        if (dk === "documentElement" || dk === "head" || dk === "body") {
          Object.defineProperty(D, dk, { value: docDefaults[dk], writable: true, configurable: true, enumerable: true });
        } else if (!(dk in D) || D[dk] == null) {
          D[dk] = docDefaults[dk];
        }
      } catch (e) {}
    }
    var docMethods = {
      createElement: makeElement,
      createElementNS: function (_ns, tag) { return makeElement(tag); },
      createTextNode: function (t) { return textNode(String(t)); },
      createDocumentFragment: function () { return makeElement("fragment"); },
      getElementById: stubById,
      getElementsByClassName: function (c) { return queryIn(docEl, "." + String(c).replace(/\s+/g, "."), docEl); },
      getElementsByTagName: function (t) { return (String(t) === "*") ? queryIn(docEl, "*", docEl) : queryIn(docEl, String(t), docEl); },
      querySelector: function (sel) {
        // 真节点树优先；树里没有的 `#id` 才退回占位桩（index.html 里的元素）
        var s = String(sel == null ? "" : sel).replace(/^\s+|\s+$/g, "");
        try {
          var hit = queryOneIn(docEl, s, docEl);
          if (hit) return hit;
        } catch (e) {
          // 选择器不在支持集内 —— 不吞：直接抛（宁可门禁红，也不要静默 null）
          throw e;
        }
        var m = /^#([\w-]+)$/.exec(s);
        return m ? stubById(m[1]) : null;
      },
      querySelectorAll: function (sel) { return queryIn(docEl, String(sel == null ? "" : sel), docEl); },
      addEventListener: function (t, fn, opts) { addListener(D, t, fn, opts); },
      removeEventListener: function (t, fn) { removeListener(D, t, fn); },
      dispatchEvent: function (ev) {
        var node = D;
        var m = listeners.get(node);
        var arr = m && m[ev && ev.type];
        if (arr) {
          arr.slice().forEach(function (r) {
            try { r.f.call(node, ev); } catch (e) { listenerErrors++; STATS.errors++; console.warn("[shim] listener error", e); }
          });
        }
        return true;
      },
      execCommand: function () { return false; },
      getSelection: function () { return { rangeCount: 0, toString: function () { return ""; }, removeAllRanges: function () {}, addRange: function () {} }; },
      createRange: function () {
        return { selectNodeContents: function () {}, setStart: function () {}, setEnd: function () {}, toString: function () { return ""; }, collapse: function () {} };
      },
      elementFromPoint: function () { return null; },
      hasFocus: function () { return true; },
      contains: function (n) { var p = n; while (p) { if (p === docEl || p === D) return true; p = p.parentNode; } return false; },
    };
    // ⚠️ 必须用 Object.defineProperty 在**对象自身**定义，不能写 `D[mk] = fn`：
    //    原型链上若存在同名 **getter-only** 访问器（实测 document 正是这种情况），
    //    普通赋值会走 set 语义 → 找不到 setter → 在非严格模式下**静默失败**（不抛错、也不生效）。
    //    自身 data property 不查原型 ⇒ 稳定生效。
    var __docFailed = [];
    // ⚠️ 事件三件套必须**强制覆盖**，不能走下面的「原生已有同名函数就跳过」守卫：
    //    模拟器环境的基础库会注入原生 document，其 dispatchEvent 严格要求真 Event 实例
    //    （传普通对象抛 "parameter 1 is not of type 'Event'"）⇒ dom-render 的 fireBootEvents
    //    派发 DOMContentLoaded 失败 ⇒ 逻辑层等不到事件、界面永远建不出来 ⇒ 纯黑屏（2026-09-16 实测）。
    //    更致命的是「半 shim 半原生」：若 addEventListener 落 shim、dispatchEvent 落原生，
    //    注册表与派发通道不同源，事件永远收不到。事件体系必须整体同源走 shim。
    var FORCE_DOC_EVENTS = { addEventListener: 1, removeEventListener: 1, dispatchEvent: 1 };
    for (var mk in docMethods) {
      // ⚠️ 必须**强制**覆盖全部 docMethods（含原生已有实现的 createElement / querySelector 等）：
      //    原生 createElement 产出「无 _kids/_attrs」的非内核节点，挂到虚拟父节点时 shim 的
      //    insertBefore 写 child.parentNode 会因原生 parentNode 是 **getter-only** 抛
      //    "Cannot set property parentNode ... which has only a getter"；原生 querySelector 在虚拟树里
      //    查不到节点。所以一律用 shim 实现替换，绝不保留原生版本。
      try {
        Object.defineProperty(D, mk, { value: docMethods[mk], writable: true, configurable: true, enumerable: false });
      } catch (e) {
        try { D[mk] = docMethods[mk]; } catch (e2) {}
      }
      if (typeof D[mk] !== "function") __docFailed.push(mk);
    }
    try { G.__WX_SHIM_DOC_STEP__ += "|done|getById=" + typeof D.getElementById + "|failed=[" + __docFailed.join(",") + "]|thisDocHas=" + Object.prototype.hasOwnProperty.call(D, "getElementById"); } catch (e) {}
  }

  // ---------- location（translator.js:23 会读 window.location.search）----------
  if (typeof G.location === "undefined") {
    G.location = { href: "https://wx-minigame/", protocol: "https:", host: "wx-minigame", hostname: "wx-minigame", pathname: "/", search: "", hash: "", origin: "https://wx-minigame", reload: function () {}, assign: function () {}, replace: function () {} };
  }
  if (!G.URLSearchParams) {
    G.URLSearchParams = function (s) {
      this._m = {};
      String(s || "").replace(/^\?/, "").split("&").forEach(function (kv) {
        if (!kv) return; var i = kv.indexOf("=");
        var k = i < 0 ? kv : kv.slice(0, i), v = i < 0 ? "" : kv.slice(i + 1);
        try { this._m[decodeURIComponent(k)] = decodeURIComponent(v); } catch (e) { this._m[k] = v; }
      }, this);
    };
    G.URLSearchParams.prototype.get = function (k) { return k in this._m ? this._m[k] : null; };
    G.URLSearchParams.prototype.has = function (k) { return k in this._m; };
    G.URLSearchParams.prototype.toString = function () { var m = this._m, o = []; for (var k in m) o.push(k + "=" + m[k]); return o.join("&"); };
  }

  // ---------- 其它浏览器全局 ----------
  if (typeof G.navigator === "undefined") {
    G.navigator = { userAgent: "WeChatMiniGame", platform: "wechat-minigame", language: "zh-CN", languages: ["zh-CN"], onLine: true, clipboard: null };
  }
  if (typeof G.performance === "undefined") G.performance = {};
  if (typeof G.performance.now !== "function") {
    G.performance.now = function () { return Date.now() - (G.__WX_T0__ || (G.__WX_T0__ = Date.now())); };
  }
  if (typeof G.requestAnimationFrame !== "function") {
    G.requestAnimationFrame = function (cb) { return setTimeout(function () { cb(G.performance.now()); }, 16); };
    G.cancelAnimationFrame = function (id) { clearTimeout(id); };
  }
  if (typeof G.setTimeout !== "function" && typeof wx !== "undefined" && wx.setTimeout) {
    G.setTimeout = wx.setTimeout.bind(wx); G.clearTimeout = wx.clearTimeout.bind(wx);
  }
  if (typeof G.matchMedia !== "function") {
    G.matchMedia = function (q) { return { matches: false, media: q, addListener: function () {}, removeListener: function () {}, addEventListener: function () {}, removeEventListener: function () {} }; };
  }
  if (typeof G.getComputedStyle !== "function") {
    G.getComputedStyle = function () { return { getPropertyValue: function () { return ""; }, width: "0px", height: "0px" }; };
  }
  if (typeof G.alert !== "function") { G.alert = function () {}; G.confirm = function () { return false; }; G.prompt = function () { return null; }; }
  if (typeof G.FileReader !== "function") {
    G.FileReader = function () { this.result = null; this.onload = null; };
    G.FileReader.prototype.readAsText = function (f) {
      var self = this;
      try {
        if (f && typeof f.text === "function") f.text().then(function (t) { self.result = t; if (self.onload) self.onload({ target: self }); });
        else if (self.onload) self.onload({ target: self });
      } catch (e) { if (self.onload) self.onload({ target: self }); }
    };
  }

  // ---------- 观察器（空实现）----------
  // 逻辑层在顶层直接 new MutationObserver(…)（小游戏无此全局）。
  // 它们是纯观察器、不产生副作用 ⇒ 空实现语义安全。
  [["MutationObserver", "observe disconnect takeRecords"],
   ["IntersectionObserver", "observe unobserve disconnect takeRecords"],
   ["ResizeObserver", "observe unobserve disconnect"]].forEach(function (def) {
    var name = def[0];
    if (typeof G[name] === "function") return;
    var Ctor = function (cb) { this._cb = cb; this._targets = []; };
    def[1].split(" ").forEach(function (m) {
      Ctor.prototype[m] = function () { return m === "takeRecords" ? [] : undefined; };
    });
    G[name] = Ctor;
  });

  // ---------- window 事件总线 ----------
  // 逻辑层多处**在顶层无保护地**调用 window.addEventListener(…)
  // （persistence.js:2896/3173、runtime.js:113/122、shell-render.js:13/754/2747、
  //   translator.js:139、error-boundary.js:50 等）。小游戏全局对象上没有这套 API，
  //   缺了会在加载期直接 TypeError ⇒ 整个逻辑层起不来。
  // ⚠️ 必须强制覆盖（不能「原生已有就跳过」）：模拟器里全局对象可能带原生事件 API，
  //    与 document 侧的 shim 注册表不同源 ⇒ 注册了收不到。与 document 三件套同理（2026-09-16）。
  {
    G.addEventListener = function (t, fn, opts) { addListener(G, t, fn, opts); };
    G.removeEventListener = function (t, fn) { removeListener(G, t, fn); };
    G.dispatchEvent = function (ev) {
      var t = ev && ev.type;
      var m = listeners.get(G);
      var arr = m && m[t];
      if (arr) {
        arr.slice().forEach(function (r) {
          try { r.f.call(G, ev); } catch (e) { listenerErrors++; console.warn("[shim] window listener error", e); }
        });
      }
      if (t === "error" && typeof G.onerror === "function") { try { G.onerror(ev); } catch (e) {} }
      return true;
    };
  }
  if (typeof G.CustomEvent !== "function") {
    G.CustomEvent = function (type, opts) {
      this.type = String(type);
      this.detail = opts && "detail" in opts ? opts.detail : null;
      this.bubbles = !!(opts && opts.bubbles);
      this.cancelable = !!(opts && opts.cancelable);
      this.defaultPrevented = false;
      this.target = null;
    };
    G.CustomEvent.prototype.preventDefault = function () {};
    G.CustomEvent.prototype.stopPropagation = function () {};
  }
  if (typeof G.Event !== "function") {
    G.Event = function (type, opts) {
      this.type = String(type);
      this.bubbles = !!(opts && opts.bubbles);
      this.cancelable = !!(opts && opts.cancelable);
      this.defaultPrevented = false;
      this.target = null;
    };
    G.Event.prototype.preventDefault = function () {};
    G.Event.prototype.stopPropagation = function () {};
  }

  // ---------- CanvasRenderingContext2D ----------
  // js/ui/planetary-render.js:5 在顶层给 CanvasRenderingContext2D.prototype 打 roundRect 补丁；
  // 小游戏没有这个全局。优先取小游戏真实 2D 上下文的原型构造器（这样补丁打在真对象上），
  // 取不到才退回桩类（保证加载期不抛错）。
  if (typeof G.CanvasRenderingContext2D !== "function") {
    var CtxCtor = null;
    try {
      if (typeof wx !== "undefined" && typeof wx.createCanvas === "function") {
        var _cv = wx.createCanvas();
        var _ctx = _cv && _cv.getContext && _cv.getContext("2d");
        if (_ctx) {
          var _proto = Object.getPrototypeOf(_ctx);
          if (_proto && typeof _proto.constructor === "function") CtxCtor = _proto.constructor;
        }
      }
    } catch (e) {}
    if (!CtxCtor) {
      CtxCtor = function CanvasRenderingContext2D() {};
      ("arc arcTo beginPath bezierCurveTo clearRect clip closePath drawImage ellipse fill fillRect fillText " +
       "lineTo moveTo putImageData quadraticCurveTo rect restore rotate save scale setTransform stroke " +
       "strokeRect strokeText translate createLinearGradient createRadialGradient createPattern " +
       "getImageData createImageData setLineDash getLineDash").split(" ").forEach(function (m) {
        CtxCtor.prototype[m] = function () { return m === "getLineDash" ? [] : undefined; };
      });
      CtxCtor.prototype.measureText = function () { return { width: 0, actualBoundingBoxAscent: 0, actualBoundingBoxDescent: 0 }; };
    }
    G.CanvasRenderingContext2D = CtxCtor;
  }

  // ---------- localStorage：优先落到小游戏真实存储 ----------
  if (typeof G.localStorage === "undefined") {
    var mem = Object.create(null);
    var hasWx = typeof wx !== "undefined" && typeof wx.setStorageSync === "function";
    G.localStorage = {
      getItem: function (k) {
        if (hasWx) { try { var v = wx.getStorageSync("ls:" + k); return v === "" || v === undefined ? null : v; } catch (e) {} }
        return k in mem ? mem[k] : null;
      },
      setItem: function (k, v) {
        v = String(v);
        if (hasWx) { try { wx.setStorageSync("ls:" + k, v); return; } catch (e) {} }
        mem[k] = v;
      },
      removeItem: function (k) {
        if (hasWx) { try { wx.removeStorageSync("ls:" + k); return; } catch (e) {} }
        delete mem[k];
      },
      clear: function () { mem = Object.create(null); },
      key: function () { return null; },
      get length() { return Object.keys(mem).length; },
    };
  }
})();
