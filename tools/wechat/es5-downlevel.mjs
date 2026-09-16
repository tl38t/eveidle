/* 自动生成的产物里若含可选链 `?.` / 空值合并 `??`，微信编译链会**整文件跳过**
 * （>2000KB 的文件不处理）—— 于是这些 ES2020 语法原样落到模拟器运行时，
 * 触发 `SyntaxError` 而黑屏（实测 logic.bundle.js:12815:117）。
 *
 * 本模块：零依赖、等长掩码定位（字符串/注释/正则内容不算命中，
 * 但**模板串 ${} 里的代码算**），把 `?.` / `??` 降级为 ES2018 可解析的等价写法。
 * 已用 globalThis 上的临时槽避免二次求值（禁 `a?.b` → `a == null ? … : a.b` 这种写法，
 * 那会让带副作用的 BASE 被求值两次）。
 *
 * 用法：
 *   node tools/wechat/es5-downlevel.mjs --selftest
 *   node tools/wechat/es5-downlevel.mjs --in <file> [--out <file>]   # 不给 --out 则打印到 stdout
 * 作为模块：
 *   import { downlevelSource, maskCode, findOps } from "./es5-downlevel.mjs"
 */
import fs from "node:fs";

/* ---------------------------------------------------------------- 掩码 ---- */
/** 等长掩码：把「非代码」字符替换为空格，长度严格不变 ⇒ 掩码下标与原文下标一一对应。
 *  非代码 = 行注释 / 块注释 / 字符串字面量内容 / 正则字面量内容 / 模板串的**文本段**；
 *  模板串的 `${ … }` 内部是**代码**，递归按代码处理（否则 `${a?.b}` 会漏检）。 */
export function maskCode(src) {
  const a = src.split("");
  const n = src.length;
  let i = 0;
  let prev = "^"; // 上一个非空白「代码」字符，用于判定 `/` 是正则还是除号
  /* 模板串状态栈：元素为 { brace: number } 表示当前处于某个 ${ } 内部，需记其深度 */
  const tmpl = [];
  let inTmplText = 0; // >0 表示正处在模板串文本段
  let braceDepth = 0;

  while (i < n) {
    const c = src[i], c2 = src[i + 1];

    /* 模板串文本段：只有 ` 与 ${ 有意义 */
    if (inTmplText > 0) {
      if (c === "\\") { a[i] = " "; if (i + 1 < n) a[i + 1] = " "; i += 2; continue; }
      if (c === "`") { inTmplText--; i++; prev = "x"; continue; }
      if (c === "$" && c2 === "{") { inTmplText--; tmpl.push({ brace: braceDepth }); braceDepth++; i += 2; prev = "{"; continue; }
      if (c !== "\n") a[i] = " ";
      i++; continue;
    }

    if (c === "/" && c2 === "/") { while (i < n && src[i] !== "\n") { a[i] = " "; i++; } continue; }
    if (c === "/" && c2 === "*") {
      a[i] = " "; a[i + 1] = " "; i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { if (src[i] !== "\n") a[i] = " "; i++; }
      if (i < n) { a[i] = " "; a[i + 1] = " "; i += 2; }
      continue;
    }
    if (c === '"' || c === "'") {
      const q = c; i++;
      while (i < n) {
        if (src[i] === "\\") { a[i] = " "; if (i + 1 < n) a[i + 1] = " "; i += 2; continue; }
        if (src[i] === q) { i++; break; }
        if (src[i] !== "\n") a[i] = " ";
        i++;
      }
      prev = "x"; continue;
    }
    if (c === "`") { inTmplText++; i++; continue; }
    /* 正则字面量：仅在「上一个代码字符不是值结尾」时才可能是正则起始 */
    if (c === "/" && !/[A-Za-z0-9_$)\]}"'`]/.test(prev)) {
      i++; let inClass = false;
      while (i < n) {
        const d = src[i];
        if (d === "\\") { a[i] = " "; if (i + 1 < n) a[i + 1] = " "; i += 2; continue; }
        if (d === "\n") break;                     // 未闭合：当作除号误判，放弃
        if (d === "[") inClass = true;
        else if (d === "]") inClass = false;
        else if (d === "/" && !inClass) { i++; break; }
        a[i] = " "; i++;
      }
      prev = "x"; continue;
    }
    if (c === "{") braceDepth++;
    else if (c === "}") {
      braceDepth--;
      if (tmpl.length && braceDepth === tmpl[tmpl.length - 1].brace) { tmpl.pop(); inTmplText++; i++; continue; }
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return a.join("");
}

/* ------------------------------------------------- 定位 `?.` / `??` ---- */
/* ⚠️ `?.` 后紧跟**十进制数字**时**不是**可选链 —— 规范里
 * `OptionalChainingPunctuator :: ?. [lookahead ∉ DecimalDigit]`。
 * 这种形状来自「三元 + 前导小数点数字」：
 *   `t > 0 ? 0.5 * t : 0`  ——压缩器去掉空格后——▶  `t>0?.5*t:0`
 * 这是**合法 ES5**（`.5` 是合法数字字面量）。若把它当可选链，
 * 降级器会去改一段本来正确的代码（实测 terser 产物在这种形状上有 23 处）。
 * 实测踩过：粗正则 `/\?\./g` 在 terser 产物上报 23 处假残留 ⇒ 门禁永远红。 */
export function findOps(mask) {
  const ops = [];
  const re = /\?\?|\?\.(?!\d)/g;
  let m;
  while ((m = re.exec(mask))) ops.push({ index: m.index, kind: m[0] === "??" ? "coalesce" : "optional" });
  return ops;
}

/* ------------------------------------------------------ 反向求 BASE 起点 ---- */
const RESERVED = new Set(("break case catch class const continue debugger default delete do else " +
  "export extends finally for function if import in instanceof new return super switch this throw try " +
  "typeof var void while with enum").split(" "));
/* ⚠️ 不要把 get / set / of / async / await / yield / let / static / arguments 塞进来 ——
 * 它们是**上下文**关键字，在别处就是合法标识符。实测踩过：把 get 当保留字
 * ⇒ `get("hull")?.value` 被判「无法解析 BASE」而误报构建失败。
 * ⚠️ 也不要把 null / true / false 塞进来 —— 它们是**合法操作数**（`null?.a` 是合法 JS）。 */

const isWord = (c) => /[A-Za-z0-9_$]/.test(c);

function skipBack(mask, i) { while (i > 0 && /\s/.test(mask[i - 1])) i--; return i; }
function skipFwd(mask, i) { while (i < mask.length && /\s/.test(mask[i])) i++; return i; }

/** 找 `[`/`(` 的配对开括号下标（从闭括号位置起），失败返回 -1 */
function matchOpen(mask, closeIdx) {
  const open = mask[closeIdx] === ")" ? "(" : "[";
  const close = mask[closeIdx];
  let depth = 0;
  for (let i = closeIdx; i >= 0; i--) {
    const c = mask[i];
    if (c === close) depth++;
    else if (c === open) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** 求成员表达式 BASE 的起始下标（endExclusive = `?` 的下标）。失败返回 -1。 */
export function baseStart(mask, endExclusive) {
  let i = endExclusive;
  for (;;) {
    i = skipBack(mask, i);
    if (i <= 0) return i;
    const c = mask[i - 1];
    if (c === ")" || c === "]") {
      const o = matchOpen(mask, i - 1);
      if (o < 0) return -1;
      i = o;                                  // 落在开括号下标；下一轮看它左边是「被调用的标识符」还是别的
      continue;
    }
    if (isWord(c)) {
      let j = i;
      while (j > 0 && isWord(mask[j - 1])) j--;
      const name = mask.slice(j, i);
      if (/^[0-9]/.test(name)) { i = j; continue; }         // 数字字面量，继续往左
      const k = skipBack(mask, j);
      if (k > 0 && mask[k - 1] === ".") { i = k - 1; continue; } // 成员链：a.b.c
      if (RESERVED.has(name)) return -1;                     // 关键字不可能作 BASE
      /* `new Foo()`：BASE 必须连 `new` 一起带上，否则会生成 `new <替换表达式>` 这种非法/错义代码 */
      const kN = skipBack(mask, j);
      if (kN >= 3 && mask.slice(kN - 3, kN) === "new" && (kN - 3 === 0 || !isWord(mask[kN - 4]))) return kN - 3;
      return j;
    }
    /* 字符串/模板字面量直接作 BASE（如 `'a'?.length`）——掩码里字面量内容已抹白，
     * 无法从掩码反推它的起始引号 ⇒ 明确报「不支持」而不是猜。真实代码未出现此形状。 */
    if (c === "'" || c === '"' || c === "`") return -1;
    return i;
  }
}

/* ------------------------------------------- `??` 右操作数终点（前向扫描） ---- */
function coalesceRightEnd(mask, start) {
  let depth = 0;
  let i = start;
  while (i < mask.length) {
    const c = mask[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") { if (depth === 0) break; depth--; }
    else if (depth === 0) {
      if (c === "," || c === ";" || c === "?" || c === ":") break;
      if (c === "=") {
        const n1 = mask[i + 1];
        if (n1 === "=" || n1 === ">") { i += mask[i + 2] === "=" ? 3 : 2; continue; }
        break;                                              // 纯赋值运算符 ⇒ `??` 表达式到此结束
      }
    }
    i++;
  }
  return i;
}

/* ------------------------------------------------------------- 降级 ---- */
const TEMP = "globalThis.__wxOc";

export function downlevelSource(src, opts = {}) {
  const hits = [];
  let out = src;
  let guard = 0;
  for (;;) {
    if (++guard > 20000) throw new Error("es5-downlevel: 迭代次数异常，疑似死循环");
    const mask = maskCode(out);
    const ops = findOps(mask);
    if (ops.length === 0) break;
    const op = ops[0];                                       // 每次处理**最左**一处 ⇒ BASE 内必不含 `?.`
    const at = op.index;
    const line = out.slice(0, at).split("\n").length;
    const col = at - (out.lastIndexOf("\n", at - 1) + 1) + 1;

    if (op.kind === "coalesce") {
      const bs = baseStart(mask, at);
      if (bs < 0) throw new Error(`es5-downlevel: 无法解析 ?? 左侧表达式 @ ${line}:${col}`);
      const be = skipBack(mask, at);
      const rs = skipFwd(mask, at + 2);
      const re = skipBack(mask, coalesceRightEnd(mask, at + 2));
      if (re <= rs) throw new Error(`es5-downlevel: 无法解析 ?? 右侧表达式 @ ${line}:${col}`);
      const base = out.slice(bs, be);
      const right = out.slice(rs, re);
      const rep = `((${TEMP} = ${base}) != null ? ${TEMP} : ${right})`;
      hits.push({ line, col, kind: "coalesce", base, original: out.slice(bs, re), replacement: rep });
      out = out.slice(0, bs) + rep + out.slice(re);
      continue;
    }

    const nextCh = mask[skipFwd(mask, at + 2)];
    const bs = baseStart(mask, at);
    if (bs < 0) throw new Error(`es5-downlevel: 无法解析可选链 BASE @ ${line}:${col}`);
    const be = skipBack(mask, at);
    const base = out.slice(bs, be);
    let rep, end;
    if (nextCh === "(") {                                    // a?.(…) —— 可选调用
      const callOpen = skipFwd(mask, at + 2);
      const close = matchClose(mask, callOpen);
      if (close < 0) throw new Error(`es5-downlevel: 可选调用实参括号不配对 @ ${line}:${col}`);
      const args = out.slice(callOpen + 1, close);
      rep = `((${TEMP} = ${base}) == null ? undefined : ${TEMP}(${args}))`;
      end = close + 1;
    } else if (nextCh === "[") {                             // a?.[k] —— 可选下标
      const idxOpen = skipFwd(mask, at + 2);
      const idxClose = matchClose(mask, idxOpen);
      if (idxClose < 0) throw new Error(`es5-downlevel: 可选下标括号不配对 @ ${line}:${col}`);
      const idx = out.slice(idxOpen + 1, idxClose);
      rep = `((${TEMP} = ${base}) == null ? undefined : ${TEMP}[${idx}])`;
      end = idxClose + 1;
    } else {                                                 // a?.b —— 可选成员
      let j = nextCh === "#" ? at + 4 : at + 2;
      const st = j;
      while (j < mask.length && isWord(mask[j])) j++;
      if (j === st) throw new Error(`es5-downlevel: 可选成员名缺失 @ ${line}:${col}`);
      const prop = out.slice(st, j);
      rep = `((${TEMP} = ${base}) == null ? undefined : ${TEMP}.${prop})`;
      end = j;
    }
    hits.push({ line, col, kind: "optional", base, original: out.slice(bs, end), replacement: rep });
    out = out.slice(0, bs) + rep + out.slice(end);
  }
  return { out, hits, changed: hits.length > 0 };
}

/** 从开括号下标找其配对闭括号下标 */
function matchClose(mask, openIdx) {
  const open = mask[openIdx];
  const close = open === "(" ? ")" : "]";
  let depth = 0;
  for (let i = openIdx; i < mask.length; i++) {
    const c = mask[i];
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

export function lineColOf(s, idx) {
  return { line: s.slice(0, idx).split("\n").length, col: idx - (s.lastIndexOf("\n", idx - 1) + 1) + 1 };
}

/* ------------------------------------------------- 自测（--selftest） ---- */
const CASES = [
  ["element.closest?.('#x')", "((globalThis.__wxOc = element.closest) == null ? undefined : globalThis.__wxOc('#x'))"],
  ["a.b?.c", "((globalThis.__wxOc = a.b) == null ? undefined : globalThis.__wxOc.c)"],
  ["f(x)?.y", "((globalThis.__wxOc = f(x)) == null ? undefined : globalThis.__wxOc.y)"],
  ["o[k]?.m", "((globalThis.__wxOc = o[k]) == null ? undefined : globalThis.__wxOc.m)"],
  ["g(a, b)?.h", "((globalThis.__wxOc = g(a, b)) == null ? undefined : globalThis.__wxOc.h)"],
  ["if (x) a?.b;", "if (x) ((globalThis.__wxOc = a) == null ? undefined : globalThis.__wxOc.b);"],
  ["return foo?.bar;", "return ((globalThis.__wxOc = foo) == null ? undefined : globalThis.__wxOc.bar);"],
  ["typeof a?.b", "typeof ((globalThis.__wxOc = a) == null ? undefined : globalThis.__wxOc.b)"],
  ["const z = q ?? 7;", "const z = ((globalThis.__wxOc = q) != null ? globalThis.__wxOc : 7);"],
  ["t = a.b ?? c.d;", "t = ((globalThis.__wxOc = a.b) != null ? globalThis.__wxOc : c.d);"],
  ["s = `x${a?.b}y`;", "s = `x${((globalThis.__wxOc = a) == null ? undefined : globalThis.__wxOc.b)}y`;"],
  ["n = 'a?.b'.length;", "n = 'a?.b'.length;"],                       // 字符串内不动
  ["// a?.b\nm = 1;", "// a?.b\nm = 1;"],                             // 注释内不动
  ["r = /\\?\\./.test(s);", "r = /\\?\\./.test(s);"],                 // 正则内不动
  /* 压缩器产物形状：三元 + 前导小数点数字。是合法 ES5，**必须原样保留**。 */
  ["x = v > 0?.5:v;", "x = v > 0?.5:v;"],
  ["a = n>=10?.3:n>=5?.2:0;", "a = n>=10?.3:n>=5?.2:0;"],
  ["a?.b?.c", "((globalThis.__wxOc = ((globalThis.__wxOc = a) == null ? undefined : globalThis.__wxOc.b)) == null ? undefined : globalThis.__wxOc.c)"],
  ["new Foo().bar?.baz", "((globalThis.__wxOc = new Foo().bar) == null ? undefined : globalThis.__wxOc.baz)"],
];

function selftest() {
  let pass = 0, fail = 0;
  for (const [input, want] of CASES) {
    let got;
    try { got = downlevelSource(input).out; } catch (e) { got = "THROW: " + e.message; }
    if (got === want) { pass++; console.log("  ✓ " + JSON.stringify(input)); }
    else {
      fail++;
      console.log("  ✗ " + JSON.stringify(input));
      console.log("      期望 " + JSON.stringify(want));
      console.log("      实际 " + JSON.stringify(got));
    }
  }
  /* 行为等价自测：降级前后求值结果必须一致 */
  const BEHAVIOR = [
    ["({a:1})?.a", 1],
    ["({})?.a", undefined],
    ["null?.a", undefined],
    ["undefined?.b", undefined],
    ["[1,2]?.[1]", 2],
    ["null?.[0]", undefined],
    ["(null)?.()", undefined],
    ["((x)=>x*2)?.(21)", 42],
    ["0 ?? 9", 0],
    ["null ?? 9", 9],
    ["undefined ?? 'x'", "x"],
    ["'a'.length", 1],   // 字面量作 BASE 的形状（如 'a'?.length）在下方「边界」用例里断言：被显式拒绝
  ];
  for (const [expr, want] of BEHAVIOR) {
    let before, after;
    try { before = new Function("return (" + expr + ");")(); } catch (e) { before = "THROW"; }
    try { after = new Function("return (" + downlevelSource(expr).out + ");")(); } catch (e) { after = "THROW:" + e.message; }
    const ok = String(before) === String(want) && String(after) === String(want);
    if (ok) { pass++; console.log("  ✓ 行为 " + expr + " → " + String(want)); }
    else { fail++; console.log("  ✗ 行为 " + expr + "  期望 " + String(want) + " 降级前 " + String(before) + " 降级后 " + String(after)); }
  }
  /* 副作用只求值一次 */
  {
    let n = 0;
    const mk = () => { n++; return { v: 5 }; };
    const out = downlevelSource("mk()?.v").out;
    const got = new Function("mk", "return (" + out + ");")(mk);
    if (got === 5 && n === 1) { pass++; console.log("  ✓ 副作用只求值一次（mk 调用 " + n + " 次）"); }
    else { fail++; console.log("  ✗ 副作用次数异常：值 " + got + " 调用 " + n + " 次"); }
  }
  /* 边界：字符串字面量直接作 BASE —— 明确拒绝（而不是猜出一个错的替换） */
  {
    let msg = "";
    try { downlevelSource("'a'?.['length']"); } catch (e) { msg = e.message; }
    if (/无法解析可选链 BASE/.test(msg)) { pass++; console.log("  ✓ 边界：字面量作 BASE → 显式拒绝（" + msg + "）"); }
    else { fail++; console.log("  ✗ 边界：字面量作 BASE 未按预期拒绝，实际：" + (msg || "未抛错")); }
  }
  /* 检测器口径：三元 + 前导小数点数字 ≠ 可选链（规范 lookahead ∉ DecimalDigit） */
  {
    const fake = findOps(maskCode("t>0?.5*t:0  x = n>=10?.3:n>=5?.2:0")).length;
    const real = findOps(maskCode("a?.b + c?.[0] + d?.(1)")).length;
    if (fake === 0 && real === 3) { pass++; console.log("  ✓ 检测器口径：伪形状 0 命中 / 真可选链 3 命中"); }
    else { fail++; console.log("  ✗ 检测器口径异常：伪形状 " + fake + " 命中（应 0）、真可选链 " + real + " 命中（应 3）"); }
  }
  console.log("\n自测结果：通过 " + pass + " 项，失败 " + fail + " 项");
  return fail === 0;
}

/* -------------------------------------------------------------- CLI ---- */
const argv = process.argv.slice(2);
if (argv.includes("--selftest")) {
  process.exit(selftest() ? 0 : 1);
} else if (argv.includes("--in")) {
  const inp = argv[argv.indexOf("--in") + 1];
  const outI = argv.indexOf("--out");
  const src = fs.readFileSync(inp, "utf8");
  const r = downlevelSource(src);
  const rest = findOps(maskCode(r.out));
  if (outI >= 0) fs.writeFileSync(argv[outI + 1], r.out, "utf8");
  else process.stdout.write(r.out);
  console.error(`降级 ${r.hits.length} 处；残余（代码区）?. / ?? = ${rest.length}`);
  process.exit(rest.length === 0 ? 0 : 2);
}
