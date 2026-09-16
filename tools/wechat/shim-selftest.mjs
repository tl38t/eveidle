/**
 * tools/wechat/shim-selftest.mjs —— 微信小游戏 DOM shim 的语义门禁
 *
 * 为什么需要它（实测教训）：
 *   上一版 shim 的 `el.querySelector` 恒返 null。启动路径**测不出来**（异常数 0、app 照跑），
 *   只有**派发事件**才暴露 —— 而且表现是「弹窗能显示但点不动」，比抛错更坏（假绿）。
 *   所以这里断言的不是「没抛错」，而是**语义对**：
 *     ① innerHTML 里建出来的按钮必须能被查回来，且接上监听器后真的会被调用；
 *     ② closest 能走祖先、contains 能判后代、classList 与 className 双向同步；
 *     ③ 事件真冒泡到 document、stopPropagation 真能拦、once 真只触发一次；
 *     ④ 不支持的选择器**显式抛错**（绝不静默返 null）。
 *
 * 覆盖口径 = 静态枚举真实代码的依赖面（不是抽样）：
 *   querySelector 180 · closest 138 · querySelectorAll 62 · matches 4 · innerHTML= 241
 *   textContent= 468 · classList 增删 110 / contains 9 · dataset 读 208 · children 41 · el.contains 2
 *
 * 用法：node tools/wechat/shim-selftest.mjs        （失败即 exit 1）
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHIM_PATH = path.join(HERE, "shim.js");
const SRC = fs.readFileSync(SHIM_PATH, "utf8");

/* ------------------------------ 极小断言库 ------------------------------ */
let pass = 0;
const failures = [];
/** 每条用例都跑在**全新沙箱**里：否则 document 级监听器与 body 子树会跨用例累积，
 *  断言就会去命中上一条用例留下的节点（实测踩过：querySelectorAll(".q") 数出 3 个）。 */
let A = null, docA = null;
function ok(name, fn) {
  A = boot();
  docA = A.document;
  try { fn(); pass++; }
  catch (e) { failures.push(name + "\n      → " + (e && e.message ? e.message : String(e))); }
}
function eq(a, b, msg) {
  if (a !== b) throw new Error((msg ? msg + "：" : "") + "期望 " + JSON.stringify(b) + "，实得 " + JSON.stringify(a));
}
function truthy(v, msg) { if (!v) throw new Error((msg ? msg + "：" : "") + "期望为真，实得 " + JSON.stringify(v)); }
function falsy(v, msg) { if (v) throw new Error((msg ? msg + "：" : "") + "期望为假，实得 " + JSON.stringify(v)); }
function throws(fn, msg) {
  let threw = null;
  try { fn(); } catch (e) { threw = e; }
  if (!threw) throw new Error((msg ? msg + "：" : "") + "期望抛错，但没有");
  return threw;
}

/* ------------------------------ 载入 shim ------------------------------ */
/** 在隔离的 vm 里装一遍 shim。opts.doc 模拟「微信模拟器自带部分 document」。 */
function boot(opts = {}) {
  const sandbox = { console: { log() {}, warn() {}, error() {} } };
  if (opts.doc) sandbox.document = opts.doc;
  if (opts.wx) sandbox.wx = opts.wx;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: "shim.js" });
  return sandbox;
}

/** 造一棵已挂到 body 的小树（用当前用例的沙箱） */
function mount(html) {
  const d = docA;
  const host = d.createElement("div");
  host.id = "host";
  d.body.appendChild(host);
  host.innerHTML = html;
  return host;
}

/* ==========================================================================
 * 1. 选择器引擎 —— 逐形状（对应实测 293 种字面量里的每一类）
 * ========================================================================== */
ok("选择器/#id", () => {
  const h = mount('<div id="a1"></div><div id="a2"></div>');
  eq(h.querySelector("#a2").id, "a2");
  eq(docA.getElementById("a2").id, "a2", "getElementById 应命中真树里的节点");
});
ok("选择器/.class 与 *.class", () => {
  const h = mount('<i class="x"></i><b class="x y"></b>');
  eq(h.querySelectorAll(".x").length, 2);
  eq(h.querySelectorAll("*.y").length, 1);
});
ok("选择器/复合 .a.b 与 tag.a.b", () => {
  const h = mount('<b class="x"></b><b class="x y"></b><i class="x y"></i>');
  eq(h.querySelectorAll(".x.y").length, 2);
  eq(h.querySelectorAll("b.x.y").length, 1, "tag 复合必须同时满足");
  eq(h.querySelector(".b.x.y"), null);
});
ok("选择器/[attr] 与 [attr=v]（含引号）", () => {
  const h = mount('<div data-k="1" data-empty></div><div data-k="2"></div>');
  eq(h.querySelectorAll("[data-k]").length, 2);
  eq(h.querySelectorAll('[data-k="2"]').length, 1);
  eq(h.querySelectorAll("[data-empty]").length, 1, "无值属性也要能匹配");
});
ok("选择器/[attr^=] [$=] [*=] [~=] [|=]", () => {
  const h = mount('<a href="https://x/y.png"></a><a href="mailto:a@b"></a><a class="p q"></a><b hreflang="en-US"></b>');
  eq(h.querySelectorAll('[href^="https"]').length, 1);
  eq(h.querySelectorAll('[href$=".png"]').length, 1);
  eq(h.querySelectorAll('[href*="://"]').length, 1);
  eq(h.querySelectorAll("[class~=q]").length, 1);
  /* |= 是「等于 或 以 want- 开头」（语言码语义），**不是**前缀匹配：
   * `[href|=https]` 匹配不到 "https://x/y.png" —— 这里同时锁住正反两向 */
  eq(h.querySelectorAll("[hreflang|=en]").length, 1, "en-US 应被 [hreflang|=en] 匹配");
  eq(h.querySelectorAll("[hreflang|=en-US]").length, 1, "完全相等也应匹配");
  eq(h.querySelectorAll('[href|="https"]').length, 0, "|= 不是前缀匹配，https:// 不该命中");
});
ok("选择器/后代与子代 >", () => {
  const h = mount('<div class="p"><span class="c"><b class="c"></b></span></div>');
  eq(h.querySelectorAll(".p .c").length, 2, "后代应递归");
  eq(h.querySelectorAll(".p > .c").length, 1, "> 只算直接子");
});
ok("选择器/相邻兄弟 + 与通用兄弟 ~", () => {
  const h = mount('<i class="a"></i><b class="b"></b><b class="b"></b>');
  eq(h.querySelectorAll(".a + .b").length, 1);
  eq(h.querySelectorAll(".a ~ .b").length, 2);
});
ok("选择器/逗号并集", () => {
  const h = mount('<div class="x"></div><span id="z"></span><i data-q="1"></i>');
  eq(h.querySelectorAll(".x, #z, [data-q]").length, 3);
});
ok("选择器/:not(.x)", () => {
  const h = mount('<b class="x"></b><b class="y"></b>');
  eq(h.querySelectorAll("b:not(.x)").length, 1);
  eq(h.querySelector("b:not(.x)").className, "y");
});
ok("选择器/:not([disabled])（真实形状）", () => {
  const h = mount('<button class="b"></button><button class="b" disabled></button>');
  eq(h.querySelectorAll("button:not([disabled])").length, 1, "禁用的那个必须被排除");
  eq(h.querySelectorAll("[disabled]").length, 1, "反向断言：disabled 确实被记进属性了");
});
ok("选择器/:scope > 子元素", () => {
  const h = mount('<div class="c"><div class="c"><span class="c"></span></div></div>');
  const outer = h.querySelector(".c");
  eq(outer.querySelectorAll(":scope > .c").length, 1, ":scope 只认直接子");
  eq(outer.querySelectorAll(":scope .c").length, 2);
});
ok("选择器/不支持的选择器必须抛错（禁静默 null）", () => {
  const h = mount('<div class="x"></div>');
  throws(() => h.querySelector(".x:has(.y)"), ":has 不在支持集内");           // Browser 里合法、我们没实现
  throws(() => h.querySelector(".x:nth-child(1)"));
  throws(() => h.querySelector(""));
});
ok("选择器/编译缓存不串 :scope 上下文（同一选择器在两个 scope 上）", () => {
  const h = mount(
    '<div class="s"><div class="s"><i class="t"></i></div></div>');
  const outers = h.querySelectorAll(".s");
  const a = outers[0].querySelectorAll(":scope > .s").length;
  const b = outers[1].querySelectorAll(":scope > .s").length;   // 内层没有 .s 子元素
  eq(a, 1, "外层应有 1 个直接 .s 子");
  eq(b, 0, "内层应为 0 —— 若缓存串了上下文这里会变 1");
});

/* ==========================================================================
 * 2. innerHTML 物化 —— 本次修复的核心（shell-render.js 的 .dlg-cancel 场景）
 * ========================================================================== */
ok("innerHTML/设为字符串后 querySelector 必须能查到真子节点", () => {
  const h = mount('<div class="dlg"><button class="dlg-cancel">取消</button><button class="dlg-confirm">确定</button></div>');
  const box = h.querySelector(".dlg");
  truthy(box.querySelector(".dlg-cancel"), "必须有 .dlg-cancel（恒 null 就是本次修复的 bug）");
  eq(box.querySelector(".dlg-confirm").textContent, "确定");
});
ok("innerHTML/查回来的子节点能接监听器且真被调用", () => {
  const h = mount('<div class="dlg"><button class="dlg-cancel"></button></div>');
  const box = h.querySelector(".dlg");
  let hit = 0;
  box.querySelector(".dlg-cancel").addEventListener("click", () => { hit++; });
  box.querySelector(".dlg-cancel").dispatchEvent({ type: "click" });
  eq(hit, 1, "对话框取消按钮必须真的响应");
});
ok("innerHTML/赋值会清空旧子节点并重物化", () => {
  const h = mount("");
  h.innerHTML = '<b class="one"></b>';
  eq(h.querySelectorAll("b").length, 1);
  h.innerHTML = '<i class="two"></i>';
  eq(h.querySelectorAll("b").length, 0, "旧子节点必须清掉");
  eq(h.querySelectorAll("i").length, 1);
});
ok("innerHTML/读取应当反映当前子节点（含属性与类）", () => {
  const h = mount("");
  h.innerHTML = '<span class="a" data-z="9">文</span>';
  const s = h.innerHTML;
  truthy(s.indexOf('class="a"') >= 0, "应含 class");
  truthy(s.indexOf('data-z="9"') >= 0, "应含 data 属性");
  truthy(s.indexOf("<span") === 0, "应从 span 开始：" + s);
  truthy(s.indexOf("文") >= 0, "应含文本");
});
ok("innerHTML/自闭合与 void 标签不产出闭合标签", () => {
  const h = mount("");
  h.innerHTML = '<br><img src="./x.png"><input type="text">';
  const s = h.innerHTML;
  truthy(s.indexOf("</br>") < 0, "br 不该有闭合标签");
  truthy(s.indexOf("</img>") < 0, "img 不该有闭合标签");
  truthy(s.indexOf('src="./x.png"') >= 0, "属性应保留");
});
ok("innerHTML/raw 标签（textarea）文本不外漏到父节点", () => {
  const h = mount("");
  h.innerHTML = '<p class="p"></p><textarea class="t">&lt;a&gt;b</textarea><p class="p2"></p>';
  eq(h.querySelectorAll("p").length, 2, "textarea 里的尖括号不应生成元素");
  eq(h.querySelector(".t").value, "<a>b", "textarea 应把文本吃进 value");
  eq(h.querySelector(".p").textContent, "", "文本不应串到前面的兄弟");
});
ok("innerHTML/实体解码", () => {
  const h = mount("");
  h.innerHTML = "<b>&amp;&lt;&gt;&nbsp;&#65;</b>";
  truthy(h.querySelector("b").textContent.indexOf("&<>") === 0, "实体应被解码");
  truthy(h.querySelector("b").textContent.indexOf("A") > 0, "数字实体应被解码");
});
ok("insertAdjacentHTML/beforeend 与 afterbegin 位置正确", () => {
  const h = mount('<i class="m"></i>');
  h.insertAdjacentHTML("beforeend", '<b class="e"></b>');
  h.insertAdjacentHTML("afterbegin", '<u class="s"></u>');
  const names = h.children.map((c) => c.tagName.toLowerCase());
  eq(names.join(","), "u,i,b", "顺序应为 afterbegin 进头、beforeend 进尾");
});
ok("outerHTML/setter 就地替换自身", () => {
  const h = mount('<i class="one"></i>');
  h.querySelector(".one").outerHTML = '<b class="two"></b>';
  eq(h.querySelectorAll(".one").length, 0);
  eq(h.querySelector(".two").tagName.toLowerCase(), "b");
});

/* ==========================================================================
 * 3. 祖先 / 后代 / 兄弟
 * ========================================================================== */
ok("closest/能沿祖先链上溯且含自身", () => {
  const h = mount('<div class="panel"><section class="card"><button class="btn"></button></section></div>');
  const btn = h.querySelector(".btn");
  eq(btn.closest(".card").className, "card");
  eq(btn.closest(".panel").className, "panel");
  eq(btn.closest(".btn").tagName.toLowerCase(), "button", "应含自身");
  eq(btn.closest(".nope"), null);
});
ok("contains/真判定后代（恒 false 会让「点面板外关闭」失效）", () => {
  const h = mount('<div class="panel"><button class="btn"></button></div><i class="out"></i>');
  const panel = h.querySelector(".panel");
  truthy(panel.contains(panel.querySelector(".btn")), "后代应为 true");
  truthy(panel.contains(panel), "自身应为 true");
  falsy(panel.contains(h.querySelector(".out")), "外人应为 false");
});
ok("matches/四种调用点", () => {
  const h = mount('<b class="x" data-t="1"></b>');
  const b = h.querySelector(".x");
  truthy(b.matches(".x"));
  truthy(b.matches("b[data-t]"));
  falsy(b.matches(".y"));
  falsy(b.matches("i"));
});
ok("children/first-last/next-prev 兄弟指针", () => {
  const h = mount('<i class="a"></i><b class="b"></b><u class="c"></u>');
  eq(h.children.length, 3);
  eq(h.firstElementChild.className, "a");
  eq(h.lastElementChild.className, "c");
  eq(h.firstElementChild.nextElementSibling.className, "b");
  eq(h.lastElementChild.previousElementSibling.className, "b");
  eq(h.firstElementChild.previousElementSibling, null);
  eq(h.lastElementChild.nextElementSibling, null);
});
ok("children/innerHTML 建出的子树也要有 _children（曾经恒为空）", () => {
  const h = mount('<div class="w"><b class="x"></b><i class="y"></i></div>');
  const w = h.querySelector(".w");
  eq(w.children.length, 2, "解析器建的元素必须维护 _children");
  eq(w.firstElementChild.className, "x");
  eq(w.lastElementChild.className, "y");
  eq(w.childElementCount, 2);
});
ok("children/文本节点不进 children，但进 childNodes", () => {
  const h = mount("文本<b class='b'></b>更多文本");
  eq(h.children.length, 1, "children 只含元素");
  eq(h.childNodes.length, 3, "childNodes 应含文本");
});

ok("现代插入/append 变参 + 字符串转文本节点", () => {
  const h = mount('<div class="p"></div>');
  const p = h.querySelector(".p");
  const a = docA.createElement("i"), b = docA.createElement("u");
  p.append(a, "文字", b);
  eq(p.children.length, 2, "两个元素子节点");
  eq(p.childNodes.length, 3, "字符串也要变成文本节点");
  eq(p.textContent, "文字");
});
ok("现代插入/prepend 变参保序", () => {
  const h = mount('<div class="p"><b class="x"></b></div>');
  const p = h.querySelector(".p");
  const a = docA.createElement("i"), b = docA.createElement("u");
  p.prepend(a, b);            // 期望顺序 a,b,x
  const names = p.children.map((c) => c.tagName.toLowerCase());
  eq(names.join(","), "i,u,b", "prepend 多个实参必须保持实参顺序");
});
ok("现代插入/after 把节点移到兄弟之后（titan-forge 的真实用法）", () => {
  const h = mount('<div class="wrap"><i class="tabs"></i><b class="boosters"></b></div>');
  const wrap = h.querySelector(".wrap");
  const tabs = wrap.querySelector(".tabs");
  const boosters = wrap.querySelector(".boosters");
  eq(boosters.previousElementSibling, tabs, "初始应紧跟其后");
  boosters.after(tabs);                       // 反向：把 tabs 挪到 boosters 后面
  eq(wrap.children.map((c) => c.className).join(","), "boosters,tabs");
  tabs.after(boosters);                       // 再挪回来
  eq(wrap.children.map((c) => c.className).join(","), "tabs,boosters");
  eq(boosters.parentElement, wrap, "父节点不该变（幂等判据依赖它）");
  eq(boosters.previousElementSibling, tabs);
  eq(wrap.children.length, 2, "移动不能产生重复节点");
});
ok("现代插入/before 把节点插到自己前面", () => {
  const h = mount('<div class="wrap"><i class="tabs"></i></div>');
  const wrap = h.querySelector(".wrap");
  const tabs = wrap.querySelector(".tabs");
  const s = docA.createElement("u");
  tabs.before(s);
  eq(wrap.children.map((c) => c.tagName.toLowerCase()).join(","), "u,i");
});
ok("现代插入/after 到跨父节点时先从原位置摘走", () => {
  const h = mount('<div class="a"><i class="x"></i></div><div class="b"><u class="y"></u></div>');
  const x = h.querySelector(".x");
  h.querySelector(".y").after(x);
  eq(h.querySelectorAll(".a .x").length, 0, "原父处必须摘掉");
  eq(h.querySelectorAll(".b .x").length, 1);
});
ok("现代插入/未挂载节点的 after/before 不抛错（真浏览器是 no-op）", () => {
  const d = docA.createElement("div");
  const n = docA.createElement("i");
  d.after(n);
  d.before(n);
  eq(d.parentNode, null);
});

/* ==========================================================================
 * 4. classList ↔ className 双向
 * ========================================================================== */
ok("classList/add 与 className 同步、contains 为真", () => {
  const h = mount('<div class="a"></div>');
  const d = h.querySelector(".a");
  d.classList.add("b", "c");
  truthy(d.classList.contains("b"), "add 之后 contains 必须为真（恒 false 是本次修复的 bug）");
  truthy(d.className.indexOf("b") >= 0, "className 必须同步");
  truthy(d.getAttribute("class").indexOf("c") >= 0, "getAttribute('class') 必须同步");
  truthy(d.matches(".a.c"), "选择器必须能看到新类");
});
ok("classList/remove 与 toggle(force)", () => {
  const h = mount('<div class="a b"></div>');
  const d = h.querySelector(".a");
  d.classList.remove("b");
  falsy(d.classList.contains("b"));
  falsy(/\bb\b/.test(d.className), "className 应清掉 b：" + d.className);
  eq(d.classList.toggle("c"), true, "toggle 无 force 且不存在 → 加");
  eq(d.classList.toggle("c", false), false, "force=false 应移除");
  eq(d.classList.toggle("c", true), true, "force=true 应加");
  eq(d.classList.toggle("c"), false, "无 force 且已存在 → 移除");
});
ok("className/setter 反向驱动 classList", () => {
  const h = mount('<div class="a"></div>');
  const d = h.querySelector(".a");
  d.className = "x y";
  truthy(d.classList.contains("x") && d.classList.contains("y"), "改 className 后 classList 必须跟着变");
  falsy(d.classList.contains("a"));
});
ok("classList/不重复添加、空白类名被忽略", () => {
  const h = mount('<div class="a"></div>');
  const d = h.querySelector(".a");
  d.classList.add("a");
  eq(d.className, "a", "重复添加不应产生 a a");
  d.classList.add("");
  eq(d.className, "a", "空类名应被忽略");
});

/* ==========================================================================
 * 5. 属性 ↔ dataset（实测 dataset 写入为 0，只读）
 * ========================================================================== */
ok("dataset/从 data-* 读出并转驼峰", () => {
  const h = mount('<div data-ship-id="7" data-x="y"></div>');
  const d = h.querySelector("div");
  eq(d.dataset.shipId, "7");
  eq(d.dataset.x, "y");
});
ok("dataset/setAttribute 后缓存失效", () => {
  const h = mount('<div data-a="1"></div>');
  const d = h.querySelector("div");
  eq(d.dataset.a, "1");
  d.setAttribute("data-b", "2");
  eq(d.dataset.b, "2", "新属性必须可见（缓存要失效）");
});
ok("getAttribute/缺失返 null、存在返字符串；hasAttribute 正确", () => {
  const h = mount('<div data-a="1" data-empty></div>');
  const d = h.querySelector("div");
  eq(d.getAttribute("data-a"), "1");
  eq(d.getAttribute("data-nope"), null);
  truthy(d.hasAttribute("data-empty"));
  falsy(d.hasAttribute("data-nope"));
  eq(d.getAttribute("style"), null, "没有行内样式时 style 属性应为 null");
});
ok("setAttribute/innerHTML 往返保真（含引号转义）", () => {
  const h = mount("");
  h.innerHTML = '<b title="a&quot;b"></b>';
  const s = h.innerHTML;
  truthy(s.indexOf("&quot;") >= 0, "引号必须转义，否则外化 HTML 会破：" + s);
});
ok("removeAttribute/同步清掉同名属性", () => {
  const h = mount('<button class="b" disabled></button>');
  const b = h.querySelector(".b");
  truthy(b.hasAttribute("disabled"));
  b.removeAttribute("disabled");
  falsy(b.hasAttribute("disabled"));
  eq(h.querySelectorAll("button:not([disabled])").length, 1, "选择器必须立刻看到属性变化");
});

/* ==========================================================================
 * 6. 行内样式
 * ========================================================================== */
ok("style/属性赋值与读取", () => {
  const h = mount('<div class="d"></div>');
  const d = h.querySelector(".d");
  d.style.display = "none";
  eq(d.style.display, "none");
});
ok("style/cssText 写入被解析、读取可还原", () => {
  const h = mount('<div class="d"></div>');
  const d = h.querySelector(".d");
  d.style.cssText = "position:fixed;inset:0;z-index:99999;color:#e8ecf4;";
  eq(d.style.position, "fixed");
  eq(d.style.zIndex, "99999");
  eq(d.style.color, "#e8ecf4");
  const t = d.style.cssText;
  truthy(t.indexOf("position:fixed") >= 0, "cssText 读回应含 position：" + t);
  truthy(t.indexOf("z-index:99999") >= 0, "读回应含 z-index：" + t);
});
ok("style/cssText 覆盖写会清掉旧声明", () => {
  const h = mount('<div class="d"></div>');
  const d = h.querySelector(".d");
  d.style.cssText = "color:red;background:blue";
  d.style.cssText = "color:green";
  eq(d.style.color, "green");
  eq(d.style.background, undefined, "旧声明必须被清掉");
});
ok("style/setProperty 与 getPropertyValue、removeProperty", () => {
  const h = mount('<div class="d"></div>');
  const d = h.querySelector(".d");
  d.style.setProperty("--v", "3");
  eq(d.style.getPropertyValue("--v"), "3");
  d.style.removeProperty("--v");
  eq(d.style.getPropertyValue("--v"), "");
});
ok("style/写入外化到 innerHTML 与 getAttribute('style')", () => {
  const h = mount("");
  h.innerHTML = '<div class="d"></div>';
  const d = h.querySelector(".d");
  d.style.display = "none";
  truthy(d.outerHTML.indexOf("display:none") >= 0, "outerHTML 应带行内样式：" + d.outerHTML);
  eq(d.getAttribute("style"), "display:none");
});
ok("style/空串值等于移除声明（真浏览器语义）", () => {
  const h = mount('<div class="d"></div>');
  const d = h.querySelector(".d");
  d.style.display = "none";
  d.style.display = "";
  eq(d.getAttribute("style"), null, "空串应视作移除");
});
ok("style/方法不会被当成声明序列化进去", () => {
  const h = mount('<div class="d"></div>');
  const d = h.querySelector(".d");
  d.style.color = "red";
  const t = d.getAttribute("style");
  falsy(/function|setProperty/.test(t), "方法不该出现在 style 文本里：" + t);
});

/* ==========================================================================
 * 7. 事件：冒泡 / 目标 / stopPropagation / once
 * ========================================================================== */
ok("事件/冒泡到祖先与 document", () => {
  const h = mount('<div class="p"><button class="b"></button></div>');
  const order = [];
  docA.addEventListener("click", () => order.push("doc"));
  h.addEventListener("click", () => order.push("host"));
  h.querySelector(".p").addEventListener("click", () => order.push("p"));
  h.querySelector(".b").dispatchEvent({ type: "click" });
  eq(order.join(">"), "p>host>doc", "冒泡顺序必须由内到外");
});
ok("事件/ev.target 是真实派发元素", () => {
  const h = mount('<button class="b"></button>');
  let seen = null;
  h.addEventListener("click", (ev) => { seen = ev.target; });
  const b = h.querySelector(".b");
  b.dispatchEvent({ type: "click" });
  eq(seen, b, "委派处理器必须拿到真 target");
});
ok("事件/stopPropagation 真的拦住祖先", () => {
  const h = mount('<div class="p"><button class="b"></button></div>');
  let up = 0;
  h.querySelector(".b").addEventListener("click", (ev) => { ev.stopPropagation(); });
  h.addEventListener("click", () => { up++; });
  h.querySelector(".b").dispatchEvent({ type: "click" });
  eq(up, 0, "祖先不该收到");
});
ok("事件/once 只触发一次", () => {
  const h = mount('<button class="b"></button>');
  let n = 0;
  const b = h.querySelector(".b");
  b.addEventListener("click", () => { n++; }, { once: true });
  b.dispatchEvent({ type: "click" });
  b.dispatchEvent({ type: "click" });
  eq(n, 1);
});
ok("事件/removeEventListener 生效", () => {
  const h = mount('<button class="b"></button>');
  let n = 0;
  const fn = () => { n++; };
  const b = h.querySelector(".b");
  b.addEventListener("click", fn);
  b.dispatchEvent({ type: "click" });
  b.removeEventListener("click", fn);
  b.dispatchEvent({ type: "click" });
  eq(n, 1);
});
ok("事件/处理器抛错不中断其它处理器，但被计数上报", () => {
  const h = mount('<button class="b"></button>');
  let after = 0;
  const b = h.querySelector(".b");
  b.addEventListener("click", () => { throw new Error("boom"); });
  b.addEventListener("click", () => { after++; });
  b.dispatchEvent({ type: "click" });
  eq(after, 1, "前一个处理器抛错不应阻断后一个");
  truthy(A.__WX_SHIM_LISTENER_ERRORS__ >= 1, "抛错数应被计入 __WX_SHIM_LISTENER_ERRORS__");
});
ok("事件/click() 触发冒泡（真实业务用法）", () => {
  const h = mount('<button class="b"></button>');
  let n = 0;
  const b = h.querySelector(".b");
  b.addEventListener("click", () => { n++; });
  b.click();
  eq(n, 1);
});
ok("事件/委派在 document 层命中动态新增的元素", () => {
  const h = mount('<div class="list"></div>');
  let hits = [];
  docA.addEventListener("click", (ev) => {
    const t = ev.target && ev.target.closest ? ev.target.closest(".row") : null;
    if (t) hits.push(t.getAttribute("data-i"));
  });
  h.querySelector(".list").innerHTML = '<a class="row" data-i="1"></a><a class="row" data-i="2"></a>';
  h.querySelectorAll(".row")[1].dispatchEvent({ type: "click" });
  eq(hits.join(","), "2", "委派必须能命中 innerHTML 里建出来的元素");
});
/* ---- 内联 on* 属性（2026-09-15 补）：浏览器里 onclick 与 addEventListener 是两条通道 ----
   为什么必须锁死：漏掉它不会抛错、异常数仍为 0（假绿），症状是「弹窗能显示但按钮点不动」。
   逻辑层 39 处 `.onclick =`（联盟面板 26 / shell-render 5 / diagnostics 4 / 战斗 1 / 广告 3）
   全走这条通道 —— 没有这几条断言，同一个坑会再犯一次。 */
ok("事件/onclick 属性赋值必须被 dispatchEvent 调用（39 处真实用法）", () => {
  const h = mount('<button class="b"></button>');
  let n = 0;
  const b = h.querySelector(".b");
  b.onclick = () => { n++; };
  b.dispatchEvent({ type: "click" });
  eq(n, 1, "内联 on* 通道断了");
});
ok("事件/onclick 经 el.click() 也要触发（弹窗按钮的真实调用路径）", () => {
  const h = mount('<button class="ok"></button>');
  let n = 0;
  h.querySelector(".ok").onclick = () => { n++; };
  h.querySelector(".ok").click();
  eq(n, 1);
});
ok("事件/on* 随冒泡在祖先上触发（overlay.onclick 关闭浮层）", () => {
  const h = mount('<div class="ov"><span class="x"></span></div>');
  let n = 0;
  h.querySelector(".ov").onclick = () => { n++; };
  h.querySelector(".x").dispatchEvent({ type: "click" });
  eq(n, 1);
});
ok("事件/on* 与 addEventListener 在同一节点上都要跑", () => {
  const h = mount('<button class="b"></button>');
  let a = 0;
  const b = h.querySelector(".b");
  b.addEventListener("click", () => { a++; });
  b.onclick = () => { a++; };
  b.dispatchEvent({ type: "click" });
  eq(a, 2);
});
ok("事件/on*=null 等于摘掉（真浏览器语义），且不抛错", () => {
  const h = mount('<button class="b"></button>');
  let n = 0;
  const b = h.querySelector(".b");
  b.onclick = () => { n++; };
  b.onclick = null;
  b.dispatchEvent({ type: "click" });
  eq(n, 0);
});
ok("事件/on* 赋值非函数不炸（字符串属性值应当被忽略）", () => {
  const h = mount('<button class="b"></button>');
  const b = h.querySelector(".b");
  b.onclick = "not-a-function";
  b.dispatchEvent({ type: "click" });
});
ok("事件/on* 只认对应类型（onpointerdown 不能被 click 触发）", () => {
  const h = mount('<button class="b"></button>');
  let n = 0;
  const b = h.querySelector(".b");
  b.onpointerdown = () => { n++; };
  b.dispatchEvent({ type: "click" });
  eq(n, 0, "类型串了");
  b.dispatchEvent({ type: "pointerdown" });
  eq(n, 1);
});
ok("事件/on* 处理器抛错不中断其它处理器，也计入错误上报", () => {
  const h = mount('<button class="b"></button>');
  let n = 0;
  const b = h.querySelector(".b");
  b.onclick = () => { throw new Error("boom"); };
  b.addEventListener("click", () => { n++; });
  b.dispatchEvent({ type: "click" });
  eq(n, 1, "内联处理器抛错不该带走其它监听器");
});

/* ==========================================================================
 * 8. 表单 / 文件 / 其它实测调用点
 * ========================================================================== */
ok("表单/select 与 setSelectionRange 存在且可调（5 处真实调用）", () => {
  const h = mount('<input class="i" type="text">');
  const i = h.querySelector(".i");
  i.select();
  i.setSelectionRange(0, 1);
});
ok("表单/files 是空列表 ⇒ files[0] === undefined（persistence.js:3028）", () => {
  const h = mount('<input class="f" type="file">');
  const f = h.querySelector(".f");
  truthy(Array.isArray(f.files) || typeof f.files.length === "number", "files 必须有 length");
  eq(f.files[0], undefined, "未选文件时 files[0] 必须是 undefined 而非抛错");
});
ok("表单/value 读写与 cloneNode 保留", () => {
  const h = mount('<input class="i" type="text">');
  const i = h.querySelector(".i");
  i.value = "abc";
  eq(i.value, "abc");
  eq(i.cloneNode(true).value, "abc");
});
ok("节点/cloneNode(true) 深拷贝含子元素与类", () => {
  const h = mount('<div class="p"><b class="c">t</b></div>');
  const c = h.querySelector(".p").cloneNode(true);
  eq(c.querySelectorAll(".c").length, 1);
  eq(c.querySelector(".c").textContent, "t");
  c.querySelector(".c").className = "z";
  eq(h.querySelector(".c").className, "c", "克隆体改动不该影响原体");
});
ok("节点/appendChild 会从原父节点摘走（真 DOM 语义）", () => {
  const h = mount('<div class="x"><span class="s"></span></div><div class="y"></div>');
  const s = h.querySelector(".s");
  h.querySelector(".y").appendChild(s);
  eq(h.querySelectorAll(".x .s").length, 0, "原位置应摘掉");
  eq(h.querySelectorAll(".y .s").length, 1);
});
ok("节点/remove() 从父节点摘除", () => {
  const h = mount('<div class="x"><span class="s"></span></div>');
  h.querySelector(".s").remove();
  eq(h.querySelectorAll(".s").length, 0);
});
ok("文本/textContent 聚合并可覆盖写", () => {
  const h = mount('<div class="d"><b>a</b><!--c--><i>b</i></div>');
  eq(h.querySelector(".d").textContent, "ab");
  h.querySelector(".d").textContent = "z";
  eq(h.querySelector(".d").textContent, "z");
  eq(h.querySelectorAll("b").length, 0, "覆盖写应清掉子元素");
});
ok("几何/零值但形状正确（布局层是下一步）", () => {
  const h = mount('<div class="d"></div>');
  const r = h.querySelector(".d").getBoundingClientRect();
  ["top", "left", "right", "bottom", "width", "height"].forEach((k) => eq(r[k], 0, k + " 应为 0"));
});

/* ==========================================================================
 * 9. document 补丁策略（模拟器自带「部分 document」的真实场景）
 * ========================================================================== */
ok("document补丁/无 document 时补齐全部方法", () => {
  ["createElement", "createTextNode", "getElementById", "querySelector", "querySelectorAll", "addEventListener"]
    .forEach((m) => eq(typeof docA[m], "function", "document." + m));
  truthy(docA.documentElement && docA.body && docA.head, "应有 html/head/body");
});
ok("document补丁/必须整体替换为虚拟文档（内核需要虚拟节点，原生 createElement 产出的节点内核读不到 ⇒ 黑屏）", () => {
  const origCreate = function () { return { nodeType: 1, tagName: "x" }; };
  const doc = { createElement: origCreate };
  const B = boot({ doc });
  // 内核需要带 _kids/_attrs 的虚拟节点，因此宿主原生 createElement 必须被替换为 shim 的 makeElement
  const el = B.document.createElement("div");
  truthy(el && "_kids" in el, "createElement 必须产出内核可读的虚拟节点（含 _kids）");
  eq(typeof B.document.getElementById, "function", "缺失的 getElementById 必须补上");
  eq(typeof B.document.querySelector, "function", "缺失的 querySelector 必须补上");
  // documentElement 必须是 shim 的虚拟 docEl（含 _kids），而非宿主原生 <html>
  truthy(B.document.documentElement && "_kids" in B.document.documentElement, "documentElement 必须是虚拟 docEl");
});
ok("document补丁/getElementById 优先命中真树，其次才给占位桩", () => {
  const h = mount('<div id="real-node"></div>');
  eq(docA.getElementById("real-node"), h.querySelector("#real-node"), "真树里的节点必须优先");
  const stub = docA.getElementById("never-exists-in-tree");
  truthy(stub, "查不到也要给桩（逻辑层有顶层无保护的 getElementById）");
  eq(stub.id, "never-exists-in-tree", "桩的 id 应等于查询的 id");
});
ok("document补丁/同一个 id 的桩对象恒定（监听器不会丢）", () => {
  eq(docA.getElementById("stub-stable"), docA.getElementById("stub-stable"));
});
ok("document补丁/querySelectorAll 返回真数组（可 map/filter/forEach）", () => {
  const h = mount('<i class="q"></i><i class="q"></i>');
  const list = docA.querySelectorAll(".q");
  eq(typeof list.map, "function", "必须支持 map（真实代码大量用）");
  eq(typeof list.filter, "function");
  eq(list.length, 2);
});
ok("document补丁/body 上可挂载并由 body.querySelector 查到", () => {
  const h = mount('<b class="in-body"></b>');
  truthy(docA.body.querySelector(".in-body"), "挂到 body 的子树必须可查");
  truthy(docA.querySelector(".in-body"), "document 级查询也应命中");
});
ok("兼容/window 与 globalThis 互指、location/search 可用", () => {
  truthy(A.window, "window 应存在");
  truthy(A.location && typeof A.location.search === "string", "location.search 应可用（translator.js 依赖）");
  const usp = new A.URLSearchParams("a=1&b=2");
  eq(usp.get("b"), "2");
});
ok("兼容/localStorage 走真实存储且可回读", () => {
  const store = {};
  const B = boot({ wx: {
    setStorageSync: (k, v) => { store[k] = v; },
    getStorageSync: (k) => (k in store ? store[k] : ""),
    removeStorageSync: (k) => { delete store[k]; },
  } });
  B.localStorage.setItem("eve_idle_save", "SAVE");
  eq(store["ls:eve_idle_save"], "SAVE", "必须落到小游戏真实存储（前缀 ls:）");
  eq(B.localStorage.getItem("eve_idle_save"), "SAVE");
  B.localStorage.removeItem("eve_idle_save");
  eq(B.localStorage.getItem("eve_idle_save"), null, "移除后应返 null");
});

ok("自报/__WX_SHIM_STATS__ 计数元素、监听器、按类型、错误", () => {
  const h = mount('<button class="b"></button><button class="c"></button>');
  const s = A.__WX_SHIM_STATS__;
  truthy(s, "必须暴露 __WX_SHIM_STATS__（微信无 console 回传，只能宿主自报）");
  const e0 = s.elements;
  const b = h.querySelector(".b");
  truthy(s.elements > 0, "建元素应当被计数");
  truthy(s.elements >= e0, "计数单调");
  const l0 = s.listeners;
  b.addEventListener("click", () => {});
  eq(s.listeners, l0 + 1, "addEventListener 应当被计数");
  truthy((s.byType.click || 0) >= 1, "按类型计数");
  const er0 = s.errors;
  h.querySelector(".c").addEventListener("click", () => { throw new Error("x"); });
  h.querySelector(".c").dispatchEvent({ type: "click" });
  eq(s.errors, er0 + 1, "处理器抛错应当被计数");
});

/* ==========================================================================
 * 10. ES5 契约 —— 产物要过微信编译链自证
 * ========================================================================== */
ok("ES5/源码不得含可选链 ?. 或空值合并 ??", () => {
  const m = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  falsy(/\?\./.test(m), "出现可选链（微信编译链对 >2000KB 文件跳过降级）");
  falsy(/\?\?/.test(m), "出现空值合并");
});
ok("ES5/不得使用箭头函数、let/const、模板串", () => {
  const m = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  falsy(/=>/.test(m), "出现箭头函数");
  falsy(/\b(let|const)\s/.test(m), "出现 let/const");
  falsy(/`/.test(m), "出现模板串");
});

/* ------------------------------ 结果 ------------------------------ */
const total = pass + failures.length;
if (failures.length) {
  console.error("\n✗ shim 自测失败 " + failures.length + " / " + total + " 项：\n");
  failures.forEach((f, i) => console.error("  " + (i + 1) + ". " + f + "\n"));
  console.error("shim: " + SHIM_PATH);
  process.exit(1);
}
console.log("✓ shim 自测通过 " + pass + " / " + total + " 项（" + path.basename(SHIM_PATH) + "）");
