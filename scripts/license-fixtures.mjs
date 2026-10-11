import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';

const work = path.resolve(process.argv[2]);
const device = spawnSync(path.join(work, 'LicenseTests.exe'), ['--device'], { encoding: 'utf8' });
if (device.error || device.status !== 0) throw device.error || Error(device.stderr);
const digest = device.stdout.trim();
if (!/^[a-f0-9]{64}$/.test(digest)) throw Error('No Windows device digest');
const pair = generateKeyPairSync('rsa', { modulusLength: 3072 }), jwk = pair.publicKey.export({ format: 'jwk' });
const keyId = 'nzip-preview-test', keys = { [keyId]: { modulus: jwk.n, exponent: jwk.e } };
const payload = { schema: 1, product: 'nzip-paid', licenseId: 'license-test', grantId: 'grant-test', bindingId: 'binding-test', generation: 1, customerRef: 'customer-001', deviceDigest: digest, entitlement: 'desktop-core', issuedAt: '2000-01-01T00:00:00.000Z' };
function certificate(raw, key = keyId) {
  const bytes = Buffer.from(typeof raw === 'string' ? raw : JSON.stringify(raw));
  return JSON.stringify({ keyId: key, payload: bytes.toString('base64url'), signature: sign('RSA-SHA256', Buffer.concat([Buffer.from('NZIP-LICENSE-V1\0'), bytes]), pair.privateKey).toString('base64url') });
}
const valid = certificate(payload), tampered = JSON.parse(valid);
const signature = Buffer.from(tampered.signature, 'base64url'); signature[0] ^= 1; tampered.signature = signature.toString('base64url');
const { entitlement: _, ...missing } = payload;
const fixture = { keys, digest, certificate: valid, badSignature: JSON.stringify(tampered), wrongDevice: certificate({ ...payload, deviceDigest: 'f'.repeat(64) }), unknownKey: certificate(payload, 'unknown-key'), duplicateEnvelope: valid.replace('{', '{"keyId":"duplicate",'), duplicatePayload: certificate(JSON.stringify(payload).replace('{', '{"schema":1,')), unknownPayload: certificate({ ...payload, expiresAt: '2099' }), missingPayload: certificate(missing), stringSchema: certificate({ ...payload, schema: '1' }), invalidSchema: certificate({ ...payload, schema: 2 }), wrongProduct: certificate({ ...payload, product: 'other' }), wrongEntitlement: certificate({ ...payload, entitlement: 'other' }), invalidIssuedAt: certificate({ ...payload, issuedAt: 'tomorrow' }), oversize: 'x'.repeat(16385) };
fs.writeFileSync(path.join(work, 'fixture.json'), JSON.stringify(fixture));
fs.writeFileSync(path.join(work, 'client-public.json'), JSON.stringify({ endpoint: '', keys: [{ keyId, ...keys[keyId] }] }));
fs.writeFileSync(path.join(work, 'this-machine.nziplicense'), valid);
// Test private key stays in ignored .cache; never part of a client package.
fs.writeFileSync(path.join(work, 'test-signing.pem'), pair.privateKey.export({ type: 'pkcs8', format: 'pem' }));
console.log('Created isolated test trust and signed Windows-device fixtures.');
