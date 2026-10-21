// Constructor — extraído da Oficina 1.5.1.
(function () {
  'use strict';
  const ctx = window._constructor;
  if (!ctx?.current()) return;
  const OficinaCore = ctx.Core;
  ctx.extendRuntime(class {
  height(value){
    this.requireCapability('build');
    this.send(this.protocol.height(OficinaCore,value));
  }

  async execute(plan,options={}){
    this.requireCapability('build');
    if(!Array.isArray(plan)||!plan.length||plan.length>5000)throw Error('Escolha uma construção válida.');
    if(!this.inventoryFresh)throw Error('Atualize seus móveis antes de construir.');
    const owned=new Set(this.inventory.map(i=>i.itemId)),used=new Set(),preparation=new Map();
    for(const p of plan){
      if(!owned.has(p.itemId)||used.has(p.itemId))throw Error('Os móveis mudaram. Atualize a lista e confira novamente.');
      used.add(p.itemId);
      if(!p.wall&&this.protocol.preparePlacement)preparation.set(p,this.protocol.preparePlacement(OficinaCore,p));
    }
    const flash=options.flash===true,delay=OficinaCore.number(options.delay??(flash?100:180),flash?25:0,flash?2000:10000,true);
    return this.run(flash?'Construir · Flash':'Construir',async signal=>{
      this.flashBuilding=flash;
      this.building=true;
      const roomEpoch=this.roomEpoch;
      this.buildRoomEpoch=roomEpoch;
      let lastCommandAt=null;
      const pace=async()=>{
        await this.checkpoint(signal);
        while(flash&&lastCommandAt!==null&&Date.now()-lastCommandAt<delay)await this.sleep(delay-(Date.now()-lastCommandAt),signal);
        await this.checkpoint(signal);
        lastCommandAt=Date.now();
      };
      const buildSend=async buffer=>{await pace();this.send(buffer);};
      const buildHeight=async value=>buildSend(this.protocol.height(OficinaCore,value));
      const result={sent:0,confirmed:0,wallSent:0};
      let changedHeight=false;
      this.update({total:plan.length});
      try{
        for(const buffer of this.protocol.resetBuild?.(OficinaCore)||[]){await buildSend(buffer);await this.sleep(80,signal);}
        for(const p of plan){
          await this.checkpoint(signal);
          for(const buffer of preparation.get(p)||[]){await buildSend(buffer);await this.sleep(80,signal);}
          if(!p.wall&&p.height!=null){await buildHeight(p.height);changedHeight=true;await this.sleep(80,signal);await this.checkpoint(signal);}
          if(p.wall){
            await buildSend(this.protocol.placeWall(OficinaCore,p));
            result.wallSent++;result.sent++;
            this.configurationReport.wallSent++;
            this.inventory=this.inventory.filter(i=>i.itemId!==p.itemId);
            this.emit('inventory',this.inventory);
            this.publishConfiguration();
          }
          else{
            await pace();
            result.sent++;
            let response;
            try{
              response=await this.exchange('placed',v=>v.spriteId===p.spriteId&&v.x===p.x&&v.y===p.y&&(p.rot===undefined||v.rot===p.rot),this.protocol.placeFloor(OficinaCore,p),signal);
            }catch(error){
              this.check(signal);
              if(error.code==='RESPONSE_TIMEOUT')this.configurationReport.unconfirmed++;
              this.publishConfiguration();
              throw error;
            }
            this.check(signal);
            if(roomEpoch!==this.roomEpoch)throw Error('O quarto mudou durante a confirmação de colocação.');
            result.confirmed++;
            // A confirmação de colocação consome o item, mesmo se os ajustes falharem.
            this.inventory=this.inventory.filter(i=>i.itemId!==p.itemId);
            const configuration=this.trackConfiguration(p,response,roomEpoch);
            this.emit('inventory',this.inventory);
            this.update({done:result.confirmed+result.wallSent,...result});
            if(p.releaseHeight){await this.checkpoint(signal);await buildHeight(null);changedHeight=false;}
            if(this.supports('configuration'))await this.configureItem(configuration,signal,{...options,delay});
            else if(configuration.statePending){
              configuration.stateReason='O estado solicitado na colocação não foi confirmado. Confira o móvel no quarto.';
              this.finishConfiguration(configuration);
              if(options.strictConfiguration)throw Object.assign(Error('Modo estrito: o estado solicitado não foi confirmado. O móvel colocado não será recolocado.'),{configurationOnly:true});
            }
          }
          this.update({done:result.confirmed+result.wallSent,...result});
          if(!flash)await this.sleep(delay,signal);
        }
        if(result.wallSent){
          await this.checkpoint(signal);
          await this.refreshInventory(signal);
          const remaining=new Set(this.inventory.map(i=>i.itemId));
          if(plan.some(p=>p.wall&&remaining.has(p.itemId)))throw Error('Há móveis de parede ainda no inventário. Confira a parede antes de tentar novamente.');
        }
        const status=this.configurationStatus();
        const text=`${result.confirmed} móveis de chão confirmados`+(result.wallSent?`; ${result.wallSent} envios para a parede`:'')+'.';
        const pending=status.pending.length?` Pendências nesta sala: ${status.report.statePending} estados e ${status.report.colorPending} cores. `+(this.supports('configuration')?'Use Tentar pendências novamente.':'Confira os estados no quarto; a repetição de ajustes ainda não está disponível neste hotel.'):'';
        this.emit('notice',{type:result.wallSent||status.pending.length?'warning':'success',text:text+pending+(result.wallSent?' Confira as posições na parede.':'')});
        return {...result,configuration:status};
      }
      finally{
        this.flashBuilding=false;
        this.building=false;
        if(roomEpoch===this.roomEpoch&&this.ws?.readyState===1){
          if(this.protocol.resetBuild)this.resetBuildModes();
          else if(changedHeight)try{this.height(null);}catch{}
        }
        this.buildRoomEpoch=null;
      }
    });
  }

  async buy(missing,catalog,options={}){
    this.requireCapability('buy');
    const valid=OficinaCore.normalizeCatalog(catalog);
    const fallback=options.pageId===undefined?undefined:OficinaCore.int(options.pageId,0);
    const counts=inv=>{const m=new Map();for(const i of inv)if(i.type!=='i')m.set(i.spriteId,(m.get(i.spriteId)||0)+1);return m;};
    const original=counts(this.inventory),desired=new Map();let excludedLimited=0;
    const limited=new Set([...this.limitedSprites,...Object.values(this.projects()).flatMap(p=>p.layout).filter(i=>i.limited).map(i=>i.spriteId),...this.inventory.filter(i=>i.limited&&i.type!=='i').map(i=>i.spriteId)]);
    for(const m of missing){
      const sid=OficinaCore.int(m.spriteId,1),count=OficinaCore.int(m.count,1,5000);
      if(desired.has(sid))throw Error('Item repetido na lista de compra.');
      const offer=valid[sid];
      if(limited.has(sid)||offer?.limited===true){excludedLimited+=count;continue;}
      if(!offer||offer.pageId===undefined&&fallback===undefined)throw Error('Faltam dados do catálogo para comprar um dos móveis.');
      desired.set(sid,(original.get(sid)||0)+count);
    }
    if(!desired.size)throw Error('Não há móveis para comprar.'+(excludedLimited?' Os faltantes são LTD e ficam fora da compra.':''));
    const delay=OficinaCore.number(options.delay??1100,0,10000);
    return this.run('Comprar móveis',async signal=>{
      this.update({label:'Conferindo seus móveis'});
      await this.refreshInventory(signal);
      const before=counts(this.inventory),orders=[];
      for(const [sid,target] of desired){
        if(this.limitedSprites.has(sid)||this.inventory.some(i=>i.spriteId===sid&&i.limited&&i.type!=='i')){excludedLimited+=Math.max(0,target-(before.get(sid)||0));continue;}
        const count=Math.max(0,target-(before.get(sid)||0));
        if(count)orders.push({sid,count});
      }
      const total=orders.reduce((n,i)=>n+i.count,0);
      this.update({label:'Comprando os móveis que faltam',total});
      let sent=0;
      for(const order of orders){
        let left=order.count;
        while(left>0){
          await this.checkpoint(signal);
          if(this.limitedSprites.has(order.sid)||this.inventory.some(i=>i.spriteId===order.sid&&i.limited&&i.type!=='i'))throw Error('Um móvel da lista foi identificado como LTD. Confira a lista antes de continuar.');
          const offer=valid[order.sid],qty=Math.min(left,offer.bundleAllowed===false?1:100);
          this.send(this.protocol.buy(OficinaCore,offer,fallback,qty));
          left-=qty;sent+=qty;
          this.update({sent,done:0});
          await this.sleep(delay,signal);
        }
      }
      this.update({label:'Verificando a chegada dos móveis'});
      await this.checkpoint(signal);
      await this.refreshInventory(signal);
      const after=counts(this.inventory);
      let obtained=0;
      for(const order of orders){const arrived=Math.max(0,(after.get(order.sid)||0)-(before.get(order.sid)||0));obtained+=Math.min(arrived,order.count);}
      if(obtained!==total)throw Error(`Foram enviados pedidos de ${sent} móveis; ${obtained} chegaram ao inventário. Confira suas compras. Nenhum pedido será repetido automaticamente.`);
      this.update({done:obtained});
      this.emit('notice',{type:excludedLimited?'warning':'success',text:(total?`${obtained} móveis chegaram ao inventário.`:excludedLimited?'Nenhum pedido foi enviado.':'Você já tem todos os móveis necessários.')+(excludedLimited?` ${excludedLimited} unidades LTD ficaram fora da compra e continuam faltantes.`:'')});
      return {sent,obtained,excludedLimited};
    });
  }

  }.prototype);

  ctx.parts.add('tasks.js');
})();
