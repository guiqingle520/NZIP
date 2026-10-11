// Use independent identities so tests never upgrade or uninstall the user's NZIP.
const path = require('node:path');
const { spawn } = require('node:child_process');
const child = spawn('powershell.exe', ['-NoProfile', '-File', path.join(__dirname, 'test-installer-location.ps1'), '-WithUi'], {
  cwd: path.resolve(__dirname, '..'), windowsHide: true, stdio: 'inherit'
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
