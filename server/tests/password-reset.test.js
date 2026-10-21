const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const express = require('express');
const jwt = require('jsonwebtoken');
const { passwordResetService, hashToken, validPassword, takeLimit } = require('../src/lib/password-reset');
const { mailConfig, resetMessage } = require('../src/lib/reset-mail');

function fixture() {
  const user = { id: '00000000-0000-4000-8000-000000000001', email: 'owner@example.invalid', fname: 'Existing', lname: 'Customer', phone: '123', roleId: 1, role: { name: 'Customer' }, isActive: true, sessionVersion: 0, passwordHash: bcrypt.hashSync('old-password', 4) };
  const related = { repairs: ['repair-1'], messages: ['message-1'], payments: ['payment-1'], schedules: ['schedule-1'], reviews: ['review-1'], profile: 'profile-1' };
  const tokens = [], mails = [], counters = new Map();
  let time = new Date(), queue = Promise.resolve();
  const db = {
    user: {
      findUnique: async ({ where }) => where.id === user.id || where.email === user.email ? { ...user } : null,
      update: async ({ data }) => { assert.deepEqual(Object.keys(data).sort(), ['passwordHash', 'sessionVersion']); user.passwordHash = data.passwordHash; user.sessionVersion += data.sessionVersion.increment; return { ...user }; },
    },
    passwordResetToken: {
      create: async ({ data }) => { tokens.push({ ...data, usedAt: null }); return data; },
      findUnique: async ({ where }) => tokens.find(t => t.tokenHash === where.tokenHash),
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const token of tokens) if ((!where.tokenHash || token.tokenHash === where.tokenHash) && (!where.userId || token.userId === where.userId) && token.usedAt === null && (!where.expiresAt || token.expiresAt > where.expiresAt.gt)) { Object.assign(token, data); count++; }
        return { count };
      },
    },
    $queryRaw: async (strings, key) => { if (strings.join('').includes('INSERT INTO')) { counters.set(key, (counters.get(key) || 0) + 1); return [{ count: counters.get(key) }]; } return []; },
    $transaction: fn => { const result = queue.then(() => fn(db)); queue = result.catch(() => {}); return result; },
  };
  const service = passwordResetService(db, async (email, token) => mails.push({ email, token }), () => time);
  return { db, user, related, tokens, mails, service, advance: ms => { time = new Date(time.getTime() + ms); } };
}

test('secure issue, expiry, invalid token, matching passwords and byte limits', async () => {
  const f = fixture();
  await f.service.issue('unknown@example.invalid'); assert.equal(f.mails.length, 0);
  await f.service.issue(f.user.email);
  assert.match(f.mails[0].token, /^[a-f0-9]{64}$/);
  assert.equal(f.tokens[0].tokenHash, hashToken(f.mails[0].token));
  assert.ok(!JSON.stringify(f.tokens).includes(f.mails[0].token));
  await assert.rejects(f.service.redeem('wrong', 'new-password'), /invalid or expired/);
  await assert.rejects(f.service.redeem(f.mails[0].token, 'new-password', 'different'), /do not match/);
  for (const password of ['short', 'a'.repeat(73), '😀'.repeat(19)]) assert.equal(validPassword(password), false);
  assert.equal(validPassword('😀'.repeat(18)), true);
  f.advance(30 * 60 * 1000);
  await assert.rejects(f.service.redeem(f.mails[0].token, 'new-password'), /invalid or expired/);
});

test('all roles preserve account data, concurrent tokens have one winner and all old tokens are consumed', async () => {
  for (const role of ['Customer', 'Technician', 'Administrator']) {
    const f = fixture(); f.user.role.name = role;
    const before = structuredClone(f.user), related = structuredClone(f.related);
    await f.service.issue(f.user.email); await f.service.issue(f.user.email);
    const results = await Promise.allSettled(f.mails.map(m => f.service.redeem(m.token, 'new-password')));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(f.user.sessionVersion, 1); assert.equal(bcrypt.getRounds(f.user.passwordHash), 12);
    assert.ok(await bcrypt.compare('new-password', f.user.passwordHash));
    assert.equal(await bcrypt.compare('old-password', f.user.passwordHash), false);
    assert.deepEqual({ ...f.user, passwordHash: before.passwordHash, sessionVersion: before.sessionVersion }, before);
    assert.deepEqual(f.related, related);
    for (const m of f.mails) await assert.rejects(f.service.redeem(m.token, 'new-password'), /invalid or expired/);
  }
});

test('SMTP configuration and email use trusted URLs, HTTPS and no plaintext password', () => {
  const env = { CLIENT_URL: 'https://fixit.example', SMTP_HOST: 'sandbox.invalid', SMTP_FROM: 'FixIT <reset@example.invalid>', NODE_ENV: 'production' };
  const config = mailConfig(env), message = resetMessage(config, 'owner@example.invalid', 'a'.repeat(64));
  assert.match(message.text, /https:\/\/fixit.example\/reset-password#token=/);
  assert.match(message.text, /30 minutes/); assert.match(message.html, /ignore this email/);
  assert.equal(config.options.requireTLS, true); assert.equal(config.options.debug, false);
  assert.throws(() => mailConfig({ ...env, CLIENT_URL: 'http://fixit.example' }));
  assert.throws(() => mailConfig({ ...env, SMTP_HOST: '' }));
  assert.throws(() => mailConfig({ ...env, CLIENT_URL: 'https://attacker@fixit.example' }));
});

test('HTTP generic responses, limits, login, legacy/current session revocation and inactive accounts', async t => {
  const f = fixture(); process.env.JWT_SECRET = 'isolated-password-reset-test';
  const key = require.resolve('../src/lib/prisma'); require.cache[key] = { id: key, filename: key, loaded: true, exports: f.db };
  const { resetRouter, GENERIC } = require('../src/routes/password-reset');
  const { authenticateToken } = require('../src/middleware/auth');
  const app = express(); app.use(express.json());
  const sent = [];
  app.use('/api/auth', resetRouter({ db: f.db, config: () => ({}), send: async (_, email, token) => sent.push({ email, token }) }));
  app.use('/api/auth', require('../src/routes/auth'));
  app.get('/protected', authenticateToken, (req, res) => res.json({ success: true }));
  app.use((err, req, res, next) => res.status(500).json({ message: 'Unavailable' }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function post(path, body, expected = 200) {
    const r = await fetch(`${base}/api/auth/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await r.json(); assert.equal(r.status, expected, json.message); return json;
  }
  const old = (await post('login', { email: f.user.email, password: 'old-password' })).data.token;
  const legacy = jwt.sign({}, process.env.JWT_SECRET, { subject: f.user.id });
  const check = async token => (await fetch(`${base}/protected`, { headers: { Authorization: `Bearer ${token}` } })).status;
  assert.equal(await check(legacy), 200);
  const known = await post('forgot-password', { email: '  OWNER@EXAMPLE.INVALID  ' });
  const unknown = await post('forgot-password', { email: 'unknown@example.invalid' });
  assert.deepEqual(known, unknown); assert.equal(known.message, GENERIC);
  for (let i = 0; i < 100 && !sent.length; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(sent.length, 1); assert.equal(sent[0].email, f.user.email);
  await post('reset-password', { token: sent[0].token, password: 'new-password', confirmPassword: 'wrong' }, 400);
  await post('reset-password', { token: sent[0].token, password: 'new-password', confirmPassword: 'new-password' });
  await post('reset-password', { token: sent[0].token, password: 'new-password' }, 400);
  await post('login', { email: f.user.email, password: 'old-password' }, 401);
  const fresh = (await post('login', { email: f.user.email, password: 'new-password' })).data.token;
  assert.equal(await check(old), 401); assert.equal(await check(legacy), 401); assert.equal(await check(fresh), 200);
  f.user.isActive = false;
  await f.service.issue(f.user.email); await f.service.redeem(f.mails[0].token, 'inactive-password');
  assert.equal(f.user.isActive, false);
  await post('login', { email: f.user.email, password: 'inactive-password' }, 403);
  assert.equal(await check(fresh), 401);
  await post('forgot-password', { email: f.user.email }); await post('forgot-password', { email: f.user.email });
  await post('forgot-password', { email: f.user.email }, 429);
  for (let i = 0; i < 7; i++) await post('reset-password', { token: 'bad', password: 'new-password' }, 400);
  await post('reset-password', { token: 'bad', password: 'new-password' }, 429);
  for (let i = 0; i < 10; i++) assert.equal(await takeLimit(f.db, 'other-ip', 'test', 10), true);
  assert.equal(await takeLimit(f.db, 'other-ip', 'test', 10), false);
});

test('delivery failure consumes token', async () => {
  const f = fixture();
  const service = passwordResetService(f.db, async () => { throw new Error('private SMTP details'); });
  await assert.rejects(service.issue(f.user.email), /RESET_MAIL_FAILED/);
  assert.ok(f.tokens[0].usedAt);
});

test('unconfigured SMTP reports the same explicit setup error for known and unknown emails', async t => {
  const f = fixture();
  const { resetRouter } = require('../src/routes/password-reset');
  const app = express(); app.use(express.json());
  app.use(resetRouter({ db: f.db, config: () => { throw new Error('not configured'); } }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const responses = [];
  for (const email of [f.user.email, 'unknown@example.invalid']) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/forgot-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
    assert.equal(response.status, 503); responses.push(await response.json());
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.deepEqual(responses[0], responses[1]); assert.match(responses[0].message, /configure SMTP and CLIENT_URL/);
  assert.equal(f.tokens.length, 0);
});
