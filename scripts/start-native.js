const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const executable = path.join(root, `dist/NZIP-${require('../package.json').version}-win-x64/NZIP.exe`);
if (!fs.existsSync(executable)) {
  const build = spawnSync('powershell.exe', ['-NoProfile', '-File', path.join(root, 'scripts/build-native.ps1')], { cwd: root, stdio: 'inherit', windowsHide: true });
  if (build.status !== 0) process.exit(build.status || 1);
}
const app = spawn(executable, process.argv.slice(2), { cwd: root, stdio: 'inherit', windowsHide: true });
app.on('error', error => { console.error(error.message); process.exitCode = 1; });
app.on('exit', code => { process.exitCode = code || 0; });
