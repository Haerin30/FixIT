// Elevates an explicitly selected EXISTING account. Never creates or prints a password.
require('dotenv').config({ quiet: true });
const prisma = require('../src/lib/prisma');
async function main() {
  const args = process.argv.slice(2), index = args.indexOf('--email');
  if (index < 0 || !args.includes('--confirm')) throw new Error('Usage: node scripts/provision-admin.js --email <trusted-existing-account> --confirm');
  const email = (args[index + 1] || '').trim().toLowerCase();
  await prisma.$transaction(async db => {
    const user = await db.user.findUnique({ where: { email }, select: { id: true, isActive: true, technicianProfile: { select: { id: true } } } });
    if (!user || !user.isActive) throw new Error('Select an existing active trusted account.');
    if (user.technicianProfile) throw new Error('Use a separate administrator account, not a technician account.');
    const role = await db.role.findUnique({ where: { name: 'Administrator' } });
    if (!role) throw new Error('Seed the Administrator role first.');
    await db.user.update({ where: { id: user.id }, data: { roleId: role.id } });
    await db.auditLog.create({ data: { actorId: user.id, action: 'ADMIN_PROVISIONED_BY_OPERATOR', entityType: 'User', entityId: user.id, details: { method: 'trusted-local-cli' } } });
  });
  console.log('Trusted administrator provisioned. Sign in using the existing account credentials.');
}
main().catch(e => { console.error(e.code ? 'Administrator provisioning failed; check database connectivity.' : e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
