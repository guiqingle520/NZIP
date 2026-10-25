import fs from 'node:fs/promises';
import path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
const [privateFile, publicFile, repository = 'guiqingle520/NZIP', keyId = 'updates-2026-01'] = process.argv.slice(2);
if (!privateFile || !publicFile || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !/^[A-Za-z0-9-]{1,100}$/.test(keyId)) throw Error('Usage: node scripts/create-update-key.mjs <private.pem> <public.json> [owner/repo] [key-id]');
const keys = generateKeyPairSync('rsa', { modulusLength: 3072 }), jwk = keys.publicKey.export({ format: 'jwk' });
await fs.mkdir(path.dirname(path.resolve(privateFile)), { recursive: true }); await fs.mkdir(path.dirname(path.resolve(publicFile)), { recursive: true });
// Exclusive writes prevent accidental replacement of a key already trusted by installed clients.
const secret = await fs.open(privateFile, 'wx', 0o600);
try { await secret.writeFile(keys.privateKey.export({ type: 'pkcs8', format: 'pem' })); } finally { await secret.close(); }
await fs.writeFile(publicFile, JSON.stringify({ repository, keyId, modulus: jwk.n, exponent: jwk.e }, null, 2), { flag: 'wx' });
console.log('Created an update key pair. Back up the private file securely; only the public JSON belongs in the source repository.');
