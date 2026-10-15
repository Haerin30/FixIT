// Creates isolated, randomly named smoke-test records and removes only those records.
require('dotenv').config({ quiet: true });
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const prisma = require('../src/lib/prisma');
const app = require('../src/index');
const users = [], repairs = [];
let server;
async function main() {
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function request(path, token, body, expected = 200) {
    const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const json = await response.json(); assert.equal(response.status, expected, `${path}: ${json.message || response.status}`); return json.data;
  }
  const password = randomUUID();
  const accounts = [];
  for (const role of ['Customer', 'Technician', 'Customer']) {
    const email = `fixit-smoke-${randomUUID()}@example.invalid`;
    const registered = await request('/auth/register', null, { fname: 'Smoke', lname: 'Test', email, password, role }, 201);
    users.push(registered.user.id);
    const logged = await request('/auth/login', null, { email, password });
    accounts.push(logged);
    assert.equal((await request('/auth/me', logged.token)).role, role);
  }
  const [customer, tech, other] = accounts;
  await request('/auth/register', null, { fname: 'No', lname: 'Admin', email: 'no-admin@example.invalid', password, role: 'Administrator' }, 400);
  const category = (await request('/categories'))[0]; assert.ok(category);
  const profile = await prisma.technicianProfile.findUnique({ where: { userId: tech.user.id } });
  const profileResponse = await fetch(base + '/technicians/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tech.token}` }, body: JSON.stringify({ bio: 'Integration test technician', yearsExperience: 2, categoryIds: [category.id], serviceAreas: [{ city: 'Cebu City', province: 'Cebu' }], isAvailable: true }) });
  assert.equal(profileResponse.status, 200);
  const browse = await request('/technicians'); assert.ok(browse.technicians.some(t => t.id === profile.id));
  await request(`/technicians/${profile.id}`);
  async function createRepair() {
    const r = await request('/repairs', customer.token, { technicianProfileId: profile.id, repairCategoryId: category.id, title: 'Smoke repair', description: 'Isolated integration test', deviceType: 'Laptop', serviceAddress: 'Smoke test address' }, 201);
    repairs.push(r.id); return r;
  }
  const r = await createRepair();
  await request(`/repairs/${r.id}/messages`, other.token, undefined, 403);
  await request('/admin/summary', customer.token, undefined, 403);
  await request(`/repairs/${r.id}/action`, customer.token, { action: 'accept' }, 409);
  await request(`/repairs/${r.id}/action`, tech.token, { action: 'accept' });
  await request(`/repairs/${r.id}/action`, tech.token, { action: 'start' }, 400);
  const schedule = await request(`/repairs/${r.id}/schedules`, tech.token, { proposedStart: new Date(Date.now()+86400000).toISOString(), proposedEnd: new Date(Date.now()+90000000).toISOString() }, 201);
  await request(`/repairs/${r.id}/schedules/${schedule.id}/respond`, tech.token, { status: 'CONFIRMED' }, 409);
  await request(`/repairs/${r.id}/schedules/${schedule.id}/respond`, customer.token, { status: 'CONFIRMED' });
  await request(`/repairs/${r.id}/messages`, customer.token, { body: 'Test message' }, 201);
  assert.equal((await request(`/repairs/${r.id}/messages`, tech.token))[0].body, 'Test message');
  await request(`/repairs/${r.id}/action`, tech.token, { action: 'start' });
  await request(`/payments/${r.id}/checkout`, customer.token, {}, 409);
  await request(`/repairs/${r.id}/action`, tech.token, { action: 'finish', finalCost: 500 });
  await request(`/repairs/${r.id}/action`, customer.token, { action: 'confirm' });
  if (!process.env.PAYMONGO_SECRET_KEY) await request(`/payments/${r.id}/checkout`, customer.token, {}, 503);
  if (process.argv.includes('--paymongo')) {
    assert.ok((process.env.PAYMONGO_SECRET_KEY || '').startsWith('sk_test_'), 'Configure a PayMongo test key first.');
    let checkout;
    try {
      assert.ok((await request(`/payments/${r.id}/checkout`, customer.token, {})).checkoutUrl);
      checkout = await prisma.payment.findUnique({ where: { repairRequestId: r.id } });
      assert.ok(checkout.providerCheckoutId);
      assert.equal((await request(`/payments/${r.id}/verify`, customer.token, {})).status, 'PENDING');
      console.log('PASS: real application repair -> PayMongo test checkout -> persisted session -> server-side pending verification');
    } finally {
      if (checkout?.providerCheckoutId) {
        const response = await fetch(`https://api.paymongo.com/v1/checkout_sessions/${encodeURIComponent(checkout.providerCheckoutId)}/expire`, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${process.env.PAYMONGO_SECRET_KEY}:`).toString('base64')}` }, signal: AbortSignal.timeout(20000) });
        assert.ok(response.ok, 'The unused test checkout could not be expired.');
        await prisma.payment.delete({ where: { id: checkout.id } });
        console.log('PASS: integration checkout expired; no payment made.');
      }
    }
  }
  const originalFetch = global.fetch, originalKey = process.env.PAYMONGO_SECRET_KEY;
  let providerPaid = false, providerAmount = 50000, creations = 0;
  process.env.PAYMONGO_SECRET_KEY = 'sk_test_isolated_contract_test';
  const sessionId = `cs_${randomUUID()}`;
  global.fetch = async (url, options) => {
    if (!String(url).startsWith('https://api.paymongo.com/')) return originalFetch(url, options);
    if (options.method === 'POST') {
      creations++;
      const attrs = JSON.parse(options.body).data.attributes;
      assert.equal(attrs.line_items[0].amount, 50000);
      assert.equal(attrs.line_items[0].currency, 'PHP');
      assert.equal(attrs.reference_number, r.id);
    }
    return { ok: true, json: async () => ({ data: { id: sessionId, attributes: { livemode: false, checkout_url: 'https://checkout.paymongo.com/isolated-test', payments: providerPaid ? [{ id: `pay_${sessionId}`, attributes: { status: 'paid', livemode: false, currency: 'PHP', amount: providerAmount } }] : [] } } }) };
  };
  try {
    assert.ok((await request(`/payments/${r.id}/checkout`, customer.token, {})).checkoutUrl);
    assert.ok((await request(`/payments/${r.id}/checkout`, customer.token, {})).checkoutUrl);
    assert.equal(creations, 1, 'Existing checkout must be reused');
    assert.equal((await request(`/payments/${r.id}/verify`, customer.token, {})).status, 'PENDING');
    providerPaid = true; providerAmount = 1;
    await request(`/payments/${r.id}/verify`, customer.token, {}, 409);
    providerAmount = 50000;
    assert.equal((await request(`/payments/${r.id}/verify`, customer.token, {})).status, 'PAID');
    assert.equal((await request(`/payments/${r.id}/verify`, customer.token, {})).status, 'PAID');
    await request(`/payments/${r.id}/checkout`, customer.token, {}, 409);
    console.log('PASS: mocked PayMongo contract, centavo amount, checkout reuse, pending/paid verification, amount mismatch, repeat payment prevention');
  } finally { global.fetch = originalFetch; if (originalKey === undefined) delete process.env.PAYMONGO_SECRET_KEY; else process.env.PAYMONGO_SECRET_KEY = originalKey; }
  await request(`/repairs/${r.id}/reviews`, customer.token, { rating: 5, comment: 'Integration test review' }, 201);
  await request(`/repairs/${r.id}/reviews`, customer.token, { rating: 4, comment: 'Duplicate review' }, 409);
  const failed = await createRepair();
  await request(`/repairs/${failed.id}/action`, tech.token, { action: 'accept' });
  const s2 = await request(`/repairs/${failed.id}/schedules`, customer.token, { proposedStart: new Date(Date.now()+86400000).toISOString(), proposedEnd: new Date(Date.now()+90000000).toISOString() }, 201);
  await request(`/repairs/${failed.id}/schedules/${s2.id}/respond`, tech.token, { status: 'CONFIRMED' });
  await request(`/repairs/${failed.id}/action`, tech.token, { action: 'start' });
  const result = await request(`/repairs/${failed.id}/action`, tech.token, { action: 'failed', finalCost: 999 });
  assert.equal(Number(result.finalCost), 0);
  await request(`/payments/${failed.id}/checkout`, customer.token, {}, 409);
  const rejected = await createRepair(); await request(`/repairs/${rejected.id}/action`, tech.token, { action: 'reject' });
  const cancelled = await createRepair(); await request(`/repairs/${cancelled.id}/action`, customer.token, { action: 'cancel' });
  assert.equal((await request('/repairs', customer.token)).length, 4);
  const adminRole = await prisma.role.findUnique({ where: { name: 'Administrator' } });
  await prisma.user.update({ where: { id: other.user.id }, data: { roleId: adminRole.id } });
  assert.ok((await request('/admin/summary', other.token)).users >= 3);
  try { const locations = await request('/locations'); assert.ok(locations.length > 100); console.log('PASS: live public PSGC REST API'); } catch (e) { console.log('BLOCKED: public location provider', e.message); process.exitCode = 1; }
  console.log('PASS: PostgreSQL registration/login, both roles, browsing, requests, authorization, acceptance/rejection/cancellation, schedules, repair lifecycle, No Fix No Pay, messaging, reviews, missing payment configuration');
}
main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  // All filters are IDs generated during this run; existing marketplace records are untouched.
  await prisma.review.deleteMany({ where: { repairRequestId: { in: repairs } } });
  await prisma.payment.deleteMany({ where: { repairRequestId: { in: repairs } } });
  await prisma.repairRequest.deleteMany({ where: { id: { in: repairs } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});
