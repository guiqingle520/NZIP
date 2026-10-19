import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const product = process.argv[2] || 'NZIPPaidPreview';
if (!['NZIP', 'NZIPPaidPreview', 'NZIPPaid'].includes(product)) throw Error('Unknown edition');
const paid = product !== 'NZIP';
const version = paid ? '0.7.2' : JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const stem = product + '-' + version, original = path.resolve('dist', stem + '-win-x64');
const resultDirectory = path.resolve('test-results/paid-package', randomUUID()); fs.mkdirSync(resultDirectory, { recursive: true });
function extract(filename, to) {
  const result = spawnSync(path.resolve('vendor/7zip/7z.exe'), ['x', path.resolve(filename), '-o' + to, '-y'], { windowsHide: true, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw result.error || Error(result.stderr);
}
function files(root, relative = '') {
  return fs.readdirSync(path.join(root, relative), { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(root, path.join(relative, e.name)) : [path.join(relative, e.name)]).sort();
}
extract('dist/' + stem + '-win-x64.zip', path.join(resultDirectory, 'zip'));
extract('dist/' + stem + '-Setup-x64.msi', path.join(resultDirectory, 'msi'));
const unpacked = path.join(resultDirectory, 'zip', stem + '-win-x64'), names = files(original);
assert.deepEqual(files(unpacked), names); assert.equal(names.length, paid ? 11 : 9);
const runtimeConfig = fs.readFileSync(path.join(unpacked, product + '.exe.config'), 'utf8');
assert(runtimeConfig.includes('sku=".NETFramework,Version=v4.8"'));
assert(runtimeConfig.includes('Switch.System.IO.UseLegacyPathHandling=false;Switch.System.IO.BlockLongPaths=false'));
for (const name of names) {
  assert(!/\.(pem|key|sqlite|pfx|nziplicense|nziprequest)$/i.test(name));
  const bytes = fs.readFileSync(path.join(original, name));
  assert.deepEqual(fs.readFileSync(path.join(unpacked, name)), bytes, name);
  assert(!bytes.includes(Buffer.from('-----BEGIN PRIVATE KEY-----'))); assert(!bytes.includes(Buffer.from('-----BEGIN RSA PRIVATE KEY-----')));
}
const work = path.resolve(paid ? '.cache/installer-' + product : '.cache/installer');
const wxs = fs.readFileSync(path.join(work, 'NZIP.wxs'), 'utf8'), info = JSON.parse(fs.readFileSync(path.join(work, 'msi-info.json')));
const xmlDecode = text => text.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>');
const payloads = [...wxs.matchAll(/<File Id="([^"]+)" Source="([^"]+)"/g)]; assert.equal(payloads.length, names.length);
for (const [, id, source] of payloads) assert.deepEqual(fs.readFileSync(path.join(resultDirectory, 'msi', id)), fs.readFileSync(xmlDecode(source)), id);
assert.equal(info.edition, product); assert.equal(info.version, version);
if (paid) {
  assert.notEqual(info.upgradeCode, '06765602-7035-4ED7-9DCB-80F02E0E5626');
  assert(!wxs.includes('Key="Software\\NZIP\\')); assert(!wxs.includes('Applications\\NZIP.exe'));
} else assert.equal(info.upgradeCode, '06765602-7035-4ED7-9DCB-80F02E0E5626');
assert(wxs.includes(`Key="Software\\${product}\\Installer"`)); assert(wxs.includes(`/x ${info.productCode}`));
const sha256 = filename => createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
const result = { ok: true, files: names.length, checks: ['ZIP bytes match build', 'MSI embedded payload bytes match build', 'no secret files or private PEMs', 'runtime configuration enables long paths at startup', 'edition install identity and previous-location key verified', 'uninstall points to this MSI product'], msiSha256: sha256('dist/' + stem + '-Setup-x64.msi'), zipSha256: sha256('dist/' + stem + '-win-x64.zip') };
fs.writeFileSync(path.join(resultDirectory, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify({ ...result, resultDirectory }, null, 2));
