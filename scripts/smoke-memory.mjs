import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
const [executable, manifest] = process.argv.slice(2);
if (!executable || !manifest) throw Error('Usage: node scripts/smoke-memory.mjs <NZIP.exe> <fixtures.json>');
const output = path.resolve('test-results/memory', randomUUID()); await fs.mkdir(output, { recursive: true });
const config = path.join(output, 'scenario.json'); await fs.writeFile(config, JSON.stringify({ output, manifest: path.resolve(manifest) }));
const child = spawn(path.resolve(executable), ['--memory-smoke', config], { windowsHide: false, stdio: 'ignore', env: { ...process.env, NZIP_TEST_MODE: '1', NZIP_USER_DATA: path.join(output, 'profile') } });
const timeout = setTimeout(() => child.kill(), 300000);
try {
  const [code] = await once(child, 'exit'); const result = JSON.parse(await fs.readFile(path.join(output, 'result.json'), 'utf8'));
  console.log(JSON.stringify({ code, output, ...result }, null, 2)); if (code !== 0 || !result.ok) process.exitCode = 1;
} finally { clearTimeout(timeout); }
