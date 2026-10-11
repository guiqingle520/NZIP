const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { createEngine } = require('./engine');
const { setContextMenus, launchRequest } = require('./integration');

let window, engine, store, storePath, previewRoot;
let active = null;
let writes = Promise.resolve();
if (process.env.NZIP_USER_DATA) app.setPath('userData', process.env.NZIP_USER_DATA);
const queue = [], jobs = [];
const defaults = { theme: 'light', openAfterExtract: true, defaultFormat: 'zip', defaultLevel: 5, rememberHistory: true, contextMenu: false };
const send = (name, data) => { if (window && !window.isDestroyed()) window.webContents.send(name, data); };
const fail = e => ({ ok: false, error: e.message || '操作失败', code: e.code || 'ERROR' });
async function persist() {
  const content = JSON.stringify(store, null, 2);
  writes = writes.catch(() => {}).then(async () => {
    const temp = `${storePath}.tmp`;
    await fs.mkdir(path.dirname(storePath), { recursive: true });
    await fs.writeFile(temp, content, 'utf8');
    await fs.rename(temp, storePath);
  });
  await writes;
}
async function remember(data) {
  if (!store.settings.rememberHistory) return;
  store.recent = [{ path: data.path, name: data.name || path.basename(data.path), size: data.archiveSize, type: data.type, openedAt: Date.now() },
    ...store.recent.filter(r => r.path !== data.path)].slice(0, 30);
  await persist(); send('state', { settings: store.settings, recent: store.recent });
}
function enqueue(type, label, payload) {
  const job = { id: crypto.randomUUID(), type, label, status: 'queued', percent: 0, createdAt: Date.now() };
  jobs.unshift(job); if (jobs.length > 100) jobs.pop();
  queue.push({ job, payload }); send('jobs', jobs); void drain();
  return { ok: true, id: job.id };
}
async function drain() {
  if (active || !queue.length) return;
  const { job, payload } = queue.shift();
  const controller = new AbortController();
  active = { job, controller };
  job.status = 'running'; job.startedAt = Date.now(); send('jobs', jobs);
  const options = { signal: controller.signal, onProgress: p => { job.percent = p.percent; send('jobs', jobs); } };
  try {
    let result;
    if (job.type === 'create') result = await engine.create(payload, options);
    else if (job.type === 'extract') result = await engine.extract(payload, options);
    else if (job.type === 'modify') result = await engine.modify(payload, options);
    else result = await engine.test(payload.archive, { ...options, password: payload.password });
    job.status = 'completed'; job.percent = 100; job.result = result;
    if (job.type === 'create') {
      try { await remember(await engine.list(result.path, { password: payload.password })); } catch { /* Multi-volume files can be opened manually. */ }
    }
    if (job.type === 'extract' && store.settings.openAfterExtract) {
      const error = await shell.openPath(result.path);
      if (error) job.notice = '解压成功，但无法自动打开文件夹';
    }
  } catch (e) {
    job.status = e.code === 'CANCELLED' ? 'cancelled' : 'failed'; job.error = e.message; job.code = e.code;
  } finally {
    job.finishedAt = Date.now(); active = null; send('jobs', jobs); void drain();
  }
}
function setupIPC() {
  function handle(name, fn) {
    ipcMain.handle(name, async (event, ...args) => {
      if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame) return fail(new Error('不允许的请求'));
      try { return await fn(...args); } catch (e) { return fail(e); }
    });
  }
  handle('init', () => ({ ok: true, settings: store.settings, recent: store.recent, jobs, version: app.getVersion(), downloads: app.getPath('downloads'), canIntegrate: app.isPackaged }));
  handle('integration', async enabled => {
    if (!app.isPackaged) throw new Error('请在打包后的 NZIP 中启用右键菜单');
    await setContextMenus(process.env.PORTABLE_EXECUTABLE_FILE || process.execPath, Boolean(enabled));
    store.settings.contextMenu = Boolean(enabled); await persist();
    return { ok: true, settings: store.settings };
  });
  handle('window', action => {
    if (action === 'minimize') window.minimize();
    if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize();
    if (action === 'close') window.close();
  });
  handle('choose', async (kind, defaultPath) => {
    if (kind === 'output') {
      const r = await dialog.showSaveDialog(window, { title: '保存压缩包', defaultPath, filters: [{ name: '压缩文件', extensions: ['zip', '7z', 'tar'] }] });
      return { ok: true, paths: r.canceled ? [] : [r.filePath] };
    }
    const folder = kind === 'folder' || kind === 'destination';
    const r = await dialog.showOpenDialog(window, {
      title: folder ? '选择文件夹' : kind === 'archives' ? '打开压缩包' : '添加文件',
      defaultPath,
      properties: folder ? ['openDirectory', ...(kind === 'folder' ? ['multiSelections'] : [])] : ['openFile', 'multiSelections'],
      filters: kind === 'archives' ? [{ name: '压缩文件', extensions: ['zip', '7z', 'rar', 'tar', 'gz', 'bz2', 'xz', 'iso', 'cab', 'wim', 'tgz', '001'] }, { name: '所有文件', extensions: ['*'] }] : undefined
    });
    return { ok: true, paths: r.filePaths };
  });
  handle('list', async (archive, password) => {
    const data = await engine.list(archive, { password }); await remember(data);
    return { ok: true, data };
  });
  handle('describe', async paths => ({ ok: true, files: await Promise.all(paths.map(async p => {
    const stat = await fs.lstat(p); return { path: p, name: path.basename(p), size: stat.size, isDirectory: stat.isDirectory() };
  })) }));
  handle('start-job', (type, payload) => {
    if (!['create', 'extract', 'test', 'modify'].includes(type)) throw new Error('无效操作');
    return enqueue(type, type === 'create' ? path.basename(payload.destination) : path.basename(payload.archive), payload);
  });
  handle('cancel-job', id => {
    if (active?.job.id === id) { active.job.status = 'cancelling'; active.controller.abort(); }
    else {
      const i = queue.findIndex(x => x.job.id === id);
      if (i >= 0) { queue[i].job.status = 'cancelled'; queue[i].job.finishedAt = Date.now(); queue.splice(i, 1); }
    }
    send('jobs', jobs); return { ok: true };
  });
  handle('settings', async settings => {
    if (settings.theme && ['light', 'dark', 'system'].includes(settings.theme)) store.settings.theme = settings.theme;
    for (const key of ['openAfterExtract', 'rememberHistory']) if (typeof settings[key] === 'boolean') store.settings[key] = settings[key];
    if (['zip', '7z', 'tar'].includes(settings.defaultFormat)) store.settings.defaultFormat = settings.defaultFormat;
    if ([0, 1, 3, 5, 7, 9].includes(Number(settings.defaultLevel))) store.settings.defaultLevel = Number(settings.defaultLevel);
    if (!store.settings.rememberHistory) store.recent = [];
    await persist(); send('state', store); return { ok: true, settings: store.settings };
  });
  handle('clear-history', async () => { store.recent = []; await persist(); send('state', store); return { ok: true }; });
  handle('reveal', async p => { shell.showItemInFolder(p); return { ok: true }; });
  handle('open-result', async id => {
    const job = jobs.find(j => j.id === id);
    if (!job?.result?.path) throw new Error('结果不可用');
    if (job.type === 'extract') { const error = await shell.openPath(job.result.path); if (error) throw new Error(error); }
    else shell.showItemInFolder(job.result.path);
    return { ok: true };
  });
  handle('preview', async ({ archive, entry, password }) => {
    const allowedText = ['.txt', '.md', '.json', '.csv', '.log', '.xml', '.yaml', '.yml', '.ini', '.css', '.js', '.ts', '.html'];
    const images = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp' };
    const ext = path.extname(entry.path).toLowerCase();
    if (!images[ext] && !allowedText.includes(ext)) throw new Error('此类型暂不支持预览，请解压后打开');
    const data = await engine.list(archive, { password });
    const actual = data.entries.find(e => e.path === entry.path);
    if (!actual || actual.isDirectory || actual.size > 10 * 1024 * 1024) throw new Error('仅支持预览 10 MB 以内的文本或图片');
    const destination = path.join(previewRoot, crypto.randomUUID());
    try {
      await engine.extract({ archive, destination, password, selected: [entry.path] });
      const buffer = await fs.readFile(path.join(destination, ...entry.path.split('/')));
      return { ok: true, kind: images[ext] ? 'image' : 'text', content: images[ext] ? `data:${images[ext]};base64,${buffer.toString('base64')}` : buffer.toString('utf8').slice(0, 200000), truncated: !images[ext] && buffer.length > 200000 };
    } finally { await fs.rm(destination, { recursive: true, force: true }); }
  });
}
function createWindow() {
  window = new BrowserWindow({ width: 1240, height: 820, minWidth: 940, minHeight: 640, frame: false, backgroundColor: '#f7f8fa',
    icon: path.join(__dirname, 'ui', 'icon.png'), show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true }
  });
  window.loadFile(path.join(__dirname, 'ui', 'index.html'));
  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.on('close', event => {
    if (active || queue.length) {
      const response = dialog.showMessageBoxSync(window, { type: 'question', buttons: ['继续任务', '取消任务并退出'], defaultId: 0, cancelId: 0, title: '任务正在进行', message: '还有压缩或解压任务未完成。', detail: '退出会取消任务，并清理临时文件。' });
      event.preventDefault();
      if (response === 1) {
        queue.splice(0); active?.controller.abort();
        const timer = setInterval(() => { if (!active) { clearInterval(timer); app.quit(); } }, 100);
      }
    }
  });
  const initial = launchRequest(process.argv);
  window.webContents.once('did-finish-load', () => { if (initial) send('launch-request', initial); });
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_event, argv) => {
    if (window?.isMinimized()) window.restore(); window?.focus();
    const request = launchRequest(argv);
    if (request) send('launch-request', request);
  });
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    storePath = path.join(app.getPath('userData'), 'preferences.json');
    try { store = JSON.parse(await fs.readFile(storePath, 'utf8')); } catch { store = {}; }
    store.settings = { ...defaults, ...store.settings }; store.recent = Array.isArray(store.recent) ? store.recent : [];
    previewRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nzip-preview-'));
    engine = createEngine(process.env.NZIP_7Z_PATH || path.join(app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', 'vendor'), '7zip', '7z.exe'));
    setupIPC(); createWindow();
  }).catch(e => { dialog.showErrorBox('NZIP 启动失败', e.message); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => { if (previewRoot) require('node:fs').rmSync(previewRoot, { recursive: true, force: true }); });
}
