import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const work = path.resolve(process.argv[2]), executable = path.resolve('dist/NZIPPaidPreview-0.8.0-win-x64/NZIPPaidPreview.exe');
const cache = path.join(process.env.LOCALAPPDATA, 'NZIP Paid Preview', 'License', 'license.dat');
if (fs.existsSync(cache)) throw Error('Existing preview license found; refusing to overwrite a user license');
const resultDirectory = path.join(work, 'paid-integration-' + randomUUID()); fs.mkdirSync(resultDirectory);
const fixture = JSON.parse(fs.readFileSync(path.join(work, 'fixture.json')));
function invoke(args, input) {
  const child = spawnSync(executable, args, { encoding: 'utf8', input: input && JSON.stringify(input), timeout: 30000, windowsHide: true, env: { ...process.env, NZIP_TEST_MODE: '1', NZIP_USER_DATA: path.join(resultDirectory, 'unrelated-profile') } });
  if (child.error) throw child.error;
  return JSON.parse(child.stdout);
}
const rpc = (operation, payload) => invoke(['--engine-rpc'], { operation, payload });
let createdCache = false, checks = [];
try {
  assert.equal(invoke(['--license-status']).license.active, false);
  for (const operation of ['create', 'extract', 'modify', 'test', 'scan', 'comment', 'repair', 'recover', 'writeback', 'sfx']) {
    const result = rpc(operation, {}); assert.equal(result.ok, false, operation); assert.equal(result.code, 'LICENSE_REQUIRED', operation);
  }
  checks.push('All ten paid RPC entry points reject unactivated client, including test-mode environment');
  const source = path.join(resultDirectory, '素材'); fs.mkdirSync(source); fs.writeFileSync(path.join(source, '你好.txt'), 'NZIP licensed offline round-trip');
  const zip = path.join(resultDirectory, 'test.zip');
  const engine = spawnSync(path.resolve('vendor/7zip/7z.exe'), ['a', zip, source], { windowsHide: true, encoding: 'utf8' }); assert.equal(engine.status, 0);
  assert.equal(rpc('list', { archive: zip }).ok, true);
  const tar = path.join(resultDirectory, 'test.tar'), compound = tar + '.xz';
  assert.equal(spawnSync(path.resolve('vendor/7zip/7z.exe'), ['a', '-ttar', tar, source], { windowsHide: true }).status, 0);
  assert.equal(spawnSync(path.resolve('vendor/7zip/7z.exe'), ['a', '-txz', compound, tar], { windowsHide: true }).status, 0);
  assert.equal(rpc('list', { archive: compound }).ok, true);
  checks.push('Unactivated client browses ZIP and compressed TAR without a paid extraction gate');
  assert.equal(invoke(['--license-import', path.join(work, 'this-machine.nziplicense')]).ok, true); createdCache = true;
  assert.equal(invoke(['--license-status']).license.active, true);
  const paidZip = path.join(resultDirectory, 'paid.zip'), destination = path.join(resultDirectory, 'extracted');
  assert.equal(rpc('create', { sources: [source], destination: paidZip }).ok, true);
  assert.equal(rpc('test', { archive: paidZip }).ok, true);
  const result = rpc('extract', { archive: paidZip, destination }); assert.equal(result.ok, true);
  assert.equal(fs.readFileSync(path.join(destination, '素材/你好.txt'), 'utf8'), 'NZIP licensed offline round-trip');
  checks.push('Actual packaged paid EXE imports a signed certificate and compresses/tests/extracts offline across separate processes');
  const invalid = path.join(work, 'bad-device.nziplicense'); fs.writeFileSync(invalid, fixture.wrongDevice);
  assert.equal(invoke(['--license-import', invalid]).ok, false); assert.equal(invoke(['--license-status']).license.active, true);
  checks.push('Wrong-device import fails and leaves good current-user DPAPI cache usable');
  fs.writeFileSync(path.join(resultDirectory, 'result.json'), JSON.stringify({ ok: true, checks }, null, 2));
  console.log(JSON.stringify({ ok: true, checks }, null, 2));
} catch (error) {
  throw error;
} finally {
  if (createdCache && !process.argv.includes('--keep-license')) fs.unlinkSync(cache);
}
