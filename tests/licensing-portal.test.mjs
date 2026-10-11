import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID, generateKeyPairSync } from 'node:crypto';
import { chromium } from 'playwright';
import { Licensing } from '../server/licensing.mjs';
import { createServer } from '../server/main.mjs';

test('purchase-email portal verifies email, lists devices, releases a slot and activates new PC', async t => {
  const directory = path.resolve('test-results/license-portal', randomUUID()); fs.mkdirSync(directory, { recursive: true });
  const pair = generateKeyPairSync('rsa', { modulusLength: 3072 });
  const service = new Licensing({ database: path.join(directory, 'licenses.sqlite'), keyId: 'test-portal', privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), storageKey: randomBytes(32), pepper: randomBytes(32) });
  const issued = service.issue({ orderRef: 'ORDER-TEST', email: 'buyer@example.test', customerRef: 'customer-test' });
  const activate = n => service.activate({ requestId: randomUUID(), activationCode: issued.activationCode, deviceDigest: n.toString(16).padStart(64, '0'), deviceName: '我的电脑 ' + n });
  for (let i = 1; i <= 3; i++) activate(i);
  let delivered;
  const server = createServer(service, { publicUrl: 'http://127.0.0.1' }, async (email, code) => { delivered = { email, code }; });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  // Public origin includes test port; construct another server using same port
  // configuration before serving so Origin checks exercise the actual browser.
  const port = server.address().port; await new Promise(resolve => server.close(resolve));
  const host = createServer(service, { publicUrl: 'http://127.0.0.1:' + port }, async (email, code) => { delivered = { email, code }; });
  await new Promise(resolve => host.listen(port, '127.0.0.1', resolve));
  let browser;
  t.after(async () => { if(browser)await browser.close(); host.closeAllConnections(); await new Promise(resolve => host.close(resolve)); service.close(); });
  browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  const page = await browser.newPage({ viewport: { width: 1000, height: 850 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:' + port);
  await page.locator('#email').fill('buyer@example.test'); await page.getByRole('button', { name: '发送验证码', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '如邮箱与购买记录一致' }).waitFor();
  assert.equal(delivered.email, 'buyer@example.test'); await page.locator('#code').fill(delivered.code);
  await page.getByRole('button', { name: '验证并查看设备' }).click(); await page.locator('article').nth(2).waitFor();
  assert.equal(await page.locator('article').count(), 3); await page.screenshot({ path: path.join(directory, 'devices.png'), fullPage: true });
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: '解绑并释放名额' }).first().click();
  await page.getByRole('status').filter({ hasText: '解绑成功' }).waitFor();
  activate(4); assert.equal(service.db.prepare('SELECT COUNT(*) n FROM bindings WHERE active=1').get().n, 3);
  assert.deepEqual(errors, []); assert.equal(await page.evaluate(() => localStorage.length), 0);
  fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify({ ok: true, sentExternally: false, checks: ['email verification', 'device list', 'self-service release', 'new machine activation', 'no browser errors', 'no token localStorage'] }, null, 2));
  console.log('Portal screenshot:', directory);
});
