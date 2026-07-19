// verify_seam.mjs — 计算发光缝到底在船体表面内/外/齐平
// 复刻 ShipFactory.js 里的 hullRadiusAt 与 addHullDetail 的发光缝放置参数
const HULL_PRESETS = {
  frigate:    { len: 7.0,  noseFat: 0.26, mid: 0.42, tail: 0.14, scale: 1.0  },
  destroyer:  { len: 9.0,  noseFat: 0.32, mid: 0.52, tail: 0.18, scale: 1.15 },
  cruiser:    { len: 11.0, noseFat: 0.42, mid: 0.76, tail: 0.26, scale: 1.4  },
  battleship: { len: 14.0, noseFat: 0.50, mid: 1.00, tail: 0.34, scale: 1.75 },
};
function hullRadiusAt(z, fatR, midR, tailR, L) {
  const pts = [
    [-L/2,0.012],[-L/2+0.06*L,fatR*0.38],[-L/2+0.14*L,fatR*0.78],
    [-L/2+0.24*L,fatR],[-0.14*L,midR*0.92],[0.02*L,midR],
    [0.28*L,midR*0.62],[0.48*L,midR*0.38],[0.72*L,tailR],
    [L/2-0.04*L,tailR*0.45],[L/2,0.012]
  ];
  if (z<=pts[0][0]) return pts[0][1];
  if (z>=pts[pts.length-1][0]) return pts[pts.length-1][1];
  for (let i=0;i<pts.length-1;i++){
    const [z0,r0]=pts[i],[z1,r1]=pts[i+1];
    if (z>=z0&&z<=z1) return r0+(r1-r0)*(z-z0)/(z1-z0);
  }
  return midR;
}
// 八边形车削面：在角度 phi 处船体实际表面半径（顶点处=R，面中点=0.924R）
function octoSurf(R, phi){
  const seg = Math.PI/4; // 45°
  const k = Math.round(phi/seg);
  const nearest = k*seg;
  let d = phi - nearest;
  d = Math.max(-seg/2, Math.min(seg/2, d));
  return R*Math.cos(d);
}
function analyze(label, hull, seamInset, seamRad){
  const p=HULL_PRESETS[hull]; const s=p.scale, L=p.len*s;
  const R=(z)=>hullRadiusAt(z, p.noseFat*s, p.mid*s, p.tail*s, L);
  const phis=[0,0.95,-0.95];
  let minGapV=Infinity,maxGapV=-Infinity,minGapF=Infinity,maxGapF=-Infinity;
  for(const phi of phis){
    for(let i=0;i<=18;i++){
      const z=-0.44*L+(0.88*L)*(i/18);
      const rC=R(z)-seamInset;            // 缝管中心半径
      const outerR=rC+seamRad;            // 缝管最外缘半径
      const surfV=R(z);                   // 顶点方向表面
      const surfF=octoSurf(R(z),phi);     // 该 phi 处八边形实际表面
      const gv=outerR-surfV, gf=outerR-surfF;
      minGapV=Math.min(minGapV,gv); maxGapV=Math.max(maxGapV,gv);
      minGapF=Math.min(minGapF,gf); maxGapF=Math.max(maxGapF,gf);
    }
  }
  const verdict = (maxGapF<0) ? "完全埋入(不可见)" : (minGapV>0 ? "整体凸出表面(浮在表面)" : "齐平/微凸(嵌在表面，可见)");
  console.log(`[${label}] ${hull.padEnd(10)} seamInset=${seamInset.toFixed(3)}s seamRad=${seamRad.toFixed(3)}s`);
  console.log(`   相对顶点表面 gap: min=${minGapV.toFixed(4)}s max=${maxGapV.toFixed(4)}s | 相对八边形面 gap: min=${minGapF.toFixed(4)}s max=${maxGapF.toFixed(4)}s -> ${verdict}`);
}
console.log("=== 当前参数 (ShipFactory.js v2.5: seamInset=0.090s, seamRad=0.010s) ===");
for(const h of ["frigate","destroyer","cruiser","battleship"]) analyze("CURRENT", h, 0.090, 0.010);
console.log("\n=== 提议修正 (seamInset=0.010s, seamRad=0.012s) ===");
for(const h of ["frigate","destroyer","cruiser","battleship"]) analyze("PROPOSED", h, 0.010, 0.012);
