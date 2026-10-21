// Run ONLY with a dedicated migrated TEST_DATABASE_URL. No application .env fallback.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
const { passwordResetService, hashToken, takeLimit } = require('../src/lib/password-reset');
if (!process.env.TEST_DATABASE_URL) throw new Error('Set TEST_DATABASE_URL to a dedicated migrated test database.');
const { PrismaClient } = require(process.env.RESET_TEST_CLIENT || '@prisma/client');
const db = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const ids = [], repairId = randomUUID(), categoryName = `reset-test-${randomUUID()}`;
let category;

async function main() {
  const roles = await Promise.all(['Customer', 'Technician', 'Administrator'].map(name => db.role.upsert({ where: { name }, update: {}, create: { name } })));
  for (const role of roles) {
    const id = randomUUID(); ids.push(id);
    await db.user.create({ data: { id, roleId: role.id, email: `${id}@example.invalid`, fname: 'Reset', lname: 'Test', phone: '123', passwordHash: await bcrypt.hash('old-password', 4), ...(role.name === 'Technician' ? { technicianProfile: { create: { bio: 'Preserve this profile' } } } : {}) } });
  }
  category = await db.repairCategory.create({ data: { name: categoryName } });
  const profile = await db.technicianProfile.findUnique({ where: { userId: ids[1] } });
  await db.repairRequest.create({ data: {
    id: repairId, customerId: ids[0], technicianProfileId: profile.id, repairCategoryId: category.id,
    title: 'Existing repair', description: 'Must survive a reset', deviceType: 'Laptop', serviceAddress: 'Test address',
    status: 'COMPLETED', outcome: 'SUCCESSFUL', finalCost: 100,
    schedules: { create: { proposedById: ids[1], proposedStart: new Date(), proposedEnd: new Date(Date.now() + 3600000), status: 'CONFIRMED' } },
    payment: { create: { amount: 100, status: 'PAID' } },
    review: { create: { customerId: ids[0], technicianProfileId: profile.id, rating: 5, comment: 'Preserve review' } },
    conversation: { create: { messages: { create: { senderId: ids[0], body: 'Preserve message' } } } },
  } });
  const readRepair = () => db.repairRequest.findUnique({ where: { id: repairId }, include: { payment: true, review: true, schedules: true, conversation: { include: { messages: true } } } });
  const beforeRepair = await readRepair(), beforeProfile = await db.technicianProfile.findUnique({ where: { id: profile.id } });
  for (const id of ids) {
    const before = await db.user.findUnique({ where: { id } }), mail = [];
    const service = passwordResetService(db, async (_, token) => mail.push(token));
    await service.issue(before.email); await service.issue(before.email);
    let results = await Promise.allSettled([service.redeem(mail[0], 'new-password'), service.redeem(mail[0], 'new-password')]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1, 'one winner for the same token');
    await assert.rejects(service.redeem(mail[1], 'other-password'), /invalid or expired/);
    await service.issue(before.email); await service.issue(before.email);
    results = await Promise.allSettled([service.redeem(mail[2], 'final-password'), service.redeem(mail[3], 'final-password')]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1, 'one winner across distinct outstanding tokens');
    const after = await db.user.findUnique({ where: { id } });
    assert.equal(after.sessionVersion, 2);
    assert.deepEqual({ ...after, passwordHash: before.passwordHash, sessionVersion: before.sessionVersion, updatedAt: before.updatedAt }, before);
    assert.ok(await bcrypt.compare('final-password', after.passwordHash));
    assert.equal(await bcrypt.compare('old-password', after.passwordHash), false);
    await service.issue(before.email);
    await db.passwordResetToken.update({ where: { tokenHash: hashToken(mail[4]) }, data: { expiresAt: new Date(Date.now() - 1) } });
    await assert.rejects(service.redeem(mail[4], 'expired-password'), /invalid or expired/);
  }
  assert.deepEqual(await readRepair(), beforeRepair);
  assert.deepEqual(await db.technicianProfile.findUnique({ where: { id: profile.id } }), beforeProfile);
  const mail = [], service = passwordResetService(db, async (_, token) => mail.push(token));
  const inactive = await db.user.update({ where: { id: ids[0] }, data: { isActive: false, sessionVersion: 2147483647 } });
  await service.issue(inactive.email);
  await assert.rejects(service.redeem(mail[0], 'rollback-password'));
  assert.equal((await db.passwordResetToken.findUnique({ where: { tokenHash: hashToken(mail[0]) } })).usedAt, null, 'failed password update rolls token consumption back');
  await db.user.update({ where: { id: ids[0] }, data: { sessionVersion: 2 } });
  await service.redeem(mail[0], 'inactive-password');
  assert.equal((await db.user.findUnique({ where: { id: ids[0] } })).isActive, false);
  const counter = randomUUID();
  try {
    const limits = await Promise.all(Array.from({ length: 20 }, () => takeLimit(db, 'integration', counter, 3)));
    assert.equal(limits.filter(Boolean).length, 3, 'atomic shared limits');
    await db.passwordResetRateLimit.update({ where: { key: hashToken(`integration:${counter}`) }, data: { expiresAt: new Date(0) } });
    assert.equal(await takeLimit(db, 'integration', counter, 3), true);
  } finally { await db.passwordResetRateLimit.deleteMany({ where: { key: hashToken(`integration:${counter}`) } }); }
  console.log('PASS: PostgreSQL concurrency, rollback, expiry, all roles, inactive status, record preservation and shared limits.');
}
main().catch(() => { console.error('Password reset database integration failed. Verify the dedicated test schema and generated client.'); process.exitCode = 1; }).finally(async () => {
  await db.review.deleteMany({ where: { repairRequestId: repairId } });
  await db.payment.deleteMany({ where: { repairRequestId: repairId } });
  await db.repairRequest.deleteMany({ where: { id: repairId } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  if (category) await db.repairCategory.delete({ where: { id: category.id } });
  await db.$disconnect();
});
