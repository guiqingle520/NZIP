const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { crc32, deflateRawSync, zstdCompressSync } = require('node:zlib');
const executable = path.resolve(process.env.NZIP_NATIVE_EXE || `dist/NZIP-${require('../package.json').version}-win-x64/NZIP.exe`);
function rpc(operation, payload, cancel = false) {
  return new Promise((resolve, reject) => {
    const p = spawn(executable, ['--engine-rpc'], { windowsHide: true, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = ''; p.stdout.setEncoding('utf8'); p.stderr.setEncoding('utf8');
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
    p.on('error', reject); p.on('close', code => { try { const r = JSON.parse(out); if (!r.ok) { const e = new Error(r.error); e.code = r.code; reject(e); } else resolve(r.data); } catch (e) { reject(code ? new Error(`${code}: ${err}`) : e); } });
    p.stdin.end(JSON.stringify({ operation, payload, cancel }));
  });
}
let root, sources;
before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'nzip-native-tests-'));
  const folder = path.join(root, '中文 文件夹'); await fs.mkdir(path.join(folder, '子目录'), { recursive: true });
  await fs.writeFile(path.join(folder, '你好.txt'), '你好，NZIP！\n'.repeat(100));
  await fs.writeFile(path.join(folder, '子目录/data.json'), '{"app":"NZIP"}');
  await fs.writeFile(path.join(folder, '二进制.bin'), crypto.randomBytes(40000)); sources = [folder];
});
after(async () => fs.rm(root, { recursive: true, force: true }));
for (const format of ['zip', '7z', 'tar', 'wim', 'tar.gz', 'tar.bz2', 'tar.xz']) test(`native ${format}: Unicode round trip and integrity`, async () => {
  const archive = path.join(root, `roundtrip.${format}`);
  await rpc('create', { sources, destination: archive, format });
  const data = await rpc('list', { archive }); assert.equal(data.entries.filter(e => !e.isDirectory).length, 3);
  assert.ok(data.entries.some(e => e.path === '中文 文件夹/你好.txt')); await rpc('test', { archive });
  const destination = path.join(root, `out-${format}`); await rpc('extract', { archive, destination });
  assert.deepEqual(await fs.readFile(path.join(destination, '中文 文件夹/二进制.bin')), await fs.readFile(path.join(sources[0], '二进制.bin')));
});
for (const format of ['gz', 'bz2', 'xz']) test(`native ${format}: single file round trip and input constraints`, async () => {
  const input = path.join(root, '中文 文件夹', '二进制.bin'), archive = path.join(root, `single-${format}.` + format);
  await rpc('create', { sources: [input], destination: archive, format });
  const listed = await rpc('list', { archive }); assert.equal(listed.entries.length, 1); await rpc('test', { archive });
  const destination = path.join(root, `single-out-${format}`); await rpc('extract', { archive, destination });
  assert.deepEqual(await fs.readFile(path.join(destination, listed.entries[0].path)), await fs.readFile(input));
  const forbidden = path.join(root, `invalid-${format}.` + format);
  await assert.rejects(() => rpc('create', { sources, destination: forbidden, format }), /单个文件/);
  await assert.rejects(() => rpc('create', { sources: [input], destination: forbidden, format, password: 'secret' }), /密码/);
  await assert.rejects(() => rpc('create', { sources: [input], destination: forbidden, format, volume: '100k' }), /分卷/);
  await assert.rejects(() => fs.stat(forbidden), { code: 'ENOENT' });
});
for (const [format, alias] of [['tar.gz', 'tgz'], ['tar.bz2', 'tbz2'], ['tar.xz', 'txz']]) test(`native ${alias}: directory browsing, selected extraction, corrupt wrapper rollback`, async () => {
  const archive = path.join(root, `alias.${alias}`); await rpc('create', { sources, destination: archive, format: alias });
  const listed = await rpc('list', { archive }); assert.ok(listed.entries.some(e => e.path === '中文 文件夹/你好.txt'));
  const destination = path.join(root, `alias-out-${alias}`); await rpc('extract', { archive, destination, preallocate: true, selected: ['中文 文件夹/你好.txt'] });
  assert.deepEqual(await fs.readFile(path.join(destination, '中文 文件夹/你好.txt')), await fs.readFile(path.join(sources[0], '你好.txt')));
  await assert.rejects(() => fs.stat(path.join(destination, '中文 文件夹/二进制.bin')), { code: 'ENOENT' });
  const bytes = await fs.readFile(archive), corrupt = path.join(root, `corrupt.${alias}`), failedOut = path.join(root, `corrupt-out-${alias}`);
  await fs.writeFile(corrupt, bytes.subarray(0, Math.floor(bytes.length / 2)));
  await assert.rejects(() => rpc('extract', { archive: corrupt, destination: failedOut })); await assert.rejects(() => fs.stat(failedOut), { code: 'ENOENT' });
});
function uudecode(text) {
  const lines = text.split(/\r?\n/), output = []; let started = false;
  for (const line of lines) {
    if (line.startsWith('begin ')) { started = true; continue; }
    if (!started || line === 'end' || !line.length) continue;
    const size = (line.charCodeAt(0) - 32) & 63, bytes = [];
    for (let i = 1; bytes.length < size; i += 4) {
      const bits = [0, 1, 2, 3].map(j => (line.charCodeAt(i + j) - 32) & 63);
      bytes.push(bits[0] << 2 | bits[1] >> 4, (bits[1] << 4 | bits[2] >> 2) & 255, (bits[2] << 6 | bits[3]) & 255);
    }
    output.push(Buffer.from(bytes.slice(0, size)));
  }
  return Buffer.concat(output);
}
for (const fixture of ['rar3-lowdist', 'rar5-stored']) test(`native ${fixture}: real RAR fixture listing, integrity and extraction`, async () => {
  const archive = path.join(root, fixture + '.rar'); await fs.writeFile(archive, uudecode(await fs.readFile(path.join(__dirname, 'fixtures', fixture + '.rar.uu'), 'utf8')));
  const listed = await rpc('list', { archive }); assert.equal(listed.entries.length, 1); await rpc('test', { archive });
  const destination = path.join(root, fixture); await rpc('extract', { archive, destination });
  const contents = await fs.readFile(path.join(destination, listed.entries[0].path));
  if (fixture === 'rar5-stored') assert.equal(contents.toString(), 'hello libarchive test suite!\n');
  else { assert.ok(contents.length > 40); assert.deepEqual(contents.subarray(0, 40), Buffer.from([...Array(40).keys()])); }
});
test('native archive aliases and Zstandard / compressed TAR decoding', async () => {
  const text = 'extended container test 中文';
  for (const extension of ['jar', 'war', 'ear', 'apk', 'epub', 'cbz', 'msix']) {
    const archive = path.join(root, 'alias.' + extension); await fs.writeFile(archive, zipFile('hello.txt', text));
    const destination = path.join(root, 'alias-' + extension); await rpc('extract', { archive, destination }); assert.equal(await fs.readFile(path.join(destination, 'hello.txt'), 'utf8'), text);
  }
  const archive = path.join(root, 'hello.txt.zst'); await fs.writeFile(archive, zstdCompressSync(Buffer.from(text)));
  const listed = await rpc('list', { archive }); assert.equal(listed.entries[0].path, 'hello.txt'); await rpc('test', { archive });
  const destination = path.join(root, 'zst-out'); await rpc('extract', { archive, destination }); assert.equal(await fs.readFile(path.join(destination, 'hello.txt'), 'utf8'), text);
  const tar = path.join(root, 'roundtrip.tar'), tzst = path.join(root, 'compressed.tzst'); await fs.writeFile(tzst, zstdCompressSync(await fs.readFile(tar)));
  assert.ok((await rpc('list', { archive: tzst })).entries.some(e => e.path === '中文 文件夹/你好.txt'));
  const tarOut = path.join(root, 'tzst-out'); await rpc('extract', { archive: tzst, destination: tarOut }); assert.deepEqual(await fs.readFile(path.join(tarOut, '中文 文件夹/二进制.bin')), await fs.readFile(path.join(sources[0], '二进制.bin')));
});
test('native wrapped TAR rejects unsafe contents and cancels without committed output', async () => {
  const archive = path.join(root, 'unsafe-wrapper.tar.gz'); await rpc('create', { sources: [path.join(sources[0], '你好.txt')], destination: archive, format: 'gz' });
  await assert.rejects(() => rpc('extract', { archive, destination: path.join(root, 'unsafe-wrapper-out') }));
  await assert.rejects(() => fs.stat(path.join(root, 'unsafe-wrapper-out')), { code: 'ENOENT' });
  const data = Buffer.from('must not escape'), header = Buffer.alloc(512);
  header.write('../escaped.txt'); header.write('0000644\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116); header.write(data.length.toString(8).padStart(11, '0') + '\0', 124); header.write('00000000000\0', 136); header.fill(32, 148, 156); header[156] = 48; header.write('ustar\0', 257); header.write('00', 263);
  const sum = [...header].reduce((a, b) => a + b, 0); header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  const unsafeTar = path.join(root, 'unsafe-content.tar'); await fs.writeFile(unsafeTar, Buffer.concat([header, data, Buffer.alloc(512 - data.length + 1024)]));
  const unsafeGzip = path.join(root, 'unsafe-content.tar.gz'); await rpc('create', { sources: [unsafeTar], destination: unsafeGzip, format: 'gz' });
  await assert.rejects(() => rpc('extract', { archive: unsafeGzip, destination: path.join(root, 'traversal-out') }), e => e.code === 'UNSAFE_PATH'); await assert.rejects(() => fs.stat(path.join(root, 'escaped.txt')), { code: 'ENOENT' });
  const rar = path.join(root, 'link.rar'); await fs.writeFile(rar, uudecode(await fs.readFile(path.join(__dirname, 'fixtures/rar4.rar.uu'), 'utf8')));
  await assert.rejects(() => rpc('extract', { archive: rar, destination: path.join(root, 'link-out') }), e => e.code === 'UNSAFE_PATH');
  const cancelPath = path.join(root, 'cancelled.tar.xz'); await assert.rejects(() => rpc('create', { sources, destination: cancelPath, format: 'tar.xz' }, true), e => e.code === 'CANCELLED');
  await assert.rejects(() => fs.stat(cancelPath), { code: 'ENOENT' }); assert.ok(!(await fs.readdir(root)).some(n => n.startsWith('.nzip-')));
});
for (const format of ['zip', '7z']) test(`native ${format}: AES passwords`, async () => {
  const archive = path.join(root, `encrypted.${format}`), password = format === '7z' ? '中文 password !@#$' : 'password !@#$';
  await rpc('create', { sources, destination: archive, format, password });
  await assert.rejects(() => rpc('test', { archive, password: 'wrong' })); await rpc('test', { archive, password });
  await rpc('extract', { archive, password, destination: path.join(root, `encrypted-out-${format}`) });
  if (format === '7z') await assert.rejects(() => rpc('list', { archive }), e => e.code === 'PASSWORD_REQUIRED');
});
test('native selection and overwrite protection', async () => {
  const archive = path.join(root, 'roundtrip.zip'), destination = path.join(root, 'selected');
  await rpc('extract', { archive, destination, selected: ['中文 文件夹/子目录/data.json'] });
  assert.equal(JSON.parse(await fs.readFile(path.join(destination, '中文 文件夹/子目录/data.json'), 'utf8')).app, 'NZIP');
  await assert.rejects(() => fs.stat(path.join(destination, '中文 文件夹/你好.txt')), { code: 'ENOENT' });
  await assert.rejects(() => rpc('extract', { archive, destination }), e => e.code === 'DEST_EXISTS');
  const original = await fs.readFile(archive); await assert.rejects(() => rpc('create', { sources, destination: archive })); assert.deepEqual(await fs.readFile(archive), original);
});
test('native volume reassembly', async () => {
  const input = path.join(root, 'volume.bin'); await fs.writeFile(input, crypto.randomBytes(350000));
  const r = await rpc('create', { sources: [input], destination: path.join(root, 'split.7z'), format: '7z', volume: '100k' });
  assert.equal(r.outputs.length, 4); await rpc('test', { archive: r.path });
  const destination = path.join(root, 'split-out'); await rpc('extract', { archive: r.path, destination }); assert.deepEqual(await fs.readFile(path.join(destination, 'volume.bin')), await fs.readFile(input));
});
test('native transactional archive edits', async () => {
  const archive = path.join(root, 'modify.zip'); await rpc('create', { sources, destination: archive });
  const file = path.join(root, 'extra.txt'); await fs.writeFile(file, 'extra');
  await rpc('modify', { archive, action: 'add', sources: [file] }); assert.ok((await rpc('list', { archive })).entries.some(e => e.path === 'extra.txt'));
  await rpc('modify', { archive, action: 'add', sources: [file], folder: '中文 文件夹/子目录/' }); assert.ok((await rpc('list', { archive })).entries.some(e => e.path === '中文 文件夹/子目录/extra.txt'));
  await rpc('modify', { archive, action: 'delete', selected: ['extra.txt'] }); assert.ok(!(await rpc('list', { archive })).entries.some(e => e.path === 'extra.txt'));
  const original = await fs.readFile(archive); await assert.rejects(() => rpc('modify', { archive, action: 'delete', selected: ['missing.txt'] })); assert.deepEqual(await fs.readFile(archive), original);
});
for (const format of ['zip', '7z']) test(`native ${format}: transactional file and folder rename`, async () => {
  const archive = path.join(root, `rename.${format}`); await rpc('create', { sources, destination: archive, format });
  await rpc('modify', { archive, action: 'rename', oldName: '中文 文件夹/你好.txt', newName: '重命名.txt' });
  assert.ok((await rpc('list', { archive })).entries.some(e => e.path === '中文 文件夹/重命名.txt'));
  await rpc('modify', { archive, action: 'rename', oldName: '中文 文件夹', newName: '新 文件夹' });
  assert.ok((await rpc('list', { archive })).entries.some(e => e.path === '新 文件夹/子目录/data.json'));
  const original = await fs.readFile(archive);
  for (const newName of ['../escape.txt', 'CON', '二进制.bin']) await assert.rejects(() => rpc('modify', { archive, action: 'rename', oldName: '新 文件夹/重命名.txt', newName }));
  await assert.rejects(() => rpc('modify', { archive, action: 'rename', oldName: '新 文件夹', newName: '取消' }, true));
  assert.deepEqual(await fs.readFile(archive), original);
  const destination = path.join(root, `rename-out-${format}`); await rpc('extract', { archive, destination });
  assert.deepEqual(await fs.readFile(path.join(destination, '新 文件夹/重命名.txt')), await fs.readFile(path.join(sources[0], '你好.txt')));
});
test('native ZIP code page is consistent for list, selected extraction and integrity', async () => {
  const archive = path.join(root, 'legacy-gbk.zip'); await fs.writeFile(archive, zipFile(Buffer.from('d6d0cec42e747874', 'hex'), 'GBK filename test'));
  const data = await rpc('list', { archive, codePage: 936 }); assert.equal(data.entries[0].path, '中文.txt');
  assert.notEqual((await rpc('list', { archive, codePage: 437 })).entries[0].path, '中文.txt');
  await rpc('test', { archive, codePage: 936 });
  const destination = path.join(root, 'gbk-out'); await rpc('extract', { archive, codePage: 936, selected: ['中文.txt'], destination });
  assert.equal(await fs.readFile(path.join(destination, '中文.txt'), 'utf8'), 'GBK filename test');
  await assert.rejects(() => rpc('list', { archive, codePage: -1 }));
  await assert.rejects(() => rpc('modify', { archive, codePage: 936, action: 'delete', selected: ['中文.txt'] }));
});
test('native AMSI scanner reports real provider result or explicit unavailability', async t => {
  const file = path.join(root, 'scan-safe.txt'), archive = path.join(root, 'scan.zip'); await fs.writeFile(file, 'NZIP benign scan test');
  await rpc('create', { sources: [file], destination: archive });
  try { const result = await rpc('scan', { archive }); assert.equal(result.files, 1); assert.match(result.message, /系统杀毒引擎未报告威胁/); }
  catch (error) { assert.equal(error.code, 'SCAN_UNAVAILABLE'); t.diagnostic('AMSI provider unavailable: ' + error.message); }
});
test('native cancellation and damaged archive cleanup', async () => {
  const destination = path.join(root, 'cancelled.7z'); await assert.rejects(() => rpc('create', { sources, destination, format: '7z' }, true), e => e.code === 'CANCELLED');
  await assert.rejects(() => fs.stat(destination), { code: 'ENOENT' });
  const archive = path.join(root, 'broken.zip'); await fs.writeFile(archive, 'broken');
  await assert.rejects(() => rpc('extract', { archive, destination: path.join(root, 'broken-out') }));
  assert.ok(!(await fs.readdir(root)).some(n => n.startsWith('.nzip-')));
});
for (const format of ['zip', '7z', 'tar.xz']) test(`native ${format}: long Unicode paths round trip with preallocation on and off`, async () => {
  const source = path.join(root, `long-source-${format}`);
  const relative = path.join(...Array.from({ length: 10 }, (_, i) => `第${i}层-abcdefghijklmnopqrstuv`), 'TableCleanupJob.java');
  assert.ok(relative.length > 260);
  const input = path.join(source, relative), contents = 'NZIP long path regression 中文\r\n'.repeat(40);
  await fs.mkdir(path.dirname(input), { recursive: true }); await fs.writeFile(input, contents);
  const archive = path.join(root, `long-path.${format}`); await rpc('create', { sources: [source], destination: archive, format });
  const listed = await rpc('list', { archive }), selected = path.basename(source) + '/' + relative.replaceAll('\\', '/');
  assert.ok(listed.entries.some(e => e.path === selected)); await rpc('test', { archive });
  for (const preallocate of [false, true]) {
    const destination = path.join(root, `long-out-${format}-${preallocate}`);
    await rpc('extract', { archive, destination, selected: [selected], preallocate });
    assert.equal(await fs.readFile(path.join(destination, selected), 'utf8'), contents);
  }
});
test('native long destination and archive paths preserve rollback on CRC failure', async () => {
  const parent = path.join(root, ...Array.from({ length: 9 }, (_, i) => `目标目录${i}-abcdefghijklmnopqrstu`));
  assert.ok(parent.length > 260); await fs.mkdir(parent, { recursive: true });
  const archive = path.join(parent, 'archive.zip'), relative = Array.from({ length: 10 }, (_, i) => `source-${i}-abcdefghijklmnopqrstu`).join('/') + '/hello.txt';
  const valid = zipFile(relative, 'long destination payload'); await fs.writeFile(archive, valid);
  const destination = path.join(parent, 'extracted'); await rpc('extract', { archive, destination, preallocate: true });
  assert.equal(await fs.readFile(path.join(destination, relative), 'utf8'), 'long destination payload');
  const broken = Buffer.from(valid), badCrc = (broken.readUInt32LE(14) ^ 1) >>> 0;
  broken.writeUInt32LE(badCrc, 14); broken.writeUInt32LE(badCrc, broken.indexOf(Buffer.from('504b0102', 'hex')) + 16);
  const corrupt = path.join(parent, 'corrupt.zip'), failed = path.join(parent, 'failed'); await fs.writeFile(corrupt, broken);
  await assert.rejects(() => rpc('extract', { archive: corrupt, destination: failed, preallocate: true }));
  await assert.rejects(() => fs.stat(failed), { code: 'ENOENT' });
  assert.ok(!(await fs.readdir(parent)).some(name => name.startsWith('.nzip-extract-')));
});
test('native writeback supports implicit parent directories without adding sibling files', async () => {
  const entry = 'implicit/subfolder/File.java', archive = path.join(root, 'implicit-edit.zip'), edited = path.join(root, 'implicit-edited.java');
  await fs.writeFile(archive, zipFile(entry, 'original')); await fs.writeFile(edited, 'edited');
  await rpc('writeback', { archive, entry, source: edited, originalHash: crypto.createHash('sha256').update('original').digest('hex') });
  const listed = await rpc('list', { archive }); assert.deepEqual(listed.entries.filter(e => !e.isDirectory).map(e => e.path), [entry]);
  const out = path.join(root, 'implicit-edited-out'); await rpc('extract', { archive, destination: out }); assert.equal(await fs.readFile(path.join(out, entry), 'utf8'), 'edited');
});
test('native rejects unsafe archive and output inside source', async () => {
  const archive = path.join(root, 'unsafe.zip'); await fs.writeFile(archive, zipFile('../escaped.txt', 'unsafe'));
  await assert.rejects(() => rpc('extract', { archive, destination: path.join(root, 'unsafe-out') }), e => e.code === 'UNSAFE_PATH');
  await assert.rejects(() => fs.stat(path.join(root, 'escaped.txt')), { code: 'ENOENT' });
  await assert.rejects(() => rpc('create', { sources, destination: path.join(sources[0], 'self.zip') }));
  await assert.rejects(() => rpc('create', { sources, destination: path.join(root, 'unicode.zip'), password: '中文密码' }), /中文密码请选择 7Z/);
});
function zipFile(name, text) {
  const filename = Buffer.from(name), data = Buffer.from(text), compressed = deflateRawSync(data), crc = crc32(data);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(Buffer.isBuffer(name) ? 0 : 0x800, 6); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(Buffer.isBuffer(name) ? 0 : 0x800, 8); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(filename.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + filename.length, 12); end.writeUInt32LE(local.length + filename.length + compressed.length, 16);
  return Buffer.concat([local, filename, compressed, central, filename, end]);
}
