import express from 'express';
import crypto from 'crypto';
import { getAdapter, SourceUnavailable, VerificationFailed, VerificationRequired, InvalidResponse } from './au-adapter.js';
import { getSection, respond } from './services.js';

const app = express();
app.use(express.json({ limit: '10kb' }));
app.use(express.static('public'));
const adapter = getAdapter(), sessions = new Map(), TTL = 30 * 60e3, ID = /^[A-Za-z0-9\-\/]{6,14}$/;
const tries = new Map(); // login throttle per IP
setInterval(() => { for (const [k, s] of sessions) if (Date.now() - s.at > TTL) sessions.delete(k); tries.clear(); }, 10 * 60e3).unref();

const MSG = {
  VerificationFailed: [403, 'verification', "We couldn't verify those details. Check them and try again."],
  VerificationRequired: [403, 'verify', 'The university system needs extra verification. Please sign in again to continue.'],
  SourceUnavailable: [503, 'unavailable', 'University records are temporarily unreachable. Please try again.'],
  InvalidResponse: [502, 'invalid', 'The university returned data we could not read safely. Please try again later.']
};
const fail = (res, e) => {
  const m = MSG[e.constructor.name];
  if (!m) console.error(e); else console.error(e.constructor.name, e.message); // technical detail stays in server logs
  const [code, error, text] = m || [500, 'server', 'Something went wrong. Please try again.'];
  res.status(code).json({ error, text });
};
function auth(req, res, next) {
  const sid = /(?:^|; )sid=([a-f0-9]{48})/.exec(req.headers.cookie || '')?.[1], s = sessions.get(sid);
  if (!s || Date.now() - s.at > TTL) { sessions.delete(sid); return res.status(401).json({ error: 'expired', text: 'Your session has expired. Please sign in again.' }); }
  s.at = Date.now(); s.hits = s.hits.filter(t => s.at - t < 60e3); s.hits.push(s.at);
  if (s.hits.length > 60) return res.status(429).json({ error: 'rate', text: 'Too many requests. Please wait a moment.' });
  req.s = s; next();
}

app.post('/api/login', async (req, res) => {
  const n = (tries.get(req.ip) || 0) + 1; tries.set(req.ip, n);
  if (n > 10) return res.status(429).json({ error: 'rate', text: 'Too many attempts. Try again in a few minutes.' });
  const id = String(req.body?.id || '').trim(), dob = String(req.body?.dob || '');
  if (!ID.test(id) || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return res.status(400).json({ error: 'invalid', text: 'Enter a valid register or roll number and your date of birth.' });
  try {
    await adapter.verify(id, { dob });
    const sid = crypto.randomBytes(24).toString('hex'), s = { sid, student: id, at: Date.now(), hits: [], cache: {}, ctx: {}, read: new Set() };
    sessions.set(sid, s);
    res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
    res.json({ mode: adapter.mode, profile: await getSection(adapter, s, 'profile') });
  } catch (e) { fail(res, e); }
});
app.get('/api/me', auth, async (req, res) => { try { res.json({ mode: adapter.mode, profile: await getSection(adapter, req.s, 'profile') }); } catch (e) { fail(res, e); } });
app.get('/api/section/:name', auth, async (req, res) => {
  try {
    let data = await getSection(adapter, req.s, req.params.name, req.query.force === '1');
    if (req.params.name === 'notifications' && data) data = data.map(n => ({ ...n, read: req.s.read.has(n.id) }));
    res.json({ data });
  } catch (e) { fail(res, e); }
});
app.post('/api/notifications/read', auth, async (req, res) => {
  try {
    const all = await getSection(adapter, req.s, 'notifications') || [];
    (req.body?.all ? all.map(n => n.id) : [].concat(req.body?.ids || [])).forEach(i => req.s.read.add(String(i)));
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});
const answer = (req, res, msg) => respond(adapter, req.s, String(msg || '').slice(0, 500)).then(r => res.json(r)).catch(e => fail(res, e));
app.post('/api/chat', auth, (req, res) => answer(req, res, req.body?.message));
app.get('/api/search', auth, (req, res) => answer(req, res, req.query.q));
app.post('/api/clear', auth, (req, res) => { req.s.cache = {}; req.s.ctx = {}; res.json({ ok: true }); });
app.post('/api/logout', (req, res) => {
  sessions.delete(/(?:^|; )sid=([a-f0-9]{48})/.exec(req.headers.cookie || '')?.[1]);
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; Max-Age=0'); res.json({ ok: true });
});
app.listen(process.env.PORT || 3000, () => console.log(`AU AI Student Assistant on :${process.env.PORT || 3000} (${adapter.mode} mode)`));
