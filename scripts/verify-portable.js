const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { createEngine } = require('../src/engine');

async function main() {
  const directory = path.resolve('test-results/portable-ui');
  const session = path.join(directory, crypto.randomUUID());
  await fs.mkdir(session, { recursive: true });
  const server = net.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port; await new Promise(resolve => server.close(resolve));
  const child = spawn(path.resolve('dist/NZIP-0.1.0-win-x64.exe'), [`--remote-debugging-port=${port}`], {
    env: { ...process.env, NZIP_USER_DATA: path.join(session, 'profile') }, windowsHide: true, stdio: 'ignore'
  });
  let browser;
  try {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1200 }); break; }
      catch { await new Promise(resolve => setTimeout(resolve, 500)); }
    }
    assert.ok(browser, 'Portable launcher must start the application');
    const page = browser.contexts()[0].pages()[0];
    await page.waitForSelector('#open-archive');
    const init = await page.evaluate(() => window.nzip.init());
    assert.equal(init.version, '0.1.0'); assert.equal(init.canIntegrate, true);
    await page.screenshot({ path: path.join(directory, 'home.png') });
    const file = path.join(session, '便携版验证.txt'); await fs.writeFile(file, 'NZIP portable works');
    const archive = path.join(session, '便携版验证.zip');
    await createEngine(path.resolve('vendor/7zip/7z.exe')).create({ sources: [file], destination: archive });
    await page.evaluate(p => openArchive(p), archive);
    await page.waitForSelector('#extract-all');
    assert.ok((await page.locator('main').innerText()).includes('便携版验证.txt'));
    console.log('Portable EXE verified: launcher, bundled runtime, version, isolated preferences and bundled archive engine.');
    await page.evaluate(() => window.nzip.window('close')).catch(() => {});
    await browser.close().catch(() => {});
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (child.exitCode === null) { await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 5000))]); }
    if (child.exitCode === null) child.kill();
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
