/* End-to-end bootstrap selection across localStorage, TapTap device mirror and cloud. */
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
function ok(v, label) { console.log((v ? "PASS " : "FAIL ") + label); if (!v) failures++; }

function payload(marker, savedAt) {
  return { marker, lastSaveTime: savedAt, skills: {}, resources: {}, settings: {}, migrations: {}, currentAction: {}, inventory: {}, combat: {}, achievements: {} };
}

function build(opts = {}) {
  const store = {};
  if (opts.localPayload) store.eve_idle_save = JSON.stringify(opts.localPayload);
  if (opts.localRaw !== undefined) store.eve_idle_save = opts.localRaw;
  const ctx = { console, Promise, Error, JSON, Date, Object, Array, Number, String, Math, Blob: function(){}, URL: { createObjectURL(){return "";}, revokeObjectURL(){} } };
  ctx.window = ctx; ctx.globalThis = ctx;
  ctx.localStorage = {
    getItem(k) { if (opts.localReadThrows && k === "eve_idle_save") throw new Error("localStorage denied"); return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); }, removeItem(k) { delete store[k]; }
  };
  ctx.setInterval = () => 0; ctx.clearInterval = () => {};
  ctx.setTimeout = (fn) => { queueMicrotask(fn); return 1; }; ctx.clearTimeout = () => {};
  ctx.document = { getElementById: () => null, addEventListener() {}, createElement() { return { setAttribute(){}, appendChild(){}, addEventListener(){}, querySelector(){return null;}, click(){}, style:{} }; }, body:{appendChild(){}} };
  ctx.addEventListener = () => {}; ctx.dispatchEvent = () => true; ctx.CustomEvent = function(t,o){this.type=t;this.detail=o&&o.detail;};
  ctx.alert = () => {}; ctx.confirm = () => true; ctx.location = { reload(){} };
  ctx.GameEvents = { emit(){} };
  ctx.gameState = payload("fresh", 1);
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(repo, "js/core/save-envelope.js"), "utf8"), ctx, { filename: "save-envelope.js" });
  vm.runInContext(readFileSync(join(repo, "js/core/persistence.js"), "utf8"), ctx, { filename: "persistence.js" });

  const mirrorResult = opts.mirrorResult || { status: "none" };
  const cloudResult = opts.cloudResult || { status: "none" };
  const mirrorAvailable = opts.mirrorAvailable !== false;
  ctx.__offline = 0; ctx.__mirrorWrites = 0; ctx.__localWrites = 0; ctx.__mirrorDeletes = 0; ctx.__cloudDeletes = 0;
  const originalSet = ctx.localStorage.setItem.bind(ctx.localStorage);
  ctx.localStorage.setItem = (k,v) => { if (k === "eve_idle_save") ctx.__localWrites++; originalSet(k,v); };

  const extra = `
    ensureUserSettingsState = function(){};
    ensureStatisticsState = function(){};
    normalizeQueueState = function(){};
    migrateStationCorporationState = function(){};
    normalizePlanetaryState = function(){};
    applyLegacyStartupFieldMigrations = function(){};
    normalizeAndMigratePayload = function(){};
    activateRestoredState = function(){};
    createSerializableGameStateSnapshot = function(s){ return JSON.parse(JSON.stringify(s)); };
    restoreSerializableGameStateSnapshot = function(target,snap){ Object.keys(target).forEach(function(k){delete target[k];}); Object.assign(target,snap); };
    calculateOfflineGains = function(){ globalThis.__offline++; };
    getAchievementSyncService = function(){ return null; };
    getLocalMirrorService = function(){
      return {
        init:function(){return Promise.resolve(${mirrorAvailable});},
        isAvailable:function(){return ${mirrorAvailable};},
        readBest:function(){return Promise.resolve(globalThis.__mirrorResult);},
        scheduleWrite:function(){globalThis.__mirrorWrites++;return Promise.resolve({ok:true});},
        deleteAll:function(){globalThis.__mirrorDeletes++;${opts.mirrorDeleteError ? "return Promise.reject(new Error('mirror delete failed'));" : "return Promise.resolve(true);"}},
        status:function(){return {available:${mirrorAvailable},busy:false,lastWriteAt:0,error:null};}
      };
    };
    getCloudSaveService = function(){
      return {
        _meta:{localRevision:${Number(opts.localRevision || 1)},lastCloudChecksum:${JSON.stringify(opts.lastCloudChecksum || "")}},
        init:function(){return Promise.resolve(${opts.cloudAvailable !== false});},
        isAvailable:function(){return ${opts.cloudAvailable !== false};},
        fetchCloudEnvelope:function(){return Promise.resolve(globalThis.__cloudResult);},
        getSyncMeta:function(){return this._meta;},
        recordLocal:function(checksum,savedAt,revision){this._meta.localChecksum=checksum;this._meta.localSavedAt=savedAt;this._meta.localRevision=revision;},
        markDirty:function(){}, maybeUpload:function(){return Promise.resolve({ok:true});},
        getCloudArchiveMeta:function(){return ${opts.cloudMeta ? "{archiveId:'cloud-a'}" : "null"};},
        deleteCloud:function(){globalThis.__cloudDeletes++;${opts.cloudDeleteError ? "return Promise.reject(new Error('cloud delete failed'));" : "return Promise.resolve(true);"}},
        decideResolution:function(c){
          if(!c.hasLocal&&!c.hasCloud)return {decision:'new'};
          if(c.hasLocal&&!c.hasCloud)return {decision:'use-local'};
          if(!c.hasLocal&&c.hasCloud)return {decision:'use-cloud'};
          if(c.localChecksum===c.cloudChecksum)return {decision:'identical'};
          if(c.cloudChecksum===c.lastCloudChecksum&&c.localChecksum!==c.lastCloudChecksum)return {decision:'use-local'};
          if(c.localChecksum===c.lastCloudChecksum&&c.cloudChecksum!==c.lastCloudChecksum)return {decision:'use-cloud'};
          return {decision:'conflict'};
        }
      };
    };
  `;
  ctx.__mirrorResult = mirrorResult;
  ctx.__cloudResult = cloudResult;
  vm.runInContext(extra, ctx, { filename: "recovery-test-overrides.js" });
  return { ctx, store, SaveManager: ctx.SaveManager };
}

function envelopeFor(ctx, p, revision) { return ctx.SaveEnvelope.create({ payload:p, revision, savedAt:p.lastSaveTime, deviceId:"test" }); }

console.log("\n[1] local missing -> mirror restores and writes localStorage");
{
  const b = build({ cloudAvailable:false });
  b.ctx.__mirrorResult = { status:"ok", slot:"current", envelope:envelopeFor(b.ctx,payload("mirror",200),2) };
  await b.SaveManager.bootstrap();
  ok(b.SaveManager.getBootState()==="local-only" && b.ctx.gameState.marker==="mirror", "mirror selected");
  ok(!!b.store.eve_idle_save, "mirror restored back to raw localStorage");
  ok(b.ctx.__offline===1, "offline settlement exactly once");
}

console.log("\n[2] corrupt localStorage -> valid mirror restores");
{
  const b = build({ localRaw:"{broken", cloudAvailable:false });
  b.ctx.__mirrorResult = { status:"ok", slot:"previous", envelope:envelopeFor(b.ctx,payload("previous",300),3) };
  await b.SaveManager.bootstrap();
  ok(b.ctx.gameState.marker==="previous", "corrupt local does not hide valid mirror");
  ok(b.SaveManager.getBootState()==="local-only", "boot unblocked after mirror recovery");
}

console.log("\n[3] valid local + corrupt mirror -> local survives with warning");
{
  const b = build({ localPayload:payload("local",400), mirrorResult:{status:"error",error:new Error("mirror corrupt")}, cloudAvailable:false });
  await b.SaveManager.bootstrap();
  ok(b.ctx.gameState.marker==="local", "valid local selected");
  ok(b.ctx.__mirrorWrites>=1 && b.SaveManager._mirrorSyncFailed===false, "valid local self-heals the mirror after read failure");
}

console.log("\n[4] no device candidate + mirror error + cloud valid -> cloud restores");
{
  const b = build({ mirrorResult:{status:"error",error:new Error("mirror I/O")}, cloudAvailable:true });
  b.ctx.__cloudResult = { status:"ok", meta:{archiveId:"a"}, envelope:envelopeFor(b.ctx,payload("cloud",500),5) };
  await b.SaveManager.bootstrap();
  ok(b.SaveManager.getBootState()==="ready" && b.ctx.gameState.marker==="cloud", "cloud rescues device read failure");
  ok(!!b.store.eve_idle_save, "cloud recovery persisted locally");
}

console.log("\n[5] mirror error + cloud none -> fail closed, zero save");
{
  const b = build({ mirrorResult:{status:"error",error:new Error("mirror denied")}, cloudAvailable:true, cloudResult:{status:"none"} });
  await b.SaveManager.bootstrap();
  ok(b.SaveManager.getBootState()==="error", "unknown device state is not treated as new game");
  ok(!b.store.eve_idle_save && b.ctx.__localWrites===0, "zero overwrite on ambiguous absence");
  ok(b.ctx.__offline===0, "zero offline settlement on blocked boot");
}

console.log("\n[6] local read exception + no mirror/cloud -> fail closed");
{
  const b = build({ localReadThrows:true, mirrorResult:{status:"none"}, cloudAvailable:true, cloudResult:{status:"none"} });
  await b.SaveManager.bootstrap();
  ok(b.SaveManager.getBootState()==="error" && b.ctx.__localWrites===0, "localStorage exception cannot create fresh save");
}

console.log("\n[7] mirror newer than local -> mirror wins device selection");
{
  const b = build({ localPayload:payload("local-old",100), localRevision:1, cloudAvailable:false });
  b.ctx.__mirrorResult = { status:"ok",slot:"current",envelope:envelopeFor(b.ctx,payload("mirror-new",900),9) };
  await b.SaveManager.bootstrap();
  ok(b.ctx.gameState.marker==="mirror-new", "higher mirror revision selected");
}

console.log("\n[8] all three explicitly none -> fresh game allowed");
{
  const b = build({ localPayload:payload("local-new",1200), localRevision:1, cloudAvailable:false });
  b.ctx.__mirrorResult = { status:"ok",slot:"current",envelope:envelopeFor(b.ctx,payload("mirror-old",900),9) };
  await b.SaveManager.bootstrap();
  ok(b.ctx.gameState.marker==="local-new", "newer local timestamp wins when sync metadata revision was lost");
}
{
  const b = build({ mirrorResult:{status:"none"}, cloudAvailable:true, cloudResult:{status:"none"} });
  await b.SaveManager.bootstrap();
  ok(b.SaveManager.getBootState()==="ready", "explicit none/none/none reaches ready");
  ok(!!b.store.eve_idle_save, "fresh save created only after all probes say none");
}

console.log("\n[9] local delete removes mirror first; mirror failure keeps local");
{
  const b = build({ localPayload:payload("keep",100), cloudAvailable:false, mirrorDeleteError:true });
  await b.SaveManager.bootstrap();
  const result = await b.SaveManager.deleteLocalSaveOnly();
  ok(result===false && !!b.store.eve_idle_save, "mirror delete failure aborts localStorage deletion");
  ok(b.ctx.__mirrorDeletes===1, "mirror deletion was attempted");
}
{
  const b = build({ localPayload:payload("delete",100), cloudAvailable:false });
  await b.SaveManager.bootstrap();
  const result = await b.SaveManager.deleteLocalSaveOnly();
  ok(result===true && !b.store.eve_idle_save && b.ctx.__mirrorDeletes===1, "successful device delete removes mirror and localStorage");
}

console.log("\n[10] permanent delete fails closed when cloud deletion fails");
{
  const b = build({ localPayload:payload("keep",100), cloudAvailable:true, cloudMeta:true, cloudDeleteError:true });
  await b.SaveManager.bootstrap();
  const result = await b.SaveManager.permanentDeleteSave();
  ok(result===false && !!b.store.eve_idle_save, "cloud delete failure preserves device save");
  ok(b.ctx.__cloudDeletes===1 && b.ctx.__mirrorDeletes===0, "permanent order is cloud before mirror/local");
}

console.log(failures ? `\nFAILED ${failures}` : "\nALL RECOVERY LAYER TESTS PASSED");
process.exit(failures ? 1 : 0);
