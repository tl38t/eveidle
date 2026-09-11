import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "STEAM-R1-ACHIEVEMENTS-COPY.md");
const outputPath = path.join(root, "js", "data", "achievement-locales.js");
const source = fs.readFileSync(sourcePath, "utf8");
const entries = [];
const blockPattern = /^## \d+\. ([A-Z]\d{2}) ·.*?\r?\n\r?\n```text\r?\n([\s\S]*?)\r?\n```/gm;

for (const match of source.matchAll(blockPattern)) {
  const id = match[1];
  const block = match[2];
  const name = block.match(/^English Name:\s*(.+)$/m)?.[1]?.trim();
  const description = block.match(/^English Description:\s*(.+)$/m)?.[1]?.trim();
  if (!name || !description) throw new Error(`Missing English copy for ${id}`);
  entries.push({ id, name, description });
}

if (entries.length !== 116) throw new Error(`Expected 116 achievement translations, found ${entries.length}`);
if (new Set(entries.map(entry => entry.id)).size !== entries.length) throw new Error("Duplicate achievement locale IDs");

const lines = entries.map(entry =>
  `    ${JSON.stringify(entry.id)}: Object.freeze({ name:${JSON.stringify(entry.name)}, description:${JSON.stringify(entry.description)} })`
);
const output = `(function () {\n  "use strict";\n  // Generated from STEAM-R1-ACHIEVEMENTS-COPY.md. Do not hand-edit.\n  const EN_US = Object.freeze({\n${lines.join(",\n")}\n  });\n  const AchievementLocales = Object.freeze({ "en-US": EN_US });\n  if (typeof globalThis !== "undefined") globalThis.AchievementLocales = AchievementLocales;\n  if (typeof window !== "undefined") window.AchievementLocales = AchievementLocales;\n})();\n`;

fs.writeFileSync(outputPath, output, "utf8");
console.log(`Wrote ${entries.length} achievement translations to ${path.relative(root, outputPath)}`);
