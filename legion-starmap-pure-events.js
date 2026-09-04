(() => {
  const canvas = document.getElementById('map');
  const title = document.getElementById('title');
  const detail = document.getElementById('detail');
  let down = null;

  const getModel = () => window.LEGION_STARMAP_CONTENT || window.LEGION_STARMAP_RENDER_MODEL;
  const nodePayload = (n) => ({
    id: n.id, name: n.name, type: n.type, subtype: n.subtype,
    collectionResource: n.collectionResource, collectionKind: n.collectionKind,
    collectionAmount: n.collectionAmount,
    collectionBaseSecondsPerUnit: n.collectionBaseSecondsPerUnit,
    collectionTimeLimitSeconds: n.collectionTimeLimitSeconds,
    collectionEfficiencyTarget: n.collectionEfficiencyTarget
  });
  const openRoom = (n) => {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'legion-starmap/open-room', node: nodePayload(n) }, '*');
    }
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

    if (typeof window.LEGION_STARMAP_SELECT === 'function') window.LEGION_STARMAP_SELECT(n);
    title.textContent = n.name;
    detail.textContent = api.describe(n);
    const old = document.getElementById('starmap-start-trial');
    if (old) old.remove();

    // 只显示详情；进入试炼房间必须由按钮明确触发。
    if (n.type === 'collection' && n.collectionResource) {
      const button = document.createElement('button');
      button.id = 'starmap-start-trial';
      button.type = 'button';
      button.textContent = '\u8fdb\u5165\u91c7\u96c6\u8bd5\u70bc\u623f\u95f4';
      button.style.cssText = 'display:block;margin-top:14px;padding:10px 14px;border:1px solid #6aa8ff;border-radius:7px;background:#132744;color:#dff1ff;cursor:pointer;font:inherit';
      button.onclick = () => openRoom(n);
      detail.appendChild(button);
    }
  });
  window.addEventListener('message', (e) => {
    const result = e && e.data && e.data.type === 'legion-starmap/trial-result' ? e.data.result : null;
    if (!result) return;
    const button = document.getElementById('starmap-start-trial');
    if (!button) return;
    button.disabled = false;
    button.textContent = result.trial && result.trial.status === 'running'
      ? '\u8fd4\u56de\u8bd5\u70bc\u623f\u95f4'
      : result.trial && result.trial.status === 'success'
        ? '\u67e5\u770b\u8bd5\u70bc\u7ed3\u679c'
        : '\u8fdb\u5165\u91c7\u96c6\u8bd5\u70bc\u623f\u95f4';
  });
  canvas.addEventListener('pointercancel', () => { down = null; });

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
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', verifyPaths, { once: true });
  else verifyPaths();
  setTimeout(verifyPaths, 200);
})();
