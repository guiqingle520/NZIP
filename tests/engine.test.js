const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { deflateRawSync, crc32 } = require('node:zlib');
const { createEngine, safeEntry, parseList } = require('../src/engine');
const { menuEntries, launchRequest } = require('../src/integration');
const engine = createEngine(path.resolve('vendor/7zip/7z.exe'));
let root, sources;
before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'nzip-tests-'));
  const folder = path.join(root, '中文 文件夹');
  await fs.mkdir(path.join(folder, '子目录'), { recursive: true });
  await fs.writeFile(path.join(folder, '你好.txt'), '你好，NZIP！\n'.repeat(100));
  await fs.writeFile(path.join(folder, '子目录', 'data.json'), JSON.stringify({ app: 'NZIP', ok: true }));
  await fs.writeFile(path.join(folder, '二进制.bin'), crypto.randomBytes(1024 * 40));
  sources = [folder];
});
after(async () => { await fs.rm(root, { recursive: true, force: true }); });
for (const format of ['zip', '7z', 'tar']) test(`${format}: Unicode round trip and integrity`, async () => {
  const destination = path.join(root, `roundtrip.${format}`);
  const created = await engine.create({ sources, destination, format });
  assert.equal(created.path, destination);
  const listed = await engine.list(destination);
  assert.ok(listed.entries.some(e => e.path === '中文 文件夹/你好.txt'));
  assert.equal(listed.entries.filter(e => !e.isDirectory).length, 3);
  await engine.test(destination);
  const output = path.join(root, `out-${format}`);
  await engine.extract({ archive: destination, destination: output });
  assert.deepEqual(await fs.readFile(path.join(output, '中文 文件夹/二进制.bin')), await fs.readFile(path.join(sources[0], '二进制.bin')));
  assert.equal(await fs.readFile(path.join(output, '中文 文件夹/你好.txt'), 'utf8'), '你好，NZIP！\n'.repeat(100));
});
for (const format of ['zip', '7z']) test(`${format}: AES password handling`, async () => {
  const archive = path.join(root, `encrypted.${format}`);
  const password = format === '7z' ? '中文 password !@#$' : 'password !@#$';
  await engine.create({ sources, destination: archive, format, password });
  await assert.rejects(() => engine.test(archive, { password: 'wrong' }), e => e.code === 'PASSWORD_REQUIRED' || e.code === 'ENGINE_ERROR');
  await engine.test(archive, { password });
  await engine.extract({ archive, password, destination: path.join(root, `encrypted-out-${format}`) });
  if (format === '7z') await assert.rejects(() => engine.list(archive), e => e.code === 'PASSWORD_REQUIRED');
});
test('selected extraction leaves other files behind', async () => {
  const archive = path.join(root, 'roundtrip.zip'), destination = path.join(root, 'selected');
  await engine.extract({ archive, destination, selected: ['中文 文件夹/子目录/data.json'] });
  assert.equal(JSON.parse(await fs.readFile(path.join(destination, '中文 文件夹/子目录/data.json'), 'utf8')).app, 'NZIP');
  await assert.rejects(() => fs.stat(path.join(destination, '中文 文件夹/你好.txt')), { code: 'ENOENT' });
});
test('ZIP gives an actionable error for non-ASCII passwords', async () => {
  await assert.rejects(() => engine.create({ sources, destination: path.join(root, 'unicode-password.zip'), password: '中文密码' }), /中文密码请选择 7Z/);
});
test('existing archive and extraction directory are never overwritten', async () => {
  const destination = path.join(root, 'roundtrip.zip');
  const before = await fs.readFile(destination);
  await assert.rejects(() => engine.create({ sources, destination }), /同名/);
  assert.deepEqual(await fs.readFile(destination), before);
  const output = path.join(root, 'existing'); await fs.mkdir(output); await fs.writeFile(path.join(output, 'keep.txt'), 'keep');
  await assert.rejects(() => engine.extract({ archive: destination, destination: output }), e => e.code === 'DEST_EXISTS');
  assert.equal(await fs.readFile(path.join(output, 'keep.txt'), 'utf8'), 'keep');
});
test('multi-volume archive reassembles and extracts', async () => {
  const input = path.join(root, 'volume.bin'); await fs.writeFile(input, crypto.randomBytes(350000));
  const result = await engine.create({ sources: [input], destination: path.join(root, 'split.7z'), format: '7z', volume: '100k' });
  assert.equal(result.outputs.length, 4);
  await engine.test(result.path);
  await engine.extract({ archive: result.path, destination: path.join(root, 'split-out') });
  assert.deepEqual(await fs.readFile(path.join(root, 'split-out/volume.bin')), await fs.readFile(input));
});
test('archive modifications are verified before replacing original', async () => {
  const archive = path.join(root, 'modify.zip'); await engine.create({ sources, destination: archive });
  const extra = path.join(root, 'extra.txt'); await fs.writeFile(extra, 'extra');
  await engine.modify({ archive, action: 'add', sources: [extra] });
  assert.ok((await engine.list(archive)).entries.some(e => e.path === 'extra.txt'));
  await engine.modify({ archive, action: 'delete', selected: ['extra.txt'] });
  assert.ok(!(await engine.list(archive)).entries.some(e => e.path === 'extra.txt'));
  const before = await fs.readFile(archive);
  await assert.rejects(() => engine.modify({ archive, action: 'delete', selected: ['not-found.txt'] }));
  assert.deepEqual(await fs.readFile(archive), before);
});
test('cancelled operation publishes no partial archive and cleans staging', async () => {
  const input = path.join(root, 'large.bin'); await fs.writeFile(input, crypto.randomBytes(12 * 1024 * 1024));
  const destination = path.join(root, 'cancelled.7z');
  const controller = new AbortController();
  const task = engine.create({ sources: [input], destination, format: '7z', level: 9 }, { signal: controller.signal });
  const timer = setTimeout(() => controller.abort(), 40);
  await assert.rejects(() => task, e => e.code === 'CANCELLED'); clearTimeout(timer);
  await assert.rejects(() => fs.stat(destination), { code: 'ENOENT' });
  assert.ok(!(await fs.readdir(root)).some(n => n.startsWith('.nzip-')));
});
test('corrupt archive fails without exposing an output folder', async () => {
  const archive = path.join(root, 'broken.zip'); await fs.writeFile(archive, 'not a zip');
  const destination = path.join(root, 'broken-out');
  await assert.rejects(() => engine.extract({ archive, destination }));
  await assert.rejects(() => fs.stat(destination), { code: 'ENOENT' });
});
test('rejects path traversal, Windows ADS, devices and malicious ZIP', async () => {
  for (const name of ['../escape', 'a/../../escape', '/absolute', 'C:\\escape', 'a:b', 'folder/CON.txt', 'NUL', 'trailing.', './alias', 'a/./alias', 'wild*.txt']) assert.throws(() => safeEntry(name));
  assert.equal(safeEntry('中文 文件夹/安全.txt'), '中文 文件夹/安全.txt');
  const archive = path.join(root, 'traversal.zip');
  await fs.writeFile(archive, zipFile('../escaped.txt', 'unsafe'));
  await assert.rejects(() => engine.extract({ archive, destination: path.join(root, 'unsafe-out') }), e => e.code === 'UNSAFE_PATH');
  await assert.rejects(() => fs.stat(path.join(root, 'escaped.txt')), { code: 'ENOENT' });
});
test('rejects links and case-colliding names in technical listing', () => {
  assert.throws(() => parseList('Type = tar\n----------\nPath = link\nSymbolic Link = ../escape\n'), e => e.code === 'UNSAFE_PATH');
  assert.throws(() => parseList('Type = zip\n----------\nPath = Name.txt\nSize = 1\n\nPath = name.txt\nSize = 2\n'), e => e.code === 'UNSAFE_PATH');
});
test('rejects archive inside its own input directory', async () => {
  await assert.rejects(() => engine.create({ sources, destination: path.join(sources[0], 'self.zip') }), /输出压缩包/);
});
test('Explorer menu commands quote paths and only target NZIP user keys', () => {
  const entries = menuEntries('C:\\Program Files\\NZIP\\NZIP.exe');
  assert.ok(entries.every(e => e.key.startsWith('HKCU\\Software\\Classes\\') && /\\NZIP\.(Compress|Open|Extract)$/.test(e.key)));
  assert.ok(entries.every(e => e.command.startsWith('"C:\\Program Files\\NZIP\\NZIP.exe" --') && e.command.endsWith('"%1"')));
  assert.deepEqual(launchRequest(['NZIP.exe', '--compress', 'D:\\中文 文件夹']), { type: 'compress', path: 'D:\\中文 文件夹' });
  assert.deepEqual(launchRequest(['NZIP.exe', '--extract', 'D:\\a.zip']), { type: 'extract', path: 'D:\\a.zip' });
  assert.equal(launchRequest(['electron.exe', '.']), null);
});
function zipFile(name, text) {
  const filename = Buffer.from(name), data = Buffer.from(text), compressed = deflateRawSync(data), crc = crc32(data);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(filename.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + filename.length, 12); end.writeUInt32LE(local.length + filename.length + compressed.length, 16);
  return Buffer.concat([local, filename, compressed, central, filename, end]);
}
