import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const [executable, manifestPath] = process.argv.slice(2);
if (!executable || !manifestPath) throw Error('Usage: node scripts/regress-large.mjs <NZIP.exe> <fixtures.json>');
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const output = path.resolve('test-results/memory', randomUUID()); await fs.mkdir(output, { recursive: true });
const runs = [], checks = [];
async function rpc(name, operation, payload) {
  const request = path.join(output, name + '-request.json'), response = path.join(output, name + '-response.json'), report = path.join(output, name + '-memory.json');
  await fs.writeFile(request, JSON.stringify({ operation, payload }));
  const child = spawn('powershell.exe', ['-NoProfile', '-File', path.resolve('scripts/measure-memory.ps1'), '-Executable', path.resolve(executable), '-Request', request, '-Response', response, '-Report', report], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let error = ''; child.stderr.on('data', d => error += d); child.stdout.resume();
  const [code] = await once(child, 'exit'); assert.equal(code, 0, error);
  const data = JSON.parse(await fs.readFile(response, 'utf8')), measurement = JSON.parse(await fs.readFile(report, 'utf8'));
  assert.equal(measurement.exitCode, 0); assert.equal(data.ok, true, data.error);
  runs.push({ name, ...measurement });
  console.log(JSON.stringify({ name, parentPrivateMiB: +(measurement.peakPrivateBytes / 1048576).toFixed(1), enginePrivateMiB: +(measurement.peakEnginePrivateBytes / 1048576).toFixed(1), combinedPrivateMiB: +(measurement.peakCombinedPrivateBytes / 1048576).toFixed(1), durationMs: measurement.durationMs }));
  return data.data;
}
async function hash(file) { const value = createHash('sha256'); for await (const chunk of createReadStream(file)) value.update(chunk); return value.digest('hex'); }
try {
  assert.equal((await fs.stat(manifest.large.source)).size, manifest.large.bytes);
  assert.equal(await hash(manifest.large.source), manifest.large.sha256);
  for (const format of ['zip', '7z']) {
    const archive = path.join(output, '真实大文件.' + format), destination = path.join(output, '提取-' + format);
    await rpc(format + '-create', 'create', { sources: [manifest.large.source], destination: archive, format, level: 1, threads: 1 });
    const listing = await rpc(format + '-list', 'list', { archive });
    assert.equal(listing.entries.length, 1); assert.equal(listing.entries[0].size, manifest.large.bytes);
    await rpc(format + '-integrity', 'test', { archive });
    await rpc(format + '-extract', 'extract', { archive, destination, selected: [listing.entries[0].path], preallocate: true });
    assert.equal(await hash(path.join(destination, listing.entries[0].path)), manifest.large.sha256);
    checks.push(`${format}: real ${manifest.large.bytes}-byte input, level 1 / one thread creation, complete directory listing, engine integrity, selected preallocated extraction, streaming SHA-256 equality`);
  }
  await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ ok: true, checks, runs }, null, 2));
  console.log('Large-file regression evidence: ' + output);
} catch (error) {
  await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ ok: false, error: String(error), checks, runs }, null, 2));
  throw error;
}
