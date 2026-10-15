const router = require('express').Router();
const prisma = require('../lib/prisma');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { owned, wrap } = require('./marketplace');
const { fail } = require('../lib/workflow');
const { provider, reconcile, recordAttempt } = require('../lib/paymongo');
router.use(authenticateToken, requireRole('Customer'));
function eligible(r, user) {
  if (r.customerId !== user.id || r.status !== 'COMPLETED' || r.outcome !== 'SUCCESSFUL' || !Number.isFinite(Number(r.finalCost)) || Number(r.finalCost) <= 0) throw fail('Payment is available only after you confirm a successful repair with a service fee. No Fix, No Pay.', 409);
}
async function locked(req, fn) {
  return prisma.$transaction(async db => {
    const r = await owned(req, db);
    eligible(r, req.user);
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${r.id}))`;
    return fn(db, r);
  }, { timeout: 45000, maxWait: 10000 });
}
async function verifyCurrent(db, payment) {
  const session = await provider(`/${encodeURIComponent(payment.providerCheckoutId)}`);
  let verified = await reconcile(db, payment, session);
  if (verified.checkoutState === 'EXPIRED') {
    const cancelled = await db.auditLog.findFirst({ where: { entityType: 'Payment', entityId: payment.id, action: 'CHECKOUT_CANCELLED', details: { path: ['checkoutId'], equals: payment.providerCheckoutId } } });
    if (cancelled) verified = { ...verified, checkoutState: 'CANCELLED' };
  }
  return { payment: verified, session };
}
router.post('/:id/checkout', wrap(async (req, res) => {
  const result = await locked(req, async (db, r) => {
    let payment = await db.payment.upsert({ where: { repairRequestId: r.id }, update: {}, create: { repairRequestId: r.id, amount: r.finalCost } });
    if (payment.status === 'PAID' || payment.status === 'REFUNDED') throw fail('This repair already has a settled payment. Another charge is not allowed.', 409);
    if (Number(payment.amount) !== Number(r.finalCost) || payment.currency !== 'PHP') throw fail('The stored payment amount does not match the confirmed repair. Contact support.', 409);
    if (payment.providerCheckoutId) {
      const current = await verifyCurrent(db, payment);
      payment = current.payment;
      if (payment.status === 'PAID') return { payment };
      if (!['EXPIRED', 'CANCELLED'].includes(payment.checkoutState)) return { checkoutUrl: current.session.attributes.checkout_url, payment };
      // Only provider-confirmed expiration permits replacing an old checkout.
      await recordAttempt(db, payment, req.user.id, 'CHECKOUT_REPLACED', payment.checkoutState);
    }
    const origin = process.env.CLIENT_URL || 'http://localhost:5173';
    const session = await provider('', { description: `FixIT repair ${r.id}`, reference_number: r.id, line_items: [{ currency: 'PHP', amount: Math.round(Number(r.finalCost) * 100), name: r.title, quantity: 1 }], payment_method_types: ['card', 'gcash'], success_url: `${origin}/?payment=returned&repair=${r.id}`, cancel_url: `${origin}/?payment=cancelled&repair=${r.id}`, show_line_items: true, send_email_receipt: false });
    if (session.attributes.livemode !== false || session.attributes.reference_number !== r.id || !session.attributes.checkout_url?.startsWith('https://checkout.paymongo.com/')) throw fail('Invalid PayMongo test checkout response.', 502);
    payment = await db.payment.update({ where: { id: payment.id }, data: { providerCheckoutId: session.id, status: 'PENDING' } });
    await recordAttempt(db, payment, req.user.id, 'CHECKOUT_CREATED', 'PENDING');
    return { checkoutUrl: session.attributes.checkout_url, payment: { ...payment, checkoutState: 'PENDING' } };
  });
  res.json({ data: result });
}));
router.post('/:id/verify', wrap(async (req, res) => {
  const result = await locked(req, async (db, r) => {
    const payment = await db.payment.findUnique({ where: { repairRequestId: r.id } });
    if (!payment?.providerCheckoutId) throw fail('No checkout exists for this repair.', 404);
    return (await verifyCurrent(db, payment)).payment;
  });
  res.json({ data: result });
}));
router.post('/:id/cancel', wrap(async (req, res) => {
  const result = await locked(req, async (db, r) => {
    const stored = await db.payment.findUnique({ where: { repairRequestId: r.id } });
    if (!stored?.providerCheckoutId) throw fail('No checkout exists.', 404);
    const { payment } = await verifyCurrent(db, stored);
    if (['PAID','REFUNDED'].includes(payment.status)) throw fail('The payment is already settled and cannot be cancelled.', 409);
    if (!['EXPIRED', 'CANCELLED'].includes(payment.checkoutState)) await provider(`/${encodeURIComponent(payment.providerCheckoutId)}/expire`, undefined, 'POST');
    const expired = await verifyCurrent(db, payment);
    if (expired.payment.status === 'PAID') return expired.payment;
    if (!['EXPIRED', 'CANCELLED'].includes(expired.payment.checkoutState)) throw fail('PayMongo has not confirmed expiration. Verify again before retrying.', 409);
    await recordAttempt(db, payment, req.user.id, 'CHECKOUT_CANCELLED', 'CANCELLED');
    return { ...expired.payment, checkoutState: 'CANCELLED' };
  });
  res.json({ data: result });
}));
module.exports = router;
