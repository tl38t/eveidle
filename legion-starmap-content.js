/* Legion Star Map canonical content bridge.
 * The renderer remains the authority for the existing node geometry.
 * This module deliberately does not rebuild, rename, or reposition nodes.
 */
(() => {
  const publish = () => {
    const model = window.LEGION_STARMAP_RENDER_MODEL;
    if (!model || !Array.isArray(model.nodes) || !Array.isArray(model.edges)) return false;
    window.LEGION_STARMAP_CONTENT = model;
    return true;
  };

  if (!publish()) {
    window.addEventListener('legion-starmap-render-model-ready', publish, { once: true });
  }
})();
