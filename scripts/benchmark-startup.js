const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function port() { const s = net.createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening'); const p = s.address().port; await new Promise(resolve => s.close(resolve)); return p; }
async function measure(kind, executable, profile, run) {
  const p = await port();
  const native = kind === 'native';
  const reportPath = path.join(path.dirname(profile), `native-ready-${Date.now()}-${run}.json`);
  const begin = performance.now();
  const child = spawn(executable, native ? [] : [`--remote-debugging-port=${p}`], { windowsHide: true, stdio: 'ignore', env: { ...process.env, NZIP_USER_DATA: profile, NZIP_TEST_MODE: '1', NZIP_STARTUP_REPORT: reportPath, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${p} --remote-debugging-address=127.0.0.1` } });
  let browser, page;
  try {
    while (performance.now() - begin < 60000) {
      try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${p}`, { timeout: 800 }); break; } catch { if (child.exitCode !== null) throw new Error(`${kind} exited before ready`); await sleep(40); }
    }
    if (!browser) throw new Error(`${kind} startup timed out`);
    const context = browser.contexts()[0];
    page = context.pages()[0] || await context.waitForEvent('page', { timeout: 15000 });
    await page.waitForSelector('#open-archive', { state: 'visible' });
    if (native) await page.waitForFunction(() => window.__NZIP_READY__ === true);
    const result = Math.round(performance.now() - begin);
    await page.evaluate(() => window.nzip.window('close')).catch(() => {});
    return { launchToReadyMs: result, ...(native ? JSON.parse(await fs.readFile(reportPath, 'utf8')) : {}) };
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (child.exitCode === null) await Promise.race([once(child, 'exit'), sleep(5000)]);
    if (child.exitCode === null) child.kill();
  }
}
async function main() {
  const dir = path.resolve('test-results/performance'); await fs.mkdir(dir, { recursive: true });
  const result = { recordedAt: new Date().toISOString(), method: 'Process launch to visible ready home DOM, measured via local CDP; native also waits for completed init/ready handshake. First run uses a fresh profile, later runs reuse that profile. OS filesystem cache not flushed. Native backendToReadyMs reports host construction to ready, excluding pre-host process startup.', cases: [] };
  for (const [kind, executable] of [['electron-portable', path.resolve('dist/NZIP-0.1.0-win-x64.exe')], ['native', path.resolve('dist/NZIP-0.2.0-win-x64/NZIP.exe')]]) {
    const times = [], reports = [];
    const profile = path.join(dir, `${kind}-${Date.now()}`);
    for (let i = 0; i < 3; i++) { const r = await measure(kind, executable, profile, i); reports.push(r); times.push(r.launchToReadyMs); console.log(`${kind} run ${i + 1}: ${JSON.stringify(r)}`); }
    result.cases.push({ kind, launchToReadyMs: times, medianMs: [...times].sort((a, b) => a - b)[1], reports });
  }
  result.oldPortableBytes = (await fs.stat('dist/NZIP-0.1.0-win-x64.exe')).size;
  await fs.writeFile(path.join(dir, 'startup.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result.cases));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
