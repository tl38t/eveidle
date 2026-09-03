/* Legion node detail integration. Kept independent from the canvas renderer. */
(() => {
  const RINGS = { outer: '\u5916\u73af', middle: '\u4e2d\u73af', inner: '\u5185\u73af' };
  const TYPES = { battle: '\u6218\u6597\u8bd5\u70bc', collection: '\u91c7\u96c6\u8bd5\u70bc', production: '\u751f\u4ea7\u8bd5\u70bc', archaeology: '\u8003\u53e4\u8bd5\u70bc', final: '\u6700\u7ec8\u8282\u70b9' };
  const SUBTYPES = {
    battle: ['\u6218\u6597'], collection: ['\u91c7\u77ff', '\u91c7\u6c14'],
    production: ['\u51b6\u70bc', '\u8230\u8236\u5236\u9020', '\u88c5\u5907\u5236\u9020', '\u589e\u5f3a\u5242\u5236\u9020'],
    archaeology: ['\u9057\u8ff9\u626b\u63cf']
  };
  const TITAN_IDS = new Set([20, 62, 104]);
  const QUOTA = {
    outer: { battle: 44, collection: 22, production: 22, archaeology: 8 },
    middle: { battle: 41, collection: 20, production: 21, archaeology: 8 },
    inner: { battle: 4, collection: 2, production: 1, archaeology: 7 }
  };

  function sourceArrays() {
    const source = Array.from(document.scripts).map(s => s.textContent || '').find(s => s.includes('const nodeNames=')) || '';
    const read = key => {
      const match = source.match(new RegExp('const ' + key + '=(\\[[\\s\\S]*?\\]);'));
      if (!match) return [];
      try { return Function('return ' + match[1])(); } catch (_) { return []; }
    };
    return { names: read('nodeNames'), alternates: read('alternateNodeNames') };
  }

  function buildNodes() {
    const { names, alternates } = sourceArrays();
    const used = new Set(); let alternateIndex = 0;
    const nameOf = (faction, index) => {
      let name = names[(faction * 31 + index) % names.length] || '';
      while (used.has(name) && alternateIndex < alternates.length) name = alternates[alternateIndex++];
      used.add(name); return name;
    };
    const nodes = [];
    for (let faction = 0; faction < 3; faction++) for (let row = 0; row < 8; row++) for (let col = 0; col < 6; col++) {
      nodes.push({ id: nodes.length, ring: row < 5 ? 'middle' : 'outer', name: nameOf(faction, row * 6 + col) });
    }
    for (let faction = 0; faction < 3; faction++) for (let extra = 0; extra < 14; extra++) {
      nodes.push({ id: nodes.length, ring: 'outer', name: nameOf(faction, 48 + extra) });
    }
    for (let i = 0; i < 14; i++) nodes.push({ id: nodes.length, ring: 'inner', name: String.fromCharCode(65 + i) + '-' + String(i + 1).padStart(2, '0') });
    nodes.push({ id: nodes.length, ring: 'inner', name: '\u5148\u9a71\u6587\u660e\u6838\u5fc3', type: 'final' });

    Object.entries(QUOTA).forEach(([ring, counts]) => {
      const group = nodes.filter(n => n.ring === ring && n.type !== 'final');
      const special = group.filter(n => TITAN_IDS.has(n.id));
      const rest = group.filter(n => !special.includes(n)).sort((a, b) => ((a.id * 73) % 997) - ((b.id * 73) % 997));
      let cursor = 0;
      Object.entries(counts).forEach(([type, count]) => {
        const picked = type === 'battle' ? special.slice() : [];
        while (picked.length < count && cursor < rest.length) picked.push(rest[cursor++]);
        picked.forEach((node, index) => { node.type = type; node.subtype = (SUBTYPES[type] || [''])[index % (SUBTYPES[type] || ['']).length]; node.tier = 'normal'; });
      });
    });
    nodes.filter(n => n.type === 'battle' && !TITAN_IDS.has(n.id)).sort((a, b) => ((a.id * 113) % 1009) - ((b.id * 113) % 1009)).slice(0, 17).forEach(n => n.tier = 'elite');
    TITAN_IDS.forEach(id => { if (nodes[id]) { nodes[id].type = 'battle'; nodes[id].subtype = '\u6cf0\u5766\u7ec4\u4ef6'; nodes[id].tier = 'elite'; } });
    nodes[nodes.length - 1].type = 'final'; nodes[nodes.length - 1].subtype = '\u6cf0\u5766\u5236\u9020\u79d1\u6280'; nodes[nodes.length - 1].tier = 'final';
    return nodes;
  }

  function boot() {
    try {
      const nodes = buildNodes();
      const byName = new Map(nodes.map(node => [node.name, node]));
      const describe = name => {
        const node = byName.get(String(name || '').trim());
        if (!node) return '';
        if (node.type === 'final') return '\u6700\u7ec8\u8282\u70b9 · \u6cf0\u5766\u5236\u9020\u79d1\u6280';
        return RINGS[node.ring] + ' · ' + TYPES[node.type] + ' · ' + node.subtype + ' · ' + (node.tier === 'elite' ? '\u7cbe\u82f1' : '\u666e\u901a');
      };
      window.LEGION_STARMAP_CONTENT = { nodes, byName, describe };
      const title = document.getElementById('title'); const detail = document.getElementById('detail');
      const update = () => { const text = title && describe(title.textContent); if (text && detail.textContent !== text) detail.textContent = text; };
      if (title && window.MutationObserver) new MutationObserver(update).observe(title, { childList: true, characterData: true, subtree: true });
      update();
    } catch (error) { window.LEGION_STARMAP_CONTENT = { error: String(error) }; }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();
