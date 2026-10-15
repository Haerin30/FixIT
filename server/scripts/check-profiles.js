// Read-only validation of public and owner profile queries against existing PostgreSQL data.
require('dotenv').config({ quiet: true });
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const prisma = require('../src/lib/prisma');
const app = require('../src/index');
let server;
async function main() {
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const profiles = await prisma.technicianProfile.findMany({ where: { user: { isActive: true } }, take: 20, select: { id: true, userId: true } });
  for (const profile of profiles) {
    const token = jwt.sign({}, process.env.JWT_SECRET, { subject: profile.userId, expiresIn: '2m' });
    const [publicResponse, ownerResponse] = await Promise.all([
      fetch(`${base}/technicians/${profile.id}`),
      fetch(`${base}/profile`, { headers: { Authorization: `Bearer ${token}` } }),
    ]);
    assert.equal(publicResponse.status, 200, 'Public profile HTTP status'); assert.equal(ownerResponse.status, 200, 'Owner profile HTTP status');
    const publicProfile = (await publicResponse.json()).data.technician;
    const ownerProfile = (await ownerResponse.json()).data;
    assert.deepEqual(ownerProfile, publicProfile);
    const [reviews, completed] = await Promise.all([
      prisma.review.findMany({ where: { technicianProfileId: profile.id, repairRequest: { status: 'COMPLETED', outcome: 'SUCCESSFUL' } }, select: { rating: true } }),
      prisma.repairRequest.count({ where: { technicianProfileId: profile.id, status: 'COMPLETED', outcome: 'SUCCESSFUL' } }),
    ]);
    const expected = reviews.length ? Number((reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(2)) : null;
    assert.equal(publicProfile.rating.averageRating, expected);
    assert.equal(publicProfile.rating.reviewCount, reviews.length);
    assert.equal(publicProfile.completedRepairs, completed);
  }
  const listingResponse = await fetch(`${base}/technicians?limit=50`);
  assert.equal(listingResponse.status, 200);
  const listing = (await listingResponse.json()).data.technicians;
  for (const card of listing) {
    const response = await fetch(`${base}/technicians/${card.id}`);
    const detail = (await response.json()).data.technician;
    assert.deepEqual(card.rating, detail.rating, 'Marketplace card rating must match detail rating');
    assert.equal(card.completedRepairs, detail.completedRepairs);
  }
  console.log(`PASS: ${profiles.length} existing public/owner profiles match; ratings, counts, completed repairs and ${listing.length} marketplace cards agree with stored PostgreSQL records. No data changed.`);
}
main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await prisma.$disconnect();
});
