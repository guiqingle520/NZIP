// Keep UI code independent of its desktop host.
if (window.chrome?.webview) {
  const pending = new Map(), handlers = new Map();
  let sequence = 0;
  window.chrome.webview.addEventListener('message', e => {
    const message = e.data;
    if (message.kind === 'reply') {
      const resolve = pending.get(message.id);
      if (resolve) { pending.delete(message.id); resolve(message.result); }
    } else if (message.kind === 'event') {
      for (const callback of handlers.get(message.name) || []) callback({ payload: message.payload });
    }
  });
  window.__NZIP_NATIVE__ = {
    core: { invoke: (_command, { action, args }) => new Promise(resolve => {
      const id = ++sequence; pending.set(id, resolve);
      window.chrome.webview.postMessage({ id, action, args });
    }) },
    event: { listen: (name, callback) => {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name).add(callback);
      return Promise.resolve(() => handlers.get(name).delete(callback));
    } }
  };
  document.addEventListener('drop', e => {
    e.preventDefault(); e.stopImmediatePropagation();
    document.querySelector('#drop-overlay').classList.remove('visible');
    const files = [...e.dataTransfer.files];
    if (files.length) window.chrome.webview.postMessageWithAdditionalObjects({ action: 'drop-files' }, files);
  });
}
if (window.__NZIP_NATIVE__) {
  const { core, event } = window.__NZIP_NATIVE__;
  const listeners = [];
  const call = (action, ...args) => core.invoke('dispatch', { action, args: args.map(a => a === undefined ? null : a) });
  window.nzip = {
    init: async () => { await Promise.all(listeners); return call('init'); },
    ready: () => call('ready'),
    window: action => call('window', action),
    choose: (kind, defaultPath) => call('choose', kind, defaultPath),
    list: (archive, password, codePage = 0) => call('list', archive, password, codePage),
    copyText: text => call('copy-text', text),
    describe: paths => call('describe', paths),
    startJob: (type, payload) => call('start-job', type, payload),
    quickExtract: (archive, password, codePage = 0) => call('extract-folder', archive, password, codePage),
    cancelJob: id => call('cancel-job', id),
    settings: settings => call('settings', settings),
    integration: enabled => call('integration', enabled),
    clearHistory: () => call('clear-history'),
    reveal: path => call('reveal', path),
    openResult: id => call('open-result', id),
    preview: payload => call('preview', payload),
    filePath: file => file.path || '',
    on: (name, callback) => { const listener = event.listen(name, e => callback(e.payload)); listeners.push(listener); return async () => (await listener)(); }
  };
  document.querySelector('.titlebar').addEventListener('mousedown', e => {
    if (e.button === 0 && !e.target.closest('.window-controls')) call('window', 'start-drag');
  });
  document.querySelector('.titlebar').addEventListener('dblclick', e => { if (!e.target.closest('.window-controls')) call('window', 'maximize'); });
}
