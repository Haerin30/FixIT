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
  await request('/auth/login', null, { email: customer.user.email, password: randomUUID() }, 401);
  await request('/auth/register', null, { fname: 'Duplicate', lname: 'Test', email: customer.user.email, password }, 409);
  assert.equal((await request('/profile', tech.token)).isAvailable, false);
  await request('/auth/register', null, { fname: 'No', lname: 'Admin', email: 'no-admin@example.invalid', password, role: 'Administrator' }, 400);
  const category = (await request('/categories'))[0]; assert.ok(category);
  const profile = await prisma.technicianProfile.findUnique({ where: { userId: tech.user.id } });
  const profileResponse = await fetch(base + '/technicians/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tech.token}` }, body: JSON.stringify({ bio: 'Integration test technician', yearsExperience: 2, categoryIds: [category.id], serviceAreas: [{ city: 'Cebu City', province: 'Cebu' }], isAvailable: true }) });
  assert.equal(profileResponse.status, 200);
  const browse = await request('/technicians'); assert.ok(browse.technicians.some(t => t.id === profile.id));
  await request(`/technicians/${profile.id}`);
  const filtered = await request('/technicians?' + new URLSearchParams({ city: 'Cebu City', category: category.name }));
  assert.ok(filtered.technicians.some(t => t.id === profile.id));
  async function createRepair() {
    const r = await request('/repairs', customer.token, { technicianProfileId: profile.id, repairCategoryId: category.id, title: 'Smoke repair', description: 'Isolated integration test', deviceType: 'Laptop', serviceAddress: 'Smoke test address' }, 201);
    repairs.push(r.id); return r;
  }
  const r = await createRepair();
  await request(`/repairs/${r.id}/reviews`, customer.token, { rating: 5, comment: 'Not completed yet' }, 409);
  await request(`/repairs/${r.id}/messages`, other.token, { body: 'Not my conversation' }, 403);
  await request(`/repairs/${r.id}/messages`, customer.token, { body: ' ' }, 400);
  await request(`/repairs/${r.id}/messages`, customer.token, { body: 'x'.repeat(2001) }, 400);
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
      const expiredResponse = await fetch(`https://api.paymongo.com/v1/checkout_sessions/${encodeURIComponent(checkout.providerCheckoutId)}/expire`, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${process.env.PAYMONGO_SECRET_KEY}:`).toString('base64')}` }, signal: AbortSignal.timeout(20000) });
      assert.ok(expiredResponse.ok);
      assert.equal((await request(`/payments/${r.id}/verify`, customer.token, {})).checkoutState, 'EXPIRED');
      const retry = await request(`/payments/${r.id}/checkout`, customer.token, {});
      assert.ok(retry.checkoutUrl);
      const replacement = await prisma.payment.findUnique({ where: { repairRequestId: r.id } });
      assert.notEqual(replacement.providerCheckoutId, checkout.providerCheckoutId);
      checkout = replacement;
      assert.equal((await request(`/payments/${r.id}/cancel`, customer.token, {})).checkoutState, 'CANCELLED');
      console.log('PASS: real provider-confirmed expiration, safe checkout replacement, cancellation and persisted attempt history.');
    } finally {
      if (checkout?.providerCheckoutId) {
        const stateResponse = await fetch(`https://api.paymongo.com/v1/checkout_sessions/${encodeURIComponent(checkout.providerCheckoutId)}`, { headers: { Authorization: `Basic ${Buffer.from(`${process.env.PAYMONGO_SECRET_KEY}:`).toString('base64')}` }, signal: AbortSignal.timeout(20000) });
        const providerState = await stateResponse.json();
        const response = providerState.data?.attributes?.status === 'expired' ? { ok: true } : await fetch(`https://api.paymongo.com/v1/checkout_sessions/${encodeURIComponent(checkout.providerCheckoutId)}/expire`, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${process.env.PAYMONGO_SECRET_KEY}:`).toString('base64')}` }, signal: AbortSignal.timeout(20000) });
        assert.ok(response.ok, 'The unused test checkout could not be expired.');
        await prisma.payment.delete({ where: { id: checkout.id } });
        console.log('PASS: integration checkout expired; no payment made.');
      }
    }
  }
  console.log('Payment paid/failed/mismatch simulations run only in isolated in-memory tests, never against PostgreSQL.');
  await request(`/repairs/${r.id}/reviews`, customer.token, { rating: 5, comment: 'Integration test review' }, 201);
  await request(`/repairs/${r.id}/reviews`, customer.token, { rating: 4, comment: 'Duplicate review' }, 409);
  const ratedProfile = (await request(`/technicians/${profile.id}`)).technician;
  assert.equal(ratedProfile.rating.averageRating, 5); assert.equal(ratedProfile.rating.reviewCount, 1); assert.equal(ratedProfile.completedRepairs, 1);
  const failed = await createRepair();
  await request(`/repairs/${failed.id}/action`, tech.token, { action: 'accept' });
  const s2 = await request(`/repairs/${failed.id}/schedules`, customer.token, { proposedStart: new Date(Date.now()+86400000).toISOString(), proposedEnd: new Date(Date.now()+90000000).toISOString() }, 201);
  await request(`/repairs/${failed.id}/schedules/${s2.id}/respond`, tech.token, { status: 'CONFIRMED' });
  await request(`/repairs/${failed.id}/action`, tech.token, { action: 'start' });
  const result = await request(`/repairs/${failed.id}/action`, tech.token, { action: 'failed', finalCost: 999 });
  assert.equal(Number(result.finalCost), 0);
  await request(`/payments/${failed.id}/checkout`, customer.token, {}, 409);
  await request(`/repairs/${failed.id}/reviews`, customer.token, { rating: 1, comment: 'Ineligible failed repair' }, 409);
  const rejected = await createRepair(); await request(`/repairs/${rejected.id}/action`, tech.token, { action: 'reject' });
  const cancelled = await createRepair(); await request(`/repairs/${cancelled.id}/action`, customer.token, { action: 'cancel' });
  assert.equal((await request('/repairs', customer.token)).length, 4);
  const adminRole = await prisma.role.findUnique({ where: { name: 'Administrator' } });
  await prisma.user.update({ where: { id: other.user.id }, data: { roleId: adminRole.id } });
  assert.ok((await request('/admin/summary', other.token)).users >= 3);
  const adminUsers = await request('/admin/users?role=Technician&q=Smoke', other.token);
  assert.ok(adminUsers.users.some(u => u.id === tech.user.id));
  await request('/admin/repairs', other.token);
  await request('/admin/payments', other.token);
  await request('/admin/users', customer.token, undefined, 403);
  const adminProfile = await request(`/admin/technicians/${profile.id}`, other.token);
  assert.equal(adminProfile.user.id, tech.user.id);
  const setActive = async isActive => {
    const response = await fetch(base + `/admin/users/${tech.user.id}/active`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${other.token}` }, body: JSON.stringify({ isActive }) });
    assert.equal(response.status, 200);
  };
  await setActive(false);
  await request('/profile', tech.token, undefined, 401);
  await setActive(true);
  assert.equal((await request('/profile', tech.token)).user.id, tech.user.id);
  console.log('PASS: admin directories, profile inspection, audited deactivation/reactivation, active-session rejection.');
  try { const locations = await request('/locations'); assert.ok(locations.length > 100); console.log('PASS: live public PSGC REST API'); } catch (e) { console.log('BLOCKED: public location provider', e.message); process.exitCode = 1; }
  console.log('PASS: isolated PostgreSQL registration/login, both roles, profiles, browsing, bookings, authorization, schedules, repair lifecycle, No Fix No Pay, persisted messages and review eligibility.');
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
