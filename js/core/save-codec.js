/* Clipboard save codec: compact transport, not encryption. */
(function (root) {
  "use strict";
  const PREFIX = "DSI1.";
  function b64(bytes) { let s=""; for (let i=0;i<bytes.length;i+=0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i,i+0x8000)); return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,""); }
  function unb64(s) { s=s.replace(/-/g,"+").replace(/_/g,"/"); while(s.length%4) s+="="; const raw=atob(s), out=new Uint8Array(raw.length); for(let i=0;i<raw.length;i++) out[i]=raw.charCodeAt(i); return out; }
  // Clipboard codes must contain recovery data only.  Runtime logs, telemetry,
  // diagnostics and UI histories can grow without bound and are not save state.
  const DROP_KEY = /(?:^|_)(?:log|logs|history|histories|telemetry|diagnostic|debug|trace|analytics|eventlog|combatlog|notifications?)$/i;
  const DROP_EXACT = new Set(["cargoLoot", "runLog", "lastLoot", "lastSpecialLoot", "statistics", "eventLedger"]);
  function compact(value, key) {
    if (DROP_EXACT.has(String(key || "")) || DROP_KEY.test(String(key || ""))) return undefined;
    if (Array.isArray(value)) return value.map(v => compact(v, "")).filter(v => v !== undefined);
    if (!value || typeof value !== "object") return value;
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const c = compact(v, k);
      if (c !== undefined) out[k] = c;
    }
    return out;
  }
  async function encode(payload) {
    const text=JSON.stringify(compact(payload)), bytes=new TextEncoder().encode(text);
    if (typeof CompressionStream !== "undefined") {
      const cs=new CompressionStream("gzip"), w=cs.writable.getWriter(); w.write(bytes); w.close();
      const buf=new Uint8Array(await new Response(cs.readable).arrayBuffer());
      return PREFIX+"g."+b64(buf);
    }
    return PREFIX+"j."+b64(bytes);
  }
  async function decode(code) {
    code=String(code||"").trim(); if(!code) throw new Error("存档文本为空");
    if(code.indexOf(PREFIX)!==0) return JSON.parse(code); // 兼容旧明文 JSON
    const parts=code.split("."); if(parts.length!==3) throw new Error("存档文本格式错误");
    let bytes=unb64(parts[2]);
    if(parts[1]==="g") { if(typeof DecompressionStream === "undefined") throw new Error("当前环境不支持压缩存档"); bytes=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()); }
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  root.ClipboardSaveCodec={encode,decode,PREFIX};
  if(typeof module!=="undefined"&&module.exports) module.exports=root.ClipboardSaveCodec;
})(typeof window!=="undefined"?window:globalThis);
