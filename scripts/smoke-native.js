const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const { once } = require('node:events');
async function main() {
  const output = path.resolve('test-results/native-desktop', crypto.randomUUID()); await fs.mkdir(output, { recursive: true });
  const executable = path.resolve(process.env.NZIP_NATIVE_EXE || `dist/NZIP-${require('../package.json').version}-win-x64/NZIP.exe`);
  const child = spawn(executable, ['--ui-smoke', output], { windowsHide: false, stdio: 'ignore', env: { ...process.env, NZIP_TEST_MODE: '1', NZIP_USER_DATA: path.join(output, 'profile') } });
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; child.kill(); }, 120000);
  try {
    const [code] = await once(child, 'exit');
    if (timedOut) throw Error(`Native UI timed out: ${output}`);
    const result = JSON.parse(await fs.readFile(path.join(output, 'result.json'), 'utf8'));
    if (code !== 0 || !result.ok) throw Error(result.error || `Exit ${code}`);
    console.log(JSON.stringify(result, null, 2)); console.log(`Native screenshots: ${output}`);
  } finally { clearTimeout(timeout); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
