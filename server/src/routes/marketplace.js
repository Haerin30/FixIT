const router = require('express').Router();
const prisma = require('../lib/prisma');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { fail, transition } = require('../lib/workflow');
const { readProfile } = require('../lib/technician-profile');
const { validateReview } = require('../lib/reviews');
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
router.get('/categories', wrap(async (req, res) => res.json({ data: await prisma.repairCategory.findMany({ orderBy: { name: 'asc' } }) })));
router.get('/locations', wrap(async (req, res) => {
  const result = await require('../lib/locations').locations();
  res.json({ data: result.data, stale: result.stale, source: 'https://psgc.gitlab.io/api/' });
}));
router.use(authenticateToken);
router.get('/auth/me', (req, res) => res.json({ data: req.user }));
router.get('/profile', requireRole('Technician'), wrap(async (req, res) => res.json({ data: await readProfile({ userId: req.user.id }) })));
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
    const repair = await owned(req, db);
    const data = transition(repair, req.user, req.body.action, req.body.finalCost);
    const changed = await db.repairRequest.updateMany({ where: { id: repair.id, status: repair.status }, data });
    if (!changed.count) throw fail('Repair changed. Refresh and try again.', 409);
    if (['CANCELLED', 'REJECTED'].includes(data.status)) await db.repairSchedule.updateMany({ where: { repairRequestId: repair.id, status: { in: ['PROPOSED', 'CONFIRMED'] } }, data: { status: 'CANCELLED' } });
    return db.repairRequest.findUnique({ where: { id: repair.id }, include });
  }, { isolationLevel: 'Serializable' });
  res.json({ data: result });
}));
router.post('/repairs/:id/schedules', wrap(async (req, res) => {
  const start = new Date(req.body.proposedStart), end = new Date(req.body.proposedEnd);
  if (!Number.isFinite(+start) || !Number.isFinite(+end) || start <= new Date() || end <= start || end - start > 86400000) throw fail('Choose a future start and an end within 24 hours.');
  const data = await prisma.$transaction(async db => {
    const r = await owned(req, db);
    if (r.status !== 'ACCEPTED') throw fail('Schedules require an accepted repair.', 409);
    return db.repairSchedule.create({ data: { repairRequestId: r.id, proposedById: req.user.id, proposedStart: start, proposedEnd: end } });
  }, { isolationLevel: 'Serializable' });
  res.status(201).json({ data });
}));
router.post('/repairs/:id/schedules/:scheduleId/respond', wrap(async (req, res) => {
  if (!['CONFIRMED', 'REJECTED'].includes(req.body.status)) throw fail('Choose confirm or reject.');
  await prisma.$transaction(async db => {
    const r = await owned(req, db);
    const s = r.schedules.find(s => s.id === uuid(req.params.scheduleId));
    if (r.status !== 'ACCEPTED' || !s || s.status !== 'PROPOSED' || s.proposedById === req.user.id) throw fail('Only the other participant can respond to a pending schedule.', 409);
    if (req.body.status === 'CONFIRMED') await db.repairSchedule.updateMany({ where: { repairRequestId: r.id, status: { in: ['PROPOSED', 'CONFIRMED'] }, id: { not: s.id } }, data: { status: 'CANCELLED' } });
    await db.repairSchedule.update({ where: { id: s.id }, data: { status: req.body.status } });
  }, { isolationLevel: 'Serializable' });
  res.json({ success: true });
}));
router.post('/repairs/:id/reviews', requireRole('Customer'), wrap(async (req, res) => {
  const review = await prisma.$transaction(async db => {
    const repair = await owned(req, db);
    const data = validateReview(repair, req.user.id, req.body || {});
    // The unique repairRequestId constraint also rejects simultaneous duplicates.
    return db.review.create({ data });
  }, { isolationLevel: 'Serializable' });
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
