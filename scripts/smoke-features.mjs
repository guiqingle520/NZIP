import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash, sign, randomUUID, generateKeyPairSync } from 'node:crypto';
const product = process.argv[2] || 'NZIP', version = product === 'NZIP' ? JSON.parse(await fs.readFile('package.json', 'utf8')).version : '0.8.0';
if (!['NZIP', 'NZIPPaid', 'NZIPPaidPreview'].includes(product)) throw Error('Unknown product');
const output = path.resolve('test-results/features', randomUUID()); await fs.mkdir(output, { recursive: true });
const keys = generateKeyPairSync('rsa', { modulusLength: 3072 }), key = keys.privateKey, publicKey = keys.publicKey.export({ format: 'jwk' });
const trust = { repository: 'guiqingle520/NZIP', keyId: 'ephemeral-test-only', modulus: publicKey.n, exponent: publicKey.e }, bytes = Buffer.alloc(4096, 0x4e);
const payload = Buffer.from(JSON.stringify({ product, version: '9999.0.0', url: `https://github.com/${trust.repository}/releases/download/test-only/NeverPublish.msi`, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }));
await fs.writeFile(path.join(output, 'download.bin'), bytes);
await fs.writeFile(path.join(output, 'signed-release.json'), JSON.stringify({ trust, envelope: JSON.stringify({ keyId: trust.keyId, payload: payload.toString('base64url'), signature: sign('sha256', payload, key).toString('base64url') }) }));
const language = process.argv[3] || 'zh-CN'; if (!['zh-CN', 'zh-TW', 'en-US'].includes(language)) throw Error('Unsupported language');
await fs.mkdir(path.join(output, 'profile'), { recursive: true }); await fs.writeFile(path.join(output, 'profile', 'desktop.json'), JSON.stringify({ language }));
const child = spawn(path.resolve(`dist/${product}-${version}-win-x64/${product}.exe`), ['--feature-smoke', output], { windowsHide: false, stdio: 'ignore', env: { ...process.env, NZIP_TEST_MODE: '1', NZIP_USER_DATA: path.join(output, 'profile') } });
const timeout = setTimeout(() => child.kill(), 180000);
try { const [code] = await once(child, 'exit'); const result = JSON.parse(await fs.readFile(path.join(output, 'result.json'), 'utf8')); console.log(JSON.stringify({ code, output, ...result }, null, 2)); if (code !== 0 || !result.ok) process.exitCode = 1; } finally { clearTimeout(timeout); }
