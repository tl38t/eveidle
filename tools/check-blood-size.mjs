import * as THREE from "three";
import { buildShip } from "../js/render3d/shipfactory2/ShipFactory2.js";

const classes = ["frigate","destroyer","cruiser","battleship"];
for (const c of classes) {
  const ship = buildShip({ faction:"blood", hull:c, seed:12345 });
  let meshes=0, maxX=0, maxZ=0, maxY=0;
  ship.traverse(o=>{ if(o.isMesh){ meshes++; o.geometry.computeBoundingBox(); const bb=o.geometry.boundingBox; maxX=Math.max(maxX, Math.abs(bb.max.x), Math.abs(bb.min.x)); maxZ=Math.max(maxZ, Math.abs(bb.max.z)); maxY=Math.max(maxY, Math.abs(bb.max.y), Math.abs(bb.min.y)); }});
  console.log(c.padEnd(10), "meshes=", String(meshes).padStart(3), " wingHalf=", maxX.toFixed(2), " lenHalf=", maxZ.toFixed(2), " thick=", maxY.toFixed(2));
}
