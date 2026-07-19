import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.resolve(toolDir, "..");
const sourceFile = path.resolve(toolDir, "..", "..", "index.html");

const normalize = (value) => value.replace(/\r\n/g, "\n");
const source = normalize(fs.readFileSync(sourceFile, "utf8"));

const styleMatch = source.match(/<style>([\s\S]*?)<\/style>/);
const bodyMatch = source.match(/<body>([\s\S]*?)<script>/);
const scriptMatch = source.match(/<script>([\s\S]*?)<\/script>/);

if (!styleMatch || !bodyMatch || !scriptMatch) {
  throw new Error("无法从原 index.html 提取 style、body 或 script 区域");
}

function ensureMarker(content, marker) {
  const index = content.indexOf(marker);
  if (index < 0) throw new Error(`找不到拆分标记：${marker}`);
  return index;
}

function splitByMarkers(content, markers, files) {
  if (files.length !== markers.length + 1) {
    throw new Error("拆分文件数量与标记数量不一致");
  }
  const positions = markers.map((marker) => ensureMarker(content, marker));
  for (let i = 1; i < positions.length; i += 1) {
    if (positions[i] <= positions[i - 1]) throw new Error("拆分标记顺序错误");
  }
  const boundaries = [0, ...positions, content.length];
  files.forEach((file, index) => {
    const target = path.join(outputDir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content.slice(boundaries[index], boundaries[index + 1]).trim() + "\n", "utf8");
  });
}

const css = styleMatch[1];
splitByMarkers(
  css,
  [
    "/* ===== 装备工程面板 ===== */",
    "/* ===== 战斗面板 ===== */",
    "/* ===== 经验条 ===== */"
  ],
  [
    "css/base.css",
    "css/panels.css",
    "css/combat.css",
    "css/components.css"
  ]
);

const script = scriptMatch[1];
const scriptFiles = [
  "js/data/base.js",
  "js/data/planets.js",
  "js/data/ships.js",
  "js/data/equipment.js",
  "js/data/combat.js",
  "js/data/ammunition.js",
  "js/core/state.js",
  "js/systems/production.js",
  "js/systems/manufacturing.js",
  "js/systems/planetary.js",
  "js/ui/action-modal.js",
  "js/core/queue.js",
  "js/systems/combat.js",
  "js/core/tick.js",
  "js/core/offline.js",
  "js/ui/render.js",
  "js/core/persistence.js"
];

splitByMarkers(
  script,
  [
    "// ---- 行星类型配置表 ----",
    "// ---- 舰船工程：T1 部件配方表 ----",
    "// ---- 装备工程：T1装备数据库（参照20260712细化） ----",
    "// ---- 战斗：敌人数据库 ----",
    "// ---- 弹药工程配方表 ----",
    "// ---- gameState 主状态对象 ----",
    "const MINING_AREAS = [",
    "/* ================================================================\n   舰船工程系统",
    "/* ================================================================\n   行星开发系统",
    "/* ================================================================\n   执行确认弹窗",
    "/* ================================================================\n   动作队列引擎",
    "/* ================================================================\n   战斗系统 — UI 渲染",
    "// 队列失败/资源不足时：跳转到下一项或停止",
    "/* ================================================================\n   离线收益计算",
    "/* ================================================================\n   侧边栏等级刷新",
    "/* ================================================================\n   存档系统"
  ],
  scriptFiles
);

const scriptTags = scriptFiles
  .map((file) => `  <script defer src="./${file.replaceAll("\\", "/")}"></script>`)
  .join("\n");

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>EVE放置：新伊甸纪元</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;600;700;900&family=Rajdhani:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
<link rel="stylesheet" href="./css/base.css">
<link rel="stylesheet" href="./css/panels.css">
<link rel="stylesheet" href="./css/combat.css">
<link rel="stylesheet" href="./css/components.css">
</head>
<body>${bodyMatch[1].trimEnd()}

${scriptTags}
</body>
</html>
`;

fs.writeFileSync(path.join(outputDir, "index.html"), html, "utf8");

const sourceImages = path.resolve(toolDir, "..", "..", "images");
const outputImages = path.join(outputDir, "images");
if (fs.existsSync(sourceImages)) {
  fs.rmSync(outputImages, { recursive: true, force: true });
  fs.cpSync(sourceImages, outputImages, { recursive: true });
}

const readme = `# EVE Idle modular version

本目录是从项目根目录现有 \`index.html\` 拆分出的独立版本。根目录原文件不会被生成脚本修改。

## 本地运行

请通过 HTTP 服务访问，不要直接双击 HTML：

在 \`eveidle-modular\` 目录中运行：

\`\`\`powershell
node ./tools/serve.mjs 8000
\`\`\`

然后访问 \`http://localhost:8000/\`。

## Netlify

- 手动部署：上传整个 \`eveidle-modular\` 文件夹，而不是只上传 \`index.html\`。
- Git 部署：将 Publish directory 指向 \`eveidle-modular\`，Build command 留空。

## 目录职责

- \`css/\`：按原始加载顺序拆分的样式。
- \`js/data/\`：配置表与静态数据。
- \`js/core/\`：状态、队列、tick、离线和存档。
- \`js/systems/\`：生产、制造、行星与战斗系统。
- \`js/ui/\`：弹窗、渲染和事件绑定。
- \`images/\`：本版本独立使用的图片副本。

当前采用按顺序加载的原生 JavaScript 文件，不需要 npm 或构建命令。这样可以先确保拆分前后行为一致，再逐步收紧模块边界。
`;

fs.writeFileSync(path.join(outputDir, "README.md"), readme, "utf8");

console.log(`已生成 ${scriptFiles.length} 个 JavaScript 文件、4 个 CSS 文件和独立 index.html`);
