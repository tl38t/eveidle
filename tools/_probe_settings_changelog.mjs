import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const html = fs.readFileSync(path.join(root, "index.html"), "utf-8");
const shellJs = fs.readFileSync(path.join(root, "js/ui/shell-render.js"), "utf-8");
const changelogJs = fs.readFileSync(path.join(root, "js/data/changelog.js"), "utf-8");
const css = fs.readFileSync(path.join(root, "css/components.css"), "utf-8");

let passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { passed++; console.log(`PASS: ${label}`); }
  else { failed++; console.error(`FAIL: ${label}`); }
}

// 1. 引入与版本号
check("html: 引入 changelog.js?v=1", /js\/data\/changelog\.js\?v=1/.test(html));
check("html: shell-render.js ?v=78", /shell-render\.js\?v=78/.test(html));
check("html: components.css ?v=33", /components\.css\?v=33/.test(html));

// 2. 设置面板有更新内容容器
check("html: settings-panel 含 #setting-changelog", /id="setting-changelog"/.test(html));
check("html: 当前版本行保持不变", /id="setting-game-version"/.test(html));

// 3. changelog.js 内容：V0.7.5 / 0904 / 含「设置界面新增更新内容」
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(changelogJs, sandbox);
const log = sandbox.window.GAME_CHANGELOG;
check("changelog.js: window.GAME_CHANGELOG 为数组且有首项", Array.isArray(log) && log.length > 0);
check("changelog.js: 首项 version = 0.7.5", log && log[0] && log[0].version === "0.7.5");
check("changelog.js: 首项 date = 2026-09-04", log && log[0] && log[0].date === "2026-09-04");
const flatItems = (log[0].sections || []).flatMap(s => s.items || []);
check("changelog.js: 含「行星自动不续费问题一键查询」", flatItems.some(t => t.includes("行星自动不续费问题一键查询")));
check("changelog.js: 含「战斗日志现在会展示弹药消耗」", flatItems.some(t => t.includes("战斗日志现在会展示弹药消耗")));
check("changelog.js: 含「设置界面新增更新内容」", flatItems.some(t => t.includes("设置界面新增更新内容")));

// 4. shell-render 渲染逻辑：读取 GAME_CHANGELOG 并写入 #setting-changelog
check("js: renderSettingsPage 读取 GAME_CHANGELOG", /window\.GAME_CHANGELOG/.test(shellJs));
check("js: renderSettingsPage 填充 #setting-changelog", /getElementById\("setting-changelog"\)/.test(shellJs));
check("js: 使用 escapeAchievementText 转义条目", /escapeAchievementText\(it\)/.test(shellJs));
check("js: 无 changelog 时隐藏容器", /clEl\.style\.display = "none"/.test(shellJs));

// 5. CSS 样式
check("css: .setting-changelog 样式存在", /\.setting-changelog\s*\{/.test(css));
check("css: .changelog-head 样式存在", /\.changelog-head\s*\{/.test(css));
check("css: .changelog-list li 样式存在", /\.changelog-list li/.test(css));

console.log(`\nResults: ${passed}/${passed + failed} passed`);
if (failed > 0) process.exit(1);
