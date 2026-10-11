const { spawn } = require('node:child_process');
const extensions = ['zip', '7z', 'rar', 'tar', 'gz', 'bz2', 'xz', 'iso', 'cab', 'wim', 'tgz', '001'];
function menuEntries(executable) {
  const root = 'HKCU\\Software\\Classes';
  const command = (flag) => `"${executable}" ${flag} "%1"`;
  const entries = [
    { key: `${root}\\*\\shell\\NZIP.Compress`, label: '使用 NZIP 压缩…', command: command('--compress') },
    { key: `${root}\\Directory\\shell\\NZIP.Compress`, label: '使用 NZIP 压缩…', command: command('--compress') }
  ];
  for (const ext of extensions) {
    const key = `${root}\\SystemFileAssociations\\.${ext}\\shell`;
    entries.push({ key: `${key}\\NZIP.Open`, label: '使用 NZIP 打开', command: command('--open') });
    entries.push({ key: `${key}\\NZIP.Extract`, label: '使用 NZIP 解压到…', command: command('--extract') });
  }
  return entries.map(e => ({ ...e, icon: `"${executable}",0` }));
}
async function reg(args, allowMissing = false) {
  return new Promise((resolve, reject) => {
    const p = spawn('reg.exe', args, { windowsHide: true, shell: false, stdio: 'ignore' });
    p.on('error', reject); p.on('close', code => code === 0 || allowMissing ? resolve() : reject(new Error('无法更新右键菜单，请检查当前用户的注册表权限')));
  });
}
async function setContextMenus(executable, enabled) {
  if (process.platform !== 'win32') throw new Error('此功能仅支持 Windows');
  for (const e of menuEntries(executable)) {
    if (enabled) {
      await reg(['add', e.key, '/ve', '/t', 'REG_SZ', '/d', e.label, '/f']);
      await reg(['add', e.key, '/v', 'Icon', '/t', 'REG_SZ', '/d', e.icon, '/f']);
      await reg(['add', e.key, '/v', 'MultiSelectModel', '/t', 'REG_SZ', '/d', 'Single', '/f']);
      await reg(['add', `${e.key}\\command`, '/ve', '/t', 'REG_SZ', '/d', e.command, '/f']);
    } else await reg(['delete', e.key, '/f'], true);
  }
}
function launchRequest(argv) {
  const flag = argv.findIndex(a => ['--compress', '--extract', '--open'].includes(a));
  if (flag >= 0 && argv[flag + 1]) return { type: argv[flag].slice(2), path: argv[flag + 1] };
  const p = argv.find((a, i) => i > 0 && !a.startsWith('-') && /\.(zip|7z|rar|tar|gz|bz2|xz|iso|cab|wim|tgz|001)$/i.test(a));
  return p ? { type: 'open', path: p } : null;
}
module.exports = { menuEntries, setContextMenus, launchRequest };
