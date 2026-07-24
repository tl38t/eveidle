import * as THREE from "three";
import { buildShip } from "../js/render3d/shipfactory2/ShipFactory2.js";

const ship = buildShip({ faction:"blood", hull:"cruiser", seed:777 });
let wMeshes=0, maxR=0, nanHit=false;
ship.traverse(o=>{
  if (o.name==="weapons"){
    o.traverse(x=>{
      if(x.isMesh){
        wMeshes++;
        const c=new THREE.Vector3(); x.getWorldPosition(c);
        if(!isFinite(c.x)||!isFinite(c.y)||!isFinite(c.z)) nanHit=true;
        maxR=Math.max(maxR, Math.hypot(c.x,c.y,c.z));
      }
    });
  }
});
console.log("weapons meshes =", wMeshes);
console.log("max radial dist =", maxR.toFixed(2), "(cruiser wingHalf ~9.9, so <10 means on-ship)");
console.log(nanHit ? "FAIL: NaN position" : "OK: no NaN");
