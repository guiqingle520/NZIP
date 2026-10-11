import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPairSync, randomUUID, randomBytes, verify } from 'node:crypto';
import { Licensing } from '../server/licensing.mjs';
import { createServer } from '../server/main.mjs';

const pair = generateKeyPairSync('rsa', { modulusLength: 3072 });
const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
function fixture(t, slots = 3) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nzip-license-'));
  let now = Date.now();
  const options = { database: path.join(directory, 'db.sqlite'), privateKey, keyId: 'test-key', storageKey: randomBytes(32), pepper: randomBytes(32), clock: () => now };
  const service = new Licensing(options), issued = service.issue({ orderRef: randomUUID(), email: 'buyer@example.test', customerRef: 'customer-001', slots });
  t.after(() => { service.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const activate = (n, extra = {}) => service.activate({ requestId: randomUUID(), activationCode: issued.activationCode, deviceDigest: n.toString(16).padStart(64, '0'), deviceName: 'PC-' + n, ...extra });
  const payload = result => JSON.parse(Buffer.from(result.certificate.payload, 'base64url'));
  const deactivate = (result, extra = {}) => { const p = payload(result); return service.deactivate({ requestId: randomUUID(), bindingId: p.bindingId, generation: p.generation, managementToken: result.managementToken, ...extra }); };
  const orderRef = service.db.prepare('SELECT orderRef FROM licenses WHERE id=?').get(issued.licenseId).orderRef;
  return { service, options, issued, orderRef, activate, deactivate, payload, advance: delta => { now += delta; } };
}
const errorCode = code => error => error.code === code;

test('signed perpetual certificate, no expiry or customer email; deterministic same-device seat', t => {
  const f = fixture(t), first = f.activate(1), p = f.payload(first);
  assert.equal(p.product, 'nzip-paid'); assert.equal(p.schema, 1); assert.equal(p.entitlement, 'desktop-core');
  assert.equal(p.expiresAt, undefined); assert.equal(p.email, undefined); assert.equal(p.activationCode, undefined);
  assert(verify('RSA-SHA256', Buffer.concat([Buffer.from('NZIP-LICENSE-V1\0'), Buffer.from(first.certificate.payload, 'base64url')]), pair.publicKey, Buffer.from(first.certificate.signature, 'base64url')));
  assert.deepEqual(f.activate(1), first);
  assert.equal(f.service.db.prepare('SELECT COUNT(*) n FROM bindings WHERE active=1').get().n, 1);
});
test('quota, self-service unbind, historical device reactivation counts against available slots', t => {
  const f = fixture(t), old = f.activate(1); f.activate(2); f.activate(3);
  assert.throws(() => f.activate(4), errorCode('SLOTS_FULL'));
  f.deactivate(old); f.activate(4);
  assert.throws(() => f.activate(1), errorCode('SLOTS_FULL'));
  assert.equal(f.service.db.prepare('SELECT COUNT(*) n FROM grants').get().n, 4);
});
test('unlimited normal device transfers and generations; stale tokens cannot remove new binding', t => {
  const f = fixture(t, 1); let current = f.activate(1), first = current;
  for (let i = 0; i < 15; i++) { f.deactivate(current); current = f.activate(1); }
  assert.equal(f.payload(current).generation, 16);
  assert.throws(() => f.deactivate(first), errorCode('FORBIDDEN'));
  assert.throws(() => f.deactivate(first, { managementToken: current.managementToken }), errorCode('STATE_CHANGED'));
});
test('idempotent retries, request conflicts and stale activation replay cannot resurrect registration', t => {
  const f = fixture(t), requestId = randomUUID(), result = f.activate(1, { requestId });
  assert.deepEqual(f.activate(1, { requestId }), result);
  assert.throws(() => f.activate(2, { requestId }), errorCode('REQUEST_CONFLICT'));
  const deactivateId = randomUUID(); assert.deepEqual(f.deactivate(result, { requestId: deactivateId }), f.deactivate(result, { requestId: deactivateId }));
  assert.throws(() => f.activate(1, { requestId }), errorCode('STATE_CHANGED'));
  const next = f.activate(1);
  assert.throws(() => f.deactivate(next, { requestId: deactivateId }), errorCode('REQUEST_CONFLICT'));
  assert.equal(f.service.db.prepare('SELECT COUNT(*) n FROM bindings WHERE active=1').get().n, 1);
});
test('signing or database persistence failure rolls back seat and grant completely', t => {
  const f = fixture(t), original = f.service.certificate;
  f.service.certificate = () => { throw new Error('signer unavailable'); };
  assert.throws(() => f.activate(1), /signer unavailable/); f.service.certificate = original;
  f.service.db.exec("CREATE TRIGGER failure BEFORE INSERT ON mutations BEGIN SELECT RAISE(ABORT,'disk failure'); END");
  assert.throws(() => f.activate(1), /disk failure/);
  assert.equal(f.service.db.prepare('SELECT COUNT(*) n FROM bindings').get().n, 0);
  assert.equal(f.service.db.prepare('SELECT COUNT(*) n FROM grants').get().n, 0);
});
test('reopen persists registrations, encrypted replay response and grant history', t => {
  const f = fixture(t), requestId = randomUUID(), result = f.activate(1, { requestId });
  const raw = f.service.db.prepare('SELECT response FROM mutations').get().response;
  assert(!raw.includes(result.managementToken));
  const other = new Licensing(f.options);
  try { assert.deepEqual(other.activate({ requestId, activationCode: f.issued.activationCode, deviceDigest: '1'.padStart(64, '0'), deviceName: 'PC-1' }), result); } finally { other.close(); }
});
test('email scoped self-service, attempt limit, resend interval, session expiry, one-use OTP', async t => {
  const f = fixture(t), result = f.activate(1); let code;
  await f.service.sendCode('buyer@example.test', async (email, otp) => { assert.equal(email, 'buyer@example.test'); code = otp; });
  await assert.rejects(f.service.sendCode('buyer@example.test', async () => {}), errorCode('RETRY_LATER'));
  for (let i = 0; i < 5; i++) assert.throws(() => f.service.verifyCode({ email: 'buyer@example.test', code: code === '000000' ? '111111' : '000000' }), errorCode('INVALID_OTP'));
  assert.throws(() => f.service.verifyCode({ email: 'buyer@example.test', code }), errorCode('INVALID_OTP'));
  f.advance(61000); await f.service.sendCode('buyer@example.test', async (_, otp) => { code = otp; });
  const session = f.service.verifyCode({ email: 'buyer@example.test', code }).sessionToken;
  assert.throws(() => f.service.verifyCode({ email: 'buyer@example.test', code }), errorCode('INVALID_OTP'));
  assert.equal(f.service.devices(session).devices.length, 1);
  const p = f.payload(result); f.service.deactivate({ requestId: randomUUID(), bindingId: p.bindingId, generation: p.generation }, session);
  f.activate(2); f.advance(900001); assert.throws(() => f.service.devices(session), errorCode('SESSION_REQUIRED'));
});
test('license code alone cannot unbind, other email cannot manage buyer devices', async t => {
  const f = fixture(t), result = f.activate(1), p = f.payload(result); let code;
  f.service.issue({ orderRef: 'other-order', email: 'other@example.test', customerRef: 'other-customer' });
  assert.throws(() => f.deactivate(result, { managementToken: f.issued.activationCode }), errorCode('FORBIDDEN'));
  await f.service.sendCode('other@example.test', async (_, otp) => { code = otp; });
  const session = f.service.verifyCode({ email: 'other@example.test', code }).sessionToken;
  assert.equal(f.service.devices(session).devices.length, 0);
  assert.throws(() => f.service.deactivate({ requestId: randomUUID(), bindingId: p.bindingId, generation: p.generation }, session), errorCode('FORBIDDEN'));
});
test('unknown email gets generic response without sending unsolicited mail', async t => {
  const f = fixture(t); let calls = 0;
  assert.deepEqual(await f.service.sendCode('unknown@example.test', async () => { calls++; }), { sent: true });
  assert.equal(calls, 0);
});
test('seller offline issuance registers a seat and exports no device-management token', t => {
  const f = fixture(t, 1), certificate = f.service.offline(f.orderRef, { schema: 1, product: 'nzip-paid', deviceDigest: 'a'.repeat(64), deviceName: 'offline PC' });
  assert.equal(certificate.managementToken, undefined);
  assert.equal(JSON.parse(Buffer.from(certificate.payload, 'base64url')).deviceDigest, 'a'.repeat(64));
  assert.throws(() => f.activate(2), errorCode('SLOTS_FULL'));
});
test('administrator pause, seat changes and code rotation leave existing offline grants unchanged', t => {
  const f = fixture(t), requestId = randomUUID(), first = f.activate(1, { requestId });
  f.service.update(f.orderRef, { pauseNew: true });
  assert.deepEqual(f.activate(1), first);
  assert.throws(() => f.activate(2), errorCode('LICENSE_PAUSED'));
  const update = f.service.update(f.orderRef, { pauseNew: false, slots: 1, rotateCode: true });
  assert.throws(() => f.activate(1, { requestId }), errorCode('INVALID_CODE'));
  assert.deepEqual(f.activate(1, { activationCode: update.activationCode }), first);
  f.deactivate(first); const second = f.activate(2, { activationCode: update.activationCode });
  assert.equal(f.payload(second).generation, 1);
  f.service.update(f.orderRef, { slots: 3 }); f.activate(3, { activationCode: update.activationCode });
  assert.throws(() => f.service.update(f.orderRef, { slots: 1 }), errorCode('INPUT'));
  assert.equal(f.service.inspect(f.orderRef).grants, 3);
});
test('HTTP concurrent activation quota, request limit and cross-origin management rejection', async t => {
  const f = fixture(t); const server = createServer(f.service, { publicUrl: 'https://license.example.test' }, async () => {});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = 'http://127.0.0.1:' + server.address().port;
  const post = (route, body, headers = {}) => fetch(url + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => post('/v1/activate', { requestId: randomUUID(), activationCode: f.issued.activationCode, deviceDigest: i.toString(16).padStart(64, '0'), deviceName: 'PC' }).then(r => r.json())));
  assert.equal(results.filter(r => r.ok).length, 3);
  assert.equal(results.filter(r => r.code === 'SLOTS_FULL').length, 17);
  assert.equal((await post('/v1/devices', {}, { Origin: 'https://evil.example.test' })).status, 403);
  assert.equal((await post('/v1/activate', { x: 'a'.repeat(17000) })).status, 413);
});
