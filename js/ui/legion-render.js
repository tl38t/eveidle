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

  // 由舰船 type 前缀推断角色（与 legion-npc.getShipRole 同源）
  function shipRoleFromType(type) {
    if (!type) return null;
    if (type.indexOf("industrial") === 0) return "industrial";
    if (type.indexOf("archaeology") === 0) return "archaeology";
    return "combat";
  }
  // 经验倍率 / 舰船适配 说明文案（与 legion-npc.getNpcXpMultiplier 同源）：
  // 返回 { xpNote, shipNote }，直接拼到 NPC 卡片 / 详情弹窗相应行尾。
  function npcXpNoteHtml(st, npc) {
    var skillClass = (typeof LEGION_NPC !== "undefined" && LEGION_NPC.getSkillShipClass)
      ? LEGION_NPC.getSkillShipClass(npc.skillId) : null;
    var xpNote = "";
    var shipNote = "";
    if (!skillClass) {
      // 管理类
      xpNote = "（管理类·不绑定舰船）";
      shipNote = "（管理类·按 9 座建筑等级和）";
    } else if (!npc.boundShipInstanceId) {
      // 非管理、未绑定舰船
      xpNote = "（未绑定舰船）";
      shipNote = "（适配：" + shipClassLabel(skillClass) + "）";
    } else {
      var ships = (st && st.inventory && Array.isArray(st.inventory.ships)) ? st.inventory.ships : [];
      var inst = ships.filter(function (s) { return s.instanceId === npc.boundShipInstanceId; })[0];
      if (!inst) {
        xpNote = "（舰船已销毁）";
        shipNote = "";
      } else {
        var type = (typeof LEGION_NPC !== "undefined" && LEGION_NPC.getShipTypeDef)
          ? LEGION_NPC.getShipTypeDef(inst.shipId) : null;
        var tier = shipTierLabel(type);
        var role = shipRoleFromType(type);
        var clsLabel = role ? shipClassLabel(role) : "—";
        var compat = (typeof LEGION_NPC !== "undefined" && LEGION_NPC.isShipClassCompatible)
          ? LEGION_NPC.isShipClassCompatible(npc.skillId, role) : true;
        shipNote = "（" + tier + "·" + clsLabel + "）";
        if (compat) {
          xpNote = "（绑定：" + getShipDisplayName(inst.shipId) + "·" + tier + "·" + clsLabel + "）";
        } else {
          xpNote = "（绑定：" + getShipDisplayName(inst.shipId) + "·" + tier + "·" + clsLabel + "，不匹配 → 惩罚 ×0.5）";
        }
      }
    }
    return { xpNote: xpNote, shipNote: shipNote };
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
  // ================================================================
  // 议事大厅信息 + 升级（2026-08-29 UI 改版：stat 卡 + 升级消耗卡片）
  // ================================================================
  // 资源显示名：优先走全局 getResourceDisplayName（"mineral:三钛合金" → "三钛合金"），
  // 沙箱/极端环境缺函数时回退取命名空间后段，绝不把 "mineral:" 前缀漏到界面。
  function resDisplayName(key) {
    try {
      if (typeof getResourceDisplayName === "function") return getResourceDisplayName(key);
    } catch (e) { /* fallthrough */ }
    return String(key == null ? "" : key).split(":").pop();
  }
  // 库存查询（enough/short 着色用）；查不到时返回 null = 不判定（视为 enough 样式但不误报）。
  function resStock(key) {
    try {
      if (typeof ResourceRegistry !== "undefined" && ResourceRegistry.get) {
        var st = getState();
        if (st) return Number(ResourceRegistry.get(st, key)) || 0;
      }
    } catch (e) { /* fallthrough */ }
    return null;
  }

  MOD.renderLegionHall = function (now) {
    var el = document.getElementById("legion-hall");
    if (!el) return;
    var st = getState();
    if (!st) return;
    var cur = typeof StationSystem !== "undefined" ? StationSystem.getStationBuildingLevel(st, "legion_hall") : 0;
    var maxLv = (typeof StationSystem !== "undefined" && StationSystem.STATION_MAX_BUILDING_LEVEL) || 5;
    var cap = LEGION_NPC.getLegionNpcCapacity(st);
    var totalNpc = LEGION_NPC.getLegionContributionSnapshot(st).totalNpcCount;
    var npcCap = Math.max(0, cap - 1);
    var mgmtMult = LEGION_NPC.getLegionNpcManagementXpMultiplier ? LEGION_NPC.getLegionNpcManagementXpMultiplier(st) : 0;
    var bodyLevel = (st.station && st.station.bodyLevel) || 0;

    // 军团研究加成（编队上限来源之一）。原 state.legion.technologyLevel 已废弃（恒 0，仅为旧档兼容），
    // 真实生效的是研究树军团分支 legionNpcCapacity。
    // 注意：直接读全局 ResearchState（与 legion-npc.js getResearchStateApi 同源）——
    // 那个 Api 函数是 legion-npc 模块私有函数，在渲染层不可见（曾因此恒显示 +0）。
    var researchBonus = 0;
    try {
      var RSApi = (typeof globalThis !== "undefined" && globalThis.ResearchState) || (typeof window !== "undefined" && window.ResearchState) || null;
      if (RSApi && typeof RSApi.getResearchBonusRaw === "function") {
        researchBonus = Number(RSApi.getResearchBonusRaw(st, "legionNpcCapacity")) || 0;
      }
    } catch (e) { researchBonus = 0; }

    // ── stat 卡 ──
    var html = '<div class="legion-stat-grid">';
    html += '<div class="legion-stat"><div class="ls-label"><i class="fa-solid fa-landmark"></i>议事大厅</div>' +
      '<div class="ls-value">Lv.' + cur + '<small>/' + maxLv + '</small></div>' +
      '<div class="ls-sub">' + (cur >= maxLv ? '已满级' : '建设进度 ' + cur + '/' + maxLv + ' 级') + '</div></div>';
    html += '<div class="legion-stat"><div class="ls-label"><i class="fa-solid fa-users"></i>军团人数</div>' +
      '<div class="ls-value">' + totalNpc + ' <small>/ ' + npcCap + '</small></div>' +
      '<div class="ls-sub">上限 = 6 + 大厅等级 + 研究加成</div></div>';
    html += '<div class="legion-stat"><div class="ls-label"><i class="fa-solid fa-flask"></i>军团研究</div>' +
      '<div class="ls-value">+' + researchBonus + ' <small>上限</small></div>' +
      '<div class="ls-sub">' + (researchBonus > 0 ? '研究树军团分支加成' : '研究树军团分支可提升') + '</div></div>';
    html += '<div class="legion-stat"><div class="ls-label"><i class="fa-solid fa-chart-line"></i>管理经验倍率</div>' +
      '<div class="ls-value">×' + (mgmtMult != null ? mgmtMult.toFixed(2) : "0") + '</div>' +
      '<div class="ls-sub">随 9 座建筑等级和提升</div></div>';
    html += '</div>';

    // ── 升级卡片 ──
    if (cur >= maxLv) {
      html += '<div class="legion-upgrade-card"><div class="legion-upgrade-head">' +
        '<span class="lu-title">议事大厅已达最高等级 Lv.' + maxLv + '</span></div></div>';
    } else {
      var target = cur + 1;
      var plan = (typeof StationSystem !== "undefined" && StationSystem.STATION_LEGION_HALL_PLANS)
        ? StationSystem.STATION_LEGION_HALL_PLANS[target] : null;
      var c = st.station && st.station.construction;
      var constructing = c && c.buildingId === "legion_hall";

      html += '<div class="legion-upgrade-card">';
      html += '<div class="legion-upgrade-head"><span class="lu-title">议事大厅升级</span>' +
        '<span class="lu-title">Lv.' + cur + ' <span class="lu-arrow">→</span> Lv.' + target + '</span>' +
        '<span class="lu-meta"><i class="fa-solid fa-triangle-exclamation" style="color:#d4a843"></i> 需空间站本体 Lv.' + target +
        '（当前 Lv.' + bodyLevel + (bodyLevel >= target ? '，已满足' : '') + '）</span></div>';

      if (plan) {
        var dur = (typeof StationSystem !== "undefined" && StationSystem.getStationConstructionDurationMs)
          ? StationSystem.getStationConstructionDurationMs(st, plan) : 0;
        html += '<div class="legion-upgrade-body"><div>';
        html += '<div class="lu-cost-title">升级消耗</div>';
        html += '<div class="lu-currency"><span>ISK <b>' + fmtInt(plan.isk) + '</b></span>' +
          '<span>功勋 <b>' + fmtInt(plan.lp || 0) + '</b></span></div>';
        if (plan.materials) {
          html += '<div class="legion-mat-list">';
          for (var mk in plan.materials) {
            var need = Number(plan.materials[mk]) || 0;
            var stock = resStock(mk);
            var enough = (stock === null) ? true : stock >= need;
            html += '<div class="legion-mat' + (enough ? ' enough' : ' short') + '"><span>' + resDisplayName(mk) + '</span><b>' + fmtInt(need) + '</b></div>';
          }
          html += '</div>';
        }
        html += '</div><div class="lu-side">';
        html += '<div class="lu-time"><i class="fa-solid fa-clock"></i> 建设时间 <b>' + fmtDuration(dur) + '</b></div>';
      } else {
        html += '<div class="legion-upgrade-body"><div><div class="lu-cost-title">升级消耗</div><div class="lu-time">无 Lv.' + target + ' 建造方案数据</div></div><div class="lu-side">';
      }

      if (constructing) {
        var durC = c.durationMs || 0;
        var pct = durC ? Math.min(100, Math.max(0, (Date.now() - c.startedAt) / durC * 100)) : 0;
        html += '<div class="legion-upgrade-body"><div>' +
          '<div class="lu-cost-title">施工进度</div>' +
          '<div class="lu-time"><i class="fa-solid fa-clock"></i> 剩余 <b>' + fmtDuration(c.completesAt - Date.now()) + '</b>（共 ' + fmtDuration(durC) + '）</div>' +
          '</div><div class="lu-side">' +
          '<button class="btn primary" data-legion-upgrade-hall disabled>建设中 ' + pct.toFixed(0) + '%</button>' +
          '</div></div>';
        html += '<div class="station-construction"><div class="progress-bar"><div class="fill" style="width:' + pct.toFixed(0) + '%"></div></div></div>';
      } else if (bodyLevel < target) {
        html += '<button class="btn primary" data-legion-upgrade-hall disabled>本体等级不足</button>';
      } else {
        html += '<button class="btn primary" data-legion-upgrade-hall>开始升级</button>';
      }
      html += '</div></div>';
    }
    el.innerHTML = html;
  };

  // ================================================================
  // 摘要（倒计时/工资状态，每次 render 都更新）—— 胶囊 chips 风格
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
    var overdue = snap.salary.overdueNpcCount || 0;

    function chip(icon, html, warn) {
      return '<span class="lg-chip' + (warn ? ' warn' : '') + '"><i class="' + icon + '"></i>' + html + '</span>';
    }
    el.innerHTML =
      chip("fa-solid fa-users", '编队 <b>' + snap.totalNpcCount + '/' + npcCap + '</b>') +
      chip("fa-solid fa-user-plus", '候选 <b>' + rs.candidateCount + '</b>') +
      chip("fa-solid fa-money-bill-wave", '工资正常 <b>' + snap.salary.paidNpcCount + '</b> · 欠薪 <b>' + overdue + '</b>', overdue > 0) +
      chip("fa-solid fa-rotate", '下次刷新 <b>' + refreshTxt + '</b>') +
      chip("fa-solid fa-coins", '手动刷新 ' + cost.isk.toLocaleString() + ' 星币 / ' + cost.lp + ' 功勋') +
      chip("fa-solid fa-hourglass-half", '下次结算 <b>' + salaryTxt + '</b>');
  };

  // ================================================================
  // 候选人
  // ================================================================
  // 技能大类中文映射（数据源 category 为英文枚举：production/combat/archaeology/management）
  var LEGION_SKILL_CATEGORY_NAMES = { production: "生产", combat: "战斗", archaeology: "考古", management: "管理" };
  function skillCategoryName(category) { return LEGION_SKILL_CATEGORY_NAMES[category] || category || "—"; }
  // 技能全档效果表（D→A）：grades 结构为 { D:{base,per}, C:..., B:..., A:... }
  function skillGradeRowsHtml(skill, currentGrade) {
    if (!skill || !skill.grades) return '';
    var order = ["D", "C", "B", "A"];
    var rows = '';
    order.forEach(function (g) {
      var gr = skill.grades[g];
      if (!gr) return;
      var isCur = (g === currentGrade);
      rows += '<div class="lc-grade-row' + (isCur ? ' current' : '') + '">' +
        gradeTagHtml(g) +
        '<span>基础 +' + gr.base + '%</span>' +
        '<span>强化 +' + gr.per + '%/次</span>' +
        (isCur ? '<span class="lc-grade-cur">当前档</span>' : '') +
        '</div>';
    });
    return rows ? '<div class="lc-grade-table">' + rows + '</div>' : '';
  }
  // 详情弹窗内容（候选 / 已招募共用骨架），由 legion-events 调 openModal 呈现。
  function skillSectionHtml(skillId, currentGrade) {
    var skill = (typeof LEGION_NPC !== "undefined" && LEGION_NPC.getSkillById) ? LEGION_NPC.getSkillById(skillId) : null;
    if (!skill) return '';
    return '<div class="lc-detail-section"><div class="lc-detail-label">技能 · ' + escapeDetailHtml(skill.name) +
      '（' + skillCategoryName(skill.category) + ' · ' + escapeDetailHtml(skill.type || "") + '）</div>' +
      (skill.effect ? '<div class="lc-detail-line">' + escapeDetailHtml(skill.effect) + '</div>' : '') +
      skillGradeRowsHtml(skill, currentGrade) + '</div>';
  }
  function escapeDetailHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function gradeTagHtml(grade, extraClass) {
    return '<span class="lc-grade-tag grade-' + (grade || "D") + (extraClass ? " " + extraClass : "") + '">' + (grade || "D") + '</span>';
  }
  MOD.buildCandidateDetailHtml = function (cand) {
    if (!cand) return '';
    var grade = cand.skillGrade || "D";
    var cost = LEGION_NPC.RECRUIT_COST[grade] || { isk: 0, lp: 0 };
    var wage = (LEGION_NPC.WAGE && LEGION_NPC.WAGE[grade]) || 0;
    return '<div class="legion-modal-title"><i class="fa-solid fa-user-plus"></i> ' + escapeDetailHtml(cand.name) +
      ' ' + gradeTagHtml(grade) + '</div>' +
      '<div class="legion-modal-body">' +
      '<div class="lc-detail-line">' + escapeDetailHtml(legionPersonalityName(cand.personalityId)) + '</div>' +
      skillSectionHtml(cand.skillId, grade) +
      '<div class="lc-detail-section"><div class="lc-detail-label">招募条件</div>' +
      '<div class="lc-detail-line">招募费：' + cost.isk.toLocaleString() + ' 星币 + ' + cost.lp + ' 功勋</div>' +
      '<div class="lc-detail-line">每 4h 工资：' + wage.toLocaleString() + ' 星币</div></div></div>';
  };
  MOD.buildNpcDetailHtml = function (npc) {
    if (!npc) return '';
    var st = getState();
    var grade = npc.skillGrade || "D";
    var cap = LEGION_NPC.getLegionNpcLevelCap(st);
    var need = 100 + 5 * (npc.level - 1);
    var xp = Number(npc.xp) || 0;
    var xpPct = Math.min(100, Math.max(0, xp / need * 100));
    var xpMult = LEGION_NPC.getNpcXpMultiplier(st, npc);
    var ss = salaryStatus(npc);
    var skillRaw = LEGION_NPC.getLegionNpcSkillRawValue(npc);
    var note = npcXpNoteHtml(st, npc);
    var shipHtml = '未绑定（点击「绑定/更换舰船」分配）';
    if (npc.boundShipInstanceId) {
      var ships = (st.inventory && Array.isArray(st.inventory.ships)) ? st.inventory.ships : [];
      var inst = ships.filter(function (s) { return s.instanceId === npc.boundShipInstanceId; })[0];
      if (inst) {
        var type = (typeof LEGION_NPC !== "undefined" && LEGION_NPC.getShipTypeDef) ? LEGION_NPC.getShipTypeDef(inst.shipId) : null;
        var role = shipRoleFromType(type);
        var compat = (typeof LEGION_NPC !== "undefined" && LEGION_NPC.isShipClassCompatible) ? LEGION_NPC.isShipClassCompatible(npc.skillId, role) : true;
        shipHtml = getShipDisplayName(inst.shipId) + '（' + shipTierLabel(type) + '）' +
          ' · <span class="' + (compat ? 'legion-ok' : 'legion-warn') + '">' + (compat ? '适配' : '不适配') + '</span>';
      } else {
        shipHtml = '（舰船已销毁）';
      }
    }
    return '<div class="legion-modal-title"><i class="fa-solid fa-id-badge"></i> ' + escapeDetailHtml(npc.name) +
      ' ' + gradeTagHtml(grade) + '</div>' +
      '<div class="legion-modal-body">' +
      '<div class="lc-detail-line">' + escapeDetailHtml(legionPersonalityName(npc.personalityId)) + ' · Lv.' + npc.level + '（上限 ' + cap + '）</div>' +
      '<div class="lc-detail-progress"><div class="progress-bar"><div class="fill" style="width:' + xpPct.toFixed(0) + '%"></div></div>' +
      '<span>XP ' + xp.toLocaleString() + ' / ' + need.toLocaleString() + ' · 经验倍率 ×' + (xpMult != null ? xpMult.toFixed(2) : "0.50") + '<span class="lc-xp-note">' + note.xpNote + '</span></span></div>' +
      skillSectionHtml(npc.skillId, grade) +
      '<div class="lc-detail-section"><div class="lc-detail-label">当前贡献</div>' +
      '<div class="lc-detail-line">技能贡献：' + escapeDetailHtml(legionSkillName(npc.skillId)) + ' +' + (skillRaw || 0) + '</div></div>' +
      '<div class="lc-detail-section"><div class="lc-detail-label">舰船与工资</div>' +
      '<div class="lc-detail-line">绑定舰船：' + shipHtml + note.shipNote + '</div>' +
      '<div class="lc-detail-line">每 4h 工资：' + ((LEGION_NPC.WAGE && LEGION_NPC.WAGE[grade]) || 0).toLocaleString() + ' 星币 · <span class="' + ss.cls + '">' + ss.text + '</span>' +
      (npc.salaryState !== "paid" ? ' · <span class="legion-warn">技能与经验暂停</span>' : '') + '</div></div></div>';
  };

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
      var catLabel = skillCategoryName(skill && skill.category);
      return '<div class="legion-card lc-detail-open" data-legion-cand-detail="' + c.npcId + '" style="cursor:pointer;" title="点击查看详情">' +
        '<div class="lc-name">' + c.name + ' ' + gradeTagHtml(grade) + '</div>' +
        '<div class="lc-meta">' + legionPersonalityName(c.personalityId) + '</div>' +
        '<div class="lc-meta">技能：' + skillLabel + '（' + catLabel + '）</div>' +
        '<div class="lc-meta">招募：' + cost.isk.toLocaleString() + ' 星币 / ' + cost.lp + ' 功勋 · 每 4h 工资 ' + (LEGION_NPC.WAGE[grade] || 0).toLocaleString() + ' 星币</div>' +
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
      var note = npcXpNoteHtml(st, n);

      // 舰船信息
      var shipHtml = '无舰船';
      var compatHtml = '';
      if (n.boundShipInstanceId) {
        var inst = ships.filter(function (s) { return s.instanceId === n.boundShipInstanceId; })[0];
        if (inst) {
          var type = (typeof LEGION_NPC !== "undefined" && LEGION_NPC.getShipTypeDef) ? LEGION_NPC.getShipTypeDef(inst.shipId) : null;
          var role = shipRoleFromType(type);
          var tier = shipTierLabel(type);
          var cls = (typeof LEGION_NPC !== "undefined" && LEGION_NPC.getSkillShipClass) ? LEGION_NPC.getSkillShipClass(n.skillId) : null;
          var compat = (typeof LEGION_NPC !== "undefined" && LEGION_NPC.isShipClassCompatible) ? LEGION_NPC.isShipClassCompatible(n.skillId, role) : true;
          compatHtml = ' · <span class="' + (compat ? 'legion-ok' : 'legion-warn') + '">' + (compat ? '适配' : '不适配') + '</span>';
          shipHtml = getShipDisplayName(inst.shipId) + '（' + tier + '）';
        } else {
          shipHtml = '（舰船已销毁）';
        }
      }

      var skillLabel = legionSkillName(n.skillId);
      var pauseTxt = (n.salaryState !== "paid")
        ? ' · <span class="legion-warn">技能暂停 · 经验暂停</span>' : '';

      return '<div class="legion-card lc-detail-open" data-legion-npc-detail="' + n.npcId + '" style="cursor:pointer;" title="点击查看详情">' +
        '<div class="lc-name">' + n.name + ' ' + gradeTagHtml(grade) + '</div>' +
        '<div class="lc-meta">' + legionPersonalityName(n.personalityId) + ' · ' + skillLabel + ' · Lv.' + n.level + '（上限 ' + cap + '）</div>' +
        '<div class="lc-meta">XP ' + (n.xp || 0) + ' / ' + need + ' · 经验倍率 ×' + (xpMult != null ? xpMult.toFixed(2) : "0.50") + '<span class="lc-xp-note">' + note.xpNote + '</span></div>' +
        '<div class="lc-meta">绑定舰船：' + shipHtml + note.shipNote + compatHtml + '</div>' +
        '<div class="lc-meta">每 4h 工资：' + (LEGION_NPC.WAGE[grade] || 0).toLocaleString() + ' · <span class="' + ss.cls + '">' + ss.text + '</span>' + pauseTxt + '</div>' +
        '<div class="lc-actions">' +
          '<button class="btn-mini" data-legion-bind-ship="' + n.npcId + '">绑定/更换舰船</button>' +
          '<button class="btn-mini" data-legion-dismiss="' + n.npcId + '">解雇</button>' +
        '</div>' +
        '</div>';
    }).join("");
  };

  // ================================================================
  // 贡献总览（源自 getLegionContributionSnapshot.effects；仅有效已发薪 NPC）
  // 2026-08-29 UI 改版：按 生产/制造/通用/战斗/探索 五组归类，默认只显生效项（>0%），
  // 未生效项收进 <details> 折叠；全 0 时显示引导文案。
  // ================================================================
  var LEGION_CONTRIB_GROUPS = [
    { title: "生产", icon: "fa-solid fa-pickaxe", rows: [
      ["miningEfficiency", "采矿效率"], ["planetaryEfficiency", "行星采集效率"],
      ["refiningSpeed", "冶炼速度"], ["gasCollectionEfficiency", "气体采集效率"]
    ] },
    { title: "制造", icon: "fa-solid fa-industry", rows: [
      ["shipManufacturingSpeed", "舰船制造速度"], ["equipmentManufacturingSpeed", "装备制造速度"],
      ["boosterManufacturingSpeed", "增强剂制造速度"], ["autolineSpeed", "自动线速度"],
      ["shipComponentCostReduction", "舰船组件消耗减免"], ["wageReduction", "工资减免"]
    ] },
    { title: "通用", icon: "fa-solid fa-star", rows: [
      ["playerNpcXpGain", "玩家与 NPC 经验获取"]
    ] },
    { title: "战斗", icon: "fa-solid fa-crosshairs", rows: [
      ["laserCombatBonus", "激光战斗加成"], ["projectileCombatBonus", "炮弹战斗加成"],
      ["missileCombatBonus", "导弹战斗加成"], ["shieldDefenseBonus", "护盾防御"],
      ["armorDefenseBonus", "装甲防御"], ["hullDefenseBonus", "结构防御"],
      ["capacitorEfficiency", "电容管理"], ["combatRareDropBonus", "战斗稀有掉率"]
    ] },
    { title: "探索", icon: "fa-solid fa-compass", rows: [
      ["archaeologySpeed", "考古速度"], ["archaeologyRareDropBonus", "考古稀有掉率"]
    ] }
  ];
  function contribRow(label, val, zero) {
    return '<div class="lc-contrib-row' + (zero ? ' lc-contrib-zero' : '') + '"><span>' + label + '</span>' +
      '<span class="lc-contrib-val">+' + (val || 0) + '%</span></div>';
  }
  MOD.renderLegionContribution = function (snap) {
    var el = document.getElementById("legion-contribution");
    if (!el) return;
    var e = snap && snap.effects;
    if (!e) { el.innerHTML = ''; return; }
    if (snap.activeNpcCount <= 0) {
      el.innerHTML = '<div class="legion-warn">暂无军团加成 —— 派遣 NPC 并按时发薪后，加成在此生效。</div>';
      return;
    }
    var total = 0;
    var html = '<div class="legion-contrib-title"><i class="fa-solid fa-chart-line"></i> 军团加成' +
      '<small title="同类加成收益递减：多条同类加成同时生效时，实际收益按递减曲线结算">已应用同类递减</small></div>';
    var zeroRows = '';
    LEGION_CONTRIB_GROUPS.forEach(function (g) {
      var active = '';
      var zeros = '';
      g.rows.forEach(function (pair) {
        total++;
        var val = Number(e[pair[0]]) || 0;
        if (val > 0) active += contribRow(pair[1], val, false);
        else zeros += contribRow(pair[1], 0, true);
      });
      if (active) html += '<div class="lc-contrib-group"><div class="lc-contrib-group-title"><i class="' + g.icon + '"></i>' + g.title + '</div>' +
        '<div class="lc-contrib-grid">' + active + '</div></div>';
      zeroRows += zeros;
    });
    var zeroCount = total - countActive(e);
    if (zeroCount > 0) {
      html += '<details class="lg-all-zero"><summary>查看全部 ' + total + ' 项（' + zeroCount + ' 项未生效）</summary>' +
        '<div class="lc-contrib-grid">' + zeroRows + '</div></details>';
    }
    el.innerHTML = html;
  };
  function countActive(e) {
    var n = 0;
    LEGION_CONTRIB_GROUPS.forEach(function (g) {
      g.rows.forEach(function (pair) { if ((Number(e[pair[0]]) || 0) > 0) n++; });
    });
    return n;
  }

  // 经验获取规则弹窗内容（由 legion-events 在「经验获取规则」按钮点击时调用 openModal）
  MOD.buildXpRuleHtml = function () {
    return '' +
      '<div class="legion-modal-title"><i class="fa-solid fa-circle-info"></i> 经验获取规则</div>' +
      '<div class="legion-modal-body">' +
        '<div class="lc-rule-block"><h4>自动获得经验</h4>' +
          '<p>只要 NPC <b class="legion-ok">在岗（未被解雇且未欠薪）</b>，就会按经验倍率自动获取经验，' +
          '<b class="legion-ok">无需绑定舰船也可获得经验</b>。绑定正确舰类只是提高倍率，不影响基础经验获取资格。</p></div>' +
        '<div class="lc-rule-block"><h4>适配舰船大类</h4>' +
          '<div class="lc-rule-ships">' +
            '<div class="lc-rule-ship industrial"><b>工业舰</b><br>采矿 / 行星 / 冶炼 / 气体<br>舰船 / 装备 / 增强剂制造<br><small>例：拓岩级、岩脊级、山海级</small></div>' +
            '<div class="lc-rule-ship combat"><b>战斗舰</b><br>激光 / 炮台 / 导弹 / 护盾<br>装甲 / 船体 / 电容 / 战利品<br><small>例：星矛级、战隼级、星冕级</small></div>' +
            '<div class="lc-rule-ship archaeology"><b>考古舰</b><br>考古速度 / 考古稀有掉率<br><small>例：觅迹级、星图级、启明级</small></div>' +
          '</div></div>' +
        '<div class="lc-rule-block"><h4>管理类技能</h4>' +
          '<p>产线调度、舰材回收、训练教范、薪资统筹不绑定舰船，按 9 座空间站建筑等级和计算：' +
          '0–8=×0.5 / 9–17=×1.0 / 18–26=×1.5 / 27–35=×2.0 / 36–44=×2.5 / 45=×3.0。</p></div>' +
        '<div class="lc-rule-block"><h4>技能进阶</h4>' +
          '<p>每 <b>10 级</b>获得一次技能强化：当前技能效果 = 基础值 + <b>floor(等级 / 10)</b> × 每次强化成长值。' +
          '例如 Lv.10 强化 1 次，Lv.20 强化 2 次，以此类推。</p></div>' +
      '</div>' +
      '<div class="legion-modal-foot"><button class="btn secondary" data-modal-close>关闭</button></div>';
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
