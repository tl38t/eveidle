// HeroStructureGenerator.js — 大船专属结构（舰级递进的"英雄元素"）
//
// 设计目标（Phase 5 大船区分 · 杠杆 B）：
//   让巡洋舰 / 战列舰出现护卫舰 / 驱逐舰根本没有的舰体结构——
//   舰桥塔、传感器桅阵、侧舷外挂舱、脊甲。小船不生成任何内容，
//   于是"大船 = 更复杂、更有分量"，而非仅仅是放大版小船。
//
// 单一职责：返回包含上述专属结构的 THREE.Group；自身无全局状态。
// 材质统一走 Materials.js（AI Rules §6）；不 import 配置文件（§19）。
// 贴附统一走 ctx.sampleHullSurface / ctx.normalAt（曲线 hull），
// 或 _fortressDims（box hull），避免浮空 / 穿模。

import * as THREE from "three";
import { rbox } from "./Materials.js";
import { MaterialFactory } from "./MaterialFactory.js";

// 把对象的 local +Y 对齐到给定表面法线（local -Z 仍朝船首，保证朝向一致）
function orientToNormal(obj, normal) {
  const yAxis = normal.clone().normalize();
  const zAxis = new THREE.Vector3(0, 0, 1);
  let xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();
  zAxis.crossVectors(xAxis, yAxis).normalize();
  obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
}

// 顶面贴附点：box hull 走 _fortressDims，曲线 hull 走 sampleHullSurface
function topPoint(z, off, ctx) {
  if (ctx._fortressDims) {
    const { hullH } = ctx._fortressDims;
    return { pos: new THREE.Vector3(0, hullH * 0.5 + off, z), normal: new THREE.Vector3(0, 1, 0) };
  }
  return { pos: ctx.sampleHullSurface(z, 0, off), normal: ctx.normalAt(z, 0) };
}

// 舷侧贴附点：box 走 _fortressDims，曲线走 sampleHullSurface(side*1.5)
function sidePoint(z, off, side, ctx) {
  if (ctx._fortressDims) {
    const { hullW } = ctx._fortressDims;
    return { pos: new THREE.Vector3(side * (hullW * 0.5 + off), 0, z), normal: new THREE.Vector3(side, 0, 0) };
  }
  const phi = side * 1.5;
  return { pos: ctx.sampleHullSurface(z, phi, off), normal: ctx.normalAt(z, phi) };
}


export function generateHeroStructures(ctx) {
  const { s, L, classTier } = ctx;
  const g = new THREE.Group();
  g.name = "hero";

  // 仅巡洋(2) / 战列(3) 生成；护卫 / 驱逐返回空 Group
  if (classTier < 2) return g;

  const rng = ctx.scope("hero").random;
  const structMat = MaterialFactory.get("panelPlate", ctx);   // 中灰重甲金属
  const darkMat = MaterialFactory.get("weaponBase", ctx);      // 暗色结构
  const glowMat = MaterialFactory.getGlow("ribbon", ctx, 2.2); // 状态灯（取 faction glow 色）
  const off = 0.02 * s;
  const isFortress = classTier >= 3;

  // 血袭者（overloaded）：舰桥塔 + 桅阵 + 外挂舱 + 脊甲
  if (ctx.civ && ctx.civ.hullType === "overloaded") {
    generateBloodHero(g, ctx, s, L, classTier, isFortress, off, structMat, darkMat, glowMat);
    return g;
  }

  // Sansha（modular）：AI 天线阵列 + 尾部六边形核心（仅巡洋/战列）
  if (ctx.civ && ctx.civ.hullType === "modular") {
    generateSanshaHero(g, ctx, s, L, classTier, isFortress, off, glowMat);
    return g;
  }

  return g;
}

// ══ 血袭者英雄结构（原 generateHeroStructures 的主体逻辑）══
function generateBloodHero(g, ctx, s, L, classTier, isFortress, off, structMat, darkMat, glowMat) {
  const rng = ctx.scope("hero").random;
  {
    const towerZ = 0.02 * L;
    const tp = topPoint(towerZ, off, ctx);
    const tower = new THREE.Group();
    const scaleX = isFortress ? 1.3 : 1.0;
    const scaleH = isFortress ? 1.5 : 1.0;
    const baseW = 0.5 * s * scaleX, baseD = 0.7 * s, baseH = 0.22 * s * scaleH;
    const midH = 0.4 * s * (isFortress ? 1.6 : 1.1);
    const topH = 0.28 * s * (isFortress ? 1.5 : 1.0);
    tower.add(rbox(baseW, baseH, baseD, 0.02 * s, structMat, [0, baseH * 0.5, 0]));
    tower.add(rbox(baseW * 0.7, midH, baseD * 0.7, 0.015 * s, structMat, [0, baseH + midH * 0.5, 0]));
    tower.add(rbox(baseW * 0.4, topH, baseD * 0.45, 0.012 * s, darkMat, [0, baseH + midH + topH * 0.5, 0]));
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.04 * s, 8, 6), glowMat);
    lamp.position.set(0, baseH + midH + topH + 0.03 * s, 0);
    tower.add(lamp);
    orientToNormal(tower, tp.normal);
    tower.position.copy(tp.pos);
    g.add(tower);
  }

  // ── ② 传感器桅阵（stern-top masts，巡洋 / 战列）──
  {
    const mastCount = isFortress ? 3 : 2;
    for (let i = 0; i < mastCount; i++) {
      const mz = (0.26 + 0.06 * i) * L;
      const mp = topPoint(mz, off, ctx);
      const mast = new THREE.Group();
      const mastH = 0.5 * s * (isFortress ? 1.2 : 0.9);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02 * s, 0.025 * s, mastH, 8), darkMat);
      pole.position.y = mastH * 0.5;
      mast.add(pole);
      const dish = new THREE.Mesh(new THREE.SphereGeometry(0.06 * s, 8, 6), structMat);
      dish.position.y = mastH;
      mast.add(dish);
      orientToNormal(mast, mp.normal);
      mast.position.copy(mp.pos);
      g.add(mast);
    }
  }

  // ── ③ 战列专属：侧舷外挂舱 + 脊甲 ──
  if (isFortress) {
    // 侧舷外挂舱（左右各一）
    for (const side of [-1, 1]) {
      const pz = -0.05 * L;
      const pp = sidePoint(pz, off, side, ctx);
      const pod = new THREE.Group();
      const podW = 0.3 * s, podH = 0.34 * s, podD = 0.6 * s;
      pod.add(rbox(podW, podH, podD, 0.02 * s, structMat, [0, 0, 0]));
      const cap = new THREE.Mesh(new THREE.SphereGeometry(podW * 0.5, 8, 6), darkMat);
      cap.position.z = podD * 0.5;
      cap.scale.set(1, 1, 0.6);
      pod.add(cap);
      orientToNormal(pod, pp.normal);
      pod.position.copy(pp.pos);
      g.add(pod);
    }
    // 脊甲（dorsal spine，沿顶部中线的细长装甲脊）
    const z0 = -0.3 * L, z1 = 0.18 * L;
    const sp = topPoint((z0 + z1) * 0.5, off, ctx);
    const spine = new THREE.Mesh(new THREE.BoxGeometry(0.12 * s, 0.1 * s, z1 - z0), structMat);
    orientToNormal(spine, sp.normal);
    spine.position.copy(sp.pos);
    g.add(spine);
  }

  return g;
}

// ══ Sansha 英雄结构：AI 天线阵列 + 尾部六边形核心 ══
function generateSanshaHero(g, ctx, s, L, classTier, isFortress, off, glowMat) {
  // ① AI 天线阵列：模块顶部的精密竖条（巡洋 2 条 / 战列 3 条）
  {
    const antCount = isFortress ? 3 : 2;
    const baseZ = isFortress ? -0.22 * L : -0.16 * L;
    for (let i = 0; i < antCount; i++) {
      const az = baseZ + i * 0.10 * L;
      const tp = topPoint(az, off, ctx);
      const antH = (isFortress ? 0.5 : 0.35) * s;
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.015 * s, 0.02 * s, antH, 6), ctx.darkMat);
      orientToNormal(ant, tp.normal);
      ant.position.copy(tp.pos).addScaledVector(tp.normal, antH * 0.5);
      g.add(ant);
      const nub = new THREE.Mesh(new THREE.SphereGeometry(0.025 * s, 6, 6), glowMat);
      nub.position.copy(tp.pos).addScaledVector(tp.normal, antH);
      g.add(nub);
    }
  }

  // ② 尾部第二六边形核心（仅战列）
  if (isFortress) {
    const tailZ = 0.44 * L;
    const tailR = ctx.hullProfile.tail * s * 0.45;
    const core2 = new THREE.Mesh(new THREE.CylinderGeometry(tailR, tailR, tailR * 0.4, 6), glowMat);
    core2.position.set(0, 0.1 * s, tailZ);
    g.add(core2);
  }
}
