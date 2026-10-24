import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';

const [manifestPath, baseline, candidate] = process.argv.slice(2);
if (!manifestPath || !baseline) throw Error('Usage: node scripts/benchmark-memory.mjs <fixtures.json> <baseline.exe> [candidate.exe]');
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const output = path.resolve('test-results/memory', randomUUID()); await fs.mkdir(output, { recursive: true });
const runs = [];
for (const fixture of manifest.listings) {
  const targets = baseline === '--candidate-only' ? [['candidate', candidate]] : [['baseline', baseline], ...(candidate ? [['candidate', candidate]] : [])];
  if (targets.some(([, executable]) => !executable)) throw Error('Missing executable');
  for (let trial = 0; trial < 3; trial++) for (const [edition, executable] of targets) {
    const name = `${fixture.entries}-${trial}-${edition}`, request = path.join(output, name + '-request.json');
    const response = path.join(output, name + '-response.json'), report = path.join(output, name + '-memory.json');
    await fs.writeFile(request, JSON.stringify({ operation: 'list', payload: { archive: fixture.archive } }));
    const child = spawn('powershell.exe', ['-NoProfile', '-File', path.resolve('scripts/measure-memory.ps1'), '-Executable', path.resolve(executable), '-Request', request, '-Response', response, '-Report', report], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let error = ''; child.stderr.on('data', d => error += d); child.stdout.resume();
    const [code] = await once(child, 'exit'); if (code !== 0) throw Error(error || 'Memory sampler failed');
    const measurement = JSON.parse(await fs.readFile(report, 'utf8')), data = JSON.parse(await fs.readFile(response, 'utf8'));
    if (measurement.exitCode !== 0 || !data.ok || data.data.entries.length !== fixture.entries) throw Error(data.error || 'Listing verification failed');
    runs.push({ edition, trial, entries: fixture.entries, ...measurement });
    console.log(JSON.stringify({ edition, entries: fixture.entries, trial, privateMiB: +(measurement.peakPrivateBytes / 1048576).toFixed(1), totalPrivateMiB: +(measurement.peakCombinedPrivateBytes / 1048576).toFixed(1), durationMs: measurement.durationMs }));
  }
}
const result = { recordedAt: new Date().toISOString(), method: 'Same ZIP fixtures, three ordinary RPC listing processes each, 25 ms sampling of NZIP and direct engine children. Samples are observed maxima, not guaranteed true peaks. Includes JSON response serialization. No OS cache flush, no forced GC; sampler memory excluded.', runs };
await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));console.log('Memory evidence: ' + output);
