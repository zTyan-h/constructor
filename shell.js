// Constructor — entrada do Sang Hub.
(function () {
  'use strict';
  if (window._constructor?.current?.()) { window._constructor.show(); return; }

  const bridge = window._hubBridge;
  if (!bridge?.loadModule || bridge.socket?.version !== 1) {
    bridge?.ui?.toast?.('Recarregue a página para atualizar o transporte do Constructor.', 'error');
    console.error('[Constructor] Ponte de transporte incompatível. Recarregue o Sang Hub.');
    return;
  }
  const VERSION = '3.4.0';
  const files = ['protocol-habblive', 'protocol-habblet', 'hotels', 'furniture', 'core', 'shapes', 'runtime', 'storage', 'catalog', 'projects', 'configurations', 'tasks', 'input', 'libs', 'preview', 'typography', 'styles', 'view', 'ui'];
  const ctx = window._constructor = {
    version: VERSION, ac: new AbortController(), parts: new Set(), protocols: Object.create(null),
    modules: files.map(name => 'constructor-' + name),
    runtime: null, ui: null, stopped: false,
    current: () => !ctx.stopped && window._constructor === ctx && window._hubBridge === bridge,
    show: () => ctx.ui?.show(),
    hide: () => ctx.ui?.hide(),
    toggle: () => ctx.ui?.host.shadowRoot.querySelector('.shell').classList.contains('minimized') ? ctx.show() : ctx.hide(),
    extendRuntime(prototype) {
      for (const name of Object.getOwnPropertyNames(prototype)) {
        if (name !== 'constructor') Object.defineProperty(ctx.Runtime.prototype, name, Object.getOwnPropertyDescriptor(prototype, name));
      }
    },
    kill() {
      if (ctx.stopped) return;
      ctx.stopped = true;
      ctx.ac.abort();
      ctx.ui?.dispose();
      ctx.runtime?.dispose();
      ctx.disposeFonts?.();
      if (window._constructor === ctx) {
        delete window._constructor;
        window.dispatchEvent(new CustomEvent('sang:module-close', { detail: { id: 'constructorlive' } }));
      }
    }
  };
  function check() {
    if (!ctx.current()) throw new DOMException('Constructor encerrado', 'AbortError');
  }
  async function load(name) {
    check();
    const url = new URL('/load', bridge.HUB_UPDATE_URL || 'https://sh.hlivescript.workers.dev');
    url.searchParams.set('p', 'modules/constructor/' + name + '.js');
    url.searchParams.set('v', VERSION);
    let timer;
    try {
      await Promise.race([
        bridge.loadModule({ id: 'constructor-' + name, url: url.href }, { signal: ctx.ac.signal }),
        new Promise((_, reject) => { timer = setTimeout(() => {
          reject(new Error('Tempo esgotado ao carregar Constructor: ' + name));
          ctx.ac.abort();
        }, 20000); })
      ]);
      check();
      if (!ctx.parts.has(name + '.js')) throw new Error('Arquivo Constructor não inicializado: ' + name);
    } finally { clearTimeout(timer); }
  }
  ctx.ready = (async () => {
    try {
      for (const name of files) await load(name);
      check();
      ctx.runtime = new ctx.Runtime(window);
      await ctx.runtime.ready;
      check();
      if (!document.body) await new Promise((resolve, reject) => {
        const cleanup = () => {
          document.removeEventListener('DOMContentLoaded', ready);
          ctx.ac.signal.removeEventListener('abort', abort);
        };
        const ready = () => { cleanup(); resolve(); };
        const abort = () => { cleanup(); reject(new DOMException('Constructor encerrado', 'AbortError')); };
        document.addEventListener('DOMContentLoaded', ready, { once: true });
        ctx.ac.signal.addEventListener('abort', abort, { once: true });
      });
      check();
      void ctx.loadFonts();
      ctx.mount(ctx.runtime);
    } catch (error) {
      ctx.kill();
      if (error.name !== 'AbortError') {
        console.error('[Constructor] Não foi possível abrir o módulo:', error);
        bridge.ui?.toast?.('Constructor: ' + error.message, 'error');
      }
      throw error;
    }
  })();
  ctx.ready.catch(() => {});
})();
