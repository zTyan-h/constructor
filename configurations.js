// Constructor — configurações de mobis já confirmados, sem recolocação.
(function () {
  'use strict';
  const ctx=window._constructor;
  if(!ctx?.current())return;
  const C=ctx.Core;
  const color=value=>value==null?null:String(value).toUpperCase();
  ctx.extendRuntime(class {
    configurationStatus(){
      const pending=[...this.pendingConfigurations.values()].map(item=>({...item}));
      const statePending=pending.filter(item=>item.statePending).length;
      const colorPending=pending.filter(item=>item.colorsPending).length;
      return {pending,report:{...this.configurationReport,statePending,colorPending,
        configured:Math.max(0,this.configurationReport.placed-pending.length)},
        canRetry:this.supports('configuration')&&pending.length>0&&!this.busy&&!this.disposed&&this.ws?.readyState===1};
    }

    publishConfiguration(){this.emit('configuration',this.configurationStatus());}

    resetConfigurationRoom(){
      const hadPending=this.pendingConfigurations.size>0;
      if(this.building)this.abort('O quarto ou a conexão mudou. A tarefa foi interrompida para preservar os móveis.');
      this.roomEpoch++;
      this.pendingConfigurations.clear();
      this.configurationReport={placed:0,configured:0,statePending:0,colorPending:0,unconfirmed:0,wallSent:0};
      this.publishConfiguration();
      if(hadPending)this.emit('notice',{type:'warning',text:'O quarto ou a conexão mudou. As pendências antigas foram descartadas; os IDs anteriores não serão reutilizados.'});
    }

    trackConfiguration(plan,response,epoch){
      if(epoch!==this.roomEpoch)throw Error('A confirmação de colocação pertence a outro quarto.');
      this.configurationReport.placed++;
      const item={roomId:response.roomId,spriteId:plan.spriteId,x:plan.x,y:plan.y,epoch:this.roomEpoch,
        expectedState:plan.extraData===undefined?undefined:String(plan.extraData),currentState:String(response.state),
        color1:this.supports('colors')&&(plan.color1||plan.color2)?color(plan.color1||'FFFFFF'):null,
        color2:this.supports('colors')&&(plan.color1||plan.color2)?color(plan.color2||'FFFFFF'):null,
        currentColor1:color(response.color1),currentColor2:color(response.color2),
        statePending:false,colorsPending:false,stateUncertain:false,revision:0,stateReason:'',colorReason:'',reason:''};
      item.statePending=item.expectedState!==undefined&&item.currentState!==item.expectedState;
      item.colorsPending=item.color1!==null&&(item.currentColor1!==item.color1||item.currentColor2!==item.color2);
      if(item.statePending||item.colorsPending)this.pendingConfigurations.set(item.roomId,item);
      this.publishConfiguration();
      return item;
    }

    observeConfiguration(update){
      const item=this.pendingConfigurations.get(update.roomId);
      if(!item||item.epoch!==this.roomEpoch)return;
      if(update.state!==undefined){
        const next=String(update.state),changed=next!==item.currentState;
        if(changed)item.revision++;
        item.currentState=next;
        // Um eco do estado anterior não confirma o efeito de um toggle em voo.
        if(changed||next===item.expectedState)item.stateUncertain=false;
        item.statePending=item.expectedState!==undefined&&next!==item.expectedState;
        if(!item.statePending)item.stateReason='';
      }
      if(update.color1!=null)item.currentColor1=color(update.color1);
      if(update.color2!=null)item.currentColor2=color(update.color2);
      if(item.currentColor1===item.color1&&item.currentColor2===item.color2){item.colorsPending=false;item.colorReason='';}
      // A tarefa ativa fecha o registro; respostas tardias também podem resolvê-lo.
      if(this.configurationActive!==item)this.finishConfiguration(item);
    }

    finishConfiguration(item){
      if(item.epoch!==this.roomEpoch)return;
      item.reason=[item.stateReason,item.colorReason].filter(Boolean).join(' · ');
      if(!item.statePending&&!item.colorsPending)this.pendingConfigurations.delete(item.roomId);
      else this.pendingConfigurations.set(item.roomId,item);
      this.publishConfiguration();
    }

    async configureItem(item,signal,options={}){
      this.requireCapability('configuration');
      this.check(signal);
      if(item.epoch!==this.roomEpoch)throw Error('As pendências pertencem a outro quarto.');
      let interval=Math.max(200,Number(options.delay)||180);
      this.configurationActive=item;
      const recover=error=>{
        this.check(signal);
        if(!['RESPONSE_TIMEOUT','CONFIGURATION_REJECTED'].includes(error.code))throw error;
      };
      const exchange=async(buffer,match=()=>true,onSend)=>{
        await this.checkpoint(signal);
        await this.sleep(interval,signal);
        await this.checkpoint(signal);
        if(onSend?.()===false)return;
        return this.exchange('configurationState',v=>v.roomId===item.roomId&&match(v),buffer,signal);
      };
      try{
        if(item.colorsPending){
          try{
            await exchange(this.protocol.color(C,item),
              v=>color(v.color1)===item.color1&&color(v.color2)===item.color2,()=>item.colorsPending);
            if(item.colorsPending)item.colorReason='As cores salvas ainda não foram confirmadas pelo jogo.';
          }catch(error){recover(error);interval=Math.min(2000,interval*2);item.colorReason=error.code==='CONFIGURATION_REJECTED'?'O jogo recusou a alteração de cor.':'As cores foram enviadas, mas a confirmação não chegou.';}
        }
        if(item.statePending){
          try{
            item.stateReason='';
            // Após timeout de um toggle, aguarde estado real antes de enviar outro.
            if(item.stateUncertain){
              await this.wait('configurationState',v=>v.roomId===item.roomId,signal).promise;
              if(item.stateUncertain)throw Object.assign(Error('Sem atualização atual do estado.'),{code:'RESPONSE_TIMEOUT'});
            }
            const seen=new Set([item.currentState]);
            for(let tries=0;item.statePending&&tries<35;tries++){
              await this.checkpoint(signal);
              let revision=item.revision,before=item.currentState;
              try{
                await exchange(this.protocol.use(C,item),
                  v=>String(v.state)!==before||String(v.state)===item.expectedState,()=>{
                    if(!item.statePending)return false;
                    before=item.currentState;revision=item.revision;seen.add(before);
                    item.stateUncertain=true;return true;
                  });
              }catch(error){
                recover(error);
                if(error.code!=='RESPONSE_TIMEOUT')throw error;
                interval=Math.min(2000,interval*2);
                // Espera passiva para resposta atrasada; não repete o toggle.
                if(item.revision===revision)await this.wait('configurationState',v=>v.roomId===item.roomId,signal,interval).promise;
              }
              if(!item.statePending){item.stateReason='';break;}
              if(seen.has(item.currentState)){item.stateReason='O móvel repetiu um estado; o estado salvo não foi alcançado.';break;}
              seen.add(item.currentState);
            }
            if(item.statePending&&!item.stateReason)item.stateReason='Limite de 35 alterações atingido sem alcançar o estado salvo.';
          }catch(error){
            recover(error);
            item.stateReason=error.code==='CONFIGURATION_REJECTED'?'O jogo recusou a alteração de estado.':'Estado sem confirmação. Atualize o móvel no quarto antes de tentar novamente.';
          }
        }
      }finally{
        this.configurationActive=null;
        if(item.statePending&&!item.stateReason)item.stateReason='A alteração de estado ainda está pendente.';
        if(item.colorsPending&&!item.colorReason)item.colorReason='A alteração de cor ainda está pendente.';
        this.finishConfiguration(item);
      }
      if(options.strictConfiguration&&(item.statePending||item.colorsPending))throw Object.assign(
        Error('Modo estrito: a construção parou com configurações pendentes. Os móveis confirmados não serão recolocados.'),{configurationOnly:true});
      return !item.statePending&&!item.colorsPending;
    }

    async retryPending(options={}){
      this.requireCapability('configuration');
      if(!this.pendingConfigurations.size)throw Error('Não há configurações pendentes neste quarto.');
      const delay=C.number(options.delay??(options.flash?100:180),options.flash?25:0,options.flash?2000:10000,true);
      return this.run('Tentar configurações pendentes',async signal=>{
        this.building=true;
        const items=[...this.pendingConfigurations.values()];
        try{
          this.update({total:items.length,done:0});
          for(let index=0;index<items.length;index++){
            await this.checkpoint(signal);
            if(items[index].statePending||items[index].colorsPending)await this.configureItem(items[index],signal,{...options,delay});
            this.update({done:index+1});
          }
          const status=this.configurationStatus();
          this.emit('notice',{type:status.pending.length?'warning':'success',text:status.pending.length?
            `Ajustes encerrados: ${status.report.statePending} estados e ${status.report.colorPending} cores ainda pendentes.`:
            'Todos os ajustes pendentes foram confirmados. Nenhum móvel foi recolocado.'});
          return status;
        }finally{this.building=false;}
      });
    }
  }.prototype);
  ctx.parts.add('configurations.js');
})();
