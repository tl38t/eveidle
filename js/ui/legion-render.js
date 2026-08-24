/* ================================================================
 * 军团 DLC —— 独立渲染模块（LegionRender）
 * 与 station-render.js 解耦；仅读取统一接口：
 *   LEGION_NPC.*        （军团核心逻辑/贡献快照/文案接口）
 *   getStationDlcNpcWorkers / StationSystem.* （空间站建设接口）
 *   getShipConfigById / SHIP_DATA / SHIP_DATA 索引（舰船名）
 * 不直接判断平台或 DLC 文件；DLC 门禁一律走 getStationDlcNpcWorkers。
 * ================================================================ */
(function (root) {
  var MOD = {};
  var _legionSig = "";

  function getState() { return (typeof gameState !== "undefined") ? gameState : null; }

  function isLegionAvailable() {
    return (typeof LEGION_NPC !== "undefined" && LEGION_NPC.isLegionSystemActive);
  }
  function isActive(state) {
    if (!isLegionAvailable()) return false;
    return LEGION_NPC.isLegionSystemActive(state || getState());
  }

  // 侧边栏「军团」标签可见性：本体 ≥ Lv.3 且已建造军团议事大厅。
  // 与 getStationDlcNpcWorkers（开发期恒放行）无关 —— 仅决定是否显示入口标签。
  MOD.isLegionTabVisible = function (state) {
    var st = state || getState();
    if (!st) return false;
    var bodyLevel = (st.station && st.station.bodyLevel) || 0;
    var hall = (st.station && st.station.buildings && st.station.buildings.legion_hall) || 0;
    return bodyLevel >= 3 && hall >= 1;
  };

  // —— 文案（统一接口；不连续重复由 getNpcDialogue 内部保证） ——
  function npcLine(npc, type, opts) {
    if (typeof LEGION_NPC !== "undefined" && LEGION_NPC.getNpcDialogue) {
      var r = LEGION_NPC.getNpcDialogue(npc, type, opts || {});
      return (r && r.text) || "";
    }
    return "";
  }

  function fmtDuration(ms) {
    if (!isFinite(ms) || ms <= 0) return "—";
    var s = Math.ceil(ms / 1000);
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    if (h > 0) return h + "h " + m + "m";
    if (m > 0) return m + "m " + sec + "s";
    return sec + "s";
  }

  function fmtInt(n) {
    if (typeof n === "number" && isFinite(n)) return Math.round(n).toLocaleString();
    return "0";
  }

  function getShipDisplayName(shipId) {
    if (!shipId) return "—";
    if (typeof getShipConfigById === "function") {
      var c = getShipConfigById(shipId);
      if (c && c.name) return c.name;
    }
    if (typeof SHIP_DATA !== "undefined") {
      var keys = ["STARTER_SHIPS", "INDUSTRIAL_SHIPS", "ARCHAEOLOGY_SHIPS"];
      for (var k = 0; k < keys.length; k++) {
        var coll = SHIP_DATA[keys[k]];
        if (coll && coll[shipId] && coll[shipId].name) return coll[shipId].name;
      }
    }
    return shipId;
  }

  var TIER_LABEL = {
    frigate: "护卫舰", destroyer: "驱逐舰", cruiser: "巡洋舰",
    battleship: "战列舰", capital: "旗舰", supercapital: "超级旗舰"
  };
  function shipTierLabel(type) {
    if (!type) return "—";
    var size = type.split("_").pop();
    return TIER_LABEL[size] || size;
  }
  function shipClassLabel(cls) {
    if (cls === "industrial") return "工业";
    if (cls === "archaeology") return "考古";
    if (cls === "combat") return "战斗";
    return cls || "—";
  }

  function legionPersonalityName(pid) {
    if (typeof LEGION_NPC !== "undefined" && LEGION_NPC.getPersonalityById) {
      var p = LEGION_NPC.getPersonalityById(pid);
      if (p) return p.name || pid;
    }
    return pid || "—";
  }
  function legionSkillName(sid) {
    if (typeof LEGION_NPC !== "undefined" && LEGION_NPC.getSkillById) {
      var s = LEGION_NPC.getSkillById(sid);
      if (s) return s.name || sid;
    }
    return sid || "—";
  }

  // 状态文案：返回 { cls, text }
  function salaryStatus(npc) {
    if (npc.salaryState === "paid") return { cls: "", text: "工资正常" };
    if (npc.salaryState === "upcoming") return { cls: "legion-warn", text: "即将发薪" };
    return { cls: "legion-warn", text: "欠薪" };
  }

  // ================================================================
  // 入口（空间站页面顶部）：始终可见；不满足时显示锁定原因。
  // ================================================================
  MOD.renderLegionEntry = function (now) {
    var el = document.getElementById("legion-entry");
    if (!el) return;
    var st = getState();
    if (!st) { el.style.display = "none"; return; }
    var active = isActive(st);
    if (!active) {
      var reasons = [];
      var bodyLevel = (st.station && st.station.bodyLevel) || 0;
      var hall = (st.station && st.station.buildings && st.station.buildings.legion_hall) || 0;
      if (bodyLevel < 2) reasons.push("需空间站本体 ≥ Lv.2");
      else if (hall < 1) reasons.push("需建造军团议事大厅");
      else if (typeof getStationDlcNpcWorkers === "function" && !getStationDlcNpcWorkers(st)) reasons.push("需军团 DLC 授权");
      el.className = "legion-entry legion-entry-locked";
      el.innerHTML = '<span class="legion-entry-icon">🔒</span>' +
        '<span class="legion-entry-title">军团大厅</span>' +
        '<span class="legion-entry-sub">未解锁：' + (reasons.join(" · ") || "条件不足") + '</span>';
      el.style.cursor = "default";
      return;
    }
    el.className = "legion-entry legion-entry-active";
    el.innerHTML = '<span class="legion-entry-icon">🛡️</span>' +
      '<span class="legion-entry-title">军团大厅</span>' +
      '<span class="legion-entry-sub">已激活 · 点击展开并管理</span>';
    el.style.cursor = "pointer";
  };

  // ================================================================
  // 主区块：仅在激活时显示；其余隐藏。
  // ================================================================
  MOD.renderLegionSection = function (now) {
    var section = document.getElementById("legion-section");
    if (!section) return;
    var st = getState();
    var active = isActive(st);
    section.style.display = active ? "" : "none";
    if (!active) { _legionSig = ""; return; }

    var snap = LEGION_NPC.getLegionContributionSnapshot(st);
    var rs = LEGION_NPC.getLegionCandidateRefreshState(st);

    var sig = MOD.computeLegionSig();
    if (sig !== _legionSig) {
      _legionSig = sig;
      MOD.renderLegionHall(now);
      MOD.renderLegionCandidates(rs);
      MOD.renderLegionNpcs(snap);
    }
    MOD.renderLegionSummary(now, snap, rs);
    MOD.renderLegionContribution(snap);
  };

  // 仅用于签名：NPC/候选/工资/刷新状态变化才重建卡片，避免倒计时抖动。
  MOD.computeLegionSig = function () {
    var st = getState();
    if (!st || !st.legion) return "empty";
    var L = st.legion;
    var parts = [];
    parts.push("A:" + ((L.npcs || []).length));
    parts.push("C:" + ((L.candidates || []).length));
    parts.push("M:" + (L.manualRefreshCount || 0));
    parts.push("R:" + (L.candidateRefreshAt || 0));
    (L.npcs || []).forEach(function (n) {
      parts.push("N:" + n.npcId + ":" + (n.skillGrade || "") + ":" + n.level + ":" + (n.salaryState || "") + ":" + (n.boundShipInstanceId || "-"));
    });
    parts.push("B:" + (st.station && st.station.buildings && st.station.buildings.legion_hall));
    return parts.join("|");
  };

  // ================================================================
  // 议事大厅信息 + 升级
  // ================================================================
  MOD.renderLegionHall = function (now) {
    var el = document.getElementById("legion-hall");
    if (!el) return;
    var st = getState();
    if (!st) return;
    var cur = typeof StationSystem !== "undefined" ? StationSystem.getStationBuildingLevel(st, "legion_hall") : 0;
    var maxLv = (typeof StationSystem !== "undefined" && StationSystem.STATION_MAX_BUILDING_LEVEL) || 5;
    var tech = (st.legion && st.legion.technologyLevel) || 0;
    var cap = LEGION_NPC.getLegionNpcCapacity(st);
    var npcx = LEGION_NPC.getLegionNpcCount(st);
    var mgmtMult = LEGION_NPC.getLegionNpcManagementXpMultiplier ? LEGION_NPC.getLegionNpcManagementXpMultiplier(st) : 0;

    var html = '';
    html += '<div class="legion-status-grid">';
    html += '<div>议事大厅等级：<b>Lv.' + cur + '</b></div>';
    html += '<div>军团总人数：<b>' + (LEGION_NPC.getLegionContributionSnapshot(st).totalNpcCount) + '</b></div>';
    html += '<div>NPC 数量：<b>' + npcx + '</b></div>';
    html += '<div>NPC 上限：<b>' + Math.max(0, cap - 1) + '</b></div>';
    html += '<div>军团科技等级：<b>' + tech + '</b></div>';
    html += '<div>当前管理经验倍率：<b>×' + (mgmtMult != null ? mgmtMult.toFixed(2) : "0") + '</b></div>';
    html += '</div>';

    // 升级块
    if (cur >= maxLv) {
      html += '<div class="legion-warn">议事大厅已达最高等级。</div>';
    } else {
      var target = cur + 1;
      var plan = (typeof StationSystem !== "undefined" && StationSystem.STATION_LEGION_HALL_PLANS)
        ? StationSystem.STATION_LEGION_HALL_PLANS[target] : null;
      var bodyLevel = (st.station && st.station.bodyLevel) || 0;
      html += '<div class="legion-hall-upgrade">';
      html += '<div class="legion-sub-title">升级至 Lv.' + target + '</div>';
      html += '<div class="legion-meta">升级所需空间站等级：Lv.' + target + '（本体当前 Lv.' + bodyLevel + '）</div>';
      if (plan) {
        html += '<div class="legion-meta">ISK：' + fmtInt(plan.isk) + ' · 功勋：' + (plan.lp || 0) + '</div>';
        var mats = [];
        if (plan.materials) {
          for (var mk in plan.materials) mats.push(mk + "：" + fmtInt(plan.materials[mk]));
        }
        if (mats.length) html += '<div class="legion-meta">材料：' + mats.join(" · ") + '</div>';
        var dur = (typeof StationSystem !== "undefined" && StationSystem.getStationConstructionDurationMs)
          ? StationSystem.getStationConstructionDurationMs(st, plan) : 0;
        html += '<div class="legion-meta">建设时间：' + fmtDuration(dur) + '</div>';
      }
      // 建设队列状态
      var c = st.station && st.station.construction;
      if (c && c.buildingId === "legion_hall") {
        var pct = dur ? Math.min(100, Math.max(0, (Date.now() - c.startedAt) / c.durationMs * 100)) : 0;
        html += '<div class="station-construction"><div class="progress-bar"><div class="fill" style="width:' + pct.toFixed(0) + '%"></div></div>';
        html += '<span>建设中…（' + fmtDuration(c.completesAt - Date.now()) + '）</span></div>';
        html += '<button class="btn-mini" data-legion-upgrade-hall disabled>建设中</button>';
      } else if (bodyLevel < target) {
        html += '<div class="legion-warn">本体等级不足，无法升级。</div>';
        html += '<button class="btn-mini" data-legion-upgrade-hall disabled>升级</button>';
      } else {
        html += '<button class="btn-mini" data-legion-upgrade-hall>升级</button>';
      }
      html += '</div>';
    }
    el.innerHTML = html;
  };

  // ================================================================
  // 摘要（倒计时/工资状态，每次 render 都更新）
  // ================================================================
  MOD.renderLegionSummary = function (now, snap, rs) {
    var el = document.getElementById("legion-summary");
    if (!el) return;
    var cap = LEGION_NPC.getLegionNpcCapacity(getState());
    var npcCap = Math.max(0, cap - 1);
    var nextRefresh = rs.nextRefreshAt || 0;
    var refreshTxt = nextRefresh > now ? fmtDuration(nextRefresh - now) : "即将刷新";
    var cost = rs.nextManualRefreshCost || { isk: 0, lp: 0 };
    var L = getState().legion;
    var nextSalary = (L && L.lastSalarySettlementAt ? L.lastSalarySettlementAt : now) + LEGION_NPC.SETTLEMENT_PERIOD_MS;
    var salaryTxt = nextSalary > now ? fmtDuration(nextSalary - now) : "结算中";

    el.innerHTML =
      '<span>编队 ' + snap.totalNpcCount + '/' + npcCap + '</span>' +
      '<span>候选 ' + rs.candidateCount + '</span>' +
      '<span>工资正常 ' + snap.salary.paidNpcCount + ' · 欠薪 ' + snap.salary.overdueNpcCount + '</span>' +
      '<span>下次刷新 ' + refreshTxt + '</span>' +
      '<span>手动刷新 ' + cost.isk.toLocaleString() + ' 星币 / ' + cost.lp + ' 功勋</span>' +
      '<span>下次结算 ' + salaryTxt + '</span>';
  };

  // ================================================================
  // 候选人
  // ================================================================
  MOD.renderLegionCandidates = function (rs) {
    var el = document.getElementById("legion-candidates");
    if (!el) return;
    var st = getState();
    var cands = (st && st.legion && st.legion.candidates) || [];
    if (!cands.length) { el.innerHTML = '<div class="legion-warn">暂无候选人，稍候自动刷新或手动刷新。</div>'; return; }
    el.innerHTML = cands.map(function (c) {
      var grade = c.skillGrade || "D";
      var cost = LEGION_NPC.RECRUIT_COST[grade] || { isk: 0, lp: 0 };
      var skill = (typeof LEGION_NPC !== "undefined" && LEGION_NPC.getSkillById) ? LEGION_NPC.getSkillById(c.skillId) : null;
      var skillLabel = skill ? skill.name : c.skillId;
      var catLabel = skill && skill.category ? skill.category : "—";
      var effectTxt = skill && skill.grades && skill.grades[grade] ? (skill.grades[grade].desc || "") : "";
      return '<div class="legion-card">' +
        '<div class="lc-name">' + c.name + '</div>' +
        '<div class="lc-meta">' + legionPersonalityName(c.personalityId) + '</div>' +
        '<div class="lc-meta">技能：' + skillLabel + '（' + catLabel + '） · ' + grade + '级</div>' +
        (effectTxt ? '<div class="lc-meta">' + effectTxt + '</div>' : '') +
        '<div class="lc-meta">招募：' + cost.isk.toLocaleString() + ' 星币 / ' + cost.lp + ' 功勋</div>' +
        '<div class="lc-meta">每 4h 工资：' + (LEGION_NPC.WAGE[grade] || 0).toLocaleString() + ' 星币</div>' +
        '<div class="lc-actions"><button class="btn-mini" data-legion-recruit="' + c.npcId + '">招募</button></div>' +
        '</div>';
    }).join("");
  };

  // ================================================================
  // NPC 列表
  // ================================================================
  MOD.renderLegionNpcs = function (snap) {
    var el = document.getElementById("legion-npcs");
    if (!el) return;
    var st = getState();
    var npcs = (st && st.legion && st.legion.npcs) || [];
    if (!npcs.length) { el.innerHTML = '<div class="legion-warn">暂无 NPC，先招募候选人。</div>'; return; }

    // 已绑定给其他 NPC 的舰船 → 不可重复选择
    var boundOthers = {};
    npcs.forEach(function (n) { if (n.boundShipInstanceId) boundOthers[n.boundShipInstanceId] = n.npcId; });
    var ships = (st.inventory && Array.isArray(st.inventory.ships)) ? st.inventory.ships : [];

    el.innerHTML = npcs.map(function (n) {
      var grade = n.skillGrade || "D";
      var xpMult = LEGION_NPC.getNpcXpMultiplier(st, n);
      var ss = salaryStatus(n);
      var cap = LEGION_NPC.getLegionNpcLevelCap(st);
      var need = 100 + 5 * (n.level - 1);   // LVn→LVn+1 所需经验（轻量阈值，非递减公式）
      var skillRaw = LEGION_NPC.getLegionNpcSkillRawValue(n);

      // 舰船信息
      var shipHtml = '无舰船';
      var compatHtml = '';
      if (n.boundShipInstanceId) {
        var inst = ships.filter(function (s) { return s.instanceId === n.boundShipInstanceId; })[0];
        if (inst) {
          var type = (typeof LEGION_NPC !== "undefined" && LEGION_NPC.getShipTypeDef) ? LEGION_NPC.getShipTypeDef(inst.shipId) : null;
          var tier = shipTierLabel(type);
          var cls = (typeof LEGION_NPC !== "undefined" && LEGION_NPC.getSkillShipClass) ? LEGION_NPC.getSkillShipClass(n.skillId) : null;
          var compat = (typeof LEGION_NPC !== "undefined" && LEGION_NPC.isShipClassCompatible) ? LEGION_NPC.isShipClassCompatible(n.skillId, type) : true;
          compatHtml = ' · <span class="' + (compat ? 'legion-ok' : 'legion-warn') + '">' + (compat ? '兼容' : '不兼容') + '</span>';
          shipHtml = getShipDisplayName(inst.shipId) + '（' + tier + '）';
        } else {
          shipHtml = '（舰船已销毁）';
        }
      }

      var skillLabel = legionSkillName(n.skillId);
      var pauseTxt = (n.salaryState !== "paid")
        ? ' · <span class="legion-warn">技能暂停 · 经验暂停</span>' : '';

      return '<div class="legion-card">' +
        '<div class="lc-name">' + n.name + '</div>' +
        '<div class="lc-meta">' + legionPersonalityName(n.personalityId) + ' · ' + skillLabel + ' · ' + grade + '级</div>' +
        '<div class="lc-meta">Lv.' + n.level + ' （XP ' + (n.xp || 0) + ' / 需 ' + need + '） · 上限 ' + cap + '</div>' +
        '<div class="lc-meta">绑定舰船：' + shipHtml + compatHtml + ' · 经验倍率 ×' + (xpMult != null ? xpMult.toFixed(2) : "0.50") + '</div>' +
        '<div class="lc-meta">每 4h 工资：' + (LEGION_NPC.WAGE[grade] || 0).toLocaleString() + ' · <span class="' + ss.cls + '">' + ss.text + '</span>' + pauseTxt + '</div>' +
        '<div class="lc-meta">技能贡献：' + skillLabel + ' +' + (skillRaw || 0) + '</div>' +
        '<div class="lc-actions">' +
          '<button class="btn-mini" data-legion-bind-ship="' + n.npcId + '">绑定/更换舰船</button>' +
          '<button class="btn-mini" data-legion-dismiss="' + n.npcId + '">解雇</button>' +
        '</div>' +
        '</div>';
    }).join("");
  };

  // ================================================================
  // 贡献总览（源自 getLegionContributionSnapshot.effects；仅有效已发薪 NPC）
  // ================================================================
  MOD.renderLegionContribution = function (snap) {
    var el = document.getElementById("legion-contribution");
    if (!el) return;
    var e = snap && snap.effects;
    if (!e) { el.innerHTML = ''; return; }
    if (snap.activeNpcCount <= 0) {
      el.innerHTML = '<div class="legion-warn">暂无军团贡献</div>';
      return;
    }
    function row(label, val) {
      return '<div class="lc-contrib-row"><span>' + label + '</span><span class="lc-contrib-val">+' + (val || 0) + '%</span></div>';
    }
    var html = '<div class="lc-contrib-title">军团贡献（已应用同类递减）</div><div class="lc-contrib-grid">';
    html += row("采矿效率", e.miningEfficiency);
    html += row("行星采集效率", e.planetaryEfficiency);
    html += row("冶炼速度", e.refiningSpeed);
    html += row("气体采集效率", e.gasCollectionEfficiency);
    html += row("舰船制造速度", e.shipManufacturingSpeed);
    html += row("装备制造速度", e.equipmentManufacturingSpeed);
    html += row("增强剂制造速度", e.boosterManufacturingSpeed);
    html += row("自动线速度", e.autolineSpeed);
    html += row("舰船组件消耗减免", e.shipComponentCostReduction);
    html += row("工资减免", e.wageReduction);
    html += row("玩家与 NPC 经验获取", e.playerNpcXpGain);
    html += row("激光战斗加成", e.laserCombatBonus);
    html += row("炮弹战斗加成", e.projectileCombatBonus);
    html += row("导弹战斗加成", e.missileCombatBonus);
    html += row("护盾防御", e.shieldDefenseBonus);
    html += row("装甲防御", e.armorDefenseBonus);
    html += row("结构防御", e.hullDefenseBonus);
    html += row("电容管理", e.capacitorEfficiency);
    html += row("战斗稀有掉率", e.combatRareDropBonus);
    html += row("考古速度", e.archaeologySpeed);
    html += row("考古稀有掉率", e.archaeologyRareDropBonus);
    html += '</div>';
    el.innerHTML = html;
  };

  MOD.legionMsg = function (text) {
    var el = document.getElementById("legion-msg");
    if (!el) return;
    el.textContent = text || "";
    el.style.display = text ? "" : "none";
  };

  MOD.getShipDisplayName = getShipDisplayName;
  root.LegionRender = MOD;
  if (typeof module !== "undefined" && module.exports) module.exports = MOD;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
