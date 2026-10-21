// Constructor — protocolo Habblet observado; recursos pendentes não são habilitados.
(function () {
  'use strict';
  const ctx=window._constructor;
  if(!ctx?.current())return;
  const OP=Object.freeze({ROOM_RESET:758,OBJECTS:1778,UPDATE:3776,CHAT:1314,INV_REQ:3150,INV_RES:994,PLACE:1258,WALL:1258,CONFIRM:1534,BUY:3492,CATALOG_INDEX:1032,CATALOG_PAGE:804,CATALOG_REQ:412,INV_REMOVE:159});
  const command=(C,text)=>C.encode(OP.CHAT,[['s',text],['i',3]]);
  ctx.protocols.habblet=Object.freeze({
    opcodes:OP,
    capabilities:Object.freeze({inventory:true,catalog:true,buy:true,build:true,capture:true,configuration:false,colors:false}),
    // As amostras conferem com estes formatos de leitura compartilhados.
    readInventory:(C,buffer)=>C.readInventory(buffer),
    readRoom:(C,buffer)=>C.readRoom(buffer),
    readFloorConfirmation:(C,buffer)=>C.readFloorConfirmation(buffer),
    // 3776 inclui o objeto completo; não usa o formato de UPDATE do Habblive.
    readUpdates:(C,buffer)=>[C.readFloorConfirmation(buffer)],
    readCatalogPage:(C,buffer)=>C.readCatalogPage(buffer,{extras:['','0']}),
    inventoryRequest:C=>C.encode(OP.INV_REQ),
    height:(C,value)=>command(C,value===null?':up':`:up ${C.number(value,-1000,1000)}`),
    preparePlacement:(C,p)=>[
      command(C,`:state ${C.int(p.extraData??0,0)}`),
      command(C,`:spin ${C.int(p.rot??0,0,7)}`)
    ],
    resetBuild:C=>[':up',':state',':spin'].map(text=>command(C,text)),
    placeFloor:(C,p)=>C.encode(OP.PLACE,[['s',`${p.itemId} ${p.x} ${p.y} ${p.rot??0}`]]),
    // Diferente do Habblive: ID e posição ficam na mesma string.
    placeWall:(C,p)=>C.encode(OP.WALL,[['s',`${p.itemId} :w=${p.wx},${p.wy} l=${p.lx},${p.ly} ${p.dir} `]]),
    buy:(C,offer,pageId,quantity)=>C.encode(OP.BUY,[['i',offer.pageId??pageId],['i',offer.offerId],['s',''],['i',quantity]]),
    catalogRequest:(C,opcode,pageId)=>C.encode(OP.CATALOG_REQ,[['i',pageId],['i',-1],['s','NORMAL']])
  });
  ctx.parts.add('protocol-habblet.js');
})();
