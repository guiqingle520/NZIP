const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const api = window.nzip;
const state = { view: 'home', settings: {}, recent: [], jobs: [], archive: null, folder: '', selected: new Set(), search: '', sort: 'name', descending: false, password: '', downloads: '', files: [], opening: false, pendingExtract: null };
let previewToken = 0;
const icons = {
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  archive: '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M3 7h18V3H3zM10 11h4m-4 4h4m-2-4v7"/>',
  activity: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="m6 13 3-4 3 7 3-5h3"/>',
  settings: '<path d="m10 3-1 3-3 1-3 2 1 3-1 3 3 2 3 1 1 3h4l1-3 3-1 3-2-1-3 1-3-3-2-3-1-1-3z"/><circle cx="12" cy="12" r="3"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9S4 17 4 12V6z"/><path d="m8 12 3 3 5-6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/>',
  unlock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 7-2m-3 9v3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  folder: '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  folderOpen: '<path d="M3 17V5h7l2 3h8v3M2 11h20l-3 9H5z"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  back: '<path d="M19 12H5m5-5-5 5 5 5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  file: '<path d="M14 3H5v18h14V8zM14 3v5h5M8 13h8m-8 4h6"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="2"/><path d="m3 17 6-5 4 3 3-6 5 8"/>',
  code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-2-15-4 18"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  x: '<path d="m6 6 12 12M6 18 18 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>',
  refresh: '<path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
  moon: '<path d="M21 13A9 9 0 0 1 11 3a9 9 0 1 0 10 10z"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M12 17v4m-5 0h10"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  sort: '<path d="M7 4v16m-4-4 4 4 4-4M14 5h7m-7 5h5m-5 5h3"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8zm-10 9 10 5 10-5M2 16l10 5 10-5"/>',
  coffee: '<path d="M4 8h13v7a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zm13 0h2a3 3 0 0 1 0 6h-2M7 2v3m4-3v3m4-3v3"/>'
};
function icon(name, cls = '') { return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.file}</svg>`; }
function hydrate(root = document) { $$('[data-icon]', root).forEach(el => el.innerHTML = icon(el.dataset.icon)); }
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function size(n) { if (!Number.isFinite(n)) return '—'; if (n === 0) return '0 B'; const i = Math.min(3, Math.floor(Math.log(n) / Math.log(1024))); return `${(n / 1024 ** i).toLocaleString('zh-CN', { maximumFractionDigits: i ? 1 : 0 })} ${['B', 'KB', 'MB', 'GB'][i]}`; }
function date(n) { return new Date(n).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
function basename(p) { return p.split(/[\\/]/).pop(); }
function dirname(p) { return p.slice(0, Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'))); }
function join(p, n) { return `${p.replace(/[\\/]$/, '')}\\${n}`; }
function toast(message, error = false) {
  const el = document.createElement('div'); el.className = `toast ${error ? 'error' : ''}`;
  el.innerHTML = `${icon(error ? 'info' : 'checkCircle')}<span>${esc(message)}</span>`;
  $('#toast-region').append(el); setTimeout(() => el.remove(), 5000);
  while ($('#toast-region').children.length > 3) $('#toast-region').firstElementChild.remove();
}
function check(result) { if (!result?.ok) { toast(result?.error || '操作失败', true); return false; } return true; }
function applyTheme() { document.documentElement.dataset.theme = state.settings.theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : state.settings.theme; }
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
function navigate(view) { state.view = view; render(); }
function render() {
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === state.view));
  $('#archive-badge').textContent = state.archive ? '1' : '';
  const running = state.jobs.filter(j => ['running', 'queued', 'cancelling'].includes(j.status)).length;
  $('#task-badge').textContent = running || '';
  $('#status-text').textContent = running ? `${running} 个任务进行中` : state.archive ? `${state.archive.name} · ${state.archive.entries.filter(e => !e.isDirectory).length} 个文件` : '已就绪';
  $('#main').innerHTML = state.view === 'home' ? homeView() : state.view === 'archive' ? archiveView() : state.view === 'tasks' ? tasksView() : settingsView();
  bindView();
}
function pageHeader(eyebrow, title, subtitle, actions = '') {
  return `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${subtitle}</p></div><div class="heading-actions">${actions}</div></div>`;
}
function homeView() {
  return `${pageHeader('YOUR EVERYDAY ARCHIVER', '压缩，更轻松<span class="purple-dot">。</span>', '给文件减负，给效率加分。简单好用，就该如此。', '<span class="quiet-badge">'+icon('shield')+' 纯净无广告</span>')}
  <div class="quick-actions">
    <button class="action-card primary-card" id="open-archive"><div class="action-top"><span class="action-icon">${icon('folderOpen')}</span><span class="shortcut">Ctrl O</span></div><div><h2>打开压缩包</h2><p>浏览文件，轻松解压</p></div><span class="action-arrow">${icon('arrow')}</span></button>
    <button class="action-card" data-command="new"><div class="action-top"><span class="action-icon lavender">${icon('plus')}</span><span class="shortcut">Ctrl N</span></div><div><h2>新建压缩包</h2><p>把零散文件，打包成一份</p></div><span class="action-arrow">${icon('arrow')}</span></button>
    <button class="action-card" id="batch-extract"><div class="action-top"><span class="action-icon mint">${icon('layers')}</span><span class="tag">批量处理</span></div><div><h2>批量解压</h2><p>多个压缩包，一次搞定</p></div><span class="action-arrow">${icon('arrow')}</span></button>
  </div>
  <button class="drop-zone" id="drop-open"><div class="drop-art">${icon('download')}</div><div><h3>拖放文件到这里</h3><p>拖入压缩包直接打开，拖入文件或文件夹开始压缩</p></div><span class="drop-hint">或者点击选择 ${icon('chevron')}</span></button>
  <section class="recent-section"><div class="section-heading"><h2>最近打开 <span>${state.recent.length.toString().padStart(2, '0')}</span></h2>${state.recent.length ? '<button class="text-button" id="clear-history">清空记录</button>' : '<span class="muted small">你的常用文件，触手可及</span>'}</div>
  ${state.recent.length ? `<div class="recent-table"><div class="recent-head"><span>文件名称</span><span>大小</span><span>打开时间</span><span></span></div>${state.recent.slice(0, 5).map((r, i) => `<button class="recent-row" data-recent="${i}"><span class="file-cell"><span class="file-icon zip">${icon('archive')}</span><span><strong>${esc(r.name)}</strong><small title="${esc(r.path)}">${esc(dirname(r.path))}</small></span></span><span class="muted">${size(r.size)}</span><span class="muted">${date(r.openedAt)}</span><span>${icon('chevron')}</span></button>`).join('')}</div>` : `<div class="empty-recent"><div class="empty-icon">${icon('clock')}</div><h3>从第一个压缩包开始</h3><p>打开过的压缩包会出现在这里，方便下次继续。</p><button class="text-button" id="empty-open">选择一个压缩包 ${icon('arrow')}</button></div>`}</section>
  <div class="home-bottom"><div>${icon('spark')}<span>少一点繁杂，多一点专注。</span></div><span>ZIP · 7Z · RAR · TAR · ISO · 更多格式</span></div>`;
}
function fileType(entry) {
  if (entry.isDirectory) return ['folder', '文件夹', 'folder-color'];
  const ext = entry.name.split('.').pop().toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return ['image', `${ext.toUpperCase()} 图片`, 'image-color'];
  if (['js', 'ts', 'json', 'html', 'css', 'py', 'xml'].includes(ext)) return ['code', `${ext.toUpperCase()} 文件`, 'code-color'];
  return ['file', ext === entry.name ? '文件' : `${ext.toUpperCase()} 文件`, ''];
}
function visibleEntries() {
  if (!state.archive) return [];
  const map = new Map();
  for (const e of state.archive.entries) {
    if (state.search) { if (e.path.toLowerCase().includes(state.search.toLowerCase())) map.set(e.path, e); continue; }
    if (!e.path.startsWith(state.folder)) continue;
    const remaining = e.path.slice(state.folder.length).replace(/\/$/, '');
    if (!remaining) continue;
    const slash = remaining.indexOf('/');
    if (slash >= 0) {
      const name = remaining.slice(0, slash), p = state.folder + name;
      if (!map.has(p)) map.set(p, { path: p, name, isDirectory: true, size: 0, modified: '', virtual: true });
    } else map.set(e.path.replace(/\/$/, ''), e);
  }
  return [...map.values()].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    const cmp = state.sort === 'size' ? a.size - b.size : state.sort === 'modified' ? a.modified.localeCompare(b.modified) : a.name.localeCompare(b.name, 'zh-CN', { numeric: true });
    return cmp * (state.descending ? -1 : 1);
  });
}
function archiveView() {
  const a = state.archive;
  if (!a) return `${pageHeader('ARCHIVE EXPLORER', '压缩包', '打开一个压缩包，查看里面的每一份文件。')}<div class="large-empty">${icon('archive')}<h2>这里还没有打开的压缩包</h2><p>支持 ZIP、7Z、RAR、TAR、ISO 等常用格式</p><button class="button primary" id="open-archive">${icon('folderOpen')}打开压缩包</button></div>`;
  const files = visibleEntries();
  const ratio = a.totalSize ? Math.max(0, Math.round((1 - a.archiveSize / a.totalSize) * 100)) : 0;
  return `${pageHeader('ARCHIVE EXPLORER', esc(a.name), `<span title="${esc(a.path)}">${esc(a.path)}</span>`, '<button class="button" id="open-archive">'+icon('folderOpen')+'打开其他文件</button>')}
  <div class="archive-stats"><div><span class="stat-icon lavender">${icon('archive')}</span><span><small>压缩大小</small><strong>${size(a.archiveSize)}</strong></span></div><div><span class="stat-icon mint">${icon('file')}</span><span><small>原始大小</small><strong>${size(a.totalSize)}</strong></span></div><div><span class="stat-icon peach">${icon('layers')}</span><span><small>包含文件</small><strong>${a.entries.filter(e => !e.isDirectory).length} <em>个</em></strong></span></div><div><span class="stat-icon lavender">${icon(a.encrypted ? 'lock' : 'spark')}</span><span><small>${a.encrypted ? '加密保护' : '节省空间'}</small><strong>${a.encrypted ? '已加密' : `${ratio}%`}</strong></span></div></div>
  <div class="archive-toolbar"><div><button class="button primary" id="extract-all">${icon('download')}解压到…</button><button class="button" id="extract-selected" ${state.selected.size ? '' : 'disabled'}>${icon('download')}解压选中</button><button class="button" id="test-archive">${icon('shield')}测试</button><span class="toolbar-divider"></span><button class="icon-button" id="add-archive" title="添加文件" aria-label="添加文件">${icon('plus')}</button><button class="icon-button" id="delete-entries" title="删除选中文件" aria-label="删除选中文件" ${state.selected.size ? '' : 'disabled'}>${icon('trash')}</button><button class="icon-button" id="refresh-archive" title="刷新" aria-label="刷新">${icon('refresh')}</button></div><label class="search-box">${icon('search')}<input id="archive-search" placeholder="搜索压缩包内文件" value="${esc(state.search)}" aria-label="搜索压缩包内文件"></label></div>
  <div class="browser-panel"><div class="breadcrumbs"><button class="icon-button" id="folder-up" ${state.folder ? '' : 'disabled'} title="上一级">${icon('back')}</button><button data-folder="">${icon('archive')}${esc(a.name)}</button>${state.folder.split('/').filter(Boolean).map((part, i, all) => `${icon('chevron')}<button data-folder="${esc(all.slice(0, i + 1).join('/') + '/')}">${esc(part)}</button>`).join('')}<span class="browser-count">${files.length} 个项目${state.selected.size ? ` · 已选 ${state.selected.size} 项` : ''}</span></div>
  <div class="files-scroll"><table class="files-table"><thead><tr><th class="checkbox-cell"><input type="checkbox" id="select-all" aria-label="全选" ${files.length && files.every(e => state.selected.has(e.path)) ? 'checked' : ''}></th><th><button data-sort="name">名称${icon('sort')}</button></th><th>类型</th><th><button data-sort="size">大小${icon('sort')}</button></th><th><button data-sort="modified">修改时间${icon('sort')}</button></th><th></th></tr></thead><tbody>${files.map((e, i) => {
    const [typeIcon, type, cls] = fileType(e);
    return `<tr data-entry="${i}" class="${state.selected.has(e.path) ? 'selected' : ''}"><td class="checkbox-cell"><input type="checkbox" data-select="${i}" ${state.selected.has(e.path) ? 'checked' : ''} aria-label="选择 ${esc(e.name)}"></td><td class="file-name" title="${esc(e.path)}"><span class="file-icon ${cls}">${icon(typeIcon)}</span><span>${esc(state.search ? e.path : e.name)}</span>${e.encrypted ? icon('lock', 'tiny') : ''}</td><td class="muted">${type}</td><td class="numeric">${e.isDirectory ? '—' : size(e.size)}</td><td class="muted file-date">${esc(e.modified.slice(0, 16) || '—')}</td><td>${e.isDirectory ? icon('chevron') : `<button class="icon-button preview-button" data-preview="${i}" title="预览" aria-label="预览 ${esc(e.name)}">${icon('eye')}</button>`}</td></tr>`;
  }).join('')}</tbody></table>${!files.length ? '<div class="no-results">'+icon('search')+'<p>没有找到文件</p></div>' : ''}</div><div class="browser-footer"><span>${icon('info')}双击文件夹浏览，双击文件预览</span><span>${esc(a.type.toUpperCase())} 格式</span></div></div>`;
}
const statusLabels = { queued: '等待中', running: '进行中', cancelling: '正在取消', completed: '已完成', failed: '失败', cancelled: '已取消' };
const jobLabels = { create: '压缩', extract: '解压', test: '测试', modify: '修改', scan: '扫描' };
function tasksView() {
  const completed = state.jobs.filter(j => j.status === 'completed').length;
  const running = state.jobs.filter(j => ['queued', 'running', 'cancelling'].includes(j.status)).length;
  return `${pageHeader('TASK ACTIVITY', '每一步，都有记录', '查看本次运行的任务进度与处理结果。')}
  <div class="task-summary"><span>${icon('activity')}<strong>${running}</strong> 个进行中</span><span>${icon('checkCircle')}<strong>${completed}</strong> 个已完成</span><span>${icon('layers')}<strong>${state.jobs.length}</strong> 个任务</span></div>
  ${!state.jobs.length ? `<div class="large-empty">${icon('coffee')}<h2>一切就绪，随时开始</h2><p>压缩、解压和测试任务都会出现在这里。</p><button class="button primary" data-command="new">${icon('plus')}新建压缩包</button></div>` : `<div class="job-list">${state.jobs.map(j => `<article class="job-card"><div class="job-icon ${j.status}">${icon(j.type === 'extract' ? 'download' : j.type === 'test' ? 'shield' : 'archive')}</div><div class="job-content"><div class="job-title"><strong>${esc(j.label)}</strong><span class="job-status ${j.status}">${icon(j.status === 'completed' ? 'checkCircle' : j.status === 'failed' ? 'info' : 'clock')}${statusLabels[j.status]}</span></div><p>${jobLabels[j.type]} · ${date(j.createdAt)}${j.finishedAt ? ` · ${((j.finishedAt - (j.startedAt || j.createdAt)) / 1000).toFixed(1)} 秒` : ''}</p>${['running', 'cancelling'].includes(j.status) ? `<div class="progress-track"><div class="progress-fill ${j.percent ? '' : 'indeterminate'}" style="width:${j.percent || 25}%"></div></div><small class="muted">${j.percent ? `${j.percent}%` : '正在处理…'}</small>` : j.error ? `<p class="job-error">${esc(j.error)}</p>` : j.result ? `<p class="job-result">${esc(j.notice || j.result.message)}${j.result.path ? ` · ${esc(j.result.path)}` : ''}</p>` : ''}</div><div>${['queued', 'running'].includes(j.status) ? `<button class="button small-button" data-cancel="${j.id}">取消</button>` : j.result?.path ? `<button class="button small-button" data-result="${j.id}">${icon('folderOpen')}查看文件</button>${j.type === 'create' ? `<button class="button small-button" data-open-created="${j.id}">打开</button>` : ''}` : ''}</div></article>`).join('')}</div>`}`;
}
function settingRow(title, description, control) { return `<div class="setting-row"><div><h3>${title}</h3><p>${description}</p></div>${control}</div>`; }
function settingsView() {
  const s = state.settings;
  return `${pageHeader('MAKE IT YOURS', '顺手，才是好工具', '按照你的习惯，设置属于你的 NZIP。')}
  <section class="settings-card"><h2>${icon('sun')}外观</h2>${settingRow('主题', '选择让你感到舒适的界面', `<div class="theme-options">${[['light', 'sun', '浅色'], ['dark', 'moon', '深色'], ['system', 'monitor', '跟随系统']].map(([v, i, t]) => `<button class="theme-option ${s.theme === v ? 'chosen' : ''}" data-theme="${v}">${icon(i)}${t}</button>`).join('')}</div>`)}</section>
  <section class="settings-card"><h2>${icon('archive')}压缩与解压</h2>${settingRow('默认压缩格式', '新建压缩包时使用的格式', `<select id="default-format"><option value="zip" ${s.defaultFormat === 'zip' ? 'selected' : ''}>ZIP · 兼容性优先</option><option value="7z" ${s.defaultFormat === '7z' ? 'selected' : ''}>7Z · 压缩率优先</option><option value="tar" ${s.defaultFormat === 'tar' ? 'selected' : ''}>TAR · 仅打包</option></select>`)}${settingRow('默认压缩级别', '在处理速度与文件大小之间找到平衡', `<select id="default-level">${levelOptions(s.defaultLevel)}</select>`)}${settingRow('解压完成后打开文件夹', '直接查看处理好的文件', `<label class="toggle"><input type="checkbox" id="open-after" ${s.openAfterExtract ? 'checked' : ''} aria-label="解压完成后打开文件夹"><span></span></label>`)}</section>
  <section class="settings-card"><h2>${icon('monitor')}Windows 集成</h2>${settingRow('资源管理器右键菜单', state.canIntegrate ? '添加打开、压缩与解压菜单；Windows 11 位于“显示更多选项”' : '在打包后的应用中启用；仅对当前 Windows 用户生效', `<label class="toggle"><input type="checkbox" id="context-menu" ${s.contextMenu ? 'checked' : ''} ${state.canIntegrate ? '' : 'disabled'} aria-label="资源管理器右键菜单"><span></span></label>`)}</section>
  <section class="settings-card"><h2>${icon('shield')}隐私</h2>${settingRow('记录最近打开的压缩包', '仅在本机保存文件路径，不保存密码', `<label class="toggle"><input type="checkbox" id="remember-history" ${s.rememberHistory ? 'checked' : ''} aria-label="记录最近打开的压缩包"><span></span></label>`)}${settingRow('清空打开记录', '不会删除压缩包或本地文件', '<button class="button small-button" id="clear-history">清空记录</button>')}</section>
  <div class="about-card"><div class="brand-icon">N</div><div><h3>NZIP <span>${state.version || '0.4.0'} · Windows x64</span></h3><p>无广告，无需登录，无遥测。所有压缩与解压均在本地完成。</p><p class="muted small">${state.runtime === 'webview2' ? 'C# + 系统 WebView2 · ' : ''}压缩引擎：7-Zip 26.04 · LGPL 2.1+ / BSD / unRAR restriction</p></div><button class="text-button" id="about-license">开源许可 ${icon('chevron')}</button></div>`;
}
function levelOptions(value) { return [[0, '仅存储'], [1, '极速'], [3, '快速'], [5, '标准（推荐）'], [7, '高压缩率'], [9, '极限压缩']].map(([v, t]) => `<option value="${v}" ${Number(value) === v ? 'selected' : ''}>${t}</option>`).join(''); }
function bindView() {
  $('#empty-open')?.addEventListener('click', chooseOpen);
  $('#drop-open')?.addEventListener('click', chooseOpen);
  $('#batch-extract')?.addEventListener('click', batchDialog);
  $('#clear-history')?.addEventListener('click', async () => { if (check(await api.clearHistory())) toast('最近打开记录已清空'); });
  $$('[data-recent]').forEach(b => b.onclick = () => openArchive(state.recent[Number(b.dataset.recent)].path));
  $('#refresh-archive')?.addEventListener('click', () => openArchive(state.archive.path, state.password));
  $('#folder-up')?.addEventListener('click', () => { state.folder = state.folder.split('/').filter(Boolean).slice(0, -1).join('/'); if (state.folder) state.folder += '/'; state.selected.clear(); render(); });
  $$('[data-folder]').forEach(b => b.onclick = () => { state.folder = b.dataset.folder; state.search = ''; state.selected.clear(); render(); });
  $$('[data-sort]').forEach(b => b.onclick = () => { state.descending = state.sort === b.dataset.sort ? !state.descending : false; state.sort = b.dataset.sort; render(); });
  const search = $('#archive-search');
  if (search) search.oninput = () => { const pos = search.selectionStart; state.search = search.value; render(); $('#archive-search').focus(); $('#archive-search').setSelectionRange(pos, pos); };
  const entries = visibleEntries();
  const selectEntry = (i, value) => {
    const e = entries[i]; if (!e) return;
    const paths = e.virtual ? state.archive.entries.filter(x => x.path.startsWith(`${e.path}/`)).map(x => x.path) : [e.path];
    for (const p of paths) value ? state.selected.add(p) : state.selected.delete(p);
    // Virtual folders are navigation items; mark their path for rendering, then resolve actual entries at extraction.
    if (e.virtual) value ? state.selected.add(e.path) : state.selected.delete(e.path);
  };
  $$('[data-select]').forEach(c => c.onchange = () => { selectEntry(Number(c.dataset.select), c.checked); render(); });
  $('#select-all')?.addEventListener('change', e => { entries.forEach((_, i) => selectEntry(i, e.target.checked)); render(); });
  $$('[data-entry]').forEach(row => {
    row.ondblclick = e => { if (e.target.closest('button,input')) return; const entry = entries[Number(row.dataset.entry)]; if (entry.isDirectory) { state.folder = entry.path.replace(/\/$/, '') + '/'; state.search = ''; state.selected.clear(); render(); } else preview(entry); };
    row.onclick = e => { if (e.target.closest('input,button')) return; const entry = entries[Number(row.dataset.entry)]; if (!e.ctrlKey && !e.metaKey) state.selected.clear(); selectEntry(Number(row.dataset.entry), !state.selected.has(entry.path)); render(); };
  });
  $$('[data-preview]').forEach(b => b.onclick = () => preview(entries[Number(b.dataset.preview)]));
  $$('[data-cancel]').forEach(b => b.onclick = () => api.cancelJob(b.dataset.cancel));
  $$('[data-result]').forEach(b => b.onclick = async () => check(await api.openResult(b.dataset.result)));
  $$('[data-open-created]').forEach(b => b.onclick = () => openArchive(state.jobs.find(j => j.id === b.dataset.openCreated).result.path));
  $$('.theme-option[data-theme]').forEach(b => b.onclick = () => updateSettings({ theme: b.dataset.theme }));
  $('#default-format')?.addEventListener('change', e => updateSettings({ defaultFormat: e.target.value }));
  $('#default-level')?.addEventListener('change', e => updateSettings({ defaultLevel: Number(e.target.value) }));
  $('#open-after')?.addEventListener('change', e => updateSettings({ openAfterExtract: e.target.checked }));
  $('#remember-history')?.addEventListener('change', e => updateSettings({ rememberHistory: e.target.checked }));
  $('#context-menu')?.addEventListener('change', async e => { const input = e.target; input.disabled = true; const r = await api.integration(input.checked); if (check(r)) { state.settings = r.settings; toast(input.checked ? '右键菜单已启用' : '右键菜单已移除'); } render(); });
  $('#about-license')?.addEventListener('click', licenseDialog);
}
async function updateSettings(settings) { const r = await api.settings(settings); if (check(r)) { state.settings = r.settings; applyTheme(); render(); } }
async function chooseOpen() { const r = await api.choose('archives'); if (check(r) && r.paths.length) openArchive(r.paths[0]); }
async function openArchive(p, password = '', codePage = null) {
  if (state.opening) return toast('正在打开压缩包，请稍候');
  state.opening = true; $('#status-text').textContent = '正在读取压缩包…';
  codePage = codePage ?? (p === state.archive?.path ? desktop.codePage : 0);
  let r; try { r = await api.list(p, password, codePage); } finally { state.opening = false; }
  if (r.code === 'PASSWORD_REQUIRED') { passwordDialog(p); return; }
  if (!check(r)) { render(); return; }
  if (r.data.encrypted && !password) { passwordDialog(p); return; }
  if (p !== state.archive?.path) desktop.expanded = new Set(['']);
  desktop.codePage = codePage; desktop.anchor = -1;
  state.archive = r.data; state.folder = ''; state.selected.clear(); state.search = ''; state.password = password; navigate('archive');
  if (state.pendingExtract === p) { state.pendingExtract = null; extractDialog(); }
  if (state.pendingQuickExtract === p) { state.pendingQuickExtract = null; if (check(await api.quickExtract(p, password, desktop.codePage))) navigate('tasks'); }
}
function showDialog(title, subtitle, content, footer, cls = '') {
  const modal = $('#modal'); if (modal.open) modal.close(); modal.className = cls;
  modal.innerHTML = `<div class="modal-heading"><div><h2>${title}</h2><p>${subtitle}</p></div><button class="icon-button" id="close-modal" aria-label="关闭对话框">${icon('x')}</button></div>${content}<div class="modal-footer">${footer}</div>`;
  $('#close-modal').onclick = () => modal.close(); modal.showModal(); return modal;
}
function passwordDialog(p) {
  showDialog('输入压缩包密码', esc(basename(p)), `<form id="password-form" class="modal-body"><label class="field-label" for="archive-password">密码</label><input id="archive-password" type="password" class="full-input" autocomplete="off" autofocus><p class="field-hint">密码仅用于本次打开，不会保存。</p></form>`, '<button class="button" id="password-cancel">取消</button><button class="button primary" type="submit" form="password-form">解锁并打开</button>', 'compact-modal');
  $('#password-cancel').onclick = () => $('#modal').close();
  $('#password-form').onsubmit = e => { e.preventDefault(); const password = $('#archive-password').value; $('#modal').close(); openArchive(p, password); };
}
async function createDialog(initial = []) {
  state.files = [];
  showDialog('新建压缩包', '把需要的文件，打包在一起。', `<form id="create-form" class="modal-body"><div class="field-heading"><label class="field-label">待压缩文件</label><div><button type="button" class="text-button" id="pick-files">${icon('plus')}添加文件</button><button type="button" class="text-button" id="pick-folders">${icon('folder')}添加文件夹</button></div></div><div id="source-list" class="source-list"></div><div class="form-grid"><label class="form-field">压缩格式<select id="create-format"><option value="zip">ZIP · 通用兼容</option><option value="7z">7Z · 更高压缩率</option><option value="tar">TAR · 仅打包</option></select></label><label class="form-field">压缩级别<select id="create-level">${levelOptions(state.settings.defaultLevel)}</select></label></div><label class="field-label" for="create-output">保存位置</label><div class="input-with-button"><input id="create-output" class="full-input" required placeholder="选择压缩包的保存位置"><button type="button" class="button" id="pick-output">浏览…</button></div><div class="form-grid"><label class="form-field">密码 <span class="optional">可选</span><div class="password-input"><input type="password" id="create-password" placeholder="留空则不加密" autocomplete="new-password"><button type="button" class="icon-button" id="toggle-password" title="显示密码">${icon('eye')}</button></div></label><label class="form-field">分卷大小<select id="create-volume"><option value="">不分卷</option><option value="10m">10 MB</option><option value="100m">100 MB</option><option value="500m">500 MB</option><option value="1024m">1 GB</option><option value="4096m">4 GB</option></select></label></div><label class="checkbox-label" id="header-option"><input type="checkbox" id="encrypt-headers" checked>同时加密文件名（7Z）</label><div class="form-note">${icon('shield')}加密使用 AES-256。请妥善保管密码。</div><p id="create-error" class="inline-error" role="alert"></p></form>`, '<span id="source-summary" class="muted small">尚未添加文件</span><div><button class="button" id="create-cancel">取消</button><button class="button primary" form="create-form" type="submit">'+icon('archive')+'开始压缩</button></div>');
  $('#create-format').value = state.settings.defaultFormat || 'zip';
  const add = async paths => { const r = await api.describe(paths); if (check(r)) { state.files = [...new Map([...state.files, ...r.files].map(f => [f.path, f])).values()]; updateSources(); } };
  $('#pick-files').onclick = async () => { const r = await api.choose('files'); if (check(r)) await add(r.paths); };
  $('#pick-folders').onclick = async () => { const r = await api.choose('folder'); if (check(r)) await add(r.paths); };
  $('#pick-output').onclick = async () => { const r = await api.choose('output', $('#create-output').value || join(state.downloads, `新建压缩包.${$('#create-format').value}`)); if (check(r) && r.paths.length) $('#create-output').value = r.paths[0]; };
  $('#create-cancel').onclick = () => $('#modal').close();
  $('#toggle-password').onclick = () => { const input = $('#create-password'); input.type = input.type === 'password' ? 'text' : 'password'; };
  const formatChange = () => {
    const format = $('#create-format').value;
    $('#create-password').disabled = format === 'tar'; if (format === 'tar') $('#create-password').value = '';
    $('#create-level').disabled = format === 'tar'; $('#header-option').hidden = format !== '7z';
    if ($('#create-output').value) $('#create-output').value = $('#create-output').value.replace(/\.(zip|7z|tar)$/i, `.${format}`);
  };
  $('#create-format').onchange = formatChange; formatChange(); updateSources();
  if (initial.length) await add(initial);
  $('#create-form').onsubmit = async e => {
    e.preventDefault(); const error = $('#create-error'); error.textContent = '';
    if (!state.files.length) { error.textContent = '请至少添加一个文件或文件夹'; return; }
    const format = $('#create-format').value;
    if (format === 'zip' && /[^\x20-\x7e]/.test($('#create-password').value)) { error.textContent = 'ZIP 密码请使用英文字母、数字或符号；中文密码请选择 7Z 格式'; return; }
    let destination = $('#create-output').value.trim();
    if (!destination.toLowerCase().endsWith(`.${format}`)) destination += `.${format}`;
    const r = await api.startJob('create', { sources: state.files.map(f => f.path), destination, format, level: Number($('#create-level').value), password: $('#create-password').value, volume: $('#create-volume').value, encryptHeaders: $('#encrypt-headers').checked });
    if (check(r)) { $('#modal').close(); navigate('tasks'); }
  };
  function updateSources() {
    $('#source-list').innerHTML = state.files.length ? state.files.map((f, i) => `<div class="source-row"><span class="file-icon ${f.isDirectory ? 'folder-color' : ''}">${icon(f.isDirectory ? 'folder' : 'file')}</span><span title="${esc(f.path)}">${esc(f.name)}<small>${f.isDirectory ? '文件夹' : size(f.size)}</small></span><button type="button" class="icon-button" data-remove-source="${i}" aria-label="移除 ${esc(f.name)}">${icon('x')}</button></div>`).join('') : `<button type="button" id="source-empty">${icon('plus')}点击添加文件或文件夹</button>`;
    $$('[data-remove-source]').forEach(b => b.onclick = () => { state.files.splice(Number(b.dataset.removeSource), 1); updateSources(); });
    $('#source-empty')?.addEventListener('click', () => $('#pick-files').click());
    $('#source-summary').textContent = state.files.length ? `${state.files.length} 个项目已添加` : '尚未添加文件';
    if (state.files.length && !$('#create-output').value) $('#create-output').value = join(dirname(state.files[0].path), `${state.files[0].name.replace(/\.[^.]+$/, '')}.${$('#create-format').value}`);
  }
}
function selectedPaths(selected) { const valid = new Set(state.archive.entries.map(e => e.path)); return selected.filter(s => valid.has(s)); }
function extractDialog(selected = []) {
  const a = state.archive; if (!a) return;
  const root = a.name.replace(/\.(zip|7z|rar|tar|gz|bz2|xz|iso|cab|wim|tgz)(\.\d+)?$/i, '');
  showDialog(selected.length ? '解压选中文件' : '解压压缩包', esc(a.name), `<form id="extract-form" class="modal-body"><label class="field-label" for="extract-output">目标文件夹</label><div class="input-with-button"><input id="extract-output" class="full-input" value="${esc(join(dirname(a.path), root))}" required><button class="button" type="button" id="pick-extract">浏览…</button></div><p class="field-hint">将创建此文件夹。若文件夹已存在，请更换名称。</p><label class="field-label" for="extract-password">密码 <span class="optional">可选</span></label><input id="extract-password" type="password" class="full-input" autocomplete="off" value="${esc(state.password)}" placeholder="加密压缩包需要输入密码"><div class="form-note">${icon('shield')}保留文件夹结构，解压完成后再显示结果。</div><div class="extract-count">${icon('file')}${selected.length ? `已选 ${selectedPaths(selected).length} 个项目` : `共 ${a.entries.filter(e => !e.isDirectory).length} 个文件`}<span>${selected.length ? '' : size(a.totalSize)}</span></div></form>`, '<button class="button" id="extract-cancel">取消</button><button class="button primary" form="extract-form" type="submit">'+icon('download')+'开始解压</button>', 'compact-modal');
  $('#pick-extract').onclick = async () => { const r = await api.choose('destination', dirname(a.path)); if (check(r) && r.paths.length) $('#extract-output').value = join(r.paths[0], root); };
  $('#extract-cancel').onclick = () => $('#modal').close();
  $('#extract-form').onsubmit = async e => { e.preventDefault(); const r = await api.startJob('extract', { archive: a.path, destination: $('#extract-output').value.trim(), password: $('#extract-password').value, codePage: desktop.codePage, selected: selectedPaths(selected) }); if (check(r)) { $('#modal').close(); navigate('tasks'); } };
}
async function batchDialog() {
  const r = await api.choose('archives'); if (!check(r) || !r.paths.length) return;
  const paths = r.paths;
  showDialog('批量解压', `${paths.length} 个压缩包，逐个有序处理。`, `<form id="batch-form" class="modal-body"><div class="batch-sources">${paths.map(p => `<div>${icon('archive')}${esc(basename(p))}</div>`).join('')}</div><label class="field-label" for="batch-output">解压到</label><div class="input-with-button"><input id="batch-output" class="full-input" required value="${esc(dirname(paths[0]))}"><button class="button" type="button" id="pick-batch">浏览…</button></div><p class="field-hint">每个压缩包使用独立的新文件夹；同名文件夹不会被覆盖。</p><label class="field-label" for="batch-password">共用密码 <span class="optional">可选</span></label><input id="batch-password" class="full-input" type="password" autocomplete="off" placeholder="所有加密包使用同一密码"></form>`, '<button class="button" id="batch-cancel">取消</button><button class="button primary" type="submit" form="batch-form">'+icon('download')+'开始批量解压</button>', 'compact-modal');
  $('#pick-batch').onclick = async () => { const r = await api.choose('destination'); if (check(r) && r.paths.length) $('#batch-output').value = r.paths[0]; };
  $('#batch-cancel').onclick = () => $('#modal').close();
  $('#batch-form').onsubmit = async e => {
    e.preventDefault(); const destination = $('#batch-output').value.trim(), password = $('#batch-password').value;
    for (const archive of paths) { const name = basename(archive).replace(/\.(zip|7z|rar|tar|gz|bz2|xz|iso|cab|wim|tgz)(\.\d+)?$/i, ''); check(await api.startJob('extract', { archive, destination: join(destination, name), password })); }
    $('#modal').close(); navigate('tasks');
  };
}
async function deleteEntries() {
  if (!state.selected.size) return;
  const selected = selectedPaths([...state.selected]);
  showDialog('从压缩包中删除文件', `将删除 ${selected.length} 个所选项目，修改成功后无法撤销。`, `<div class="modal-body"><p class="field-hint">NZIP 会先生成并验证新的压缩包，再替换原包。本地源文件不会被删除。</p></div>`, '<button class="button" id="delete-cancel">取消</button><button class="button danger" id="delete-confirm">删除所选项目</button>', 'compact-modal');
  $('#delete-cancel').onclick = () => $('#modal').close();
  $('#delete-confirm').onclick = async () => { const r = await api.startJob('modify', { archive: state.archive.path, action: 'delete', selected, password: state.password, codePage: desktop.codePage }); if (check(r)) { $('#modal').close(); navigate('tasks'); } };
}
async function addFilesToArchive() {
  if (!state.archive) return;
  if (state.archive.encrypted) return toast('加密压缩包请解压后重新创建，以确保加密设置一致', true);
  if (!['zip', '7z'].includes(state.archive.type.toLowerCase())) return toast('仅支持向 ZIP 和 7Z 压缩包添加文件', true);
  const r = await api.choose('files'); if (!check(r) || !r.paths.length) return;
  if (check(await api.startJob('modify', { archive: state.archive.path, action: 'add', sources: r.paths, folder: state.folder, codePage: desktop.codePage }))) navigate('tasks');
}
async function preview(entry) {
  const token = ++previewToken;
  showDialog(esc(entry.name), `${size(entry.size)} · 文件预览`, '<div class="modal-body preview-body"><div class="preview-loading">正在读取文件…</div></div>', '<span class="muted small">安全预览 · 不执行文件内容</span><button class="button" id="preview-close">关闭</button>', 'preview-modal');
  $('#preview-close').onclick = () => $('#modal').close();
  const r = await api.preview({ archive: state.archive.path, entry, password: state.password, codePage: desktop.codePage });
  if (token !== previewToken || !$('#modal').open || !$('.preview-body')) return;
  $('.preview-body').innerHTML = !r.ok ? `<div class="no-results">${icon('info')}<p>${esc(r.error)}</p></div>` : r.kind === 'image' ? `<img class="preview-image" alt="${esc(entry.name)}" src="${r.content}">` : `<pre class="text-preview">${esc(r.content)}</pre>${r.truncated ? '<p class="field-hint">内容较长，仅显示前 200,000 个字符。</p>' : ''}`;
}
function licenseDialog() {
  showDialog('关于 NZIP', `${state.version || '0.4.0'} · 纯粹的本地压缩工具`, '<div class="modal-body license-body"><h3>NZIP</h3><p>应用源代码采用 MIT 许可。</p><h3>7-Zip 26.04</h3><p>Copyright © 1999–2026 Igor Pavlov。以独立进程调用未经修改的 7-Zip。</p><p>主要采用 GNU LGPL 2.1 或更高版本，部分代码采用 BSD 许可和 unRAR 限制。完整许可位于应用 7zip 目录中。</p><p>源码与引擎下载：www.7-zip.org/download.html</p><h3>Microsoft WebView2</h3><p>使用系统共享的 WebView2 Runtime，不随应用捆绑浏览器内核。SDK 许可位于 LICENSE.webview2.txt。</p></div>', '<button class="button primary" id="license-close">知道了</button>', 'compact-modal');
  $('#license-close').onclick = () => $('#modal').close();
}
$$('[data-view]').forEach(b => b.onclick = () => navigate(b.dataset.view));
$$('[data-window]').forEach(b => b.onclick = () => api.window(b.dataset.window));
hydrate();
document.addEventListener('keydown', e => {
  if ($('#modal').open) return;
  if (e.ctrlKey || e.metaKey) {
    if (e.key.toLowerCase() === 'o') { e.preventDefault(); chooseOpen(); }
    if (e.key.toLowerCase() === 'n') { e.preventDefault(); createDialog(); }
    if (e.key.toLowerCase() === 'f' && state.view === 'archive') { e.preventDefault(); void command('search'); }
  }
  if (e.key === 'F5' && state.archive) { e.preventDefault(); openArchive(state.archive.path, state.password, desktop.codePage); }
  if (e.key === 'Delete' && state.view === 'archive' && !e.target.matches('input,textarea')) void command('delete');
});
let dragDepth = 0;
document.addEventListener('dragenter', e => { e.preventDefault(); if (e.dataTransfer.types.includes('Files')) { dragDepth++; $('#drop-overlay').classList.add('visible'); } });
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('dragleave', e => { e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; $('#drop-overlay').classList.remove('visible'); } });
document.addEventListener('drop', async e => {
  e.preventDefault(); dragDepth = 0; $('#drop-overlay').classList.remove('visible');
  const paths = [...e.dataTransfer.files].map(f => api.filePath(f)).filter(Boolean);
  await handleDroppedPaths(paths);
});
async function handleDroppedPaths(paths) {
  if (!paths.length) return;
  if (paths.length === 1 && /\.(zip|7z|rar|tar|gz|bz2|xz|iso|cab|wim|tgz|001)$/i.test(paths[0])) { $('#modal').close(); await openArchive(paths[0]); }
  else await createDialog(paths);
}
api.on('state', data => { state.settings = data.settings; state.recent = data.recent; applyTheme(); if (state.view === 'home') render(); });
api.on('jobs', data => {
  const old = new Map(state.jobs.map(j => [j.id, j.status])); state.jobs = data;
  for (const j of data) if (old.has(j.id) && old.get(j.id) !== j.status) {
    if (j.status === 'completed') {
      toast(`${jobLabels[j.type]}完成：${j.label}`);
      if (j.type === 'modify' && state.archive?.path === j.result.path) void api.list(state.archive.path, state.password, desktop.codePage).then(r => { if (r.ok) { state.archive = r.data; state.selected.clear(); if (state.folder && !r.data.entries.some(e => e.path.startsWith(state.folder))) state.folder = ''; if (state.view === 'archive') render(); } });
    }
    if (j.status === 'failed') toast(j.error, true);
  }
  if (state.view === 'tasks') render();
  else { $('#task-badge').textContent = data.filter(j => ['running', 'queued', 'cancelling'].includes(j.status)).length || ''; }
  const activeCount = data.filter(j => ['running', 'queued', 'cancelling'].includes(j.status)).length;
  $('#status-text').textContent = activeCount ? `${activeCount} 个任务进行中` : state.archive ? `${state.archive.name} · ${state.archive.entries.filter(e => !e.isDirectory).length} 个文件` : '已就绪';
});
api.on('open-archive', p => openArchive(p));
api.on('launch-request', async request => {
  $('#modal').close();
  if (request.type === 'compress') await createDialog([request.path]);
  else { state.pendingExtract = request.type === 'extract' ? request.path : null; state.pendingQuickExtract = request.type === 'extract-folder' ? request.path : null; await openArchive(request.path); }
});
api.init().then(async r => { if (check(r)) { Object.assign(state, { settings: r.settings, recent: r.recent, jobs: r.jobs, downloads: r.downloads, canIntegrate: r.canIntegrate, version: r.version, runtime: r.runtime }); $('.version').textContent = `v${r.version}`; applyTheme(); render(); await api.ready?.(); window.__NZIP_READY__ = true; } });
