import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Licensing, Fault } from './licensing.mjs';

export function loadConfig(filename) {
  const config = JSON.parse(fs.readFileSync(filename, 'utf8'));
  const base = path.dirname(path.resolve(filename));
  return { ...config, database: path.resolve(base, config.database), privateKey: fs.readFileSync(path.resolve(base, config.privateKey)), storageKey: Buffer.from(config.storageKey, 'base64'), pepper: Buffer.from(config.pepper, 'base64') };
}
export function createServer(service, config, deliver) {
  const origin = new URL(config.publicUrl).origin;
  const recent = new Map();
  const routes = new Set(['/v1/activate', '/v1/deactivate', '/v1/email-code', '/v1/email-verify', '/v1/devices']);
  return http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      if (req.method === 'GET' && ['/', '/manage.js', '/manage.css'].includes(req.url)) {
        const file = req.url === '/' ? 'manage.html' : req.url.slice(1);
        res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.js') ? 'application/javascript; charset=utf-8' : 'text/css; charset=utf-8');
        return res.end(fs.readFileSync(new URL('./public/' + file, import.meta.url)));
      }
      if (req.method !== 'POST' || !routes.has(req.url)) throw new Fault('NOT_FOUND', '接口不存在', 404);
      if (req.headers.origin && req.headers.origin !== origin) throw new Fault('ORIGIN', '请求来源无效', 403);
      if (!(req.headers['content-type'] ?? '').startsWith('application/json')) throw new Fault('INPUT', '需要 JSON 请求', 415);
      const now = Date.now(), ip = req.socket.remoteAddress;
      let limit = recent.get(ip); if (!limit || now > limit.until) { limit = { until: now + 60000, n: 0 }; recent.set(ip, limit); }
      if (++limit.n > 120) throw new Fault('RETRY_LATER', '请求过于频繁，请稍后重试', 429);
      if (recent.size > 10000) for (const [key, value] of recent) if (now > value.until) recent.delete(key);
      let size = 0, chunks = [];
      for await (const chunk of req) { size += chunk.length; if (size > 16384) throw new Fault('INPUT', '请求过大', 413); chunks.push(chunk); }
      let p; try { p = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Fault('INPUT', 'JSON 无效'); }
      if (!p || Array.isArray(p) || typeof p !== 'object') throw new Fault('INPUT', 'JSON 对象无效');
      // Session tokens stay in memory in the portal; explicit header avoids CSRF.
      const token = req.headers.authorization?.replace(/^Bearer /, '');
      let result;
      switch (req.url) {
        case '/v1/activate': result = service.activate(p); break;
        case '/v1/deactivate': result = service.deactivate(p, token); break;
        case '/v1/email-code': result = await service.sendCode(p.email, deliver); break;
        case '/v1/email-verify': result = service.verifyCode(p); break;
        case '/v1/devices': result = service.devices(token); break;
      }
      res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify({ ok: true, ...result }));
    } catch (error) {
      res.statusCode = error instanceof Fault ? error.status : 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: false, code: error instanceof Fault ? error.code : 'SERVER_ERROR', error: error instanceof Fault ? error.message : '授权服务暂时不可用，请稍后重试' }));
      // No payloads, email addresses, codes, tokens or keys in logs.
      if (!(error instanceof Fault)) console.error('License request failed:', error.name);
    }
  });
}
export async function deliverEmail(config, email, code) {
  if (!config.mail?.apiKey || !config.mail?.from) throw new Error('Email delivery is not configured');
  const response = await fetch('https://api.resend.com/emails', { method: 'POST', signal: AbortSignal.timeout(15000), headers: { Authorization: 'Bearer ' + config.mail.apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: config.mail.from, to: [email], subject: 'NZIP 设备管理验证码', text: `您的验证码是 ${code}，10 分钟内有效。如非本人操作，请忽略。` }) });
  if (!response.ok) throw new Error('Email delivery failed');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = loadConfig(process.argv[2] || 'server/secrets/config.json');
  if (!config.publicUrl.startsWith('https://')) throw new Error('Production publicUrl must use HTTPS');
  const service = new Licensing(config), server = createServer(service, config, (email, code) => deliverEmail(config, email, code));
  server.requestTimeout = 20000; server.headersTimeout = 15000;
  server.listen(config.port || 8787, '127.0.0.1', () => console.log('NZIP license service listening on loopback'));
  process.on('SIGTERM', () => server.close(() => { service.close(); process.exit(0); }));
}
