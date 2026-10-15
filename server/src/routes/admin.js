const router = require('express').Router();
const prisma = require('../lib/prisma');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { fail } = require('../lib/workflow');
const wrap = fn => async (req, res, next) => { try { await fn(req, res); } catch (error) { next(error); } };
router.use(authenticateToken, requireRole('Administrator'));
const userSelect = { id: true, fname: true, lname: true, email: true, isActive: true, createdAt: true, role: { select: { name: true } }, technicianProfile: { select: { id: true, isAvailable: true } } };
function paging(req) { const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.page, 10) || 1)); return { page, skip: (page - 1) * 20, take: 20 }; }
router.get('/users', wrap(async (req, res) => {
  const p = paging(req), q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0,100) : '';
  const role = req.query.role, active = req.query.active;
  if (role && !['Customer','Technician','Administrator'].includes(role)) throw fail('Invalid role filter.');
  if (active && !['true','false'].includes(active)) throw fail('Invalid account status filter.');
  const where = { ...(role ? { role: { name: role } } : {}), ...(active ? { isActive: active === 'true' } : {}), ...(q ? { OR: ['fname','lname','email'].map(key => ({ [key]: { contains: q, mode: 'insensitive' } })) } : {}) };
  const [users, total] = await Promise.all([prisma.user.findMany({ where, select: userSelect, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: p.skip, take: p.take }), prisma.user.count({ where })]);
  res.json({ data: { users, pagination: { page: p.page, total, totalPages: Math.ceil(total / 20) } } });
}));
router.patch('/users/:id/active', wrap(async (req, res) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id) || typeof req.body?.isActive !== 'boolean') throw fail('Provide an account identifier and a boolean isActive value.');
  if (req.params.id === req.user.id) throw fail('You cannot deactivate your own administrator account.', 409);
  const result = await prisma.$transaction(async db => {
    const target = await db.user.findUnique({ where: { id: req.params.id }, select: userSelect });
    if (!target) throw fail('Account not found.', 404);
    if (target.role.name === 'Administrator') throw fail('Administrator access changes require trusted operator review.', 409);
    const updated = await db.user.update({ where: { id: target.id }, data: { isActive: req.body.isActive }, select: userSelect });
    await db.auditLog.create({ data: { actorId: req.user.id, action: req.body.isActive ? 'ACCOUNT_ACTIVATED' : 'ACCOUNT_DEACTIVATED', entityType: 'User', entityId: target.id, details: { previousActive: target.isActive, isActive: req.body.isActive } } });
    return updated;
  }, { isolationLevel: 'Serializable' });
  res.json({ data: result });
}));
router.get('/repairs', wrap(async (req, res) => {
  const p = paging(req), statuses = ['PENDING','ACCEPTED','REJECTED','CANCELLED','IN_PROGRESS','AWAITING_CUSTOMER_CONFIRMATION','COMPLETED','FAILED'];
  if (req.query.status && !statuses.includes(req.query.status)) throw fail('Invalid repair status.');
  const where = req.query.status ? { status: req.query.status } : {};
  const [repairs, total] = await Promise.all([prisma.repairRequest.findMany({ where, skip: p.skip, take: p.take, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], select: { id: true, title: true, status: true, outcome: true, finalCost: true, createdAt: true, customer: { select: { fname: true, lname: true } }, technicianProfile: { select: { id: true, user: { select: { fname: true, lname: true } } } }, payment: { select: { id: true, amount: true, currency: true, status: true, paidAt: true } } } }), prisma.repairRequest.count({ where })]);
  res.json({ data: { repairs, pagination: { page: p.page, total, totalPages: Math.ceil(total / 20) } } });
}));
router.get('/payments', wrap(async (req, res) => {
  const p = paging(req);
  if (req.query.status && !['PENDING','PAID','FAILED','REFUNDED'].includes(req.query.status)) throw fail('Invalid payment status.');
  const where = req.query.status ? { status: req.query.status } : {};
  const [payments, total] = await Promise.all([prisma.payment.findMany({ where, skip: p.skip, take: p.take, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], select: { id: true, repairRequestId: true, amount: true, currency: true, status: true, paidAt: true, createdAt: true, providerCheckoutId: true, providerPaymentId: true, repairRequest: { select: { title: true, customer: { select: { fname: true, lname: true } } } } } }), prisma.payment.count({ where })]);
  res.json({ data: { payments, pagination: { page: p.page, total, totalPages: Math.ceil(total / 20) } } });
}));
router.get('/technicians/:id', wrap(async (req, res) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id)) throw fail('Invalid profile identifier.');
  const profile = await prisma.technicianProfile.findUnique({ where: { id: req.params.id }, select: { id: true, bio: true, serviceDescription: true, yearsExperience: true, isAvailable: true, user: { select: userSelect }, specialties: { include: { repairCategory: true } }, serviceAreas: { include: { serviceArea: true } }, _count: { select: { repairRequests: true, reviews: true } } } });
  if (!profile) throw fail('Profile not found.', 404);
  res.json({ data: profile });
}));
module.exports = router;
