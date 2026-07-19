import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(toolsDir, "..");
const htmlPath = path.join(root, "three-demo.html");
const cssPath = path.join(root, "css", "three-demo.css");
const jsPath = path.join(root, "js", "three-demo.js");
const outputPath = path.join(root, "three-demo-standalone.html");

const html = fs.readFileSync(htmlPath, "utf8");
const css = fs.readFileSync(cssPath, "utf8");
const js = fs.readFileSync(jsPath, "utf8");

const standalone = html
  .replace(
    '<link rel="stylesheet" href="./css/three-demo.css">',
    `<style>\n${css}\n</style>`
  )
  .replace(
    '<a class="back-link" href="./index.html">← 返回游戏</a>',
    '<span class="back-link">EVE IDLE · 独立演示</span>'
  )
  .replace(
    '<script type="module" src="./js/three-demo.js"></script>',
    `<script type="module">\n${js}\n</script>`
  )
  .replace(
    '<noscript>此演示需要启用 JavaScript。</noscript>',
    '<noscript>此演示需要启用 JavaScript，并需要联网加载 Three.js。</noscript>'
  );

if (standalone.includes('./css/three-demo.css') || standalone.includes('./js/three-demo.js')) {
  throw new Error("Standalone replacement failed: local asset references remain.");
}

fs.writeFileSync(outputPath, standalone, "utf8");
console.log(`Standalone demo generated: ${outputPath}`);
