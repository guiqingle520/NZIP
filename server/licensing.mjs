import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes, createHash, createHmac, createCipheriv, createDecipheriv, sign, createPrivateKey } from 'node:crypto';

export class Fault extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
const fail = (code, message, status) => { throw new Fault(code, message, status); };
const hash = value => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(value);
export const emailAddress = value => {
  if (typeof value !== 'string' || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) fail('INPUT', '请输入有效的购买邮箱');
  return value.trim().toLowerCase();
};

// All quota changes are synchronous SQLite transactions. A response is never
// returned until the certificate, binding and replay record have committed.
export class Licensing {
  constructor({ database, privateKey, keyId, storageKey, pepper, clock = Date.now }) {
    this.key = createPrivateKey(privateKey);
    if (this.key.asymmetricKeyType !== 'rsa' || this.key.asymmetricKeyDetails.modulusLength < 3072) throw new Error('RSA key must be at least 3072 bits');
    if (!identifier(keyId) || storageKey.length !== 32 || pepper.length < 32) throw new Error('Invalid server secrets');
    this.keyId = keyId; this.storageKey = storageKey; this.pepper = pepper; this.clock = clock;
    this.db = new DatabaseSync(database);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS licenses(id TEXT PRIMARY KEY, orderRef TEXT UNIQUE NOT NULL, email TEXT NOT NULL, customerRef TEXT NOT NULL, slots INTEGER NOT NULL CHECK(slots>0), codeHash TEXT UNIQUE NOT NULL, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS bindings(id TEXT PRIMARY KEY, licenseId TEXT NOT NULL REFERENCES licenses(id), digest TEXT NOT NULL, label TEXT NOT NULL, active INTEGER NOT NULL, generation INTEGER NOT NULL, grantId TEXT, tokenHash TEXT, certificate TEXT, created INTEGER NOT NULL, updated INTEGER NOT NULL, UNIQUE(licenseId,digest));
      CREATE TABLE IF NOT EXISTS grants(id TEXT PRIMARY KEY, bindingId TEXT NOT NULL REFERENCES bindings(id), generation INTEGER NOT NULL, certificate TEXT NOT NULL, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS mutations(id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, bindingId TEXT NOT NULL, generation INTEGER NOT NULL, kind TEXT NOT NULL, response TEXT NOT NULL, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS challenges(email TEXT PRIMARY KEY, codeHash TEXT NOT NULL, expires INTEGER NOT NULL, attempts INTEGER NOT NULL, sent INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(tokenHash TEXT PRIMARY KEY, email TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY, operation TEXT NOT NULL, subject TEXT NOT NULL, created INTEGER NOT NULL);`);
    if (!this.db.prepare('PRAGMA table_info(licenses)').all().some(c => c.name === 'enabled')) this.db.exec('ALTER TABLE licenses ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1');
    this.db.prepare('DELETE FROM sessions WHERE expires<?').run(this.clock());
  }
  close() { this.db.close(); }
  mac(value) { return createHmac('sha256', this.pepper).update(value).digest('hex'); }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  encrypt(value) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.storageKey, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
  }
  decrypt(value) {
    const data = Buffer.from(value, 'base64'), cipher = createDecipheriv('aes-256-gcm', this.storageKey, data.subarray(0, 12));
    cipher.setAuthTag(data.subarray(12, 28));
    return JSON.parse(Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8'));
  }
  issue({ orderRef, email, customerRef, slots = 3 }) {
    email = emailAddress(email);
    if (!identifier(orderRef) || !identifier(customerRef) || !Number.isInteger(slots) || slots < 1 || slots > 100) fail('INPUT', '订单参数不正确');
    const code = 'NZ-' + randomBytes(20).toString('hex').toUpperCase(), id = randomUUID();
    this.transaction(() => {
      this.db.prepare('INSERT INTO licenses(id,orderRef,email,customerRef,slots,codeHash,created) VALUES(?,?,?,?,?,?,?)').run(id, orderRef, email, customerRef, slots, this.mac(code), this.clock());
      this.db.prepare('INSERT INTO audit VALUES(?,?,?,?)').run(randomUUID(), 'issue', id, this.clock());
    });
    return { licenseId: id, activationCode: code, slots };
  }
  update(orderRef, changes) {
    if (!changes || Array.isArray(changes) || typeof changes !== 'object' || Object.keys(changes).some(k => !['slots', 'pauseNew', 'rotateCode'].includes(k))) fail('INPUT', '维护参数无效');
    return this.transaction(() => {
      const license = this.db.prepare('SELECT * FROM licenses WHERE orderRef=?').get(orderRef);
      if (!license) fail('NOT_FOUND', '订单不存在', 404);
      const active = this.db.prepare('SELECT COUNT(*) n FROM bindings WHERE licenseId=? AND active=1').get(license.id).n;
      if ('slots' in changes && (!Number.isInteger(changes.slots) || changes.slots < 1 || changes.slots > 100 || changes.slots < active)) fail('INPUT', '名额不能低于当前登记数量，且需为 1–100');
      for (const field of ['pauseNew', 'rotateCode']) if (field in changes && typeof changes[field] !== 'boolean') fail('INPUT', '维护开关必须为布尔值');
      const code = changes.rotateCode ? 'NZ-' + randomBytes(20).toString('hex').toUpperCase() : undefined;
      this.db.prepare('UPDATE licenses SET slots=?,enabled=?,codeHash=? WHERE id=?').run(changes.slots ?? license.slots, 'pauseNew' in changes ? Number(!changes.pauseNew) : license.enabled, code ? this.mac(code) : license.codeHash, license.id);
      this.db.prepare('INSERT INTO audit VALUES(?,?,?,?)').run(randomUUID(), 'update:' + Object.keys(changes).join(','), license.id, this.clock());
      return { licenseId: license.id, slots: changes.slots ?? license.slots, pauseNew: 'pauseNew' in changes ? changes.pauseNew : !license.enabled, ...(code ? { activationCode: code } : {}) };
    });
  }
  inspect(orderRef) {
    const license = this.db.prepare('SELECT id,orderRef,email,customerRef,slots,enabled,created FROM licenses WHERE orderRef=?').get(orderRef);
    if (!license) fail('NOT_FOUND', '订单不存在', 404);
    return { license, bindings: this.db.prepare('SELECT id,label,active,generation,created,updated FROM bindings WHERE licenseId=? ORDER BY updated DESC').all(license.id), grants: this.db.prepare('SELECT COUNT(*) n FROM grants g JOIN bindings b ON b.id=g.bindingId WHERE b.licenseId=?').get(license.id).n };
  }
  certificate(license, bindingId, generation, digest, grantId) {
    const payload = Buffer.from(JSON.stringify({ schema: 1, product: 'nzip-paid', licenseId: license.id, grantId, bindingId, generation, customerRef: license.customerRef, deviceDigest: digest, entitlement: 'desktop-core', issuedAt: new Date(this.clock()).toISOString() }));
    return { keyId: this.keyId, payload: payload.toString('base64url'), signature: sign('RSA-SHA256', Buffer.concat([Buffer.from('NZIP-LICENSE-V1\0'), payload]), this.key).toString('base64url') };
  }
  request(p) {
    if (!identifier(p.requestId)) fail('INPUT', '缺少有效的请求编号');
  }
  replay(p, kind, fingerprint) {
    const old = this.db.prepare('SELECT * FROM mutations WHERE id=?').get(p.requestId);
    if (!old) return null;
    if (old.kind !== kind || old.fingerprint !== fingerprint) fail('REQUEST_CONFLICT', '此请求编号已用于其他请求', 409);
    const binding = this.db.prepare('SELECT * FROM bindings WHERE id=?').get(old.bindingId);
    if (!binding || binding.generation !== old.generation || !!binding.active !== (kind === 'activate')) fail('STATE_CHANGED', '设备状态已变化，请重新操作', 409);
    return this.decrypt(old.response);
  }
  record(p, kind, fingerprint, binding, response) {
    this.db.prepare('INSERT INTO mutations VALUES(?,?,?,?,?,?,?)').run(p.requestId, fingerprint, binding.id, binding.generation, kind, this.encrypt(response), this.clock());
    return response;
  }
  activate(p) {
    if (typeof p.activationCode !== 'string' || p.activationCode.length > 100) fail('INPUT', '激活参数不正确');
    return this.activateForCodeHash(p, this.mac(p.activationCode.trim().toUpperCase()));
  }
  offline(orderRef, request) {
    if (request.schema !== 1 || request.product !== 'nzip-paid') fail('INPUT', '离线申请文件无效');
    const license = this.db.prepare('SELECT codeHash FROM licenses WHERE orderRef=?').get(orderRef);
    if (!license) fail('NOT_FOUND', '订单不存在', 404);
    const result = this.activateForCodeHash({ requestId: randomUUID(), deviceDigest: request.deviceDigest, deviceName: request.deviceName }, license.codeHash);
    this.db.prepare('INSERT INTO audit VALUES(?,?,?,?)').run(randomUUID(), 'offline', orderRef, this.clock());
    return result.certificate;
  }
  activateForCodeHash(p, codeHash) {
    this.request(p);
    if (!/^[a-f0-9]{64}$/.test(p.deviceDigest) || typeof p.deviceName !== 'string' || p.deviceName.length > 80) fail('INPUT', '激活参数不正确');
    const fingerprint = hash(JSON.stringify([codeHash, p.deviceDigest, p.deviceName]));
    return this.transaction(() => {
      const license = this.db.prepare('SELECT * FROM licenses WHERE codeHash=?').get(codeHash);
      if (!license) fail('INVALID_CODE', '激活码无效', 403);
      const replay = this.replay(p, 'activate', fingerprint); if (replay) return replay;
      let binding = this.db.prepare('SELECT * FROM bindings WHERE licenseId=? AND digest=?').get(license.id, p.deviceDigest);
      if (binding?.active) {
        // Stable per-grant token keeps retries and another Windows user valid.
        const token = createHmac('sha256', this.storageKey).update('device-token|' + binding.grantId).digest('base64url');
        return this.record(p, 'activate', fingerprint, binding, { certificate: JSON.parse(binding.certificate), managementToken: token });
      }
      if (!license.enabled) fail('LICENSE_PAUSED', '此订单暂停新增设备激活，请联系发行方；已有离线授权可继续使用', 403);
      const count = this.db.prepare('SELECT COUNT(*) AS n FROM bindings WHERE licenseId=? AND active=1').get(license.id).n;
      if (count >= license.slots) fail('SLOTS_FULL', '设备名额已满，请通过购买邮箱管理设备并释放名额', 409);
      const id = binding?.id ?? randomUUID(), generation = (binding?.generation ?? 0) + 1, grantId = randomUUID();
      const token = createHmac('sha256', this.storageKey).update('device-token|' + grantId).digest('base64url');
      const certificate = this.certificate(license, id, generation, p.deviceDigest, grantId), now = this.clock();
      this.db.prepare(`INSERT INTO bindings VALUES(?,?,?,?,1,?,?,?,?,?,?) ON CONFLICT(licenseId,digest) DO UPDATE SET active=1,generation=excluded.generation,grantId=excluded.grantId,tokenHash=excluded.tokenHash,certificate=excluded.certificate,label=excluded.label,updated=excluded.updated`).run(id, license.id, p.deviceDigest, p.deviceName, generation, grantId, hash(token), JSON.stringify(certificate), now, now);
      this.db.prepare('INSERT INTO grants VALUES(?,?,?,?,?)').run(grantId, id, generation, JSON.stringify(certificate), now);
      binding = { id, generation };
      return this.record(p, 'activate', fingerprint, binding, { certificate, managementToken: token });
    });
  }
  session(token) {
    if (typeof token !== 'string' || token.length > 100) fail('SESSION_REQUIRED', '请验证购买邮箱', 401);
    const session = this.db.prepare('SELECT * FROM sessions WHERE tokenHash=? AND expires>?').get(hash(token), this.clock());
    if (!session) fail('SESSION_REQUIRED', '邮箱验证已失效，请重新验证', 401);
    return session;
  }
  deactivate(p, sessionToken) {
    this.request(p);
    if (!identifier(p.bindingId) || !Number.isInteger(p.generation) || p.generation < 1) fail('INPUT', '设备参数不正确');
    return this.transaction(() => {
      const binding = this.db.prepare('SELECT * FROM bindings WHERE id=?').get(p.bindingId);
      if (!binding) fail('NOT_FOUND', '设备不存在', 404);
      if (sessionToken) {
        const session = this.session(sessionToken);
        const license = this.db.prepare('SELECT * FROM licenses WHERE id=?').get(binding.licenseId);
        if (license.email !== session.email) fail('FORBIDDEN', '无权管理此设备', 403);
      } else if (typeof p.managementToken !== 'string' || p.managementToken.length > 100 || hash(p.managementToken) !== binding.tokenHash) fail('FORBIDDEN', '请通过购买邮箱管理此设备', 403);
      const fingerprint = hash(JSON.stringify([binding.id, p.generation]));
      const replay = this.replay(p, 'deactivate', fingerprint); if (replay) return replay;
      if (binding.generation !== p.generation) fail('STATE_CHANGED', '设备已重新激活，请刷新后重试', 409);
      this.db.prepare('UPDATE bindings SET active=0,updated=? WHERE id=?').run(this.clock(), binding.id);
      return this.record(p, 'deactivate', fingerprint, binding, { deactivated: true, bindingId: binding.id, generation: binding.generation });
    });
  }
  // Delivery is injected by the HTTPS host; tests never send external mail.
  async sendCode(email, deliver) {
    email = emailAddress(email);
    const code = String(randomBytes(4).readUInt32BE() % 1000000).padStart(6, '0');
    const now = this.clock();
    this.transaction(() => {
      const old = this.db.prepare('SELECT sent FROM challenges WHERE email=?').get(email);
      if (old && now - old.sent < 60000) fail('RETRY_LATER', '请稍后再发送验证码', 429);
      this.db.prepare('INSERT OR REPLACE INTO challenges VALUES(?,?,?,?,?)').run(email, this.mac(email + '|' + code), now + 600000, 0, now);
    });
    // Only purchasing customers receive mail. Unknown addresses get the same
    // public response, so this endpoint cannot be used as an arbitrary mailer.
    if (this.db.prepare('SELECT 1 FROM licenses WHERE email=? LIMIT 1').get(email)) await deliver(email, code);
    return { sent: true };
  }
  verifyCode(p) {
    const email = emailAddress(p.email);
    if (typeof p.code !== 'string' || !/^\d{6}$/.test(p.code)) fail('INVALID_OTP', '验证码无效');
    // Failed attempt increments must commit, so errors are raised after commit.
    const result = this.transaction(() => {
      const challenge = this.db.prepare('SELECT * FROM challenges WHERE email=?').get(email);
      if (!challenge || challenge.expires < this.clock() || challenge.attempts >= 5) return null;
      this.db.prepare('UPDATE challenges SET attempts=attempts+1 WHERE email=?').run(email);
      if (challenge.codeHash !== this.mac(email + '|' + p.code)) return null;
      this.db.prepare('DELETE FROM challenges WHERE email=?').run(email);
      const token = secret();
      this.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(token), email, this.clock() + 900000);
      return { sessionToken: token };
    });
    if (!result) fail('INVALID_OTP', '验证码错误或已失效');
    return result;
  }
  devices(token) {
    const session = this.session(token);
    return { devices: this.db.prepare(`SELECT b.id AS bindingId,b.generation,b.label AS deviceName,b.active,b.updated,l.customerRef,l.slots,l.id AS licenseId FROM bindings b JOIN licenses l ON l.id=b.licenseId WHERE l.email=? ORDER BY b.updated DESC`).all(session.email) };
  }
}
