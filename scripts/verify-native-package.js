const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
function run(executable, args, input, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env });
    let out = '', err = ''; child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', data => out += data); child.stderr.on('data', data => err += data);
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve(out) : reject(new Error(err || `Exit ${code}`)));
    child.stdin.end(input || '');
  });
}
async function files(root, relative = '') {
  const result = [];
  for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
    const name = path.join(relative, entry.name);
    if (entry.isDirectory()) result.push(...await files(root, name)); else result.push(name);
  }
  return result.sort();
}
async function main() {
  const root = path.resolve('test-results/release-check', crypto.randomUUID());
  await fs.mkdir(root, { recursive: true });
  const folder = `NZIP-${require('../package.json').version}-win-x64`;
  await run(path.resolve('vendor/7zip/7z.exe'), ['x', path.resolve(`dist/${folder}.zip`), `-o${root}`, '-y']);
  const original = path.resolve('dist', folder), extracted = path.join(root, folder);
  const names = await files(original); assert.deepEqual(await files(extracted), names);
  for (const name of names) assert.deepEqual(await fs.readFile(path.join(extracted, name)), await fs.readFile(path.join(original, name)), name);
  if (process.argv.includes('--files-only')) {
    console.log(`Release ZIP file verification passed: all ${names.length} files match. Runtime round trip explicitly skipped (--files-only).`);
    console.log(`Extracted release: ${extracted}`); return;
  }
  const input = path.join(root, '中文素材.txt'), archive = path.join(root, '发布包测试.zip'), destination = path.join(root, '解压结果');
  await fs.writeFile(input, 'NZIP bundled-engine release check 中文');
  const env = { ...process.env }; delete env.NZIP_7Z_PATH;
  const rpc = async (operation, payload) => {
    const result = JSON.parse(await run(path.join(extracted, 'NZIP.exe'), ['--engine-rpc'], JSON.stringify({ operation, payload }), env));
    assert.equal(result.ok, true, result.error); return result.data;
  };
  await rpc('create', { sources: [input], destination: archive, format: 'zip' });
  await rpc('test', { archive }); await rpc('extract', { archive, destination });
  assert.deepEqual(await fs.readFile(path.join(destination, '中文素材.txt')), await fs.readFile(input));
  console.log(`Release ZIP passed: all ${names.length} files match; extracted executable created, tested and extracted Unicode ZIP using its bundled engine.`);
  console.log(`Extracted release: ${extracted}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
