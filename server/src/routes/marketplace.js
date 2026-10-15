const router = require('express').Router();
const prisma = require('../lib/prisma');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { fail, transition } = require('../lib/workflow');
const { readProfile } = require('../lib/technician-profile');
const { validateReview } = require('../lib/reviews');
const { canPropose, delegationAllowed, scheduleDates, priceCorrection, assignedTechnician } = require('../lib/repair-rules');
const person = { id: true, fname: true, lname: true };
const include = { customer: { select: person }, technicianProfile: { select: { id: true, userId: true, user: { select: person } } }, repairCategory: true, schedules: { orderBy: { createdAt: 'desc' } }, payment: true, review: true };
const wrap = fn => async (req, res, next) => { try { await fn(req, res); } catch (e) { next(e); } };
const text = (value, name, max = 2000) => { if (typeof value !== 'string' || !value.trim() || value.length > max) throw fail(`${name} is required (maximum ${max} characters).`); return value.trim(); };
const uuid = value => { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '')) throw fail('Invalid identifier.'); return value; };
async function owned(req, db = prisma) {
  const repair = await db.repairRequest.findUnique({ where: { id: uuid(req.params.id) }, include });
  if (!repair) throw fail('Repair not found.', 404);
  if (repair.customerId !== req.user.id && repair.technicianProfile?.userId !== req.user.id) throw fail('Access denied.', 403);
  return repair;
}
async function lockedRepair(req, db) {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${uuid(req.params.id)}))`;
  return owned(req, db);
}
router.get('/categories', wrap(async (req, res) => res.json({ data: await prisma.repairCategory.findMany({ orderBy: { name: 'asc' } }) })));
router.get('/locations', wrap(async (req, res) => {
  const result = await require('../lib/locations').locations();
  res.json({ data: result.data, stale: result.stale, source: 'https://psgc.gitlab.io/api/' });
}));
router.use(authenticateToken);
router.get('/auth/me', (req, res) => res.json({ data: req.user }));
router.get('/profile', requireRole('Technician'), wrap(async (req, res) => res.json({ data: await readProfile({ userId: req.user.id }) })));
router.get('/conversations', requireRole('Customer','Technician'), wrap(async (req, res) => {
  const page = Math.max(1,Math.min(10000,Number.parseInt(req.query.page,10)||1)), limit = 30;
  const where = req.user.role === 'Technician' ? { technicianProfile: { userId: req.user.id } } : { customerId: req.user.id };
  const [records,total] = await Promise.all([
    prisma.repairRequest.findMany({ where, skip: (page-1)*limit, take: limit, orderBy: [{ createdAt: 'desc' },{ id: 'desc' }], select: { id: true, title: true, status: true, createdAt: true, customer: { select: person }, technicianProfile: { select: { user: { select: person } } }, conversation: { select: { messages: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1, select: { id: true, senderId: true, body: true, createdAt: true } } } } } }),
    prisma.repairRequest.count({ where }),
  ]);
  res.json({ data: { conversations: records.map(r => ({ repairId: r.id, title: r.title, status: r.status, participant: req.user.role === 'Technician' ? r.customer : r.technicianProfile?.user || null, lastMessage: r.conversation?.messages[0] || null, createdAt: r.createdAt })), pagination: { page, total, totalPages: Math.ceil(total/limit) } } });
}));
router.get('/repairs/:id', wrap(async (req,res) => res.json({ data: await owned(req) })));
router.get('/repairs', wrap(async (req, res) => {
  const where = req.user.role === 'Technician' ? { technicianProfile: { userId: req.user.id } } : { customerId: req.user.id };
  res.json({ data: await prisma.repairRequest.findMany({ where, include, orderBy: { createdAt: 'desc' }, take: 100 }) });
}));
router.post('/repairs', requireRole('Customer'), wrap(async (req, res) => {
  const b = req.body || {};
  const data = { customerId: req.user.id, technicianProfileId: uuid(b.technicianProfileId), repairCategoryId: Number(b.repairCategoryId), title: text(b.title, 'Title', 120), description: text(b.description, 'Description'), deviceType: text(b.deviceType, 'Device type', 100), deviceModel: typeof b.deviceModel === 'string' ? b.deviceModel.slice(0,150) : null, serviceAddress: text(b.serviceAddress, 'Service address', 500) };
  if (!Number.isInteger(data.repairCategoryId) || data.repairCategoryId < 1) throw fail('Select a repair category.');
  if (b.requestId !== undefined) {
    data.id = uuid(b.requestId);
    const existing = await prisma.repairRequest.findUnique({ where: { id: data.id }, include });
    if (existing) {
      const same = ['customerId','technicianProfileId','repairCategoryId','title','description','deviceType','deviceModel','serviceAddress'].every(key => (existing[key] ?? null) === (data[key] ?? null));
      if (!same) throw fail('This submission was already used. Check My repairs before making a different request.', 409);
      return res.status(201).json({ data: existing });
    }
  }
  const tech = await prisma.technicianProfile.findFirst({ where: { id: data.technicianProfileId, isAvailable: true, user: { isActive: true }, specialties: { some: { repairCategoryId: data.repairCategoryId } } } });
  if (!tech) throw fail('Choose an available technician with this specialty.');
  res.status(201).json({ data: await prisma.repairRequest.create({ data, include }) });
}));
router.post('/repairs/:id/action', wrap(async (req, res) => {
  const result = await prisma.$transaction(async db => {
    const repair = await lockedRepair(req, db);
    const data = transition(repair, req.user, req.body.action, req.body.finalCost, req.body.priceVersion);
    const changed = await db.repairRequest.updateMany({ where: { id: repair.id, status: repair.status, priceVersion: repair.priceVersion ?? 0 }, data });
    if (!changed.count) throw fail('Repair changed. Refresh and try again.', 409);
    if (req.body.action === 'confirm') await db.auditLog.create({ data: { actorId: req.user.id, action: 'CUSTOMER_CONFIRMED_PRICE', entityType: 'RepairRequest', entityId: repair.id, details: { amount: String(repair.finalCost), priceVersion: repair.priceVersion ?? 0 } } });
    if (['CANCELLED', 'REJECTED'].includes(data.status)) await db.repairSchedule.updateMany({ where: { repairRequestId: repair.id, status: { in: ['PROPOSED', 'CONFIRMED'] } }, data: { status: 'CANCELLED' } });
    return db.repairRequest.findUnique({ where: { id: repair.id }, include });
  }, { isolationLevel: 'ReadCommitted' });
  res.json({ data: result });
}));
router.patch('/repairs/:id/scheduling-permission', wrap(async (req, res) => {
  const data = await prisma.$transaction(async db => {
    const r = await lockedRepair(req, db);
    delegationAllowed(r, req.user, req.body.customerCanProposeSchedule);
    if (Boolean(r.customerCanProposeSchedule) === req.body.customerCanProposeSchedule) return r;
    const result = await db.repairRequest.update({ where: { id: r.id }, data: { customerCanProposeSchedule: req.body.customerCanProposeSchedule }, include });
    await db.auditLog.create({ data: { actorId: req.user.id, action: 'SCHEDULING_PERMISSION_CHANGED', entityType: 'RepairRequest', entityId: r.id, details: { previous: Boolean(r.customerCanProposeSchedule), customerCanProposeSchedule: req.body.customerCanProposeSchedule } } });
    return result;
  }, { isolationLevel: 'ReadCommitted' });
  res.json({ data });
}));
router.patch('/repairs/:id/final-price', wrap(async (req, res) => {
  const result = await prisma.$transaction(async db => {
    const r = await lockedRepair(req, db);
    // Read fresh under the same lock used by checkout creation and customer confirmation.
    const payment = await db.payment.findUnique({ where: { repairRequestId: r.id } });
    const data = priceCorrection({ ...r, payment }, req.user, req.body);
    if (Number(r.finalCost) === data.finalCost) return r;
    const changed = await db.repairRequest.updateMany({ where: { id: r.id, status: r.status, priceVersion: r.priceVersion ?? 0 }, data });
    if (!changed.count) throw fail('The price changed. Refresh before editing again.',409);
    await db.auditLog.create({ data: { actorId: req.user.id, action: 'FINAL_PRICE_CORRECTED', entityType: 'RepairRequest', entityId: r.id, details: { previousAmount: String(r.finalCost), newAmount: String(data.finalCost), previousPriceVersion: r.priceVersion ?? 0, newPriceVersion: data.priceVersion, previousStatus: r.status, customerApprovalInvalidated: r.status === 'COMPLETED' } } });
    return db.repairRequest.findUnique({ where: { id: r.id }, include });
  }, { isolationLevel: 'ReadCommitted' });
  res.json({ data: result });
}));
router.post('/repairs/:id/schedules', wrap(async (req, res) => {
  const data = await prisma.$transaction(async db => {
    const r = await lockedRepair(req, db);
    canPropose(r, req.user);
    const { start, end } = scheduleDates(req.body);
    if (r.schedules.some(s => s.status === 'PROPOSED')) throw fail('A schedule is already awaiting a response. Resolve it before proposing another.',409);
    return db.repairSchedule.create({ data: { repairRequestId: r.id, proposedById: req.user.id, proposedStart: start, proposedEnd: end } });
  }, { isolationLevel: 'ReadCommitted' });
  res.status(201).json({ data });
}));
router.post('/repairs/:id/schedules/:scheduleId/respond', wrap(async (req, res) => {
  if (!['CONFIRMED', 'REJECTED'].includes(req.body.status)) throw fail('Choose confirm or reject.');
  await prisma.$transaction(async db => {
    const r = await lockedRepair(req, db);
    const s = r.schedules.find(s => s.id === uuid(req.params.scheduleId));
    if (r.status !== 'ACCEPTED' || !s || s.status !== 'PROPOSED' || s.proposedById === req.user.id) throw fail('Only the other participant can respond to a pending schedule.', 409);
    if (!assignedTechnician(r, req.user) && !(req.user.role === 'Customer' && req.user.id === r.customerId)) throw fail('Only the other repair participant may respond.',403);
    if (req.body.status === 'CONFIRMED' && new Date(s.proposedStart) <= new Date()) throw fail('The proposed start time has passed. Reject it and request a future time.',409);
    if (req.body.status === 'CONFIRMED' && r.schedules.some(other => other.id !== s.id && other.status === 'CONFIRMED')) throw fail('A schedule is already confirmed. The existing schedule is preserved.',409);
    if (req.body.status === 'CONFIRMED') await db.repairSchedule.updateMany({ where: { repairRequestId: r.id, status: { in: ['PROPOSED', 'CONFIRMED'] }, id: { not: s.id } }, data: { status: 'CANCELLED' } });
    await db.repairSchedule.update({ where: { id: s.id }, data: { status: req.body.status } });
  }, { isolationLevel: 'ReadCommitted' });
  res.json({ success: true });
}));
router.post('/repairs/:id/reviews', requireRole('Customer'), wrap(async (req, res) => {
  const review = await prisma.$transaction(async db => {
    const repair = await lockedRepair(req, db);
    const data = validateReview(repair, req.user.id, req.body || {});
    // The unique repairRequestId constraint also rejects simultaneous duplicates.
    return db.review.create({ data });
  }, { isolationLevel: 'ReadCommitted' });
  res.status(201).json({ data: review });
}));
router.get('/repairs/:id/messages', wrap(async (req, res) => {
  const r = await owned(req);
  const messages = await prisma.message.findMany({ where: { conversation: { repairRequestId: r.id } }, include: { sender: { select: person } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100 });
  res.json({ data: messages.reverse() });
}));
router.post('/repairs/:id/messages', wrap(async (req, res) => {
  const r = await owned(req);
  const body = text(req.body.body, 'Message');
  const conversation = await prisma.conversation.upsert({ where: { repairRequestId: r.id }, update: {}, create: { repairRequestId: r.id } });
  const messageId = req.body.messageId === undefined ? undefined : uuid(req.body.messageId);
  if (messageId) {
    const existing = await prisma.message.findUnique({ where: { id: messageId } });
    if (existing) {
      if (existing.senderId !== req.user.id || existing.conversationId !== conversation.id || existing.body !== body) throw fail('Message submission conflict. Refresh the conversation.', 409);
      return res.status(201).json({ data: existing });
    }
  }
  res.status(201).json({ data: await prisma.message.create({ data: { ...(messageId ? { id: messageId } : {}), conversationId: conversation.id, senderId: req.user.id, body } }) });
}));
router.get('/admin/summary', requireRole('Administrator'), wrap(async (req, res) => {
  const [users, technicians, repairs, paid, statuses] = await Promise.all([prisma.user.count(), prisma.technicianProfile.count(), prisma.repairRequest.count(), prisma.payment.aggregate({ where: { status: 'PAID' }, _sum: { amount: true } }), prisma.repairRequest.groupBy({ by: ['status'], _count: { _all: true } })]);
  res.json({ data: { users, technicians, repairs, paidTotal: paid._sum.amount || 0, statuses } });
}));
module.exports = { router, owned, wrap };
