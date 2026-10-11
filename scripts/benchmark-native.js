// Measure ordinary launches without developer tools or a CDP connection.
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const dir = path.resolve('test-results/performance'); await fs.mkdir(dir, { recursive: true });
  const profile = path.join(dir, `normal-${Date.now()}`), runs = [];
  for (let i = 0; i < 3; i++) {
    const report = path.join(dir, `normal-ready-${Date.now()}-${i}.json`);
    const env = { ...process.env, NZIP_USER_DATA: profile, NZIP_STARTUP_REPORT: report };
    delete env.NZIP_TEST_MODE; delete env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS;
    const begin = performance.now();
    const child = spawn(path.resolve(process.env.NZIP_NATIVE_EXE || `dist/NZIP-${require('../package.json').version}-win-x64/NZIP.exe`), [], { env, stdio: 'ignore', windowsHide: true });
    try {
      let ready;
      while (performance.now() - begin < 60000) {
        try { ready = JSON.parse(await fs.readFile(report, 'utf8')); break; } catch {}
        if (child.exitCode !== null) throw Error('App exited before ready');
        await sleep(25);
      }
      if (!ready) throw Error('Startup timed out');
      const result = { launchToReadyMs: Math.round(performance.now() - begin), ...ready };
      runs.push(result); console.log(`Normal native run ${i + 1}: ${JSON.stringify(result)}`);
    } finally {
      // Send WM_CLOSE to this test's window so WebView2 can close normally.
      if (child.exitCode === null) {
        const close = spawn('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${child.pid} -ErrorAction SilentlyContinue).CloseMainWindow() | Out-Null`], { windowsHide: true, stdio: 'ignore' });
        await once(close, 'exit');
        if (child.exitCode === null) await Promise.race([once(child, 'exit'), sleep(5000)]);
        if (child.exitCode === null) child.kill();
      }
    }
  }
  const result = { recordedAt: new Date().toISOString(), method: 'Normal launch, no test mode, debugger or CDP. Process spawn to native ready report after initial settings/render. First run uses a fresh profile, next two reuse it. File polled every 25 ms; OS cache not flushed.', runs, medianMs: runs.map(r => r.launchToReadyMs).sort((a, b) => a - b)[1] };
  await fs.writeFile(path.join(dir, process.env.NZIP_BENCHMARK_NAME || 'normal-startup.json'), JSON.stringify(result, null, 2));
  console.log(`Normal startup median: ${result.medianMs} ms`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
