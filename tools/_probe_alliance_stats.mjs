// 探针：在 vm 沙箱加载 alliance-render.js，验证 formatRelativeTime 助手 + 文件可加载无抛错。
import { readFileSync } from "node:fs";
import vm from "node:vm";

const code = readFileSync("js/ui/alliance-render.js", "utf8");
const sandbox = { window: {}, document: { getElementById: () => null, querySelector: () => null, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), head: { appendChild() {} }, body: { appendChild() {} } }, localStorage: { getItem: () => null, setItem() {} }, console };
sandbox.window = sandbox; // 让 root = window，且属性落到 sandbox
vm.createContext(sandbox);
let pass = true;
const msgs = [];
try {
  vm.runInContext(code, sandbox, { filename: "alliance-render.js" });
} catch (e) {
  pass = false;
  msgs.push("加载抛错: " + e.message);
}

const fmt = sandbox.AllianceRenderHelpers && sandbox.AllianceRenderHelpers.formatRelativeTime;
if (typeof fmt !== "function") { pass = false; msgs.push("AllianceRenderHelpers.formatRelativeTime 未导出"); }
else {
  const now = Date.now();
  const cases = [
    [null, "从未上线"],
    ["", "从未上线"],
    [new Date(now - 30000).toISOString(), "刚刚"],
    [new Date(now - 5 * 60000).toISOString(), "5 分钟前"],
    [new Date(now - 3 * 3600000).toISOString(), "3 小时前"],
    [new Date(now - 2 * 86400000).toISOString(), "2 天前"],
    [new Date(now - 60 * 86400000).toISOString(), "2 个月前"],
    [new Date(now - 400 * 86400000).toISOString(), "1 年前"],
  ];
  for (const [input, expected] of cases) {
    const got = fmt(input);
    if (got !== expected) { pass = false; msgs.push(`formatRelativeTime(${JSON.stringify(input)}) = "${got}"，期望 "${expected}"`); }
  }
}
// 确认文件顶层导出了 renderAlliancePage（renderMemberCard 等内部函数已就绪）
if (typeof sandbox.renderAlliancePage !== "function") { pass = false; msgs.push("renderAlliancePage 未导出"); }

console.log(pass ? "PASS —— alliance-render.js 加载正常，formatRelativeTime 相对时间全部正确 ✅" : "FAIL —— " + msgs.join("; "));
process.exit(pass ? 0 : 1);
