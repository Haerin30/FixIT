const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const { validateReview } = require('../src/lib/reviews');
const customerId = '00000000-0000-4000-8000-000000000001';
const techId = '00000000-0000-4000-8000-000000000002';
const profileId = '00000000-0000-4000-8000-000000000003';
const requestId = '00000000-0000-4000-8000-000000000004';
const strangerId = '00000000-0000-4000-8000-000000000005';
const repair = { id: requestId, customerId, technicianProfileId: profileId, technicianProfile: { userId: techId }, status: 'COMPLETED', outcome: 'SUCCESSFUL', review: null };

test('review eligibility rejects failed, pending, unconfirmed, wrong customer, and duplicate reviews', () => {
  for (const status of ['PENDING', 'ACCEPTED', 'IN_PROGRESS', 'AWAITING_CUSTOMER_CONFIRMATION', 'FAILED', 'CANCELLED', 'REJECTED']) assert.throws(() => validateReview({ ...repair, status }, customerId, { rating: 5, comment: 'Test' }), { status: 409 });
  for (const outcome of ['UNSUCCESSFUL', null]) assert.throws(() => validateReview({ ...repair, outcome }, customerId, { rating: 5, comment: 'Test' }));
  assert.throws(() => validateReview(repair, strangerId, { rating: 5, comment: 'Test' }));
  assert.throws(() => validateReview({ ...repair, review: { id: 'existing' } }, customerId, { rating: 5, comment: 'Test' }));
  assert.throws(() => validateReview({ ...repair, technicianProfileId: null }, customerId, { rating: 5, comment: 'Test' }));
});
test('review inputs accept only integer stars and nonblank bounded feedback', () => {
  for (const rating of [0, 6, 2.5, '5', null, NaN]) assert.throws(() => validateReview(repair, customerId, { rating, comment: 'Feedback' }));
  for (const comment of ['', '  ', null, 'a'.repeat(2001)]) assert.throws(() => validateReview(repair, customerId, { rating: 5, comment }));
  assert.equal(validateReview(repair, customerId, { rating: 4, comment: '  Fixed my laptop.  ' }).comment, 'Fixed my laptop.');
});

test('HTTP profiles, marketplace ratings, owner access and review updates share actual review data', async t => {
  process.env.JWT_SECRET = 'isolated-ratings-test-secret';
  let available = true;
  const stored = [
    { id: 'review-1', rating: 5, comment: 'Excellent repair.', status: 'COMPLETED', outcome: 'SUCCESSFUL' },
    { id: 'review-2', rating: 3, comment: 'Completed successfully.', status: 'COMPLETED', outcome: 'SUCCESSFUL' },
    { id: 'legacy-failed', rating: 1, comment: 'Failed repair.', status: 'FAILED', outcome: 'UNSUCCESSFUL' },
  ];
  function eligible(where) {
    assert.deepEqual(where.repairRequest, { status: 'COMPLETED', outcome: 'SUCCESSFUL' });
    return stored.filter(r => r.status === 'COMPLETED' && r.outcome === 'SUCCESSFUL');
  }
  function rawProfile() { return { id: profileId, userId: techId, updatedAt: '2026-10-15T00:00:00.000Z', bio: 'Technician biography', yearsExperience: 4, serviceDescription: 'Repair services', isAvailable: available, user: { id: techId, fname: 'Test', lname: 'Technician' }, specialties: [{ yearsExperience: 4, repairCategory: { id: 1, name: 'Laptop Repair' } }], serviceAreas: [{ serviceArea: { city: 'Cebu City', province: 'Cebu' } }] }; }
  const db = {
    user: { findUnique: async ({ where }) => ({ id: where.id, fname: 'Test', lname: 'User', email: 'test@example.invalid', isActive: true, role: { name: where.id === techId ? 'Technician' : 'Customer' } }) },
    technicianProfile: {
      findFirst: async ({ where }) => (where.id && where.id !== profileId) || (where.userId && where.userId !== techId) ? null : rawProfile(),
      findMany: async () => available ? [rawProfile()] : [], count: async () => available ? 1 : 0,
    },
    repairRequest: {
      findUnique: async () => ({ ...repair }),
      count: async ({ where }) => { assert.equal(where.status, 'COMPLETED'); assert.equal(where.outcome, 'SUCCESSFUL'); return 7; },
      groupBy: async ({ where }) => { assert.equal(where.status, 'COMPLETED'); assert.equal(where.outcome, 'SUCCESSFUL'); return [{ technicianProfileId: profileId, _count: { _all: 7 } }]; },
    },
    review: {
      aggregate: async ({ where }) => { const rows = eligible(where); return { _avg: { rating: rows.length ? rows.reduce((a,r) => a+r.rating,0)/rows.length : null }, _count: { _all: rows.length } }; },
      groupBy: async ({ where }) => { const rows = eligible(where); return [{ technicianProfileId: profileId, _avg: { rating: rows.length ? rows.reduce((a,r) => a+r.rating,0)/rows.length : null }, _count: { _all: rows.length } }]; },
      count: async ({ where }) => eligible(where).length,
      findMany: async ({ where, skip = 0, take = 10 }) => eligible(where).slice(skip,skip+take).map(({ status, outcome, ...r }) => ({ ...r, createdAt: '2026-10-15T00:00:00.000Z', customer: { fname: 'Repair', lname: 'Customer' } })),
      create: async ({ data }) => {
        if (stored.some(r => r.repairRequestId === data.repairRequestId)) throw Object.assign(new Error('Duplicate'), { code: 'P2002' });
        const row = { ...data, id: 'new-review', status: 'COMPLETED', outcome: 'SUCCESSFUL' }; stored.push(row); return row;
      },
    },
    $transaction: async fn => fn(db), $executeRaw: async () => 0,
  };
  const prismaKey = require.resolve('../src/lib/prisma');
  require.cache[prismaKey] = { id: prismaKey, filename: prismaKey, loaded: true, exports: db };
  const app = express();
  app.use(express.json());
  app.use('/api/technicians', require('../src/routes/technicians'));
  app.use('/api', require('../src/routes/marketplace').router);
  app.use((error, req, res, next) => res.status(error.code === 'P2002' ? 409 : error.status || 500).json({ message: error.message }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  async function request(path, userId, body, expected = 200) {
    const token = userId && jwt.sign({}, process.env.JWT_SECRET, { subject: userId, expiresIn: '5m' });
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json(); assert.equal(response.status, expected, JSON.stringify(data)); return data.data;
  }
  const publicProfile = (await request(`/technicians/${profileId}`)).technician;
  const ownerProfile = await request('/profile', techId);
  assert.deepEqual(ownerProfile, publicProfile);
  assert.deepEqual(publicProfile.rating, { averageRating: 4, reviewCount: 2 });
  assert.equal(publicProfile.completedRepairs, 7);
  assert.equal(publicProfile.reviews.length, 2);
  assert.equal(publicProfile.reviews[0].customerName, 'Repair Customer');
  const listing = (await request('/technicians')).technicians[0];
  assert.deepEqual(listing.rating, publicProfile.rating);
  assert.equal(listing.completedRepairs, 7);
  await request('/profile', customerId, null, 403);
  await request('/profile', null, null, 401);
  await request(`/repairs/${requestId}/reviews`, techId, { rating: 5, comment: 'Not a customer' }, 403);
  await request(`/repairs/${requestId}/reviews`, strangerId, { rating: 5, comment: 'Not my repair' }, 403);
  await request(`/repairs/${requestId}/reviews`, customerId, { rating: 2.5, comment: 'Invalid stars' }, 400);
  await request(`/repairs/${requestId}/reviews`, customerId, { rating: 5, comment: 'Fixed my computer.' }, 201);
  await request(`/repairs/${requestId}/reviews`, customerId, { rating: 1, comment: 'Duplicate' }, 409);
  const updated = (await request(`/technicians/${profileId}`)).technician;
  assert.deepEqual(updated.rating, { averageRating: 4.33, reviewCount: 3 });
  assert.deepEqual((await request('/technicians')).technicians[0].rating, updated.rating);
  assert.equal((await request(`/technicians/${profileId}/reviews?page=2`)).reviews.length, 0);
  await request('/technicians/invalid-id', null, null, 400);
  available = false;
  assert.equal((await request('/profile', techId)).isAvailable, false);
  assert.equal((await request(`/technicians/${profileId}`)).technician.isAvailable, false);
  stored.splice(0, stored.length);
  const empty = (await request(`/technicians/${profileId}`)).technician;
  assert.deepEqual(empty.rating, { averageRating: null, reviewCount: 0 });
  assert.deepEqual(empty.reviews, []);
});
