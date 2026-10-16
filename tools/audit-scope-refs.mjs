// 临时作用域扫描器：找出「引用了本文件声明过的名字，但该名字不在引用点的作用域链内」的
// 标识符（= 运行时 ReferenceError 的高危嫌疑）。本次线上 bug（autoenh 分支引用 planauto
// map 回调内的 disabledAttr）正是这一类，node --check 抓不到。
// 用法：node _scan_scope_refs.mjs <file.js> [more.js ...]
import * as acorn from "file:///D:/EVE-IDLE/EVEIDLE-WORKBUDDY-FRESH/node_modules/acorn/dist/acorn.mjs";
import fs from "fs";

const SKIP_KEYS = new Set(["type", "start", "end", "loc", "range", "sourceType"]);

function children(node) {
  const out = [];
  for (const k of Object.keys(node)) {
    if (SKIP_KEYS.has(k)) continue;
    const v = node[k];
    if (!v || typeof v !== "object") continue;
    if (Array.isArray(v)) {
      for (const c of v) if (c && typeof c.type === "string") out.push(c);
    } else if (typeof v.type === "string") out.push(v);
  }
  return out;
}

class Scope {
  constructor(parent, kind) { this.parent = parent; this.kind = kind; this.names = new Map(); }
  declare(name, node) { if (!this.names.has(name)) this.names.set(name, node); }
  has(name) { let s = this; while (s) { if (s.names.has(name)) return true; s = s.parent; } return false; }
  fnScope() { let s = this; while (s && s.kind !== "function" && s.kind !== "global") s = s.parent; return s || this; }
}

function collectBindings(pat, scope, declIds, allDeclared) {
  if (!pat) return;
  switch (pat.type) {
    case "Identifier":
      scope.declare(pat.name, pat); allDeclared.add(pat.name); declIds.add(pat); break;
    case "ObjectPattern":
      for (const p of pat.properties) {
        if (p.type === "RestElement") collectBindings(p.argument, scope, declIds, allDeclared);
        else collectBindings(p.value, scope, declIds, allDeclared);
      }
      break;
    case "ArrayPattern":
      for (const el of pat.elements) if (el) collectBindings(el, scope, declIds, allDeclared);
      break;
    case "AssignmentPattern":
      collectBindings(pat.left, scope, declIds, allDeclared); break;
    case "RestElement":
      collectBindings(pat.argument, scope, declIds, allDeclared); break;
    default: break;
  }
}

function analyze(file) {
  const src = fs.readFileSync(file, "utf8");
  let ast;
  try {
    ast = acorn.parse(src, {
      ecmaVersion: "latest", sourceType: "script",
      locations: true, allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true,
    });
  } catch (e) {
    // ESM 文件回退 module 模式
    ast = acorn.parse(src, {
      ecmaVersion: "latest", sourceType: "module",
      locations: true, allowAwaitOutsideFunction: true,
    });
  }

  const globalScope = new Scope(null, "global");
  const nodeScope = new Map();
  const declIds = new Set();
  const allDeclared = new Set();

  function bindDecls(list, scope) {
    for (const d of list) {
      if (!d) continue;
      collectBindings(d.id, d.type === "VariableDeclarator" && d._kind === "var" ? scope.fnScope() : scope, declIds, allDeclared);
    }
  }

  function build(node, scope) {
    if (!node || typeof node.type !== "string") return;
    const t = node.type;

    if (t === "Program") {
      nodeScope.set(node, scope);
      for (const c of children(node)) build(c, scope);
      return;
    }

    if (t === "FunctionDeclaration" || t === "FunctionExpression" || t === "ArrowFunctionExpression") {
      if (node.id) { scope.declare(node.id.name, node.id); allDeclared.add(node.id.name); declIds.add(node.id); }
      const inner = new Scope(scope, "function");
      for (const p of node.params) collectBindings(p, inner, declIds, allDeclared);
      nodeScope.set(node, scope);
      for (const c of children(node)) {
        if (c === node.id) continue;
        build(c, inner);
      }
      return;
    }

    if (t === "BlockStatement" || t === "StaticBlock" || t === "ForStatement" || t === "ForInStatement" ||
        t === "ForOfStatement" || t === "SwitchStatement") {
      const inner = new Scope(scope, "block");
      nodeScope.set(node, inner);
      for (const c of children(node)) build(c, inner);
      return;
    }

    if (t === "CatchClause") {
      const inner = new Scope(scope, "block");
      if (node.param) collectBindings(node.param, inner, declIds, allDeclared);
      nodeScope.set(node, inner);
      for (const c of children(node)) { if (c === node.param) continue; build(c, inner); }
      return;
    }

    if (t === "VariableDeclaration") {
      const target = node.kind === "var" ? scope.fnScope() : scope;
      for (const d of node.declarations) {
        collectBindings(d.id, target, declIds, allDeclared);
      }
      nodeScope.set(node, scope);
      for (const c of children(node)) build(c, scope);
      return;
    }

    if (t === "ClassDeclaration" || t === "ClassExpression") {
      if (node.id) { scope.declare(node.id.name, node.id); allDeclared.add(node.id.name); declIds.add(node.id); }
      nodeScope.set(node, scope);
      for (const c of children(node)) { if (c === node.id) continue; build(c, scope); }
      return;
    }

    if (t === "ImportDeclaration") {
      for (const s of node.specifiers) {
        if (s.local) { scope.declare(s.local.name, s.local); allDeclared.add(s.local.name); declIds.add(s.local); }
      }
      nodeScope.set(node, scope);
      return;
    }

    nodeScope.set(node, scope);
    for (const c of children(node)) build(c, scope);
  }

  build(ast, globalScope);

  const refs = [];
  function walk(node) {
    if (!node || typeof node.type !== "string") return;
    const scope = nodeScope.get(node) || globalScope;
    switch (node.type) {
      case "Identifier":
        if (!declIds.has(node)) refs.push({ name: node.name, node, scope });
        return;
      case "MemberExpression":
        walk(node.object); if (node.computed) walk(node.property); return;
      case "Property":
        if (node.computed) walk(node.key);
        walk(node.value); return;
      case "MethodDefinition":
      case "PropertyDefinition":
        if (node.computed) walk(node.key);
        walk(node.value); return;
      case "LabeledStatement": walk(node.body); return;
      case "BreakStatement": case "ContinueStatement": case "MetaProperty":
      case "ImportSpecifier": case "ImportDefaultSpecifier": case "ImportNamespaceSpecifier": return;
      default:
        for (const c of children(node)) walk(c);
    }
  }
  walk(ast);

  const problems = [];
  const seen = new Set();
  for (const r of refs) {
    if (!allDeclared.has(r.name)) continue;
    if (r.scope.has(r.name)) continue;
    const key = r.name + "@" + r.node.loc.start.line + ":" + r.node.loc.start.column;
    if (seen.has(key)) continue;
    seen.add(key);
    problems.push({ name: r.name, line: r.node.loc.start.line, col: r.node.loc.start.column });
  }
  return problems;
}

function collect(target, out) {
  const st = fs.statSync(target);
  if (st.isDirectory()) {
    for (const name of fs.readdirSync(target)) {
      if (name === "node_modules" || name === ".git") continue;
      collect(target.replace(/[\\/]+$/, "") + "/" + name, out);
    }
    return;
  }
  if (/\.(js|mjs)$/.test(target)) out.push(target);
}

const inputs = [];
for (const a of process.argv.slice(2)) collect(a, inputs);

let total = 0;
for (const file of inputs) {
  let problems;
  try { problems = analyze(file); }
  catch (e) { console.log(`[PARSE-FAIL] ${file}: ${e.message}`); continue; }
  if (problems.length) {
    console.log(`\n=== ${file} : ${problems.length} 处高危作用域引用 ===`);
    for (const p of problems) console.log(`  ${p.line}:${p.col}  ${p.name}`);
    total += problems.length;
  } else {
    console.log(`OK  ${file}`);
  }
}
console.log(`\nTOTAL: ${total}`);
