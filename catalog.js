// Constructor — extraído da Oficina 1.5.1.
(function () {
  'use strict';
  const ctx = window._constructor;
  if (!ctx?.current()) return;
  const OficinaCore = ctx.Core;
  ctx.extendRuntime(class {
  catalogCaptureStatus(){const items=Object.values(this.catalog());return {active:this.catalogCapture.active,pages:this.catalogCapture.pages.size,learned:this.catalogCapture.learned,total:items.filter(i=>!i.limited).length,limited:items.filter(i=>i.limited).length};}

  startCatalogCapture(){
    this.requireCapability('catalog');
    if(this.busy)throw Error('Conclua a tarefa atual antes de capturar o catálogo.');
    this.catalog();
    this.catalogCapture={active:true,opcode:null,pages:new Set(),learned:0};
    this.emit('catalog',this.catalogCaptureStatus());
    this.emit('notice',{type:'info',text:'Abra a loja do jogo e visite as páginas com os móveis que deseja comprar. A captura não faz compras.'});
  }

  stopCatalogCapture(){this.catalogCapture.active=false;this.emit('catalog',this.catalogCaptureStatus());}

  learnCatalog(packet){
    if(OficinaCore.OP.CATALOG_PAGE!==undefined&&packet.id!==OficinaCore.OP.CATALOG_PAGE)return;
    const catalogSession=this.catalogCapture;
    if(catalogSession.opcode!==null&&packet.id!==catalogSession.opcode)return;
    let page;
    try{page=this.protocol.readCatalogPage(OficinaCore,packet.buffer);}catch{return;}
    const candidate=this.catalogCandidates.get(page.pageId);
    if(candidate&&candidate.ws===this.ws&&Date.now()-candidate.time<10000&&page.catalogType==='NORMAL'){
      const newlyReady=!this.catalogRequest||this.catalogRequest.opcode!==candidate.opcode;
      this.catalogRequest={opcode:candidate.opcode};
      this.catalogCandidates.delete(page.pageId);
      if(newlyReady)this.emit('diagnostic',`Pedido de página reconhecido e confirmado: página ${page.pageId}. Capturar tudo está pronto.`);
      this.emit('catalog-ready',this.catalogCaptureStatus());
    }
    else if(!this.catalogRequest&&catalogSession.active)this.emit('diagnostic',`Página ${page.pageId} recebida, mas o pedido de abertura não foi observado. Abra outra categoria da loja com o módulo ativo para aprender o pedido.`);
    if(!catalogSession.active)return;
    this.catalogWriteQueue=this.catalogWriteQueue.then(async()=>{
      if(this.disposed)return;
      try{
        const current=this.catalog();
        let learned=0;
        for(const offer of page.offers){const {spriteId,...data}=offer;if(!current[spriteId])learned++;if(!current[spriteId]?.limited)current[spriteId]=data;}
        for(const spriteId of page.limitedSpriteIds){current[spriteId]={limited:true};this.limitedSprites.add(spriteId);}
        if(page.offers.length||page.limitedSpriteIds.length)await this.saveCatalog(current);
        catalogSession.opcode=packet.id;
        catalogSession.pages.add(page.pageId);
        catalogSession.learned+=learned;
        this.dispatch({kind:'catalogPage',pageId:page.pageId,catalogType:page.catalogType});
        this.emit('catalog',this.catalogCaptureStatus());
        this.emit('diagnostic',`Catálogo: página ${page.pageId}, ${page.offers.length} ofertas individuais aproveitáveis de ${page.total}.`);
      }
      catch(e){
        catalogSession.active=false;
        this.emit('notice',{type:'error',text:'Não foi possível salvar o catálogo: '+e.message});
        this.emit('catalog',{active:false,pages:catalogSession.pages.size,learned:catalogSession.learned,total:0});
      }
    });
  }

  observeCatalogRequest(buffer,ws){
    for(const packet of OficinaCore.decode(buffer))try{
      if(OficinaCore.OP.CATALOG_REQ!==undefined&&packet.id!==OficinaCore.OP.CATALOG_REQ)continue;
      if(['INV_REQ','PLACE','WALL','BUY','CHAT','USE','COLOR'].some(key=>OficinaCore.OP[key]===packet.id))continue;
      const r=new OficinaCore.Reader(packet.buffer,6),pageId=r.i32(),offerId=r.i32(),type=r.str();
      if(pageId>=0&&offerId>=-1&&type==='NORMAL'&&r.p===packet.buffer.byteLength){
        if(this.catalogCandidates.size>100)this.catalogCandidates.clear();
        this.catalogCandidates.set(pageId,{opcode:packet.id,ws,time:Date.now()});
      }
    }catch{/* Só aprende pedidos de página completos e confirmados pelo servidor. */}
  }

  learnCatalogIndex(packet){
    if(OficinaCore.OP.CATALOG_INDEX!==undefined&&packet.id!==OficinaCore.OP.CATALOG_INDEX)return;
    if(this.catalogIndexOpcode!==undefined&&packet.id!==this.catalogIndexOpcode)return;
    try{
      const r=new OficinaCore.Reader(packet.buffer,6),pages=new Map();
      let nodes=0;
      const bool=()=>{const n=r.u8();if(n>1)throw Error('Índice inválido.');return !!n;};
      const node=depth=>{
        if(depth>40||++nodes>20000)throw Error('Índice grande demais.');
        const visible=bool();r.i32();
        const catalogPageId=r.i32(),name=r.str();r.str();
        for(let n=r.count(20000);n>0;n--)r.i32();
        if(visible&&catalogPageId>=0)pages.set(catalogPageId,{id:catalogPageId,name});
        for(let n=r.count(20000);n>0;n--)node(depth+1);
      };
      node(0);bool();
      const type=r.str();
      if(type!=='NORMAL'||r.p!==packet.buffer.byteLength||!pages.size)return;
      this.catalogIndexOpcode=packet.id;
      this.catalogIndex=[...pages.values()];
      this.emit('catalog-ready',this.catalogCaptureStatus());
    }catch{/* Outros pacotes não são a lista de páginas da loja. */}
  }

  async scanCatalog(){
    this.requireCapability('catalog');
    if(this.busy)throw Error('Conclua ou cancele a tarefa atual primeiro.');
    if(!this.catalogIndex.length)throw Error('Recarregue o jogo e abra a loja para receber a lista de páginas.');
    if(!this.catalogRequest)throw Error('Ative a captura manual e abra uma página de móveis na loja uma vez. Depois clique em Capturar tudo.');
    const pages=this.catalogIndex.slice(),opcode=this.catalogRequest.opcode;
    if(!this.catalogCapture.active)this.startCatalogCapture();
    this.catalogScan=true;
    try{
      return await this.run('Capturar catálogo',async signal=>{
        const completed=new Set(),failedPages=new Map();
        let sent=0;
        this.update({total:pages.length});
        for(let pass=0;pass<3;pass++){
          const pending=pages.filter(page=>!completed.has(page.id));
          if(!pending.length)break;
          if(pass)await this.sleep(1000*pass,signal);
          for(const page of pending){
            await this.checkpoint(signal);
            if(!this.catalogCapture.active)throw Error('A captura foi interrompida.');
            this.update({label:`Loja: ${page.name||'página '+page.id}${pass?' · nova tentativa '+pass:''}`,done:completed.size});
            try{
              sent++;
              await this.exchange('catalogPage',v=>v.pageId===page.id&&v.catalogType==='NORMAL',this.protocol.catalogRequest(OficinaCore,opcode,page.id),signal,7000);
              completed.add(page.id);failedPages.delete(page.id);
            }
            catch(e){
              this.check(signal);
              if(!this.catalogCapture.active)throw Error('A captura parou porque não foi possível salvar o catálogo.');
              failedPages.set(page.id,page);
              this.emit('diagnostic',`Página ${page.id} sem resposta salva (tentativa ${pass+1}/3).`);
            }
            this.update({done:completed.size,confirmed:completed.size,sent});
            // Uma requisição em voo: a resposta salva libera a próxima página.
            await this.sleep(pass?350:100,signal);
          }
        }
        const confirmed=completed.size,failed=failedPages.size,pendingPages=[...failedPages.keys()];
        this.catalogScanReport={confirmed,failed,pendingPages};
        this.emit('notice',{type:failed?'warning':'success',text:failed?`Captura incompleta: ${confirmed}/${pages.length} páginas salvas; ${failed} continuam sem resposta após 3 tentativas. Consulte os IDs no diagnóstico.`:`Catálogo capturado: ${confirmed} páginas e ${this.catalogCaptureStatus().total} móveis disponíveis para compra salvos.`});
        if(failed)this.emit('diagnostic','Páginas pendentes: '+pendingPages.join(', '));
        return this.catalogScanReport;
      });
    }
    finally{this.catalogScan=false;this.stopCatalogCapture();}
  }

  saveCatalog(value){
    const valid=OficinaCore.normalizeCatalog(value);
    // Uma importação antiga não pode apagar uma restrição LTD já confirmada.
    for(const [sid,item] of Object.entries(this.catalog()))if(item.limited)valid[sid]={limited:true};
    for(const sid of this.limitedSprites)valid[sid]={limited:true};
    const saved=this.persist('hl_module_shop_db',valid);
    return saved?.then?saved.then(()=>valid):valid;
  }

  }.prototype);

  ctx.parts.add('catalog.js');
})();
