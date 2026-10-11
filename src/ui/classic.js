// Desktop archive browser: shared commands keep menus and toolbar in sync.
icons.globe = '<circle cx="12" cy="12" r="10"/><ellipse cx="12" cy="12" rx="4" ry="10"/><path d="M2 12h20M4 6h16M4 18h16"/>';
const documentOutline = '<path d="M5 2h9l5 5v15H5zM14 2v5h5"/>';
icons.openDocument = documentOutline + '<path d="M2 15h12m-4-4 4 4-4 4"/>';
icons.extractDocument = documentOutline + '<path d="M11 3h3m-5 2h3m-1 2h3m-5 2h3m-1 2h3m-5 2h3m-1 2h3m-4 2h3v3h-3z"/>';
icons.newDocument = documentOutline + '<path d="M10 3h3m-3 3h3m-3 3h3m-3 3h3m-3 3h3v4h-3z"/>';
icons.addDocument = documentOutline + '<path d="M8 15h9m-4.5-4.5v9"/>';
icons.deleteDocument = documentOutline + '<path d="M8 16h9"/>';
icons.bolt = '<path d="M12 2 3 13h8l-2 9L21 9h-9l6-7z"/>';
icons.list = '<path d="M7 4h14M7 12h14M7 20h14"/><rect x="2" y="3" width="2" height="2"/><rect x="2" y="11" width="2" height="2"/><rect x="2" y="19" width="2" height="2"/>';
const desktop = { expanded: new Set(['']), anchor: -1, search: false, mode: 'details', tree: true, split: 68, codePage: 0 };
try { Object.assign(desktop, JSON.parse(localStorage.getItem('nzip.browser') || '{}')); } catch {}
desktop.expanded = new Set(['']);
function saveBrowser() { localStorage.setItem('nzip.browser', JSON.stringify({ mode: desktop.mode, tree: desktop.tree, split: desktop.split })); }
function folders() {
  const result = new Set();
  for (const entry of state.archive?.entries || []) {
    const parts = entry.path.replace(/\/$/, '').split('/'); if (!entry.isDirectory) parts.pop();
    let path = ''; for (const part of parts) { path += part + '/'; result.add(path); }
  }
  return [...result].sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
}
function parentFolder() { const parts = state.folder.split('/').filter(Boolean); parts.pop(); return parts.length ? parts.join('/') + '/' : ''; }
function goFolder(path) { state.folder = path; state.search = ''; state.selected.clear(); desktop.anchor = -1; render(); }
function treeView() {
  const paths = folders(), children = new Map();
  for (const path of paths) { const parts = path.split('/').filter(Boolean); parts.pop(); const parent = parts.length ? parts.join('/') + '/' : ''; if (!children.has(parent)) children.set(parent, []); children.get(parent).push(path); }
  // Keep the current folder visible after navigating from the file list.
  let ancestor = state.folder; while (ancestor) { const parts = ancestor.split('/').filter(Boolean); parts.pop(); ancestor = parts.length ? parts.join('/') + '/' : ''; desktop.expanded.add(ancestor); }
  const row = (path, depth) => {
    const hasChildren = !!children.get(path)?.length, open = desktop.expanded.has(path);
    return `<div class="tree-row ${state.folder === path ? 'current' : ''}" role="treeitem" aria-selected="${state.folder === path}" ${hasChildren ? `aria-expanded="${open}"` : ''} tabindex="${state.folder === path ? '0' : '-1'}" data-tree-folder="${esc(path)}" style="padding-left:${depth * 18 + 3}px"><button class="tree-expander" data-expand="${esc(path)}" aria-label="${open ? '折叠' : '展开'} ${esc(path || state.archive.name)}" ${hasChildren ? '' : 'disabled'}>${hasChildren ? (open ? '⌄' : '›') : ''}</button>${icon(path ? 'folder' : 'archive')}<span>${esc(path ? path.split('/').filter(Boolean).pop() : state.archive.name)}</span></div>`;
  };
  const rows = [], stack = [...(children.get('') || [])].reverse().map(path => [path, 0]);
  while (stack.length) { const [path, depth] = stack.pop(); rows.push(row(path, depth)); if (desktop.expanded.has(path)) for (const child of [...(children.get(path) || [])].reverse()) stack.push([child, depth + 1]); }
  return rows.join('');
}
const baseRender = render, baseBind = bindView;
render = function () {
  baseRender();
  const a = state.archive;
  document.title = a ? `${a.name} - NZIP` : 'NZIP'; $('#window-title').textContent = document.title;
  document.body.dataset.view = state.view;
  document.body.classList.toggle('icon-view', desktop.mode === 'icons');
  document.body.classList.toggle('hide-tree', !desktop.tree);
  document.documentElement.style.setProperty('--tree-width', desktop.split + '%');
  $('#archive-summary').textContent = a ? `文件: ${a.entries.filter(e => !e.isDirectory).length}  文件夹: ${folders().length}  压缩文件大小: ${size(a.archiveSize)}${a.encrypted ? '  已加密' : ''}` : '无广告 · 本地处理';
  $('#status-text').textContent = state.jobs.some(j => ['queued', 'running', 'cancelling'].includes(j.status)) ? '正在处理任务…' : a && state.view === 'archive' ? (state.selected.size ? `已选择 ${state.selected.size} 项` : state.folder || a.name) : '已就绪';
  updateCommands(); hydrate();
};
homeView = function () {
  return `<div class="archive-workspace home-workspace"><aside class="directory-pane"><div class="pane-caption">最近打开</div><div class="recent-files">${state.recent.map((r, i) => `<button data-recent="${i}" title="${esc(r.path)}">${icon('archive')}<span>${esc(r.name)}</span></button>`).join('') || '<p class="muted">暂无记录</p>'}</div></aside><div class="pane-divider" role="separator" aria-orientation="vertical" tabindex="0" aria-label="调整目录树宽度"></div><section class="welcome-pane"><div class="welcome-logo">N</div><h1>NZIP</h1><p>压缩 · 解压 · 无广告</p><div><button class="button" data-command="open">${icon('folderOpen')}打开压缩包…</button><button class="button" data-command="new">${icon('archive')}新建压缩包…</button></div><p class="muted">拖入压缩包即可浏览，拖入文件或文件夹即可压缩</p><div class="welcome-formats">ZIP · 7Z · RAR · TAR · ISO</div></section></div>`;
};
archiveView = function () {
  const a = state.archive; if (!a) return homeView();
  const files = visibleEntries();
  return `<div class="archive-workspace"><aside class="directory-pane"><button class="pane-caption" data-tree-home title="${esc(a.path)}">${icon('archive')}${esc(a.name)}</button><div class="directory-tree" role="tree" aria-label="压缩包目录树">${treeView()}</div></aside><div class="pane-divider" role="separator" aria-orientation="vertical" tabindex="0" aria-valuemin="20" aria-valuemax="70" aria-valuenow="${desktop.split}" aria-label="调整目录树宽度"></div><section class="file-pane" aria-label="压缩包文件列表">
  <div class="address-row ${desktop.search || state.search ? 'searching' : ''}"><button class="icon-button" id="folder-up" title="上一级" ${state.folder ? '' : 'disabled'}>${icon('back')}</button><span title="${esc(state.folder)}">${esc(state.folder || a.name)}</span><label class="search-box">${icon('search')}<input id="archive-search" aria-label="搜索压缩包内文件" placeholder="搜索包内文件" value="${esc(state.search)}"></label><button class="icon-button" data-command="clear-search" aria-label="关闭搜索">${icon('x')}</button></div>
  <div class="files-scroll" tabindex="0"><table class="files-table"><thead><tr><th class="checkbox-cell"><input type="checkbox" id="select-all" aria-label="全选" ${files.length && files.every(e => state.selected.has(e.path)) ? 'checked' : ''}></th><th><button data-sort="name">名称${icon('sort')}</button></th><th><button data-sort="size">大小${icon('sort')}</button></th><th>压缩后</th><th>类型</th><th><button data-sort="modified">修改时间${icon('sort')}</button></th><th>CRC32</th><th></th></tr></thead><tbody>
  ${state.folder && !state.search ? `<tr class="parent-row"><td></td><td colspan="7"><button data-folder="${esc(parentFolder())}">${icon('folder')}..</button></td></tr>` : ''}
  ${files.map((e, i) => { const [typeIcon, type, cls] = fileType(e); return `<tr data-entry="${i}" class="${state.selected.has(e.path) ? 'selected' : ''}" tabindex="0" aria-selected="${state.selected.has(e.path)}"><td class="checkbox-cell"><input type="checkbox" data-select="${i}" aria-label="选择 ${esc(e.name)}" ${state.selected.has(e.path) ? 'checked' : ''}></td><td class="file-name" title="${esc(e.path)}"><span class="file-icon ${cls}">${icon(typeIcon)}</span><span>${esc(state.search ? e.path : e.name)}</span>${e.encrypted ? icon('lock', 'tiny') : ''}</td><td class="numeric">${e.isDirectory ? '' : size(e.size)}</td><td class="numeric">${e.isDirectory ? '' : size(e.packed)}</td><td class="muted">${type}</td><td class="file-date">${esc(e.modified.slice(0, 16))}</td><td class="crc">${esc(e.crc || '')}</td><td>${!e.isDirectory ? `<button class="icon-button preview-button" data-preview="${i}" aria-label="预览 ${esc(e.name)}" title="预览">${icon('eye')}</button>` : ''}</td></tr>`; }).join('')}</tbody></table>${!files.length ? '<div class="no-results">'+(state.search ? '没有匹配的文件' : '此文件夹为空')+'</div>' : ''}</div></section></div>`;
};
function updateCommands() {
  const editable = state.archive && !state.archive.encrypted && desktop.codePage === 0 && ['zip', '7z'].includes(state.archive.type.toLowerCase());
  $$('[data-command]').forEach(b => { b.disabled = !!((b.hasAttribute('data-needs-archive') && !state.archive) || (b.hasAttribute('data-needs-selection') && !state.selected.size) || (b.hasAttribute('data-needs-editable') && !editable)); b.onclick = () => { closeMenus(); void command(b.dataset.command); }; });
  $$('[data-command="rename"],[data-command="delete"]').forEach(b => { if (!editable) b.disabled = true; });
}
function closeMenus() { $$('.menu[open]').forEach(m => m.open = false); $('#file-context').hidden = true; }
function selectFile(entry, selected) {
  const paths = entry.virtual ? state.archive.entries.filter(e => e.path.startsWith(entry.path + '/')).map(e => e.path).concat(entry.path) : [entry.path];
  for (const path of paths) selected ? state.selected.add(path) : state.selected.delete(path);
}
function paintSelection() {
  const entries = visibleEntries();
  $$('[data-entry]').forEach(row => { const selected = state.selected.has(entries[Number(row.dataset.entry)].path); row.classList.toggle('selected', selected); row.setAttribute('aria-selected', selected); row.querySelector('input').checked = selected; });
  if ($('#select-all')) $('#select-all').checked = !!entries.length && entries.every(e => state.selected.has(e.path));
  $('#status-text').textContent = state.selected.size ? `已选择 ${state.selected.size} 项` : state.folder || state.archive?.name || '已就绪'; updateCommands();
}
bindView = function () {
  baseBind(); updateCommands();
  $('[data-tree-home]')?.addEventListener('click', () => goFolder(''));
  $$('[data-tree-folder]').forEach(row => {
    row.onclick = e => { if (!e.target.closest('[data-expand]')) goFolder(row.dataset.treeFolder); };
    row.onkeydown = e => {
      const rows = $$('[data-tree-folder]'), i = rows.indexOf(row), path = row.dataset.treeFolder;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goFolder(path); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))].focus(); }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); e.key === 'ArrowRight' ? desktop.expanded.add(path) : desktop.expanded.delete(path); render(); $$('[data-tree-folder]').find(r => r.dataset.treeFolder === path)?.focus(); }
    };
  });
  $$('[data-expand]').forEach(b => b.onclick = e => { e.stopPropagation(); desktop.expanded.has(b.dataset.expand) ? desktop.expanded.delete(b.dataset.expand) : desktop.expanded.add(b.dataset.expand); render(); });
  const entries = visibleEntries();
  $$('[data-entry]').forEach(row => {
    const i = Number(row.dataset.entry), entry = entries[i];
    row.onclick = e => {
      if (e.target.closest('input,button')) return;
      if (e.shiftKey && desktop.anchor >= 0) { if (!e.ctrlKey) state.selected.clear(); for (let n = Math.min(desktop.anchor, i); n <= Math.max(desktop.anchor, i); n++) selectFile(entries[n], true); }
      else { const selected = state.selected.has(entry.path); if (!e.ctrlKey) state.selected.clear(); selectFile(entry, e.ctrlKey ? !selected : true); desktop.anchor = i; }
      paintSelection();
    };
    row.ondblclick = e => { if (!e.target.closest('button,input')) entry.isDirectory ? goFolder(entry.path.replace(/\/$/, '') + '/') : preview(entry); };
    row.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); entry.isDirectory ? goFolder(entry.path.replace(/\/$/, '') + '/') : preview(entry); } if (e.key === ' ') { e.preventDefault(); selectFile(entry, !state.selected.has(entry.path)); paintSelection(); } };
    row.oncontextmenu = e => { e.preventDefault(); if (!state.selected.has(entry.path)) { state.selected.clear(); selectFile(entry, true); paintSelection(); } showFileMenu(e.clientX, e.clientY); };
  });
  const divider = $('.pane-divider');
  if (divider) {
    divider.onpointerdown = e => { divider.setPointerCapture(e.pointerId); divider.onpointermove = event => { if (!divider.hasPointerCapture(event.pointerId)) return; const box = $('.archive-workspace').getBoundingClientRect(); desktop.split = Math.max(20, Math.min(70, (event.clientX - box.left) / box.width * 100)); document.documentElement.style.setProperty('--tree-width', desktop.split + '%'); }; divider.onpointerup = event => { divider.releasePointerCapture(event.pointerId); saveBrowser(); }; };
    divider.onkeydown = e => { if (['ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); desktop.split = Math.max(20, Math.min(70, desktop.split + (e.key === 'ArrowLeft' ? -2 : 2))); saveBrowser(); render(); $('.pane-divider').focus(); } };
  }
};
function showFileMenu(x, y) {
  closeMenus(); const menu = $('#file-context');
  menu.innerHTML = [['preview', '打开 / 预览'], ['extract-selected', '解压选中文件…'], ['copy-names', '复制文件路径'], ['rename', '重命名…'], ['delete', '删除']].map(([cmd, label]) => `<button role="menuitem" data-command="${cmd}">${label}</button>`).join('');
  menu.hidden = false; updateCommands(); menu.style.left = Math.min(x, innerWidth - 230) + 'px'; menu.style.top = Math.max(0, Math.min(y, innerHeight - menu.offsetHeight - 30)) + 'px'; menu.querySelector('button').focus();
}
async function command(name) {
  if (name === 'open') return chooseOpen();
  if (name === 'new') return createDialog();
  if (name === 'batch') return batchDialog();
  if (name === 'about') return licenseDialog();
  if (name === 'help') return helpDialog();
  if (['details', 'icons', 'tree'].includes(name)) { if (name === 'tree') desktop.tree = !desktop.tree; else desktop.mode = name; saveBrowser(); render(); return; }
  if (!state.archive) return;
  if (['add', 'delete', 'rename'].includes(name) && (desktop.codePage !== 0 || state.archive.encrypted || !['zip', '7z'].includes(state.archive.type.toLowerCase()))) return toast('修改仅支持默认代码页下未加密的 ZIP / 7Z，请先解压再重新打包', true);
  if (name === 'close-archive') { state.archive = null; state.selected.clear(); desktop.codePage = 0; return navigate('home'); }
  if (name === 'reveal') return check(await api.reveal(state.archive.path));
  if (name === 'extract') return extractDialog();
  if (name === 'extract-selected') return extractDialog([...state.selected]);
  if (name === 'quick-extract') { if (check(await api.quickExtract(state.archive.path, state.password, desktop.codePage))) navigate('tasks'); return; }
  if (name === 'add') return addFilesToArchive();
  if (name === 'delete') return deleteEntries();
  if (name === 'rename') return renameDialog();
  if (name === 'properties') return propertiesDialog();
  if (name === 'codepage') return codePageDialog();
  if (name === 'refresh') return openArchive(state.archive.path, state.password, desktop.codePage);
  if (name === 'search') { desktop.search = true; navigate('archive'); $('#archive-search').focus(); return; }
  if (name === 'clear-search') { state.search = ''; desktop.search = false; render(); return; }
  if (name === 'select-all' || name === 'invert') { visibleEntries().forEach(e => selectFile(e, name === 'select-all' || !state.selected.has(e.path))); paintSelection(); return; }
  if (name === 'copy-names') { if (!state.selected.size) return; const text = [...state.selected].join('\r\n'); if (check(await api.copyText(text))) toast('已复制文件路径'); return; }
  if (name === 'preview') { const entry = visibleEntries().find(e => state.selected.has(e.path)); if (entry) entry.isDirectory ? goFolder(entry.path.replace(/\/$/, '') + '/') : preview(entry); return; }
  if (name === 'test') { if (check(await api.startJob('test', { archive: state.archive.path, password: state.password, codePage: desktop.codePage }))) navigate('tasks'); return; }
  if (name === 'scan') return scanDialog();
}
function simpleDialog(title, description, content) {
  showDialog(title, description, `<div class="modal-body">${content}</div>`, '<button class="button" id="simple-close">关闭</button>', 'compact-modal'); $('#simple-close').onclick = () => $('#modal').close();
}
function propertiesDialog() {
  const a = state.archive;
  simpleDialog('压缩包属性', a.name, `<dl class="properties-list">${[['位置', a.path], ['格式', a.type.toUpperCase()], ['压缩大小', size(a.archiveSize)], ['解压大小', size(a.totalSize)], ['文件 / 文件夹', `${a.entries.filter(e => !e.isDirectory).length} / ${folders().length}`], ['加密', a.encrypted ? '是' : '否'], ['文件名代码页', desktop.codePage || '自动（引擎默认）']].map(([label, value]) => `<dt>${label}</dt><dd>${esc(value)}</dd>`).join('')}</dl>`);
}
function codePageDialog() {
  showDialog('文件名代码页', '文件名乱码时，可用不同编码重新读取 ZIP 文件。', `<form id="codepage-form" class="modal-body"><label class="field-label" for="codepage">文件名编码</label><select id="codepage" class="full-input">${[[0, '自动（引擎默认）'], [65001, 'UTF-8'], [936, '简体中文（GBK）'], [950, '繁体中文（Big5）'], [932, '日文（Shift-JIS）'], [949, '韩文'], [437, 'DOS 美国'], [1252, '西欧']].map(([value, label]) => `<option value="${value}" ${desktop.codePage === value ? 'selected' : ''}>${label}</option>`).join('')}</select><p class="field-hint">所选编码同时用于浏览、预览、测试和解压。带 Unicode 文件名的压缩包可能忽略此选项。非默认编码下请先解压，再重新打包修改。</p></form>`, '<button class="button" id="codepage-cancel">取消</button><button class="button primary" form="codepage-form">重新读取</button>', 'compact-modal');
  $('#codepage-cancel').onclick = () => $('#modal').close();
  $('#codepage-form').onsubmit = e => { e.preventDefault(); const page = Number($('#codepage').value); $('#modal').close(); void openArchive(state.archive.path, state.password, page); };
}
function renameDialog() {
  const entries = visibleEntries().filter(e => state.selected.has(e.path));
  if (entries.length !== 1) return toast('请选择一个文件或文件夹重命名', true);
  const entry = entries[0];
  showDialog('重命名', entry.name, `<form id="rename-form" class="modal-body"><label class="field-label" for="rename-name">新名称</label><input class="full-input" id="rename-name" value="${esc(entry.name)}" required autofocus><p class="field-hint">保留父目录；文件夹内的文件会一起更名。仅支持未加密的 ZIP / 7Z。</p></form>`, '<button class="button" id="rename-cancel">取消</button><button class="button primary" form="rename-form">确定</button>', 'compact-modal');
  $('#rename-cancel').onclick = () => $('#modal').close();
  $('#rename-form').onsubmit = async e => { e.preventDefault(); const result = await api.startJob('modify', { archive: state.archive.path, action: 'rename', oldName: entry.path.replace(/\/$/, ''), newName: $('#rename-name').value.trim(), codePage: desktop.codePage }); if (check(result)) { $('#modal').close(); navigate('tasks'); } };
}
function scanDialog() {
  showDialog('扫描压缩包', state.archive.name, '<div class="modal-body"><p>通过 Windows AMSI 调用系统已安装的杀毒引擎，扫描包内文件内容。文件仅解压到临时目录，不执行，完成后清理。</p><p class="field-hint">需要可用的 AMSI 杀毒引擎。最多处理 512 MB、10,000 个文件，单个文件最多 64 MB；超限或引擎不可用会明确报错。嵌套压缩包不递归展开。扫描结果不代表绝对安全。</p></div>', '<button class="button" id="scan-cancel">取消</button><button class="button primary" id="scan-confirm">开始扫描</button>', 'compact-modal');
  $('#scan-cancel').onclick = () => $('#modal').close(); $('#scan-confirm').onclick = async () => { if (check(await api.startJob('scan', { archive: state.archive.path, password: state.password, codePage: desktop.codePage }))) { $('#modal').close(); navigate('tasks'); } };
}
function helpDialog() {
  simpleDialog('使用说明与功能支持', 'NZIP · 本地压缩工具', '<p>打开 / 新建：Ctrl+O / Ctrl+N；查找：Ctrl+F；全选：Ctrl+A；重命名：F2；刷新：F5；返回上级：Alt+↑。Ctrl / Shift 单击可多选，右击文件可预览和解压。</p><p>支持 ZIP / 7Z / TAR 创建、AES 加密、分卷、批量解压、目录树、文本和图片预览、完整性测试、未加密 ZIP / 7Z 添加 / 删除 / 重命名、代码页和系统杀毒扫描。</p><p>目前与 Bandizip 仍有差异：不支持 ALZ / EGG 等专有格式、密码恢复 / 管理、损坏修复、SFX 创建、压缩包注释编辑、拖出文件到资源管理器；嵌套 TAR 压缩包需分两步解压。Windows 11 右键子菜单位于“显示更多选项”。</p>');
}
$$('.menu').forEach(menu => {
  menu.addEventListener('toggle', () => { if (menu.open) $$('.menu').forEach(other => { if (other !== menu) other.open = false; }); });
  menu.addEventListener('pointerenter', () => { if ($$('.menu[open]').length) { $$('.menu').forEach(other => { if (other !== menu) other.open = false; }); menu.open = true; } });
});
document.addEventListener('pointerdown', e => { if (!e.target.closest('.menu,#file-context')) closeMenus(); });
document.addEventListener('click', e => { if (e.target.closest('[data-view]')) closeMenus(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeMenus();
  if ($('#modal').open || e.target.matches('input,textarea,select')) return;
  if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); if (state.view === 'archive') goFolder(parentFolder()); }
  const menuKeys = { f: 'file', e: 'edit', s: 'find', o: 'options', v: 'view', t: 'tools', h: 'help' };
  if (e.altKey && menuKeys[e.key.toLowerCase()]) { e.preventDefault(); closeMenus(); const menu = $('#menu-' + menuKeys[e.key.toLowerCase()]); menu.open = true; menu.querySelector('button:not(:disabled)')?.focus(); }
  if ((e.ctrlKey || e.metaKey) && ['a', 'c'].includes(e.key.toLowerCase()) && state.view === 'archive') { e.preventDefault(); void command({ a: 'select-all', c: 'copy-names' }[e.key.toLowerCase()]); }
  if (e.key === 'F2' && state.view === 'archive') { e.preventDefault(); void command('rename'); }
  const popup = e.target.closest('.menu-popup');
  if (popup && ['ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); const buttons = $$('button:not(:disabled)', popup), index = buttons.indexOf(e.target); buttons[(index + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus(); }
});
hydrate();
