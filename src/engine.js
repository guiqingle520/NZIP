const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');

class ArchiveError extends Error {
  constructor(message, code = 'ARCHIVE_ERROR') { super(message); this.code = code; }
}
const abortError = () => new ArchiveError('操作已取消', 'CANCELLED');
function assertActive(signal) { if (signal?.aborted) throw abortError(); }
function safeEntry(name) {
  const n = name.replaceAll('\\', '/');
  if (!n || /[\x00-\x1f<>"|?*]/.test(n) || n.startsWith('/') || n.includes(':') ||
    n.split('/').some(p => p === '.' || p === '..' || /[. ]$/.test(p) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(p))) {
    throw new ArchiveError(`压缩包包含不安全的路径：${name}`, 'UNSAFE_PATH');
  }
  return n;
}
function parseList(text) {
  const separator = text.indexOf('----------');
  if (separator < 0) throw new ArchiveError('无法读取压缩包文件列表');
  const header = text.slice(0, separator);
  const type = header.match(/^Type = (.+)$/m)?.[1]?.trim() || 'archive';
  const entries = text.slice(separator + 10).trim().split(/\r?\n\r?\n/).filter(Boolean).map(block => {
    const fields = {};
    for (const line of block.split(/\r?\n/)) {
      const i = line.indexOf(' = ');
      if (i >= 0) fields[line.slice(0, i)] = line.slice(i + 3);
    }
    if (!fields.Path) throw new ArchiveError('文件名无法解析，已停止读取', 'UNSAFE_PATH');
    const name = safeEntry(fields.Path);
    if (fields['Symbolic Link'] || fields['Hard Link'] || /reparse|(?:^|[ _])l[rwxstST-]{9}/i.test(fields.Attributes || '')) {
      throw new ArchiveError('为保护本地文件，暂不支持含符号链接或硬链接的压缩包', 'UNSAFE_PATH');
    }
    return {
      path: name, name: name.split('/').filter(Boolean).pop(),
      isDirectory: fields.Folder === '+' || /^D/.test(fields.Attributes || ''),
      size: Number(fields.Size || 0), packed: Number(fields['Packed Size'] || 0),
      modified: fields.Modified || '', encrypted: fields.Encrypted === '+', crc: fields.CRC || ''
    };
  });
  const seen = new Set();
  for (const e of entries) {
    const key = e.path.toLowerCase().replace(/\/$/, '');
    if (seen.has(key)) throw new ArchiveError('压缩包包含重复或仅大小写不同的路径，无法安全处理', 'UNSAFE_PATH');
    seen.add(key);
  }
  return { type, entries, totalSize: entries.reduce((n, e) => n + e.size, 0), encrypted: entries.some(e => e.encrypted) };
}
function createEngine(binary) {
  async function run(args, { cwd, signal, onProgress, maxOutput = 64 * 1024 * 1024 } = {}) {
    assertActive(signal);
    return new Promise((resolve, reject) => {
      const child = spawn(binary, ['-sccUTF-8', '-bd', '-bsp1', ...args], {
        cwd, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe']
      });
      child.stdin.end(); // Never leave the GUI waiting for an interactive password prompt.
      let out = '', err = '', tooLarge = false;
      const abort = () => child.kill();
      signal?.addEventListener('abort', abort, { once: true });
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stdout.on('data', data => {
        out += data;
        if (out.length > maxOutput) { tooLarge = true; child.kill(); }
        for (const m of data.matchAll(/(\d{1,3})%/g)) onProgress?.({ percent: Math.min(99, Number(m[1])) });
      });
      child.stderr.on('data', data => { err = (err + data).slice(-8192); });
      child.on('error', e => {
        signal?.removeEventListener('abort', abort);
        reject(new ArchiveError(`无法启动压缩引擎：${e.message}`, 'ENGINE_MISSING'));
      });
      child.on('close', code => {
        signal?.removeEventListener('abort', abort);
        if (signal?.aborted) return reject(abortError());
        if (tooLarge) return reject(new ArchiveError('压缩包文件列表过大，无法安全加载'));
        if (code !== 0) {
          const detail = `${err}\n${out.slice(-3000)}`;
          if (/wrong password|password is incorrect|enter password|encrypted archive/i.test(detail))
            return reject(new ArchiveError('此压缩包需要正确的密码', 'PASSWORD_REQUIRED'));
          return reject(new ArchiveError(code === 1 ? '压缩引擎报告警告；操作未提交，请检查文件权限或占用情况' :
            /not enough space|disk full/i.test(detail) ? '磁盘空间不足' :
            /can not open.*archive|is not archive|unexpected end|data error|crc failed|headers error/i.test(detail) ? '压缩包损坏、密码错误或格式不受支持' :
            '操作失败，请检查文件权限、密码以及压缩包是否完整', 'ENGINE_ERROR'));
        }
        resolve(out);
      });
    });
  }
  const passwordArg = password => [`-p${password || ''}`];
  async function list(archive, options = {}) {
    const text = await run(['l', '-slt', ...passwordArg(options.password), '--', path.resolve(archive)], options);
    const data = parseList(text);
    const stat = await fs.stat(archive);
    return { ...data, path: path.resolve(archive), name: path.basename(archive), archiveSize: stat.size };
  }
  async function test(archive, options = {}) {
    await list(archive, options);
    await run(['t', ...passwordArg(options.password), '--', path.resolve(archive)], options);
    return { message: '完整性测试通过，所有文件均完好' };
  }
  async function create({ sources, destination, format = 'zip', level = 5, password = '', volume = '', encryptHeaders = true }, options = {}) {
    if (!Array.isArray(sources) || !sources.length) throw new ArchiveError('请先添加需要压缩的文件');
    if (!['zip', '7z', 'tar'].includes(format)) throw new ArchiveError('不支持的压缩格式');
    if (![0, 1, 3, 5, 7, 9].includes(Number(level))) throw new ArchiveError('不支持的压缩级别');
    if (format === 'tar' && password) throw new ArchiveError('TAR 格式不支持密码加密');
    if (format === 'zip' && /[^\x20-\x7e]/.test(password)) throw new ArchiveError('ZIP 密码请使用英文字母、数字或符号；中文密码请选择 7Z 格式');
    if (volume && !/^[1-9]\d{0,6}[mk]$/i.test(volume)) throw new ArchiveError('分卷大小格式不正确');
    destination = path.resolve(destination);
    sources = [...new Set(sources.map(s => path.resolve(s)))];
    const baseNames = sources.map(s => path.basename(s).toLowerCase());
    if (new Set(baseNames).size !== sources.length) throw new ArchiveError('来源中存在同名文件，请分别压缩或放入不同文件夹');
    for (const source of sources) {
      const stat = await fs.lstat(source);
      if (stat.isSymbolicLink()) throw new ArchiveError('暂不支持压缩符号链接');
      if (stat.isDirectory()) await verifyTree(source, options.signal);
      if (source === destination || (stat.isDirectory() && isInside(source, destination))) throw new ArchiveError('输出压缩包不能放在待压缩文件夹内');
    }
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const staging = await fs.mkdtemp(path.join(path.dirname(destination), '.nzip-create-'));
    const tempArchive = path.join(staging, path.basename(destination));
    try {
      // A common parent keeps every selected root name while avoiding absolute paths in the archive.
      let cwd = path.dirname(sources[0]);
      while (!sources.every(s => isInside(cwd, s))) {
        const parent = path.dirname(cwd);
        if (parent === cwd) throw new ArchiveError('不同磁盘的文件请分别压缩');
        cwd = parent;
      }
      const relative = sources.map(s => path.relative(cwd, s));
      const args = ['a', `-t${format}`, `-mx=${level}`, '-mmt=on', '-y', '-snl'];
      if (password) {
        args.push(`-p${password}`);
        if (format === 'zip') args.push('-mem=AES256');
        if (format === '7z' && encryptHeaders) args.push('-mhe=on');
      }
      if (volume) args.push(`-v${volume}`);
      await run([...args, '--', tempArchive, ...relative], { ...options, cwd });
      assertActive(options.signal);
      const outputs = (await fs.readdir(staging)).filter(n => n === path.basename(destination) || n.startsWith(`${path.basename(destination)}.`)).sort();
      if (!outputs.length) throw new ArchiveError('未生成压缩文件');
      // Hard-link publication is atomic and refuses to replace any existing file.
      const committed = [];
      try {
        for (const name of outputs) {
          const target = path.join(path.dirname(destination), name);
          await fs.link(path.join(staging, name), target); committed.push(target);
        }
      } catch (e) {
        await Promise.all(committed.map(f => fs.unlink(f)));
        if (e.code === 'EEXIST') throw new ArchiveError('同名压缩包或分卷已存在，请更换名称');
        throw e;
      }
      return { path: committed[0], outputs: committed, message: `压缩完成${outputs.length > 1 ? `，共 ${outputs.length} 个分卷` : ''}` };
    } finally { await fs.rm(staging, { recursive: true, force: true }); }
  }
  async function extract({ archive, destination, password = '', selected = [] }, options = {}) {
    const data = await list(archive, { ...options, password });
    selected.forEach(safeEntry);
    if (selected.some(s => !data.entries.some(e => e.path === s))) throw new ArchiveError('所选文件已不在压缩包中');
    destination = path.resolve(destination);
    if (await exists(destination)) throw new ArchiveError('目标文件夹已存在，请选择新的文件夹名称，避免覆盖已有文件', 'DEST_EXISTS');
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const staging = await fs.mkdtemp(path.join(path.dirname(destination), '.nzip-extract-'));
    try {
      const args = ['x', '-y', '-spd', ...passwordArg(password), `-o${staging}`, '--', path.resolve(archive), ...selected];
      await run(args, options);
      // Check every extracted node before exposing the directory to the user.
      await verifyTree(staging, options.signal);
      assertActive(options.signal);
      if (await exists(destination)) throw new ArchiveError('目标文件夹已存在，请更换路径', 'DEST_EXISTS');
      await fs.rename(staging, destination);
      return { path: destination, message: '解压完成' };
    } finally { await fs.rm(staging, { recursive: true, force: true }); }
  }
  async function modify({ archive, action, sources = [], selected = [], password = '' }, options = {}) {
    const data = await list(archive, { ...options, password });
    if (!['zip', '7z'].includes(data.type.toLowerCase())) throw new ArchiveError('仅支持修改 ZIP 和 7Z 压缩包');
    if (data.encrypted) throw new ArchiveError('加密压缩包请解压后重新创建，以确保加密设置一致');
    if (!['add', 'delete'].includes(action)) throw new ArchiveError('无效的修改操作');
    if (action === 'delete' && !selected.length) throw new ArchiveError('请先选择要删除的文件');
    selected.forEach(safeEntry);
    if (selected.some(s => !data.entries.some(e => e.path === s))) throw new ArchiveError('文件不存在');
    if (action === 'add' && !sources.length) throw new ArchiveError('请先添加文件');
    archive = path.resolve(archive);
    const staging = await fs.mkdtemp(path.join(path.dirname(archive), '.nzip-edit-'));
    const temp = path.join(staging, path.basename(archive));
    const before = await fs.stat(archive);
    try {
      await fs.copyFile(archive, temp);
      if (action === 'delete') await run(['d', '-y', '-spd', '--', temp, ...selected], options);
      else {
        sources = sources.map(s => path.resolve(s));
        const cwd = path.dirname(sources[0]);
        if (sources.some(s => path.dirname(s) !== cwd)) throw new ArchiveError('每次添加的文件需来自同一个文件夹');
        const existing = new Set(data.entries.map(e => e.path.toLowerCase()));
        for (const s of sources) {
          const base = path.basename(s).toLowerCase();
          if ([...existing].some(p => p === base || p.startsWith(`${base}/`))) throw new ArchiveError('压缩包中存在同名文件，请先删除或重命名来源');
        }
        await run(['a', '-y', '-snl', '--', temp, ...sources.map(s => path.basename(s))], { ...options, cwd });
      }
      await list(temp, options);
      await test(temp, options);
      assertActive(options.signal);
      const now = await fs.stat(archive);
      if (now.mtimeMs !== before.mtimeMs || now.size !== before.size) throw new ArchiveError('压缩包已被其他程序修改，请重新打开后重试');
      await fs.rename(temp, archive);
      return { path: archive, message: action === 'delete' ? '所选文件已从压缩包中删除' : '文件已添加到压缩包' };
    } finally { await fs.rm(staging, { recursive: true, force: true }); }
  }
  return { run, list, create, extract, test, modify };
}
function isInside(root, target) {
  const rel = path.relative(root, target);
  return rel !== '' && !rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel);
}
async function exists(p) { try { await fs.lstat(p); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }
async function verifyTree(root, signal) {
  for (const item of await fs.readdir(root, { withFileTypes: true })) {
    assertActive(signal);
    const p = path.join(root, item.name);
    const stat = await fs.lstat(p);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()) || (stat.isFile() && stat.nlink > 1))
      throw new ArchiveError('压缩包包含不安全的链接文件', 'UNSAFE_PATH');
    if (stat.isDirectory()) await verifyTree(p, signal);
  }
}
module.exports = { createEngine, parseList, safeEntry, ArchiveError, isInside };
