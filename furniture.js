// Constructor — FurnitureData local por hotel, sem ofertas de compra.
(function () {
  'use strict';
  const ctx = window._constructor;
  if (!ctx?.current()) return;
  let pending = null;

  function index(items) {
    if (!Array.isArray(items)) throw Error('FurnitureData sem lista de móveis.');
    const byId = new Map(), byClassname = new Map();
    for (const item of items) {
      if (!Number.isInteger(item.id) || item.id <= 0 || typeof item.classname !== 'string' || !item.classname) continue;
      if (!byId.has(item.id)) byId.set(item.id, []);
      byId.get(item.id).push(item);
      if (!byClassname.has(item.classname)) byClassname.set(item.classname, []);
      byClassname.get(item.classname).push(item);
    }
    if (!byId.size) throw Error('FurnitureData sem móveis reconhecidos.');
    // Preserva candidatos e duplicações; não resolve equivalências arbitrariamente.
    return {byId,byClassname,count:items.length};
  }

  ctx.loadFurniture = function () {
    if (pending) return pending;
    pending = (async () => {
      if (!ctx.hotel) throw Error('Não foi possível identificar o hotel para carregar os móveis.');
      const url = new URL('/load', window._hubBridge.HUB_UPDATE_URL || 'https://sh.hlivescript.workers.dev');
      url.searchParams.set('p', 'modules/constructor/furnis/' + ctx.hotel.furniture);
      url.searchParams.set('v', ctx.version);
      const response = await fetch(url.href, {signal:AbortSignal.any([ctx.ac.signal,AbortSignal.timeout(30000)])});
      if (!response.ok) throw Error('FurnitureData do ' + ctx.hotel.name + ' indisponível (HTTP ' + response.status + ').');
      const data = await response.json();
      if (!ctx.current()) throw new DOMException('Constructor encerrado', 'AbortError');
      const result = {hotel:ctx.hotel.id,floor:index(data.roomitemtypes?.furnitype),wall:index(data.wallitemtypes?.furnitype)};
      ctx.furnitureData = result;
      return result;
    })().catch(error => { pending = null; throw error; });
    return pending;
  };
  ctx.parts.add('furniture.js');
})();
