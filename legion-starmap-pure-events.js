(() => {
  const canvas = document.getElementById('map');
  const title = document.getElementById('title');
  const detail = document.getElementById('detail');
  let down = null;
  const initialConquered = new Map();
  let playerCompletedIds = new Set();
  let playerCollectionRewards = new Map();
  let playerProductionRewards = new Map();
  let playerArchaeologyRewards = new Map();
  let selectedNode = null;
  let routeState = { controlledIds:new Set(), originIds:new Set(), frontierIds:new Set(), availableIds:new Set() };

  const getModel = () => window.LEGION_STARMAP_CONTENT || window.LEGION_STARMAP_RENDER_MODEL;
  const nodeId = (node) => node && node.id != null ? String(node.id) : '';
  const INITIAL_ROUTE_NAMES = new Set(['\u963f\u6d1b\u6069', '\u827e\u6d1b', '\u5229\u5965\u65af']);
  const isInitialRouteNode = (node) => !!(node && INITIAL_ROUTE_NAMES.has(String(node.name || '')));

  const refreshRouteState = (redraw) => {
    const api = getModel();
    if (!api || !Array.isArray(api.nodes) || !Array.isArray(api.edges)) return routeState;

    const controlledIds = new Set(playerCompletedIds);
    api.nodes.forEach((node) => {
      if (node && node.conquered) controlledIds.add(nodeId(node));
    });
    controlledIds.delete('');

    const initialIds = new Set();
    api.nodes.filter(isInitialRouteNode).forEach((node) => initialIds.add(nodeId(node)));
    const completedInitialIds = new Set([...controlledIds].filter((id) => initialIds.has(id)));
    const initialChoiceLocked = completedInitialIds.size > 0;
    const originIds = new Set();
    if (!controlledIds.size) {
      initialIds.forEach((id) => originIds.add(id));
    }
    const routeAnchors = controlledIds.size ? controlledIds : originIds;
    const frontierIds = new Set();
    api.edges.forEach((edge) => {
      const left = edge && edge.a;
      const right = edge && edge.b;
      const leftId = nodeId(left);
      const rightId = nodeId(right);
      if (!leftId || !rightId) return;
      if (routeAnchors.has(leftId) && !controlledIds.has(rightId)) frontierIds.add(rightId);
      if (routeAnchors.has(rightId) && !controlledIds.has(leftId)) frontierIds.add(leftId);
    });
    if (initialChoiceLocked) {
      initialIds.forEach((id) => {
        if (!completedInitialIds.has(id)) frontierIds.delete(id);
      });
    }
    const availableIds = controlledIds.size ? frontierIds : originIds;

    api.nodes.forEach((node) => {
      const id = nodeId(node);
      node.routeOwned = controlledIds.has(id);
      node.routeOrigin = originIds.has(id);
      node.routeAvailable = availableIds.has(id) && !node.routeOwned;
      node.routeLocked = !node.routeOwned && !node.routeAvailable;
    });
    routeState = { controlledIds, originIds, frontierIds, availableIds, initialIds, completedInitialIds, initialChoiceLocked };
    if (redraw && typeof api.redraw === 'function') api.redraw();
    document.body.dataset.starmapControlledCount = String(controlledIds.size);
    document.body.dataset.starmapFrontierCount = String(availableIds.size);
    document.body.dataset.starmapInitialChoiceLocked = String(initialChoiceLocked);
    document.body.dataset.starmapInitialChoiceCount = String(originIds.size);
    return routeState;
  };

  const getNodeRouteStatus = (node) => {
    const state = refreshRouteState(false);
    const id = nodeId(node);
    if (state.controlledIds.has(id)) return 'owned';
    if (state.availableIds.has(id)) return 'available';
    return 'blocked';
  };

  const removeLegacySideInfo = () => {
    const side = detail && detail.parentElement;
    if (!side) return;
    Array.from(side.children).forEach((child) => {
      if (child !== detail && child.id !== 'title' && child.id !== 'starmap-reward-description' && child.id !== 'starmap-resident-reward-summary') child.remove();
    });
  };
  removeLegacySideInfo();
  if (detail) detail.textContent = '点击任意星系节点查看详情。';

  const appendRouteHint = (status) => {
    const old = document.getElementById('starmap-route-hint');
    if (old) old.remove();
    const hint = document.createElement('div');
    hint.id = 'starmap-route-hint';
    hint.style.cssText = 'margin-top:12px;padding:9px 11px;border:1px solid #324964;border-radius:7px;background:#0a1625;color:#91abc5;font-size:13px;line-height:1.5';
    hint.textContent = status === 'owned'
      ? '\u5df2\u5236\u538b\uff1a\u53ef\u67e5\u770b\u8be6\u60c5\uff0c\u4e0d\u80fd\u91cd\u590d\u6311\u6218\u3002'
      : status === 'available'
        ? (routeState.controlledIds.size
          ? '\u524d\u6cbf\u53ef\u63a8\u8fdb\uff1a\u8be5\u8282\u70b9\u4e0e\u5f53\u524d\u5df2\u5236\u538b\u8282\u70b9\u76f4\u63a5\u8fde\u7ebf\u3002'
          : '\u521d\u59cb\u524d\u6cbf\uff1a\u963f\u6d1b\u6069\u3001\u827e\u6d1b\u3001\u5229\u5965\u65af\u4e09\u9009\u4e00\uff1b\u5b8c\u6210\u4e00\u4e2a\u540e\u5176\u4f59\u4e24\u4e2a\u9501\u5b9a\u3002')
        : '\u8def\u7ebf\u5df2\u9501\u5b9a\uff1a\u53ea\u80fd\u9009\u62e9\u4e0e\u73a9\u5bb6\u5df2\u5236\u538b\u8282\u70b9\u76f4\u63a5\u8fde\u7ebf\u7684\u4e0b\u4e00\u4e2a\u8282\u70b9\u3002';
    detail.appendChild(hint);
  };

  const rewardIdName = (rewardId) => {
    const id = String(rewardId || '');
    const separator = id.indexOf(':');
    return separator >= 0 ? id.slice(separator + 1) : id;
  };
  const displayRewardName = (rewardId, fallbackName) => {
    const id = String(rewardId || '');
    const fallback = fallbackName || rewardIdName(id);
    try {
      if (window.DisplayNames && typeof window.DisplayNames.getResourceRefName === 'function') {
        return window.DisplayNames.getResourceRefName(id, fallback);
      }
      if (window.parent && window.parent.DisplayNames && typeof window.parent.DisplayNames.getResourceRefName === 'function') {
        return window.parent.DisplayNames.getResourceRefName(id, fallback);
      }
      if (window.parent && window.parent.ResourceRegistry && typeof window.parent.ResourceRegistry.getResourceDisplayName === 'function') {
        return window.parent.ResourceRegistry.getResourceDisplayName(id) || fallback;
      }
    } catch (_) {}
    return fallback;
  };
  const appendRewardRow = (host, label, value, accent) => {
    const row = document.createElement('div');
    row.className = 'reward-description-row';
    row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:flex-start;margin-top:6px;line-height:1.55;min-width:0;max-width:100%';
    const key = document.createElement('strong');
    key.className = 'reward-description-key';
    key.textContent = label + '：';
    key.style.cssText = 'flex:0 1 auto;min-width:0;max-width:100%;overflow-wrap:anywhere;word-break:break-word;color:#e5f2ff';
    const copy = document.createElement('span');
    copy.className = 'reward-description-value';
    copy.textContent = value;
    copy.style.cssText = 'flex:1 1 120px;min-width:0;max-width:100%;overflow-wrap:anywhere;word-break:break-word;color:' + (accent || '#a8bdd5');
    row.append(key, copy);
    host.appendChild(row);
  };
  const appendRewardButton = (host, id, label, disabled, handler) => {
    const button = document.createElement('button');
    button.id = id;
    button.type = 'button';
    button.textContent = label;
    button.disabled = !!disabled;
    button.style.cssText = 'display:block;margin-top:10px;padding:8px 12px;border:1px solid #6aa8ff;border-radius:6px;background:#132744;color:#dff1ff;cursor:pointer;font:inherit';
    if (button.disabled) button.style.opacity = '.58';
    button.onclick = () => {
      if (!button.disabled) handler();
    };
    host.appendChild(button);
  };
  const appendResidentRewardSummary = () => {
    let host = document.getElementById('starmap-resident-reward-summary');
    if (!host && detail && detail.parentElement) {
      host = document.createElement('div');
      host.id = 'starmap-resident-reward-summary';
      host.className = 'reward-description';
      detail.parentElement.appendChild(host);
    }
    if (!host) return;
    host.textContent = '';
    const heading = document.createElement('h3');
    heading.textContent = '星图驻留奖励总览';
    host.appendChild(heading);
    const intro = document.createElement('p');
    intro.textContent = '采集、生产、考古节点的 24 小时驻留奖励统一汇总，领取后一次性入库。';
    host.appendChild(intro);
    const dailyGrouped = new Map();
    const extractGrouped = new Map();
    const addGrouped = (map, rewardId, name, amount, sourceNodeId) => {
      const key = String(rewardId || '');
      if (!key) return;
      const entry = map.get(key) || { name:name || rewardIdName(key), amount:0, wholeAmount:0, nodeIds:new Set() };
      const normalizedAmount = Math.max(0, Number(amount) || 0);
      entry.amount += normalizedAmount;
      entry.wholeAmount += Math.floor(normalizedAmount + 1e-9);
      if (sourceNodeId != null) entry.nodeIds.add(String(sourceNodeId));
      map.set(key, entry);
    };
    const appendSummaryLabel = (label) => {
      const section = document.createElement('strong');
      section.textContent = label;
      section.style.cssText = 'display:block;margin-top:12px;color:#a9c9ff';
      host.appendChild(section);
    };
    const productionDailyName = (reward) => {
      if (reward && reward.rewardKind === 'booster') {
        const qualities = Array.isArray(reward.qualityPool) ? reward.qualityPool.map(String) : [];
        const qualityText = qualities.length === 1 ? (qualities[0] === 'l' ? '传奇' : '精工') : '精工/传奇';
        return '随机' + qualityText + '增强剂';
      }
      const pool = reward && Array.isArray(reward.rewardPool) ? reward.rewardPool.map((rewardId) => displayRewardName(rewardId)).filter(Boolean) : [];
      return pool.length ? '随机矿物（' + pool.join('、') + '）' : '随机矿物';
    };
    playerCollectionRewards.forEach((reward) => {
      const resourceId = String(reward && reward.resourceId || '');
      if (!resourceId) return;
      addGrouped(dailyGrouped, 'collection:' + resourceId, resourceId, reward && reward.dailyAmount, reward && reward.nodeId);
      addGrouped(extractGrouped, 'collection:' + resourceId, resourceId, reward && reward.pendingAmount, reward && reward.nodeId);
    });
    playerProductionRewards.forEach((reward) => {
      if (!reward) return;
      addGrouped(dailyGrouped, 'production:' + productionDailyName(reward), productionDailyName(reward), reward.dailyAmount, reward.nodeId);
      const items = Array.isArray(reward.pendingItems) ? reward.pendingItems : [];
      items.forEach((item) => addGrouped(extractGrouped, 'production:' + item.rewardId, item.name, item.amount, reward.nodeId));
    });
    playerArchaeologyRewards.forEach((reward) => {
      const rewardId = String(reward && reward.rewardId || '');
      if (!rewardId) return;
      const name = reward.rewardName || displayRewardName(rewardId);
      addGrouped(dailyGrouped, 'archaeology:' + rewardId, name, reward.dailyAmount, reward.nodeId);
      addGrouped(extractGrouped, 'archaeology:' + rewardId, name, reward.pendingAmount, reward.nodeId);
    });

    appendSummaryLabel('每24小时可获得');
    if (!dailyGrouped.size) {
      appendRewardRow(host, '当前状态', '暂无已制压的驻留节点，完成采集、生产或考古试炼后开始累计。', '#9bb2c8');
    } else {
      dailyGrouped.forEach((entry) => {
        appendRewardRow(host, entry.name, '×' + formatRewardAmount(entry.amount) + '（' + entry.nodeIds.size + ' 个节点）', '#bfe4ff');
      });
    }

    appendSummaryLabel('当前可提取');
    const pendingWhole = [...extractGrouped.values()].reduce((sum, entry) => sum + entry.wholeAmount, 0);
    if (!extractGrouped.size) {
      appendRewardRow(host, '当前状态', '暂无可提取物品。', '#9bb2c8');
    } else {
      extractGrouped.forEach((entry) => {
        const whole = entry.wholeAmount;
        appendRewardRow(host, entry.name, '×' + whole + (entry.amount - whole > 1e-9 ? '（累计中：' + formatRewardAmount(entry.amount) + '）' : ''), whole > 0 ? '#ffe18a' : '#9bb2c8');
      });
      if (pendingWhole <= 0) appendRewardRow(host, '提取提示', '目前还没有整单位物品，零数部分会继续累计。', '#9bb2c8');
    }
    appendRewardButton(host, 'starmap-collect-all-resident-rewards', pendingWhole > 0 ? '提取全部驻留奖励' : '暂无可提取奖励', pendingWhole <= 0, () => {
      if (window.parent && window.parent !== window) window.parent.postMessage({ type:'legion-starmap/collect-resident-rewards' }, '*');
    });
  };
  const appendRewardDescription = (node, status) => {
    const host = document.getElementById('starmap-reward-description');
    if (!host) return;
    host.textContent = '';
    const heading = document.createElement('h3');
    heading.textContent = '奖励说明';
    host.appendChild(heading);
    if (!node) {
      const empty = document.createElement('p');
      empty.textContent = '选择节点后显示一次性奖励、每日奖励和当前累计。';
      host.appendChild(empty);
      return;
    }
    if (node.name === '先驱文明核心' || node.subtype === '泰坦制造科技') {
      appendRewardRow(host, '一次性奖励', '泰坦核心制造权限，并开启虫洞日常玩法');
      appendRewardRow(host, '每日奖励', '无');
      return;
    }
    if (node.type === 'battle') {
      const titanComponent = ['莱芙', '赫洛', '羽落川'].includes(String(node.name || ''));
      appendRewardRow(host, '一次性奖励', titanComponent
        ? '星币、功勋、货柜、生产许可及对应泰坦组件制造权限'
        : '星币、功勋、货柜及生产许可');
      appendRewardRow(host, '每日奖励', '无（战斗节点不提供驻留奖励）', '#9bb2c8');
      appendRewardRow(host, '领取状态', '战斗结算奖励随通关结算，不设置每日领取按钮', '#9bb2c8');
      return;
    }
    if (node.type === 'collection') {
      const resource = String(node.collectionResource || '目标采集物');
      const firstAmount = Math.max(0, Number(node.collectionAmount) || 0);
      const reward = status === 'owned' ? playerCollectionRewards.get(nodeId(node)) : null;
      const dailyAmount = reward ? Number(reward.dailyAmount) || 0 : Math.max(0, Math.round(firstAmount * 0.96));
      appendRewardRow(host, '一次性奖励', resource + ' ×' + formatRewardAmount(firstAmount));
      appendRewardRow(host, '每日奖励', resource + ' ×' + formatRewardAmount(dailyAmount) + ' / 24h（每小时累计）');
      if (status !== 'owned') {
        appendRewardRow(host, '当前累计', '0（完成节点后开始累计）', '#9bb2c8');
      } else {
        const pending = reward ? Number(reward.pendingAmount) || 0 : 0;
        appendRewardRow(host, '当前累计', resource + ' ×' + formatRewardAmount(pending), pending > 0 ? '#ffe18a' : '#9bb2c8');
        appendRewardRow(host, '提取方式', '请使用下方“星图驻留奖励总览”统一提取', '#9bb2c8');
      }
      return;
    }
    if (node.type === 'production' && node.productionReward) {
      const spec = node.productionReward;
      const reward = status === 'owned' ? playerProductionRewards.get(nodeId(node)) : null;
      const qualityText = productionRewardQualityText(spec);
      const poolText = Array.isArray(spec.rewardPool) && spec.rewardPool.length
        ? '（' + spec.rewardPool.map((rewardId) => displayRewardName(rewardId)).join('、') + '）'
        : '';
      const rewardText = spec.kind === 'booster'
        ? '随机' + qualityText + '增强剂 ×' + Number(spec.dailyAmount || 10)
        : '随机矿物' + poolText + ' ×' + Number(spec.dailyAmount || 0);
      appendRewardRow(host, '一次性奖励', rewardText);
      appendRewardRow(host, '每日奖励', rewardText + ' / 24h（每小时累计）');
      if (status !== 'owned') {
        appendRewardRow(host, '当前累计', '0（完成节点后开始累计）', '#9bb2c8');
      } else {
        const pendingAmount = reward ? Number(reward.pendingAmount) || 0 : 0;
        const pendingWhole = reward ? Number(reward.pendingWholeAmount) || 0 : 0;
        const pendingItems = reward && Array.isArray(reward.pendingItems)
          ? reward.pendingItems.filter((item) => Number(item.amount) > 0).map((item) => displayRewardName(item.rewardId, item.name) + ' ×' + formatRewardAmount(item.amount)).join('、')
          : '';
        appendRewardRow(host, '当前累计', pendingItems || ('待领取 ' + formatRewardAmount(pendingAmount)), pendingAmount > 0 ? '#ffe18a' : '#9bb2c8');
        appendRewardRow(host, '可提取', pendingWhole > 0 ? '整数奖励 ×' + pendingWhole : '暂无整单位奖励', pendingWhole > 0 ? '#ffe18a' : '#9bb2c8');
        appendRewardRow(host, '提取方式', '请使用下方“星图驻留奖励总览”统一提取', '#9bb2c8');
      }
      return;
    }
    if (node.type === 'archaeology') {
      const rewardTier = String(node.archaeologyRewardTier || (node.ring === 'outer' ? 'ii' : node.ring === 'middle' ? 'iii' : 'iv')).toLowerCase();
      const rewardTierLabel = rewardTier.toUpperCase();
      const rewardNames = { ii:'校准基体 II 型', iii:'校准基体 III 型', iv:'校准基体 IV 型' };
      const rewardName = rewardNames[rewardTier] || ('校准基体 ' + rewardTierLabel + ' 型');
      const firstAmount = Math.max(0, Number(node.archaeologyFirstRewardAmount) || (node.ring === 'outer' ? 3 : node.ring === 'middle' ? 6 : 9));
      const dailyAmount = Math.max(0, Number(node.archaeologyDailyRewardAmount) || (node.ring === 'outer' ? 1 : node.ring === 'middle' ? 2 : 3));
      const reward = status === 'owned' ? playerArchaeologyRewards.get(nodeId(node)) : null;
      appendRewardRow(host, '一次性奖励', rewardName + ' ×' + formatRewardAmount(firstAmount) + '（首次通关）');
      appendRewardRow(host, '每日奖励', rewardName + ' ×' + formatRewardAmount(dailyAmount) + ' / 24h（每小时累计）');
      if (status !== 'owned') {
        appendRewardRow(host, '当前累计', '0（完成节点后开始累计）', '#9bb2c8');
      } else {
        const pendingAmount = reward ? Number(reward.pendingAmount) || 0 : 0;
        appendRewardRow(host, '当前累计', rewardName + ' ×' + formatRewardAmount(pendingAmount), pendingAmount > 0 ? '#ffe18a' : '#9bb2c8');
        appendRewardRow(host, '提取方式', '请使用下方“考古奖励总览”统一提取', '#9bb2c8');
      }
      return;
    }
    if (node.type === 'final') {
      appendRewardRow(host, '一次性奖励', '泰坦核心制造权限，并开启虫洞日常玩法');
      appendRewardRow(host, '每日奖励', '无');
      return;
    }
    appendRewardRow(host, '一次性奖励', '暂无配置');
    appendRewardRow(host, '每日奖励', '暂无配置');
  };

  const formatRewardAmount = (value) => {
    const amount = Number(value) || 0;
    if (Math.abs(amount - Math.round(amount)) < 0.000001) return String(Math.round(amount));
    return amount.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  };
  const appendCollectionReward = (node, status) => {
    const old = document.getElementById('starmap-collection-reward');
    if (old) old.remove();
    if (!node || status !== 'owned' || node.type !== 'collection') return;
    const reward = playerCollectionRewards.get(nodeId(node));
    const panel = document.createElement('div');
    panel.id = 'starmap-collection-reward';
    panel.style.cssText = 'margin-top:12px;padding:10px 11px;border:1px solid #456b59;border-radius:7px;background:linear-gradient(135deg,#0b211d,#0b1722);color:#bcebd0;font-size:13px;line-height:1.6';
    const heading = document.createElement('strong');
    heading.textContent = '星图采集奖励';
    heading.style.cssText = 'display:block;color:#8fe0ad;margin-bottom:2px';
    panel.appendChild(heading);
    if (!reward) {
      const empty = document.createElement('span');
      empty.textContent = '该节点已制压；小时奖励记录将在首次完成后建立。';
      panel.appendChild(empty);
      detail.appendChild(panel);
      return;
    }
    const daily = document.createElement('span');
    daily.textContent = '每日累计：' + formatRewardAmount(reward.dailyAmount) + ' · 每小时：' + formatRewardAmount(reward.hourlyAmount) + ' ' + reward.resourceId;
    daily.style.display = 'block';
    panel.appendChild(daily);
    const pending = Number(reward.pendingAmount) || 0;
    const pendingText = document.createElement('span');
    pendingText.textContent = '待领取：' + formatRewardAmount(pending) + ' ' + reward.resourceId;
    pendingText.style.cssText = 'display:block;color:' + (pending > 0 ? '#ffe18a' : '#9bb2ad');
    panel.appendChild(pendingText);
    const hint = document.createElement('span');
    hint.textContent = '提取方式：请使用“星图驻留奖励总览”统一提取。';
    hint.style.cssText = 'display:block;color:#9bb2ad';
    panel.appendChild(hint);
    detail.appendChild(panel);
  };
  const productionRewardQualityText = (reward) => {
    if (!reward || reward.kind !== 'booster') return '';
    if (reward.qualityPool && reward.qualityPool.length === 1) return reward.qualityPool[0] === 'l' ? '传奇' : '精工';
    return '精工 80% / 传奇 20%';
  };
  const appendProductionReward = (node, status) => {
    const old = document.getElementById('starmap-production-reward');
    if (old) old.remove();
    if (!node || node.type !== 'production' || !node.productionReward) return;
    const spec = node.productionReward;
    const reward = status === 'owned' ? playerProductionRewards.get(nodeId(node)) : null;
    const panel = document.createElement('div');
    panel.id = 'starmap-production-reward';
    panel.style.cssText = 'margin-top:12px;padding:10px 11px;border:1px solid #536f9c;border-radius:7px;background:linear-gradient(135deg,#111c31,#0a1421);color:#c7d8ef;font-size:13px;line-height:1.6';
    const heading = document.createElement('strong');
    heading.textContent = '生产节点驻留奖励';
    heading.style.cssText = 'display:block;color:#a9c9ff;margin-bottom:2px';
    panel.appendChild(heading);
    const daily = document.createElement('span');
    daily.style.display = 'block';
    daily.textContent = spec.kind === 'booster'
      ? '每日：随机' + productionRewardQualityText(spec) + '增强剂 ×' + Number(spec.dailyAmount || 10) + '（每24小时结算）'
      : '每日：随机矿物 ×' + Number(spec.dailyAmount || 0) + '（每24小时结算）';
    panel.appendChild(daily);
    if (status !== 'owned') {
      const locked = document.createElement('span');
      locked.style.cssText = 'display:block;color:#90a7c1';
      locked.textContent = '完成节点后开始累计，奖励需要手动收取。';
      panel.appendChild(locked);
    } else if (!reward) {
      const waiting = document.createElement('span');
      waiting.style.cssText = 'display:block;color:#90a7c1';
      waiting.textContent = '首次完成奖励已在通关时发放，小时账本等待同步。';
      panel.appendChild(waiting);
    } else {
      const current = document.createElement('span');
      current.style.display = 'block';
      current.textContent = '当前批次：' + (reward.currentRewardName || '待生成') + ' · 距下一批 ' + Number(reward.hoursUntilNextReward || 24) + ' 小时';
      panel.appendChild(current);
      const pending = document.createElement('span');
      const pendingAmount = Number(reward.pendingWholeAmount || 0);
      pending.style.cssText = 'display:block;color:' + (pendingAmount > 0 ? '#ffe18a' : '#9bb2ad');
      pending.textContent = pendingAmount > 0 ? '待领取：' + pendingAmount + '（按奖励批次分别入库）' : '待领取：暂无整单位奖励';
      panel.appendChild(pending);
      const hint = document.createElement('span');
      hint.textContent = '提取方式：请使用“星图驻留奖励总览”统一提取。';
      hint.style.cssText = 'display:block;color:#9bb2ad';
      panel.appendChild(hint);
    }
    detail.appendChild(panel);
  };

  const nodePayload = (n) => ({
    id: n.id, name: n.name, ring: n.ring, tier: n.tier, type: n.type, subtype: n.subtype,
    collectionResource: n.collectionResource, collectionKind: n.collectionKind,
    collectionAmount: n.collectionAmount,
    collectionBaseSecondsPerUnit: n.collectionBaseSecondsPerUnit,
    collectionTimeLimitSeconds: n.collectionTimeLimitSeconds,
    collectionEfficiencyTarget: n.collectionEfficiencyTarget,
    productionRequirements: Array.isArray(n.productionRequirements) ? n.productionRequirements.map((entry) => ({
      kind: entry.kind, resourceId: entry.resourceId, itemId: entry.itemId, shipId: entry.shipId,
      name: entry.name, amount: entry.amount, minEnhancement: entry.minEnhancement
    })) : [],
    productionReward: n.productionReward ? {
      kind:n.productionReward.kind, dailyAmount:n.productionReward.dailyAmount,
      rewardPool:Array.isArray(n.productionReward.rewardPool) ? n.productionReward.rewardPool.slice() : [],
      qualityPool:Array.isArray(n.productionReward.qualityPool) ? n.productionReward.qualityPool.slice() : [],
      qualityWeights:Array.isArray(n.productionReward.qualityWeights) ? n.productionReward.qualityWeights.map((entry) => ({ quality:entry.quality, weight:entry.weight })) : []
    } : null,
    archaeologySiteId: n.archaeologySiteId,
    archaeologyRewardTier: n.archaeologyRewardTier,
    archaeologyFirstRewardAmount: n.archaeologyFirstRewardAmount,
    archaeologyDailyRewardAmount: n.archaeologyDailyRewardAmount,
    archaeologyDifficulty: n.archaeologyDifficulty,
    archaeologyBaseCycleSeconds: n.archaeologyBaseCycleSeconds,
    archaeologyTimeLimitSeconds: n.archaeologyTimeLimitSeconds,
    archaeologyTargetProgress: n.archaeologyTargetProgress,
    archaeologyRareRate: n.archaeologyRareRate,
    archaeologyInterferenceSeconds: n.archaeologyInterferenceSeconds,
    battleTrialZoneId: n.battleTrialZoneId,
    battleTrialEnemyCount: n.battleTrialEnemyCount,
    battleTrialTimeLimitSeconds: n.battleTrialTimeLimitSeconds,
    battleTrialTargetWaves: n.battleTrialTargetWaves
  });
  const openRoom = (n) => {
    if (getNodeRouteStatus(n) === 'blocked') {
      appendRouteHint('blocked');
      return false;
    }
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'legion-starmap/open-room', node: nodePayload(n) }, '*');
    }
    return true;
  };
  const pick = (e) => {
    const api = getModel();
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * 1000 / rect.width;
    const y = (e.clientY - rect.top) * 700 / rect.height;
    let best = null;
    let distance = Infinity;
    if (!api || !Array.isArray(api.nodes)) return null;
    for (const n of api.nodes) {
      const d = Math.hypot(n.x - x, n.y - y);
      if (d < distance) { best = n; distance = d; }
    }
    return distance < 30 ? best : null;
  };

  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointerup', (e) => {
    const moved = down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6;
    down = null;
    if (moved) return;
    const api = getModel();
    const n = pick(e);
    if (!n || !api || typeof api.describe !== 'function') return;

    selectedNode = n;
    if (typeof window.LEGION_STARMAP_SELECT === 'function') window.LEGION_STARMAP_SELECT(n);
    title.textContent = n.name;
    detail.textContent = api.describe(n);
    const routeStatus = getNodeRouteStatus(n);
    appendRouteHint(routeStatus);
    const old = document.getElementById('starmap-start-trial');
    if (old) old.remove();

    // 只显示详情；进入试炼房间必须由按钮明确触发。
    if (routeStatus !== 'blocked' && ((n.type === 'collection' && n.collectionResource) || (n.type === 'production' && Array.isArray(n.productionRequirements) && n.productionRequirements.length) || (n.type === 'archaeology' && n.archaeologySiteId) || (n.type === 'battle' && n.battleTrialZoneId))) {
      const button = document.createElement('button');
      button.id = 'starmap-start-trial';
      button.type = 'button';
      button.dataset.nodeType = n.type;
      button.textContent = routeStatus === 'owned' ? '\u67e5\u770b\u5df2\u5236\u538b\u8282\u70b9' : n.type === 'production' ? '进入生产试炼房间' : n.type === 'archaeology' ? '进入考古试炼房间' : n.type === 'battle' ? '进入战斗试炼房间' : '\u8fdb\u5165\u91c7\u96c6\u8bd5\u70bc\u623f\u95f4';
      button.style.cssText = 'display:block;margin-top:14px;padding:10px 14px;border:1px solid #6aa8ff;border-radius:7px;background:#132744;color:#dff1ff;cursor:pointer;font:inherit';
      button.onclick = () => openRoom(n);
      detail.appendChild(button);
    }
    appendRewardDescription(n, routeStatus);
  });
  window.addEventListener('message', (e) => {
    if (e && e.data && e.data.type === 'legion-starmap/collection-reward-state') {
      playerCollectionRewards = new Map((Array.isArray(e.data.rewards) ? e.data.rewards : []).map((reward) => [String(reward.nodeId), reward]));
      appendResidentRewardSummary();
      if (selectedNode) appendRewardDescription(selectedNode, getNodeRouteStatus(selectedNode));
      return;
    }
    if (e && e.data && e.data.type === 'legion-starmap/production-reward-state') {
      playerProductionRewards = new Map((Array.isArray(e.data.rewards) ? e.data.rewards : []).map((reward) => [String(reward.nodeId), reward]));
      appendResidentRewardSummary();
      if (selectedNode) appendRewardDescription(selectedNode, getNodeRouteStatus(selectedNode));
      return;
    }
    if (e && e.data && e.data.type === 'legion-starmap/archaeology-reward-state') {
      playerArchaeologyRewards = new Map((Array.isArray(e.data.rewards) ? e.data.rewards : []).map((reward) => [String(reward.nodeId), reward]));
      appendResidentRewardSummary();
      if (selectedNode) appendRewardDescription(selectedNode, getNodeRouteStatus(selectedNode));
      return;
    }
    if (e && e.data && e.data.type === 'legion-starmap/completed-nodes') {
      const api = getModel();
      if (!api || !Array.isArray(api.nodes)) return;
      const completed = new Set(Array.isArray(e.data.nodeIds) ? e.data.nodeIds.map(String) : []);
      playerCompletedIds = completed;
      appendResidentRewardSummary();
      let changed = false;
      api.nodes.forEach((node) => {
        const id = String(node.id);
        if (!initialConquered.has(id)) initialConquered.set(id, !!node.conquered);
        const conquered = initialConquered.get(id) || completed.has(id);
        if (!!node.conquered !== conquered) { node.conquered = conquered; changed = true; }
        node.completedByPlayer = completed.has(id);
      });
      refreshRouteState(changed);
      if (selectedNode) appendRewardDescription(selectedNode, getNodeRouteStatus(selectedNode));
      return;
    }
    const result = e && e.data && e.data.type === 'legion-starmap/trial-result' ? e.data.result : null;
    if (!result) return;
    const button = document.getElementById('starmap-start-trial');
    if (!button) return;
    button.disabled = false;
    button.textContent = result.trial && result.trial.status === 'running'
      ? '\u8fd4\u56de\u8bd5\u70bc\u623f\u95f4'
      : result.trial && result.trial.status === 'success'
        ? '\u67e5\u770b\u8bd5\u70bc\u7ed3\u679c'
        : button.dataset.nodeType === 'production' ? '进入生产试炼房间' : button.dataset.nodeType === 'archaeology' ? '进入考古试炼房间' : button.dataset.nodeType === 'battle' ? '进入战斗试炼房间' : '\u8fdb\u5165\u91c7\u96c6\u8bd5\u70bc\u623f\u95f4';
  });
  canvas.addEventListener('pointercancel', () => { down = null; });

  appendResidentRewardSummary();
  const verifyPaths = () => {
    const api = getModel();
    if (!api || !Array.isArray(api.nodes) || !Array.isArray(api.edges)) return;
    const core = api.nodes.find((n) => n.id === 200);
    const seen = new Set(core ? [core] : []);
    const queue = core ? [core] : [];
    while (queue.length) {
      const node = queue.pop();
      api.edges.forEach((edge) => {
        const next = edge.a === node ? edge.b : edge.b === node ? edge.a : null;
        if (next && !seen.has(next)) { seen.add(next); queue.push(next); }
      });
    }
    document.body.dataset.starmapReachability = seen.size === api.nodes.length ? 'all-connected' : 'unreachable-nodes';
    refreshRouteState(true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', verifyPaths, { once: true });
  else verifyPaths();
  setTimeout(verifyPaths, 200);
})();
