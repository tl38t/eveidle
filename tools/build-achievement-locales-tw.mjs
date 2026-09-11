import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const input = path.join(root, 'steam-achievements-zh-TW.csv');
const output = path.join(root, 'js', 'data', 'achievement-locales-tw.js');
function parseCsv(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false; else cell += ch; }
    else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const header = rows.shift();
  return rows.map(values => Object.fromEntries(header.map((key, index) => [key, values[index] ?? ''])));
}
const rows = parseCsv(fs.readFileSync(input, 'utf8')).filter(row => row.ID && row['Display Name']);
const entries = rows.map(row => `    ${JSON.stringify(row.ID)}: Object.freeze({ name:${JSON.stringify(row['Display Name'])}, description:${JSON.stringify(row.Condition)} })`);
fs.writeFileSync(output, `(function(){\n  const ZH_TW = Object.freeze({\n${entries.join(',\n')}\n  });\n  const root = typeof window !== "undefined" ? window : globalThis;\n  root.AchievementLocales = Object.assign({}, root.AchievementLocales || {}, { "zh-TW": ZH_TW });\n})();\n`, 'utf8');
console.log(`Wrote ${rows.length} zh-TW achievement entries to ${output}`);
