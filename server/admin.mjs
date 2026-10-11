import fs from 'node:fs';
import path from 'node:path';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { Licensing } from './licensing.mjs';
import { loadConfig } from './main.mjs';

const [command, filename = 'server/secrets/config.json', ...args] = process.argv.slice(2);
if (command === 'init') {
  const publicUrl = args[0];
  if (!publicUrl || !publicUrl.startsWith('https://')) throw new Error('Usage: node server/admin.mjs init <config-path> https://license.YOUR-DOMAIN');
  if (fs.existsSync(filename)) throw new Error('Configuration already exists; refusing to replace keys');
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const pair = generateKeyPairSync('rsa', { modulusLength: 3072 });
  const privateName = path.resolve(path.dirname(filename), 'signing.pem');
  fs.writeFileSync(privateName, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 });
  const keyId = 'nzip-' + new Date().toISOString().slice(0, 10);
  fs.writeFileSync(filename, JSON.stringify({ database: 'licenses.sqlite', privateKey: 'signing.pem', keyId, storageKey: randomBytes(32).toString('base64'), pepper: randomBytes(32).toString('base64'), publicUrl, port: 8787, mail: { from: '', apiKey: '' } }, null, 2), { flag: 'wx', mode: 0o600 });
  const jwk = pair.publicKey.export({ format: 'jwk' });
  fs.writeFileSync(path.join(path.dirname(filename), 'client-public.json'), JSON.stringify({ endpoint: publicUrl, keys: [{ keyId, modulus: jwk.n, exponent: jwk.e }] }, null, 2));
  console.log('Created server secrets and client-public.json. Back up secrets; never distribute them.');
} else if (command === 'issue') {
  const [orderRef, email, customerRef, slots = '3'] = args;
  const service = new Licensing(loadConfig(filename));
  try { console.log(JSON.stringify(service.issue({ orderRef, email, customerRef, slots: Number(slots) }), null, 2)); } finally { service.close(); }
} else if (command === 'offline') {
  const [orderRef, requestFile, outputFile] = args;
  if (!outputFile || fs.existsSync(outputFile) || fs.statSync(requestFile).size > 16384) throw new Error('Choose a new output filename and a small .nziprequest file');
  const service = new Licensing(loadConfig(filename));
  try { const certificate = service.offline(orderRef, JSON.parse(fs.readFileSync(requestFile, 'utf8'))); fs.writeFileSync(outputFile, JSON.stringify(certificate), { flag: 'wx' }); console.log('Created device-bound offline certificate; one active seat is registered.'); } finally { service.close(); }
} else if (command === 'update' || command === 'show') {
  const [orderRef, optionsFile] = args, service = new Licensing(loadConfig(filename));
  try { console.log(JSON.stringify(command === 'show' ? service.inspect(orderRef) : service.update(orderRef, JSON.parse(fs.readFileSync(optionsFile, 'utf8'))), null, 2)); } finally { service.close(); }
} else throw new Error('Commands: init <config> <https-url>; issue <config> <order-ref> <email> <customer-ref> [slots]; offline <config> <order-ref> <request-file> <output-file>; update <config> <order-ref> <options-json>; show <config> <order-ref>');
