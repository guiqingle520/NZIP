const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const executable = path.resolve(process.env.NZIP_NATIVE_EXE || `dist/NZIP-${require('../package.json').version}-win-x64/NZIP.exe`);
function rpc(operation, payload, cancel = false) {
  return new Promise((resolve, reject) => {
    const p = spawn(executable, ['--engine-rpc'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); let out = '', err = '';
    p.stdout.setEncoding('utf8'); p.stderr.setEncoding('utf8'); p.stdout.on('data', s => out += s); p.stderr.on('data', s => err += s); p.on('error', reject);
    p.on('close', code => { try { const r = JSON.parse(out); if (!r.ok) throw Object.assign(new Error(r.error), { code: r.code }); resolve(r.data); } catch (e) { reject(code ? new Error(err || `Exit ${code}`) : e); } });
    p.stdin.end(JSON.stringify({ operation, payload, cancel }));
  });
}
let root, sources;
before(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'nzip-tools-')); sources = [path.join(root, '你好.txt'), path.join(root, 'other.txt')]; await fs.writeFile(sources[0], '你好'.repeat(200)); await fs.writeFile(sources[1], 'intact other file'); });
after(async () => fs.rm(root, { recursive: true, force: true }));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
for (const suffix of ['zip', 'zipx']) test(`${suffix} edited file writeback preserves siblings, comment and original entry path`, async () => {
  const input = path.join(root, `edit-${suffix}`), target = path.join(input, '子目录', '你好.txt');
  await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, '原文'.repeat(100)); await fs.writeFile(path.join(input, 'other.txt'), 'untouched sibling');
  const archive = path.join(root, `edit.${suffix}`); await rpc('create', { sources: [input], destination: archive, format: 'zip' });
  const entry = path.basename(input) + '/子目录/你好.txt'; await rpc('comment', { archive: suffix === 'zip' ? archive : await copyZipAlias(archive), comment: '保留 ZIP 注释' });
  // ZIPX uses the same ZIP container; keep the commented alias for that test.
  if (suffix === 'zipx') await fs.copyFile(archive + '.zip', archive);
  const edited = path.join(root, `edited-${suffix}.txt`), original = await fs.readFile(target), stat = await fs.stat(target);
  await fs.writeFile(edited, '新文'.repeat(100)); await fs.utimes(edited, stat.atime, stat.mtime);
  await rpc('writeback', { archive, entry, source: edited, originalHash: digest(original) });
  const output = path.join(root, `writeback-${suffix}`); await rpc('extract', { archive, destination: output });
  assert.equal(await fs.readFile(path.join(output, entry), 'utf8'), '新文'.repeat(100));
  assert.equal(await fs.readFile(path.join(output, path.basename(input), 'other.txt'), 'utf8'), 'untouched sibling');
  assert.equal((await rpc('read-comment', { archive })).comment, '保留 ZIP 注释');
  assert.equal(await fs.readFile(edited, 'utf8'), '新文'.repeat(100));
});
async function copyZipAlias(archive) { const alias = archive + '.zip'; await fs.copyFile(archive, alias); return alias; }
test('edited file conflict, invalid input and cancellation leave archive and edited copy unchanged', async () => {
  const archive = path.join(root, 'conflict.zip'), edited = path.join(root, 'changed.txt'); await rpc('create', { sources, destination: archive });
  const originalHash = digest(await fs.readFile(sources[0])); await fs.writeFile(edited, 'first edit');
  const payload = { archive, entry: path.basename(sources[0]), source: edited, originalHash };
  await rpc('writeback', payload); const before = await fs.readFile(archive); await fs.writeFile(edited, 'second stale edit');
  await assert.rejects(() => rpc('writeback', payload), e => e.code === 'EDIT_CONFLICT');
  await assert.rejects(() => rpc('writeback', { ...payload, entry: '../escaped.txt' }), e => e.code === 'UNSAFE_PATH');
  await assert.rejects(() => rpc('writeback', { ...payload, originalHash: 'invalid' }));
  await assert.rejects(() => rpc('writeback', payload, true), e => e.code === 'CANCELLED');
  assert.deepEqual(await fs.readFile(archive), before); assert.equal(await fs.readFile(edited, 'utf8'), 'second stale edit');
  assert.ok(!(await fs.readdir(root)).some(name => name.startsWith('.nzip-writeback-')));
});
test('independent editor sessions merge different entries without losing earlier edits', async () => {
  const archive = path.join(root, 'merge-edits.zip'); await rpc('create', { sources, destination: archive });
  for (let i = 0; i < sources.length; i++) {
    const edited = path.join(root, `session-${i}.txt`); await fs.writeFile(edited, `edited session ${i}`);
    await rpc('writeback', { archive, entry: path.basename(sources[i]), source: edited, originalHash: digest(await fs.readFile(sources[i])) });
  }
  const out = path.join(root, 'merge-edits-out'); await rpc('extract', { archive, destination: out });
  for (let i = 0; i < sources.length; i++) assert.equal(await fs.readFile(path.join(out, path.basename(sources[i])), 'utf8'), `edited session ${i}`);
});
test('encrypted ZIP writeback keeps target and sibling encryption', async () => {
  const archive = path.join(root, 'encrypted-edit.zip'), password = 'edit-password'; await rpc('create', { sources, destination: archive, password });
  const edited = path.join(root, 'encrypted-edit.txt'); await fs.writeFile(edited, 'encrypted changed text');
  await rpc('writeback', { archive, entry: path.basename(sources[0]), source: edited, originalHash: digest(await fs.readFile(sources[0])), password });
  assert.ok((await rpc('list', { archive, password })).entries.every(e => e.encrypted));
  const out = path.join(root, 'encrypted-edited-out'); await rpc('extract', { archive, password, destination: out });
  assert.equal(await fs.readFile(path.join(out, path.basename(sources[0])), 'utf8'), 'encrypted changed text');
  assert.deepEqual(await fs.readFile(path.join(out, path.basename(sources[1]))), await fs.readFile(sources[1]));
});
test('LZMA-compressed ZIPX writeback preserves an advanced-compression sibling', async () => {
  const archive = path.join(root, 'advanced.zipx'), directory = path.join(root, 'advanced-input'); await fs.mkdir(directory);
  const advancedSources = [path.join(directory, 'target.txt'), path.join(directory, 'sibling.txt')];
  await fs.writeFile(advancedSources[0], 'advanced target 中文 '.repeat(5000)); await fs.writeFile(advancedSources[1], 'advanced unchanged sibling '.repeat(5000));
  const created = spawnSync(process.env.NZIP_7Z_PATH || path.resolve('vendor/7zip/7z.exe'), ['a', '-tzip', '-mm=LZMA', archive, ...advancedSources], { windowsHide: true, encoding: 'utf8' });
  assert.ifError(created.error); assert.equal(created.status, 0, created.stderr);
  assert.ok((await rpc('list', { archive })).entries.every(e => e.method.includes('LZMA')));
  const edited = path.join(root, 'advanced-edited.txt'); await fs.writeFile(edited, 'updated advanced ZIPX');
  await rpc('writeback', { archive, entry: path.basename(advancedSources[0]), source: edited, originalHash: digest(await fs.readFile(advancedSources[0])) });
  const sibling = (await rpc('list', { archive })).entries.find(e => e.path === path.basename(advancedSources[1])); assert.ok(sibling.method.includes('LZMA'));
  const out = path.join(root, 'advanced-edited-out'); await rpc('extract', { archive, destination: out });
  assert.equal(await fs.readFile(path.join(out, path.basename(advancedSources[0])), 'utf8'), 'updated advanced ZIPX');
  assert.deepEqual(await fs.readFile(path.join(out, path.basename(advancedSources[1]))), await fs.readFile(advancedSources[1]));
});
test('7Z does not offer the ZIP-only editing writeback protocol', async () => {
  const archive = path.join(root, 'not-editable.7z'); await rpc('create', { sources, destination: archive, format: '7z' }); const before = await fs.readFile(archive);
  const originalHash = digest(await fs.readFile(sources[0]));
  await assert.rejects(() => rpc('writeback', { archive, entry: path.basename(sources[0]), source: sources[0], originalHash }), e => e.code === 'EDIT_UNSUPPORTED');
  assert.deepEqual(await fs.readFile(archive), before);
});
test('ZIP comments are transactional, Unicode and preserve contents', async () => {
  const archive = path.join(root, 'comment.zip'); await rpc('create', { sources, destination: archive });
  await rpc('comment', { archive, comment: '中文注释\r\n第二行' }); assert.equal((await rpc('read-comment', { archive })).comment, '中文注释\r\n第二行'); await rpc('test', { archive });
  const before = await fs.readFile(archive); await assert.rejects(() => rpc('comment', { archive, comment: 'x'.repeat(65536) })); assert.deepEqual(await fs.readFile(archive), before);
  await assert.rejects(() => rpc('comment', { archive, comment: 'cancelled' }, true), e => e.code === 'CANCELLED'); assert.deepEqual(await fs.readFile(archive), before);
  await rpc('comment', { archive, comment: '' }); assert.equal((await rpc('read-comment', { archive })).comment, '');
});
test('ZIP recovery rebuilds a missing central directory and leaves original unchanged', async () => {
  const archive = path.join(root, 'repair-source.zip'); await rpc('create', { sources, destination: archive });
  const bytes = await fs.readFile(archive); const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 1, 2])); assert.ok(central > 0);
  const broken = path.join(root, 'broken.zip'); await fs.writeFile(broken, bytes.subarray(0, central)); const original = await fs.readFile(broken);
  const destination = path.join(root, 'repaired.zip'); const result = await rpc('repair', { archive: broken, destination }); assert.equal(result.recovered, 2); await rpc('test', { archive: destination });
  const out = path.join(root, 'repaired-out'); await rpc('extract', { archive: destination, destination: out }); for (const source of sources) assert.deepEqual(await fs.readFile(path.join(out, path.basename(source))), await fs.readFile(source)); assert.deepEqual(await fs.readFile(broken), original);
  await assert.rejects(() => rpc('repair', { archive: broken, destination })); assert.deepEqual(await fs.readFile(broken), original);
  const cancelled = path.join(root, 'cancelled-repair.zip'); await assert.rejects(() => rpc('repair', { archive: broken, destination: cancelled }, true), e => e.code === 'CANCELLED'); await assert.rejects(() => fs.stat(cancelled), { code: 'ENOENT' });
});
test('ZIP recovery skips corrupt data and reports incomplete recovery', async () => {
  const archive = path.join(root, 'partial.zip'); await rpc('create', { sources, destination: archive }); const bytes = await fs.readFile(archive);
  const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 1, 2])); const broken = Buffer.from(bytes.subarray(0, central)); const data = 30 + broken.readUInt16LE(26) + broken.readUInt16LE(28); broken[data] ^= 0xff;
  const file = path.join(root, 'partial-broken.zip'); await fs.writeFile(file, broken); const result = await rpc('repair', { archive: file, destination: path.join(root, 'partial-repaired.zip') }); assert.equal(result.recovered, 1); assert.ok(result.skipped >= 1);
});
test('preallocated selected extraction preserves bytes and does not create unselected files', async () => {
  const archive = path.join(root, 'comment.zip'), destination = path.join(root, 'preallocated');
  await rpc('extract', { archive, destination, selected: ['你好.txt'], preallocate: true });
  assert.deepEqual(await fs.readFile(path.join(destination, '你好.txt')), await fs.readFile(sources[0]));
  await assert.rejects(() => fs.stat(path.join(destination, 'other.txt')), { code: 'ENOENT' });
});
for (const format of ['zip', '7z']) test(`${format} local dictionary password recovery verifies the actual password`, async () => {
  const archive = path.join(root, `recover.${format}`); await rpc('create', { sources, destination: archive, format, password: '12', encryptHeaders: true });
  const result = await rpc('recover', { archive, candidates: ['wrong', '12', 'unused'] }); assert.equal(result.password, '12'); assert.equal(result.attempts, 2);
  const dictionary = path.join(root, `dict-${format}.txt`); await fs.writeFile(dictionary, 'nope\n12\n'); assert.equal((await rpc('recover', { archive, dictionary })).password, '12');
  await assert.rejects(() => rpc('recover', { archive, candidates: ['nope'] }), e => e.code === 'PASSWORD_NOT_FOUND');
  await assert.rejects(() => rpc('recover', { archive, characters: '0123456789', minLength: 1, maxLength: 12 }));
  await assert.rejects(() => rpc('recover', { archive, candidates: ['12'] }, true), e => e.code === 'CANCELLED');
});
test('password character enumeration is bounded and finds a short numeric password', async () => {
  const archive = path.join(root, 'recover.zip'); const result = await rpc('recover', { archive, characters: '12', minLength: 2, maxLength: 2 }); assert.equal(result.password, '12');
  const plain = path.join(root, 'comment.zip'); await assert.rejects(() => rpc('recover', { archive: plain, candidates: ['anything'] }), e => e.code === 'NOT_ENCRYPTED');
});
test('all screenshot codepages are accepted and metadata is returned', async () => {
  const archive = path.join(root, 'comment.zip');
  for (const codePage of [0, 932, 936, 950, 949, 1252, 1250, 1251, 1254, 1253, 1256, 1255, 1257, 874, 65001]) assert.equal((await rpc('list', { archive, codePage })).entries.filter(e => !e.isDirectory).length, 2);
  const metadata = await rpc('zip-metadata', { archive }); assert.ok(metadata['你好.txt'].method); const detected = await rpc('detect-codepage', { archive }); assert.ok((await rpc('list', { archive, codePage: detected.codePage })).entries.some(e => e.name === '你好.txt'));
});
