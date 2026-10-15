const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
test('checkout HTTP enforces ownership, trusted pricing, retry history, cancellation, verification and no second charge', async t => {
  process.env.JWT_SECRET = 'isolated-payments-http-secret';
  process.env.PAYMONGO_SECRET_KEY = 'sk_test_isolated_contract';
  const customer = '00000000-0000-4000-8000-000000000001', tech = '00000000-0000-4000-8000-000000000002', other = '00000000-0000-4000-8000-000000000003', id = '00000000-0000-4000-8000-000000000004';
  const repair = { id, customerId: customer, technicianProfile: { userId: tech }, status: 'PENDING', outcome: null, finalCost: '500', title: 'Test repair' };
  let stored, creations = 0, malformed = false;
  const audits = [], sessions = new Map();
  const db = {
    user: { findUnique: async ({ where }) => ({ id: where.id, isActive: true, fname: 'Test', lname: 'User', role: { name: where.id === tech ? 'Technician' : 'Customer' } }) },
    repairRequest: { findUnique: async () => repair },
    payment: {
      upsert: async ({ create }) => stored || (stored = { id: 'payment-test', status: 'PENDING', currency: 'PHP', ...create }),
      findUnique: async () => stored,
      update: async ({ data }) => (stored = { ...stored, ...data }),
    },
    auditLog: { create: async ({ data }) => { audits.push(data); return data; }, findFirst: async ({ where }) => audits.find(a => a.action === where.action && a.details.checkoutId === where.details.equals) },
    $transaction: async fn => fn(db), $executeRaw: async () => 0,
  };
  const key = require.resolve('../src/lib/prisma'); require.cache[key] = { id: key, filename: key, loaded: true, exports: db };
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    if (!String(url).startsWith('https://api.paymongo.com/')) return originalFetch(url,options);
    let s;
    if (options.method === 'POST' && !String(url).endsWith('/expire')) {
      const a = JSON.parse(options.body).data.attributes; assert.equal(a.line_items[0].amount,50000); assert.equal(a.reference_number,id);
      s = { id: `cs_${++creations}`, attributes: { reference_number: id, livemode: false, status: 'active', checkout_url: 'https://checkout.paymongo.com/test', payments: [], payment_intent: { id: 'pi_test' } } }; sessions.set(s.id,s);
    } else { const parts = String(url).split('/'); const sid = parts.at(-1) === 'expire' ? parts.at(-2) : parts.at(-1); s = sessions.get(sid); if (options.method === 'POST') s.attributes.status = 'expired'; }
    return { ok: true, json: async () => ({ data: malformed ? { ...s, id: 'wrong-session' } : structuredClone(s) }) };
  };
  t.after(() => { global.fetch = originalFetch; });
  const app = express(); app.use(express.json()); app.use('/api/payments',require('../src/routes/payments')); app.use((e,req,res,next) => res.status(e.status || 500).json({ message: e.message }));
  const server = await new Promise(resolve => { const s = app.listen(0,'127.0.0.1',() => resolve(s)); }); t.after(() => new Promise(resolve => server.close(resolve)));
  async function call(action, actor = customer, expected = 200) {
    const response = await originalFetch(`http://127.0.0.1:${server.address().port}/api/payments/${id}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(actor ? { Authorization: `Bearer ${jwt.sign({},process.env.JWT_SECRET,{ subject: actor })}` } : {}) }, body: JSON.stringify({ amount: 1 }) });
    const json = await response.json(); assert.equal(response.status,expected,JSON.stringify(json)); return json.data;
  }
  await call('checkout',null,401); await call('checkout',tech,403); await call('checkout',other,403); await call('checkout',customer,409); assert.equal(creations,0);
  repair.status = 'COMPLETED'; repair.outcome = 'UNSUCCESSFUL'; await call('checkout',customer,409);
  repair.outcome = 'SUCCESSFUL'; await call('checkout'); await call('checkout'); assert.equal(creations,1);
  assert.equal((await call('verify')).checkoutState,'PENDING');
  malformed = true; await call('verify',customer,409); malformed = false; assert.equal(stored.status,'PENDING');
  assert.equal((await call('cancel')).checkoutState,'CANCELLED');
  await call('checkout'); assert.equal(creations,2); assert.ok(audits.some(a => a.action === 'CHECKOUT_REPLACED' && a.details.checkoutId === 'cs_1'));
  sessions.get('cs_2').attributes.status = 'expired'; assert.equal((await call('verify')).checkoutState,'EXPIRED');
  await call('checkout'); assert.equal(creations,3);
  const s = sessions.get('cs_3'); s.attributes.payments = [{ id: 'pay_test', attributes: { status: 'paid', currency: 'PHP', livemode: false, amount: 1, payment_intent_id: 'pi_test' } }];
  await call('verify',customer,409); assert.equal(stored.status,'PENDING');
  s.attributes.payments[0].attributes.amount = 50000;
  assert.equal((await call('verify')).status,'PAID'); assert.equal((await call('verify')).status,'PAID');
  await call('checkout',customer,409); await call('cancel',customer,409); assert.equal(creations,3);
});
