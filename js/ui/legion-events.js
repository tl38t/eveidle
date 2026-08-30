/* ================================================================
 * 军团 DLC —— 独立事件模块（LegionEvents）
 * 仅通过统一接口与军团核心交互：LEGION_NPC.* / StationSystem.*
 * 全部事件委托 + idempotent 绑定 + 防重复提交 + 弹窗销毁。
 * ================================================================ */
(function (root) {
  var MOD = {};
  var _bound = false;
  var _busy = {};          // 按动作类型防重复提交
  var _modalEl = null;

  function getState() { return (typeof gameState !== "undefined") ? gameState : null; }
  function hasLegion() { return (typeof LEGION_NPC !== "undefined"); }
  function render() { if (typeof LegionRender !== "undefined" && LegionRender.renderLegionSection) LegionRender.renderLegionSection(Date.now()); }

  function guard(action, fn) {
    if (_busy[action]) return;
    _busy[action] = true;
    try { fn(); } finally { _busy[action] = false; }
  }

  // NPC 台词（统一接口；结构性去重由 getNpcDialogue 保证）
  function line(npc, type, opts) {
    if (hasLegion() && LEGION_NPC.getNpcDialogue) {
      var r = LEGION_NPC.getNpcDialogue(npc, type, opts || {});
      return (r && r.text) || "";
    }
    return "";
  }
  function msg(t) { if (typeof LegionRender !== "undefined" && LegionRender.legionMsg) LegionRender.legionMsg(t); }

  // —— 通用模态 ——
  function closeModal() {
    if (_modalEl && _modalEl.parentNode) _modalEl.parentNode.removeChild(_modalEl);
    _modalEl = null;
  }
  function openModal(html) {
    closeModal();
    var overlay = document.createElement("div");
    overlay.className = "legion-modal-overlay";
    overlay.innerHTML = '<div class="legion-modal">' + html + '</div>';
    document.body.appendChild(overlay);
    _modalEl = overlay;
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeModal();
      else if (e.target.closest("[data-modal-close]")) closeModal();
    });
    return overlay;
  }

  // —— 详情弹窗（候选人 / 已招募 NPC）：点击卡片空白处弹出，按钮事件不受影响 ——
  function openDetailModal(innerHtml) {
    openModal(innerHtml +
      '<div class="legion-modal-foot"><button class="btn secondary" data-modal-close>关闭</button></div>');
  }
  function openCandidateDetail(candId) {
    if (!hasLegion() || !LegionRender.buildCandidateDetailHtml) return;
    var st = getState();
    var cand = ((st.legion && st.legion.candidates) || []).filter(function (c) { return c.npcId === candId; })[0];
    if (!cand) { msg("候选人不存在"); return; }
    openDetailModal(LegionRender.buildCandidateDetailHtml(cand));
  }
  function openNpcDetail(npcId) {
    if (!hasLegion() || !LegionRender.buildNpcDetailHtml) return;
    var st = getState();
    var npc = ((st.legion && st.legion.npcs) || []).filter(function (n) { return n.npcId === npcId; })[0];
    if (!npc) { msg("NPC 不存在"); return; }
    openDetailModal(LegionRender.buildNpcDetailHtml(npc));
  }

  // —— 舰船绑定/更换模态 ——
  function openShipBindModal(npcId) {
    var st = getState();
    if (!st) return;
    var npc = (st.legion && st.legion.npcs || []).filter(function (n) { return n.npcId === npcId; })[0];
    if (!npc) { msg("NPC 不存在"); return; }
    var owned = (st.inventory && Array.isArray(st.inventory.ships)) ? st.inventory.ships : [];
    var boundOthers = {};
    (st.legion.npcs || []).forEach(function (n) { if (n.npcId !== npcId && n.boundShipInstanceId) boundOthers[n.boundShipInstanceId] = true; });

    if (!owned.length) {
      msg(line(npc, "noShip", { now: Date.now() }) || "暂无可用舰船");
      return;
    }

    var rows = owned.map(function (s) {
      var type = (hasLegion() && LEGION_NPC.getShipTypeDef) ? LEGION_NPC.getShipTypeDef(s.shipId) : null;
      var role = (hasLegion() && LEGION_NPC.getShipRole) ? LEGION_NPC.getShipRole(type) : null;
      var compat = (hasLegion() && LEGION_NPC.isShipClassCompatible) ? LEGION_NPC.isShipClassCompatible(npc.skillId, role) : true;
      var isBound = s.instanceId === npc.boundShipInstanceId;
      var disabled = (boundOthers[s.instanceId] && !isBound) ? " disabled" : "";
      var sel = isBound ? " selected" : "";
      var nameFn = (typeof LegionRender !== "undefined" && LegionRender.getShipDisplayName) ? LegionRender.getShipDisplayName : function (id) { return id; };
      var roleLabel = { industrial: "工业舰", combat: "战斗舰", archaeology: "考古舰" }[role] || "—";
      var btnText = isBound ? '卸下' : (disabled ? '已占用' : '选择');
      var pickValue = isBound ? "" : s.instanceId;
      var enhanceLevel = Math.max(0, Math.floor(Number(s.enhancementLevel) || 0));
      var enhanceHtml = enhanceLevel > 0 ? '<span class="lc-ship-enhance">+' + enhanceLevel + '</span>' : '';
      return '<div class="lc-ship-row' + (disabled ? ' lc-ship-disabled' : '') + '">' +
        '<span class="lc-ship-name">' + nameFn(s.shipId) + enhanceHtml + '</span>' +
        '<span class="lc-ship-tier">' + shipTierLabelLocal(type) + '</span>' +
        '<span class="lc-ship-role">适配：' + roleLabel + '</span>' +
        '<span class="' + (compat ? 'legion-ok' : 'legion-warn') + ' lc-ship-compat">' + (compat ? '适配' : '不适配') + '</span>' +
        '<button class="btn ' + (sel ? ' secondary' : ' primary') + '" data-ship-pick="' + pickValue + '"' + disabled + '>' + btnText + '</button>' +
        '</div>';
    }).join("");

    openModal(
      '<div class="legion-modal-title">为 ' + escapeHtml(npc.name) + ' 选择舰船</div>' +
      '<div class="legion-modal-body">' + (rows || '<div class="legion-warn">没有可绑定舰船</div>') + '</div>' +
      '<div class="legion-modal-foot"><button class="btn secondary" data-ship-cancel>取消</button></div>'
    );

    _modalEl.addEventListener("click", function (e) {
      var pick = e.target.closest("button[data-ship-pick]");
      if (pick && !pick.hasAttribute("disabled")) {
        doBindShip(npc, npcId, pick.getAttribute("data-ship-pick"));
      }
      if (e.target.closest("button[data-ship-cancel]")) closeModal();
    });
  }

  function shipTierLabelLocal(type) {
    var TIER = { frigate: "护卫舰", destroyer: "驱逐舰", cruiser: "巡洋舰", battleship: "战列舰", capital: "旗舰", supercapital: "超级旗舰" };
    if (!type) return "—";
    return TIER[type.split("_").pop()] || type;
  }

  function doBindShip(npc, npcId, shipInstanceId) {
    var st = getState();
    var old = npc.boundShipInstanceId;

    // 卸下当前舰船：解绑并归还机库，不销毁（二次确认，避免误触）
    if (shipInstanceId === "" || shipInstanceId == null) {
      if (!old) { closeModal(); return; }
      openModal(
        '<div class="legion-modal-title">确认卸下舰船</div>' +
        '<div class="legion-modal-body">卸下后该 NPC 将转为未绑定状态，舰船<b>归还机库</b>，经验倍率按未绑定计算（基础值）。确认卸下？</div>' +
        '<div class="legion-modal-foot">' +
          '<button class="btn danger" data-confirm-unbind>确认卸下</button>' +
          '<button class="btn secondary" data-confirm-no>取消</button>' +
        '</div>'
      );
      _modalEl.addEventListener("click", function (e) {
        if (e.target.closest("button[data-confirm-unbind]")) {
          closeModal();
          var ur = LEGION_NPC.assignLegionNpcShip(st, npcId, null);
          if (!ur.changed) { msg("卸下失败：" + (ur.reason === "npc-combat-locked" ? "NPC 正在战斗或修复中，暂不可卸下舰船" : (ur.reason || "未知错误"))); render(); return; }
          msg(line(npc, "shipUnbound", { now: Date.now() }) || "已卸下舰船，飞船已归还机库");
          render();
        } else if (e.target.closest("button[data-confirm-no]")) {
          closeModal();
          openShipBindModal(npcId); // 回到选择弹窗，保留上下文
        }
      });
      return;
    }

    // 绑定/更换舰船
    function commit() {
      var r = LEGION_NPC.assignLegionNpcShip(st, npcId, shipInstanceId);
      if (!r.changed) {
        if (r.reason === "npc-combat-locked") msg("NPC 正在战斗或修复中，暂不可绑定/卸下舰船");
        else if (r.reason === "ship-in-use") msg("该舰船已被其他 NPC 绑定");
        else if (r.reason === "ship-is-combat") msg("该舰船正在作为你的战斗舰出战，请先在战斗面板卸下再绑定");
        else if (r.reason === "ship-not-found") msg("舰船不存在");
        else if (r.reason === "npc-not-found") msg("NPC 不存在");
        else msg("更换舰船失败：" + (r.reason || "未知错误"));
        closeModal();
        return;
      }
      var type = (hasLegion() && LEGION_NPC.getShipTypeDef) ? LEGION_NPC.getShipTypeDef(shipInstanceId) : null;
      var cls = (hasLegion() && LEGION_NPC.getSkillShipClass) ? LEGION_NPC.getSkillShipClass(npc.skillId) : null;
      var compat = (hasLegion() && LEGION_NPC.isShipClassCompatible) ? LEGION_NPC.isShipClassCompatible(npc.skillId, type) : true;
      var evt = old ? "shipReplaced" : "shipAssigned";
      if (!compat) evt = "incompatibleShip";
      msg(line(npc, evt, { now: Date.now() }) || "已更新舰船");
      closeModal();
      render();
    }
    if (old && old !== shipInstanceId) {
      openModal(
        '<div class="legion-modal-title">确认更换舰船</div>' +
        '<div class="legion-modal-body">更换后原舰船将<b>解绑并归还机库</b>，确认？</div>' +
        '<div class="legion-modal-foot">' +
          '<button class="btn primary" data-confirm-yes>确认更换</button>' +
          '<button class="btn secondary" data-confirm-no>取消</button>' +
        '</div>'
      );
      _modalEl.addEventListener("click", function (e) {
        if (e.target.closest("button[data-confirm-yes]")) commit();
        else if (e.target.closest("button[data-confirm-no]")) closeModal();
      });
    } else {
      commit();
    }
  }

  // 解雇执行（已过二次确认）：仅调 dismissLegionNpc，不改状态以外的东西
  function doDismissNpc(npc, npcId) {
    var r = LEGION_NPC.dismissLegionNpc(getState(), npcId);
    if (!r.changed) { msg("解雇失败：" + (r.reason || "未知错误")); return; }
    var dl = (npc) ? line(npc, "dismiss", { now: Date.now() }) : "";
    msg("已解雇 " + (npc ? npc.name : "NPC") + (npc && npc.boundShipInstanceId ? "（其舰船已归还机库）" : "") + (dl ? "：" + dl : ""));
    render();
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // —— 绑定（idempotent） ——
  MOD.bind = function () {
    if (_bound) return;
    _bound = true;

    var entry = document.getElementById("legion-entry");
    if (entry && !entry._legionDelegated) {
      entry._legionDelegated = true;
      entry.addEventListener("click", function () {
        if (entry.className.indexOf("legion-entry-active") >= 0) {
          var sec = document.getElementById("legion-section");
          if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    }

    var refreshBtn = document.getElementById("btn-legion-refresh");
    if (refreshBtn && !refreshBtn._legionDelegated) {
      refreshBtn._legionDelegated = true;
      refreshBtn.addEventListener("click", function () {
        guard("refresh", function () {
          if (!hasLegion() || !LEGION_NPC.manuallyRefreshLegionNpcCandidates) return;
          var r = LEGION_NPC.manuallyRefreshLegionNpcCandidates(getState(), { now: Date.now() });
          if (!r.changed) {
            if (r.reason === "insufficient") msg("星币或功勋不足，无法手动刷新");
            else if (r.reason === "inactive") msg("军团系统未激活");
            else msg("刷新失败：" + (r.reason || "未知错误"));
            return;
          }
          msg("已刷新候选人");
          render();
        });
      });
    }

    // 「经验获取规则」弹窗
    var ruleBtn = document.getElementById("btn-legion-xp-rule");
    if (ruleBtn && !ruleBtn._legionDelegated) {
      ruleBtn._legionDelegated = true;
      ruleBtn.addEventListener("click", function () {
        if (typeof LegionRender !== "undefined" && LegionRender.buildXpRuleHtml) openModal(LegionRender.buildXpRuleHtml());
      });
    }

    var hallEl = document.getElementById("legion-hall");
    if (hallEl && !hallEl._legionDelegated) {
      hallEl._legionDelegated = true;
      hallEl.addEventListener("click", function (e) {
        var btn = e.target.closest("button[data-legion-upgrade-hall]");
        if (!btn || btn.hasAttribute("disabled")) return;
        guard("upgrade-hall", function () {
          if (typeof StationSystem === "undefined") { msg("空间站系统未加载"); return; }
          var r = StationSystem.startStationBuildingConstruction(getState(), "legion_hall", Date.now());
          if (!r.changed) {
            if (r.reason === "insufficient-isk") msg("星币不足");
            else if (r.reason === "insufficient-lp") msg("功勋不足");
            else if (r.reason === "insufficient-materials") msg("材料不足");
            else if (r.reason === "body-level-cap") msg("本体等级不足，无法升级");
            else if (r.reason === "construction-in-progress") msg("已有建设在进行");
            else if (r.reason === "max-level") msg("已达最高等级");
            else msg("升级失败：" + (r.reason || "未知错误"));
            return;
          }
          msg("军团议事大厅升级已开工");
          render();
        });
      });
    }

    var candBox = document.getElementById("legion-candidates");
    if (candBox && !candBox._legionDelegated) {
      candBox._legionDelegated = true;
      candBox.addEventListener("click", function (e) {
        var btn = e.target.closest("button[data-legion-recruit]");
        if (!btn) {
          // 点卡片空白处 → 候选人详情
          var card = e.target.closest("[data-legion-cand-detail]");
          if (card && !e.target.closest("button")) openCandidateDetail(card.getAttribute("data-legion-cand-detail"));
          return;
        }
        guard("recruit", function () {
          if (!hasLegion() || !LEGION_NPC.recruitLegionNpc) return;
          var cid = btn.getAttribute("data-legion-recruit");
          var r = LEGION_NPC.recruitLegionNpc(getState(), cid, { now: Date.now() });
          if (!r.changed) {
            if (r.reason === "insufficient") msg("星币或功勋不足，无法招募");
            else if (r.reason === "capacity") msg("编队已满（NPC 上限已满）");
            else if (r.reason === "candidate-not-found") msg("候选人不存在（可能已招募）");
            else msg("招募失败：" + (r.reason || "未知错误"));
            return;
          }
          var nl = line(r.npc, "recruit", { now: Date.now() });
          msg((r.npc.name || "NPC") + " 已加入：" + (nl || ""));
          render();
        });
      });
    }

    var npcBox = document.getElementById("legion-npcs");
    if (npcBox && !npcBox._legionDelegated) {
      npcBox._legionDelegated = true;
      npcBox.addEventListener("click", function (e) {
        var bind = e.target.closest("button[data-legion-bind-ship]");
        if (bind) {
          guard("bind-" + bind.getAttribute("data-legion-bind-ship"), function () {
            openShipBindModal(bind.getAttribute("data-legion-bind-ship"));
          });
          return;
        }
        var dismiss = e.target.closest("button[data-legion-dismiss]");
        if (dismiss) {
          guard("dismiss-" + dismiss.getAttribute("data-legion-dismiss"), function () {
            if (!hasLegion() || !LEGION_NPC.dismissLegionNpc) return;
            var npcId = dismiss.getAttribute("data-legion-dismiss");
            var npc = (getState().legion && getState().legion.npcs || []).filter(function (n) { return n.npcId === npcId; })[0];
            if (!npc) { msg("NPC 不存在"); return; }
            var shipNote = npc.boundShipInstanceId
              ? '<br><br>该 NPC 绑定的舰船将<b>归还机库</b>。'
              : '';
            openModal(
              '<div class="legion-modal-title"><i class="fa-solid fa-user-slash"></i> 确认解雇</div>' +
              '<div class="legion-modal-body">确定解雇 <b>' + escapeHtml(npc.name) + '</b> 吗？解雇后不可恢复。' + shipNote + '</div>' +
              '<div class="legion-modal-foot">' +
                '<button class="btn danger" data-confirm-yes>确认解雇</button>' +
                '<button class="btn secondary" data-confirm-no>取消</button>' +
              '</div>'
            );
            _modalEl.addEventListener("click", function (ev) {
              if (ev.target.closest("button[data-confirm-yes]")) { closeModal(); doDismissNpc(npc, npcId); }
              else if (ev.target.closest("button[data-confirm-no]")) closeModal();
            });
          });
          return;
        }
        // 点卡片空白处 → NPC 详情
        if (!e.target.closest("button")) {
          var npcCard = e.target.closest("[data-legion-npc-detail]");
          if (npcCard) openNpcDetail(npcCard.getAttribute("data-legion-npc-detail"));
        }
      });
    }
  };

  MOD.closeModal = closeModal;

  root.LegionEvents = MOD;
  if (typeof module !== "undefined" && module.exports) module.exports = MOD;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
