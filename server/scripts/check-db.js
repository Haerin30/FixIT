require('dotenv').config({ quiet: true });
const prisma = require('../src/lib/prisma');
console.log({ databaseConfigured: !!process.env.DATABASE_URL, jwtConfigured: !!process.env.JWT_SECRET, paymongoTestConfigured: (process.env.PAYMONGO_SECRET_KEY || '').startsWith('sk_test_') });
prisma.role.findMany({ select: { name: true } }).then(roles => console.log({ databaseConnected: true, roles })).catch(e => { console.log({ databaseConnected: false, code: e.code || 'CONNECTION_FAILED' }); process.exitCode = 1; }).finally(() => prisma.$disconnect());
