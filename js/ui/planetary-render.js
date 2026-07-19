/* ================================================================
   行星开发原生DOM与Canvas适配器
   ================================================================ */

if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function(x, y, width, height, radius) {
    const value = typeof radius === "number" ? { tl:radius, tr:radius, br:radius, bl:radius } : radius;
    this.moveTo(x + value.tl, y); this.arcTo(x + width, y, x + width, y + height, value.tr);
    this.arcTo(x + width, y + height, x, y + height, value.br); this.arcTo(x, y + height, x, y, value.bl);
    this.arcTo(x, y, x + width, y, value.tl); return this;
  };
}

function resizeSkillBar(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.offsetWidth || 400;
  const height = 24;
  if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
    canvas.width = width * ratio; canvas.height = height * ratio;
    canvas.getContext("2d").scale(ratio, ratio);
  }
  return { width, height };
}

function drawSkillBar(canvas, percent, colorType) {
  if (!canvas) return;
  const size = resizeSkillBar(canvas), context = canvas.getContext("2d");
  const value = Math.min(100, Math.max(0, percent));
  const fillWidth = value / 100 * size.width;
  context.clearRect(0, 0, size.width, size.height);
  context.beginPath(); context.roundRect(0, 0, size.width, size.height, 6); context.fillStyle = "rgba(8,12,20,.7)"; context.fill();
  context.strokeStyle = "#000"; context.lineWidth = 3; context.stroke();
  context.shadowColor = "rgba(212,168,67,.3)"; context.shadowBlur = 10; context.strokeStyle = "#d4a843"; context.lineWidth = 4;
  context.beginPath(); context.roundRect(-2.5, -2.5, size.width + 5, size.height + 5, 8.5); context.stroke(); context.shadowBlur = 0;
  if (value > 0.5 && fillWidth > 4) {
    const palettes = { green:["#1a6a2a", "#4ac87a", "#7ae89a", "#1a6a2a"], gold:["#6a4a0a", "#d4a843", "#f0c860", "#6a4a0a"], purple:["#3a1a6a", "#8a4ac8", "#b07ae8", "#3a1a6a"] };
    const colors = palettes[colorType] || palettes.green;
    const gradient = context.createLinearGradient(0, 0, fillWidth, 0);
    colors.forEach((color, index) => gradient.addColorStop(index / (colors.length - 1), color));
    context.beginPath(); context.roundRect(4.5, 4.5, Math.max(0, fillWidth - 5.5), size.height - 10, 4); context.fillStyle = gradient; context.fill();
  }
  const label = Math.round(value) + "%";
  context.textAlign = "center"; context.textBaseline = "middle"; context.font = '700 12px Rajdhani,"Microsoft YaHei",sans-serif';
  context.lineWidth = 2.5; context.strokeStyle = "rgba(0,0,0,.6)"; context.strokeText(label, size.width / 2, size.height / 2 + 0.5);
  context.fillStyle = "#e8d8a0"; context.fillText(label, size.width / 2, size.height / 2 + 0.5);
}

function formatCompact(number) {
  if (number >= 1e6) return (number / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (number >= 1e3) return (number / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
  return number.toLocaleString();
}

const planetVisualOffsets = new Map();

function renderPlanetaryCard(card) {
  return `<div class="planet-card${card.expired ? " expired" : ""}" id="planet-card-${card.id}">
    <div class="planet-header"><canvas class="planet-canvas" id="pcanvas-${card.id}" width="60" height="60"></canvas><span class="planet-name">${card.name}</span><span class="planet-status ${card.statusClass}" id="planet-status-${card.id}">${card.statusText}</span></div>
    <div class="planet-output"><span>产物：</span><span class="po-icon">${card.outputIcon}</span><span class="po-name">${card.output}</span></div>
    <div class="planet-storage-row"><span class="ps-label">库存</span><div class="progress-bar"><div class="fill planet-storage-fill" id="planet-storage-fill-${card.id}" style="width:${card.storagePercent}%;"></div></div><span class="ps-value" id="planet-storage-value-${card.id}">${card.storage} / ${card.storageMax}</span></div>
    <div class="planet-prod-row" id="planet-prod-row-${card.id}"${card.showOutputProgress ? "" : ' style="display:none;"'}><span class="ps-label">产出</span><div class="progress-bar"><div class="fill planet-prod-fill" id="planet-prod-${card.id}" style="width:${card.outputPercent}%;"></div></div><span class="ps-value" id="planet-eta-${card.id}">~${card.outputEta.toFixed(1)}s</span></div>
    <div class="planet-time-row"><span class="pt-label">周期</span><div class="progress-bar"><div class="fill planet-time-fill${card.timeWarning ? " warn" : ""}" id="planet-time-fill-${card.id}" style="width:${card.timePercent}%;"></div></div><span class="pt-value" id="planet-time-value-${card.id}">${card.timeLeftText}</span></div>
    <div class="planet-actions"><button class="btn primary planet-collect-btn" data-action="collect" data-id="${card.id}" ${card.canCollect ? "" : 'disabled style="opacity:.4;"'}>📥 收取</button><button class="btn-redeploy planet-redeploy-btn" data-action="redeploy" data-id="${card.id}">🔄 续期</button><button class="btn-remove-planet planet-remove-btn" data-action="remove" data-id="${card.id}">✕ 撤除</button></div>
  </div>`;
}

function renderPlanetaryPage(now) {
  const renderTime = Number(now) || Date.now();
  const display = getPlanetaryDisplayState(gameState, renderTime, getCargoCapacity());
  const text = (id, value) => { const element = document.getElementById(id); if (element) element.textContent = value; };
  text("planetary-header-info", `等级 ${display.level} · 槽位 ${display.usedSlots} / ${display.slots}`);
  text("planetary-exp-value", display.xp.toLocaleString() + " / " + display.xpNeeded.toLocaleString());
  text("planetary-slot-info", `可用槽位：${display.usedSlots} / ${display.slots}`);
  const fill = document.getElementById("planetary-exp-fill"); if (fill) fill.style.width = display.xpPercent + "%";
  const deploy = document.getElementById("btn-deploy-planet"); if (deploy) deploy.style.display = display.canDeploy ? "" : "none";
  const grid = document.getElementById("planet-grid"); const empty = document.getElementById("planet-empty-msg");
  if (!grid) return display;
  grid.innerHTML = display.deployments.map(renderPlanetaryCard).join("");
  if (empty) empty.style.display = display.deployments.length ? "none" : "";
  for (const card of display.deployments) {
    if (!planetVisualOffsets.has(card.id)) planetVisualOffsets.set(card.id, Math.random());
    const canvas = document.getElementById("pcanvas-" + card.id); if (canvas) _drawPlanetSphere(canvas, card.type, planetVisualOffsets.get(card.id));
  }
  return display;
}

function updatePlanetaryLiveUI(now) {
  const renderTime = Number(now) || Date.now();
  const display = getPlanetaryDisplayState(gameState, renderTime, getCargoCapacity());
  const grid = document.getElementById("planet-grid");
  if (grid && grid.querySelectorAll(".planet-card").length !== display.deployments.length) return renderPlanetaryPage(renderTime);
  const slotInfo = document.getElementById("planetary-slot-info"); if (slotInfo) slotInfo.textContent = `可用槽位：${display.usedSlots} / ${display.slots}`;
  const deploy = document.getElementById("btn-deploy-planet"); if (deploy) deploy.style.display = display.canDeploy ? "" : "none";
  for (const card of display.deployments) {
    const element = document.getElementById("planet-card-" + card.id); if (!element) return renderPlanetaryPage(renderTime);
    element.classList.toggle("expired", card.expired);
    const status = document.getElementById("planet-status-" + card.id); if (status) { status.className = "planet-status " + card.statusClass; status.textContent = card.statusText; }
    const storageFill = document.getElementById("planet-storage-fill-" + card.id); if (storageFill) storageFill.style.width = card.storagePercent + "%";
    const storageValue = document.getElementById("planet-storage-value-" + card.id); if (storageValue) storageValue.textContent = card.storage + " / " + card.storageMax;
    const outputRow = document.getElementById("planet-prod-row-" + card.id); if (outputRow) outputRow.style.display = card.showOutputProgress ? "" : "none";
    const timeFill = document.getElementById("planet-time-fill-" + card.id); if (timeFill) { timeFill.style.width = card.timePercent + "%"; timeFill.className = "fill planet-time-fill" + (card.timeWarning ? " warn" : ""); }
    const timeValue = document.getElementById("planet-time-value-" + card.id); if (timeValue) timeValue.textContent = card.timeLeftText;
    const collect = element.querySelector('[data-action="collect"]'); if (collect) { collect.disabled = !card.canCollect; collect.style.opacity = card.canCollect ? "" : "0.4"; }
  }
  return display;
}

function updatePlanetaryAnimationFrame(frameTime, elapsedFrames) {
  const display = getPlanetaryDisplayState(gameState, Date.now(), getCargoCapacity());
  for (const card of display.deployments) {
    const currentOffset = planetVisualOffsets.has(card.id) ? planetVisualOffsets.get(card.id) : Math.random();
    const nextOffset = (currentOffset + (_PLANET_SPEEDS[card.type] || 0.0008) * elapsedFrames) % 1;
    planetVisualOffsets.set(card.id, nextOffset);
    const progress = document.getElementById("planet-prod-" + card.id); if (progress) progress.style.width = card.outputPercent + "%";
    const eta = document.getElementById("planet-eta-" + card.id); if (eta) eta.textContent = "~" + card.outputEta.toFixed(1) + "s";
    const canvas = document.getElementById("pcanvas-" + card.id); if (canvas) _drawPlanetSphere(canvas, card.type, nextOffset);
  }
}

function planetaryActionMessage(result) {
  const messages = { "level-locked":"需要行星开发 Lv." + (result.level || 1), "no-slots":"没有空余槽位！", "insufficient-isk":"ISK 不足！", "insufficient-tritanium":"三钛合金不足！", "cargo-full":"主仓库空间不足！", "storage-not-empty":"请先收取行星库存，再撤除该行星。" };
  return messages[result.reason] || "操作失败";
}

function deployPlanet(type) {
  const result = dispatchGameAction(gameState, { type:"planetary/deploy", planetType:type }, Date.now());
  if (!result.changed) { alert(planetaryActionMessage(result)); return false; }
  renderPlanetaryPage(); return true;
}

function collectPlanet(id) {
  const result = dispatchGameAction(gameState, { type:"planetary/collect", id, cargoCapacity:getCargoCapacity() }, Date.now());
  if (!result.changed && result.reason === "cargo-full") alert(planetaryActionMessage(result));
  if (result.changed) renderPlanetaryPage();
  return result.changed;
}

function redeployPlanet(id) {
  const result = dispatchGameAction(gameState, { type:"planetary/redeploy", id }, Date.now());
  if (!result.changed) { alert(planetaryActionMessage(result)); return false; }
  renderPlanetaryPage(); return true;
}

function removePlanet(id) {
  const deployment = gameState.planetary.deployments.find(item => item.id === id);
  if (!deployment) return false;
  if ((deployment.storage || 0) > 0) { alert("请先收取行星库存，再撤除该行星。"); return false; }
  const config = PLANET_TYPES.find(planet => planet.type === deployment.type);
  if (!confirm(`确定撤除${config ? config.name : "该行星"}吗？部署费用不会返还。`)) return false;
  const result = dispatchGameAction(gameState, { type:"planetary/remove", id }, Date.now());
  if (result.changed) { planetVisualOffsets.delete(id); renderPlanetaryPage(); }
  return result.changed;
}

function showDeployModal() {
  const overlay = document.getElementById("deploy-modal"); const options = document.getElementById("deploy-options");
  if (!overlay || !options) return;
  const display = getPlanetaryDisplayState(gameState, Date.now(), getCargoCapacity());
  options.innerHTML = display.deployOptions.map(option => `<div class="deploy-option${option.unlocked ? "" : " locked"}"><div class="do-info"><span class="do-name">${option.icon} ${option.name}</span><span class="do-detail">产出：${option.output} · 间隔 ${option.interval.toFixed(1)}s</span></div><div class="do-cost">${option.unlocked ? `ISK ${option.costISK} · 三钛 ${option.costTrit}<br><button class="btn primary" style="margin-top:4px;font-size:11px;" data-type="${option.type}">部署</button>` : `🔒 需 Lv.${option.level}`}</div></div>`).join("");
  overlay.classList.remove("hidden");
}

function hideDeployModal() {
  const overlay = document.getElementById("deploy-modal"); if (overlay) overlay.classList.add("hidden");
}


// ---- 行星 Canvas 纹理与渲染 ----
const _PLANET_SPEEDS  = { lava:0.0009, gas:0.0006, ice:0.0012, plasma:0.0005, temperate:0.0010, storm:0.0015 };
const _PLANET_TILTS   = { lava:15, gas:20, ice:210, plasma:330, temperate:55, storm:140 };
const _PLANET_HAS_RING= { gas:true, storm:true };
const _PLANET_TEX_CACHE = {};
const _PLANET_MASK_CACHE = {};

function _buildPlanetGradients() {
  return {
    lava:      [[0,'#552200'],[0.5,'#993300'],[0.7,'#dd5500'],[1,'#772200']],
    gas:       [[0,'#0f2a3a'],[0.3,'#1a4466'],[0.6,'#337799'],[0.8,'#4488bb'],[1,'#1a4466']],
    ice:       [[0,'#2a5566'],[0.4,'#4488aa'],[0.7,'#99ccdd'],[1,'#4488aa']],
    plasma:    [[0,'#331166'],[0.4,'#6622bb'],[0.7,'#9944ee'],[1,'#6622bb']],
    temperate: [[0,'#0d3344'],[0.3,'#1a5577'],[0.6,'#2a77aa'],[0.8,'#4499cc'],[1,'#2a77aa']],
    storm:     [[0,'#112233'],[0.3,'#223355'],[0.6,'#445577'],[0.8,'#556688'],[1,'#334466']]
  };
}

function _getPlanetTexture(type) {
  if (_PLANET_TEX_CACHE[type]) return _PLANET_TEX_CACHE[type];
  const w = 512, h = 256;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const grads = _buildPlanetGradients();
  const stops = grads[type] || grads.lava;
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  for (const [pos, color] of stops) grad.addColorStop(pos, color);
  ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);

  if (type === 'lava') {
    for (let i = 0; i < 14; i++) {
      const x = Math.random() * w, y = Math.random() * h, r = 8 + Math.random() * 40;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,'+(200+Math.random()*55)+',80,'+(0.7+Math.random()*0.3)+')');
      g.addColorStop(0.6, 'rgba(255,'+(150+Math.random()*50)+',30,'+(0.4+Math.random()*0.3)+')');
      g.addColorStop(1, 'rgba(255,80,0,0)');
      ctx.fillStyle = g; ctx.beginPath();
      ctx.ellipse(x, y, r*(0.6+Math.random()*0.8), r*(0.4+Math.random()*0.6), Math.random()*2, 0, Math.PI*2);
      ctx.fill();
    }
  }
  if (type === 'gas') {
    for (let i = 0; i < 8; i++) {
      const y = (0.05 + i*0.12 + Math.random()*0.04) * h;
      ctx.fillStyle = 'rgba(200,230,255,'+(0.15+Math.random()*0.25)+')';
      ctx.fillRect(0, y-4, w, 6+Math.random()*10);
    }
    ctx.save(); ctx.shadowColor='rgba(255,180,80,0.4)'; ctx.shadowBlur=25;
    ctx.beginPath(); ctx.ellipse(w*0.35, h*0.52, 44, 28, 0, 0, Math.PI*2);
    ctx.fillStyle='#dd7744'; ctx.fill();
    ctx.shadowBlur=12; ctx.beginPath(); ctx.ellipse(w*0.35, h*0.52, 28, 16, 0, 0, Math.PI*2);
    ctx.fillStyle='#ff9955'; ctx.fill();
    ctx.shadowBlur=6; ctx.beginPath(); ctx.ellipse(w*0.35, h*0.52, 12, 7, 0, 0, Math.PI*2);
    ctx.fillStyle='#ffbb77'; ctx.fill(); ctx.restore();
    for (let i = 0; i < 20; i++) {
      const x = Math.random()*w, y = Math.random()*h, r = 2+Math.random()*6;
      ctx.beginPath(); ctx.ellipse(x, y, r, r*0.5, Math.random()*2, 0, Math.PI*2);
      ctx.fillStyle = 'rgba(255,255,255,'+(0.04+Math.random()*0.06)+')'; ctx.fill();
    }
  }
  if (type === 'ice') {
    for (let i = 0; i < 25; i++) {
      const x = Math.random()*w, y = Math.random()*h, len = 8+Math.random()*35;
      ctx.strokeStyle = 'rgba(60,90,110,'+(0.25+Math.random()*0.35)+')';
      ctx.lineWidth = 1+Math.random()*2; ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x+len*(Math.random()-0.5)*2, y+len*(Math.random()-0.5)*2); ctx.stroke();
    }
    for (let i = 0; i < 8; i++) {
      const x = Math.random()*w, y = Math.random()*h, r = 15+Math.random()*45;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,'+(0.08+Math.random()*0.12)+')');
      g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
    }
  }
  if (type === 'plasma') {
    const cols = ['#ff88ff','#66aaff','#aa44ff','#44ccff'];
    for (let i = 0; i < 16; i++) {
      const x = Math.random()*w, y = Math.random()*h, r = 10+Math.random()*32;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const col = cols[Math.floor(Math.random()*cols.length)];
      g.addColorStop(0, col+'aa'); g.addColorStop(0.5, col+'55'); g.addColorStop(1, 'transparent');
      ctx.fillStyle = g; ctx.beginPath();
      ctx.ellipse(x, y, r*(0.5+Math.random()*0.8), r*(0.3+Math.random()*0.6), Math.random()*2, 0, Math.PI*2); ctx.fill();
    }
  }
  if (type === 'temperate') {
    const landCols = ['#55bb44','#66bb55','#77cc66','#99dd77','#88cc66'];
    for (let i = 0; i < 12; i++) {
      const x = Math.random()*w, y = Math.random()*h, r = 12+Math.random()*38;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const col = landCols[Math.floor(Math.random()*landCols.length)];
      g.addColorStop(0, col+'aa'); g.addColorStop(0.7, col+'60'); g.addColorStop(1, 'transparent');
      ctx.fillStyle = g; ctx.beginPath();
      ctx.ellipse(x, y, r*(0.5+Math.random()*0.9), r*(0.4+Math.random()*0.7), Math.random()*2, 0, Math.PI*2); ctx.fill();
    }
    for (let i = 0; i < 6; i++) {
      const x = Math.random()*w, y = Math.random()*h, r = 20+Math.random()*55;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,'+(0.08+Math.random()*0.08)+')');
      g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(x, y, r*(0.5+Math.random()*0.8), r*(0.3+Math.random()*0.5), Math.random()*2, 0, Math.PI*2); ctx.fill();
    }
  }
  if (type === 'storm') {
    for (let i = 0; i < 14; i++) {
      const x = Math.random()*w, y = Math.random()*h, r = 8+Math.random()*30;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const bright = 130+Math.random()*125;
      g.addColorStop(0, 'rgba('+bright+','+(bright-40)+',255,'+(0.4+Math.random()*0.4)+')');

      g.addColorStop(0.6, 'rgba('+(bright-60)+','+(bright-100)+',220,'+(0.15+Math.random()*0.25)+')');
      g.addColorStop(1, 'transparent'); ctx.fillStyle = g; ctx.beginPath();
      ctx.ellipse(x, y, r*(0.4+Math.random()*0.8), r*(0.3+Math.random()*0.6), Math.random()*2, 0, Math.PI*2); ctx.fill();
    }
  }

  const imgData = ctx.getImageData(0, 0, w, h);
  _PLANET_TEX_CACHE[type] = { data: imgData.data, w, h };
  return _PLANET_TEX_CACHE[type];
}

function _getPlanetMask(size) {
  const key = 'm'+size;
  if (_PLANET_MASK_CACHE[key]) return _PLANET_MASK_CACHE[key];
  const baseR = (size/2-4)*0.66;
  const mc = document.createElement('canvas'); mc.width = size; mc.height = size;
  const mCtx = mc.getContext('2d');
  const grad = mCtx.createRadialGradient(baseR*0.65, baseR*0.35, 0, baseR, baseR, baseR);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0)');
  grad.addColorStop(0.7, 'rgba(0,0,0,0.18)');
  grad.addColorStop(0.9, 'rgba(0,0,0,0.40)');
  grad.addColorStop(1, 'rgba(0,0,0,0.70)');
  mCtx.fillStyle = grad; mCtx.fillRect(0, 0, size, size);
  const hl = mCtx.createRadialGradient(baseR*0.32, baseR*0.22, 0, baseR*0.32, baseR*0.22, baseR*0.5);
  hl.addColorStop(0, 'rgba(255,255,255,0.40)');
  hl.addColorStop(0.3, 'rgba(255,255,255,0.14)');
  hl.addColorStop(1, 'rgba(255,255,255,0)');
  mCtx.fillStyle = hl; mCtx.beginPath(); mCtx.arc(baseR*0.32, baseR*0.22, baseR*0.5, 0, Math.PI*2); mCtx.fill();
  _PLANET_MASK_CACHE[key] = mc;
  return mc;
}

function _drawPlanetRing(ctx, cx, cy, r, type) {
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, ctx.canvas.width, cy); ctx.clip();
  ctx.translate(cx, cy); ctx.scale(1, 0.28); ctx.rotate(0.18);
  ctx.shadowColor = 'rgba(150,200,255,0.35)'; ctx.shadowBlur = 35;
  ctx.strokeStyle = type==='gas' ? 'rgba(180,215,255,0.70)' : 'rgba(160,150,220,0.65)';
  ctx.lineWidth = 6; ctx.beginPath(); ctx.ellipse(0, 0, r*2.2, r*2.2, 0, 0, Math.PI*2); ctx.stroke();
  ctx.shadowBlur = 15;
  ctx.strokeStyle = type==='gas' ? 'rgba(210,235,255,0.50)' : 'rgba(190,180,240,0.45)';
  ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(0, 0, r*1.70, r*1.70, 0, 0, Math.PI*2); ctx.stroke();
  ctx.restore();
  // 环阴影
  ctx.save();
  const shGrad = ctx.createLinearGradient(0, cy+r*0.2, 0, cy+r*1.5);
  shGrad.addColorStop(0, 'rgba(0,0,0,0)'); shGrad.addColorStop(0.3, 'rgba(0,0,0,0.08)'); shGrad.addColorStop(1, 'rgba(0,0,0,0.20)');
  ctx.fillStyle = shGrad; ctx.beginPath(); ctx.ellipse(cx, cy, r*2.2, r*0.62, 0.18, 0, Math.PI*2); ctx.fill();
  ctx.restore();
}

function _drawPlanetSphere(canvas, type, scrollOffset) {
  const size = canvas.width;
  const baseR = (size/2-4)*0.66;
  const cx = size/2, cy = size/2;
  const tex = _getPlanetTexture(type);
  const maskCanvas = _getPlanetMask(size);
  const ctx = canvas.getContext('2d');
  const tiltDeg = _PLANET_TILTS[type] || 15;
  const tiltRad = tiltDeg * Math.PI / 180;
  const cosT = Math.cos(tiltRad), sinT = Math.sin(tiltRad);
  const r = baseR;
  const ow = Math.ceil(r*2), oh = Math.ceil(r*2);
  const imageData = ctx.createImageData(ow, oh);
  const data = imageData.data;
  const texW = tex.w, texH = tex.h;

  for (let py = 0; py < oh; py++) {
    for (let px = 0; px < ow; px++) {
      const nx = (px - r)/r, ny = (py - r)/r;
      const dist2 = nx*nx + ny*ny;
      if (dist2 > 1) continue;
      const nz = Math.sqrt(1 - dist2);
      const rx = nx;
      const ry = ny*cosT - nz*sinT;
      const rz = ny*sinT + nz*cosT;
      const theta = Math.atan2(rz, rx);
      const phi = Math.asin(Math.max(-1, Math.min(1, ry)));
      let u = (theta/(2*Math.PI) + 0.5 + scrollOffset) % 1;
      if (u < 0) u += 1;
      const v = phi/Math.PI + 0.5;
      const tx = Math.floor(u*texW) % texW;
      const ty = Math.min(texH-1, Math.max(0, Math.floor(v*texH)));
      const tidx = (ty*texW + tx)*4;
      const idx = (py*ow + px)*4;
      data[idx]=tex.data[tidx]; data[idx+1]=tex.data[tidx+1]; data[idx+2]=tex.data[tidx+2]; data[idx+3]=255;
    }
  }
  ctx.clearRect(0, 0, size, size);
  const offsetX = cx - r, offsetY = cy - r;
  ctx.putImageData(imageData, offsetX, offsetY);

  // 光照遮罩
  ctx.save(); ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(maskCanvas, offsetX, offsetY, r*2, r*2);
  ctx.restore();

  // 辉光
  ctx.save();
  const glow = ctx.createRadialGradient(cx, cy, r*0.7, cx, cy, r);
  glow.addColorStop(0, 'rgba(255,255,255,0)');
  glow.addColorStop(0.95, 'rgba(180,220,255,0.08)');
  glow.addColorStop(1, 'rgba(180,220,255,0.04)');
  ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.fill();
  ctx.restore();

  ctx.strokeStyle = 'rgba(180,220,255,0.06)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.stroke();

  // 星环
  if (_PLANET_HAS_RING[type]) _drawPlanetRing(ctx, cx, cy, r, type);
}

(function bindPlanetaryUI() {
  const deployButton = document.getElementById("btn-deploy-planet"); if (deployButton) deployButton.addEventListener("click", showDeployModal);
  const closeButton = document.getElementById("modal-close"); if (closeButton) closeButton.addEventListener("click", hideDeployModal);
  const overlay = document.getElementById("deploy-modal"); if (overlay) overlay.addEventListener("click", event => {
    if (event.target === overlay) hideDeployModal();
    const deploy = event.target.closest("[data-type]"); if (deploy && !deploy.disabled && deployPlanet(deploy.dataset.type)) hideDeployModal();
  });
  const grid = document.getElementById("planet-grid"); if (grid) grid.addEventListener("click", event => {
    const button = event.target.closest("[data-action]"); if (!button) return;
    if (button.dataset.action === "collect") collectPlanet(button.dataset.id);
    else if (button.dataset.action === "redeploy") redeployPlanet(button.dataset.id);
    else if (button.dataset.action === "remove") removePlanet(button.dataset.id);
  });
})();
