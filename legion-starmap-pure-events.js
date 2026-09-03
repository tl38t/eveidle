(() => {
  const canvas=document.getElementById('map'),title=document.getElementById('title'),detail=document.getElementById('detail');let down=null;
  const getModel=()=>window.LEGION_STARMAP_CONTENT||window.LEGION_STARMAP_RENDER_MODEL;
  const pick=e=>{const api=getModel(),r=canvas.getBoundingClientRect(),x=(e.clientX-r.left)*1000/r.width,y=(e.clientY-r.top)*700/r.height;let best=null,dist=Infinity;if(!api||!Array.isArray(api.nodes))return null;for(const n of api.nodes){const d=Math.hypot(n.x-x,n.y-y);if(d<dist){best=n;dist=d}}return dist<30?best:null};
  canvas.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY}});
  canvas.addEventListener('pointerup',e=>{const moved=down&&Math.hypot(e.clientX-down.x,e.clientY-down.y)>6;down=null;if(moved)return;const api=getModel(),n=pick(e);if(n&&api&&typeof api.describe==='function'){if(typeof window.LEGION_STARMAP_SELECT==='function')window.LEGION_STARMAP_SELECT(n);title.textContent=n.name;detail.textContent=api.describe(n)}});
  canvas.addEventListener('pointercancel',()=>{down=null});
  const verifyPaths=()=>{const api=getModel();if(!api)return;const core=api.nodes.find(n=>n.id===200),seen=new Set(core?[core]:[]),queue=core?[core]:[];while(queue.length){const node=queue.pop();api.edges.forEach(edge=>{const next=edge.a===node?edge.b:edge.b===node?edge.a:null;if(next&&!seen.has(next)){seen.add(next);queue.push(next)}})};document.body.dataset.starmapReachability=seen.size===api.nodes.length?'all-connected':'unreachable-nodes';};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',verifyPaths,{once:true});else verifyPaths();setTimeout(verifyPaths,200);
})();
