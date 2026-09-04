// 验证方向修正：战斗小队面板的「部署物（激光定向打捞单元）」汇总块已删除，
// 船坞（桌面 + 手机）的部署物模块 + 特殊标签保留，并把回收/移出小队入口放到船坞。
// 这是上一轮「误删船坞部署物」的反向验证。
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const files = {
  combat: join(ROOT, "js/ui/combat-render.js"),
  shell: join(ROOT, "js/ui/shell-render.js"),
  sel: join(ROOT, "js/core/selectors.js"),
  tp: join(ROOT, "js/ui/taptap-portrait.js"),
  html: join(ROOT, "index.html"),
};

function rd(p) { return readFileSync(p, "utf8"); }
const combat = rd(files.combat);
const shell = rd(files.shell);
const sel = rd(files.sel);
const tp = rd(files.tp);
const html = rd(files.html);

let pass = 0, fail = 0;
const results = [];
function check(name, cond) {
  if (cond) { pass++; results.push("PASS " + name); }
  else { fail++; results.push("FAIL " + name); }
}

// 1. 战斗面板：renderSquadDeployables 整体删除
check("combat: renderSquadDeployables 函数已删除", !/function renderSquadDeployables/.test(combat));
check("combat: 调用点 deployHtml = renderSquadDeployables 已删除", !/const deployHtml = renderSquadDeployables/.test(combat));
check("combat: 仍保留小队槽位下拉渲染（renderSquadSlot）", /function renderSquadSlot/.test(combat));
check("combat: 已部署 MTU 仍可作为槽位选项（deployableOption）", /deployableOption/.test(combat));
// 2. 船坞（桌面）：保留 special 标签 + renderHangarDeployables
check("shell: 特殊标签 early-return 已恢复", /activeTab === "special"/.test(shell) && /renderHangarDeployables\(display\)/.test(shell));
check("shell: renderHangarDeployables 函数存在", /function renderHangarDeployables/.test(shell));
check("shell: 部署物卡片含 部署/回收 按钮", /data-deploy=/.test(shell) && /data-dismantle-deployable=/.test(shell));
check("shell: 已部署 MTU 含 移出小队（取消部署）按钮", /data-undeploy=/.test(shell) && /移出小队（取消部署）/.test(shell));
check("shell: bindHangarUI 含部署物事件委托", /\[data-deploy\],\[data-undeploy\],\[data-dismantle-deployable\]/.test(shell));
// 3. selectors：特殊标签不再被排除
check("selectors: 不再过滤 special（无 l.id !== \"special\"）", !/hangarLineIds = SHIP_ASSEMBLY_LINES\.filter\(function \(l\) \{ return l\.id !== "special"/.test(sel));
// 4. 手机端船坞：部署物视图恢复
check("tp: tpDeployablesHTML 函数恢复", /function tpDeployablesHTML/.test(tp));
check("tp: tpFiltersHTML 含 部署物 标签", /\["deployables", "部署物"\]/.test(tp));
check("tp: mobileRenderHangarPanel 含 deployables 分支", /_tpHangarFilter === "deployables"/.test(tp));
check("tp: 手机端已部署 MTU 含 移出小队 按钮", /tpDeployablesHTML[\s\S]*?data-undeploy=/.test(tp));
check("tp: hookHangar 含 data-undeploy 委托", /\[data-deploy\],\[data-undeploy\],\[data-dismantle-deployable\]/.test(tp));
// 5. ?v= bump
check("html: selectors.js ?v=69", /selectors\.js\?v=69/.test(html));
check("html: shell-render.js ?v=78", /shell-render\.js\?v=78/.test(html));
check("html: combat-render.js ?v=49", /combat-render\.js\?v=49/.test(html));
check("html: taptap-portrait.js ?v=20", /taptap-portrait\.js\?v=20/.test(html));

console.log(results.join("\n"));
console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail ? 1 : 0);
