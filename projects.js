// Constructor — extraído da Oficina 1.5.1.
(function () {
  'use strict';
  const ctx = window._constructor;
  if (!ctx?.current()) return;
  const OficinaCore = ctx.Core;
  ctx.extendRuntime(class {
  projects(){return OficinaCore.normalizeProjects(this.storage('hl_module_rooms',{}));}
  catalog(){return OficinaCore.normalizeCatalog(this.storage('hl_module_shop_db',{}));}

  saveProjects(value){
    const valid=OficinaCore.normalizeProjects(value);
    const saved=this.persist('hl_module_rooms',valid);
    const finish=()=>{this.emit('projects',valid);return valid;};
    return saved?.then?saved.then(finish):finish();
  }

  saveProject(name,layout){
    name=String(name).trim();
    if(!name||name.length>120)throw Error('Dê um nome com até 120 caracteres ao projeto.');
    const all=this.projects();
    if(Object.hasOwn(all,name))throw Error('Esse nome já existe. Use outro nome para preservar o projeto anterior.');
    const valid=OficinaCore.normalizeProjects({[name]:{layout}});
    all[name]=valid[name];
    return this.saveProjects(all);
  }

  deleteProject(name){
    const all=this.projects();
    delete all[name];
    return this.saveProjects(all);
  }

  async capture(name){
    this.requireCapability('capture');
    return this.run('Salvar quarto',async signal=>{
      this.update({label:'Entre novamente no quarto para salvar',total:1});
      const {layout}=await this.wait('room',()=>true,signal,120000).promise;
      if(!layout.length)throw Error('Este quarto não tem móveis de chão para salvar.');
      await this.saveProject(name,layout);
      this.update({done:1});
      this.emit('notice',{type:'success',text:`Projeto “${name}” salvo com ${layout.length} móveis de chão.`});
      return layout;
    });
  }

  }.prototype);

  ctx.parts.add('projects.js');
})();
