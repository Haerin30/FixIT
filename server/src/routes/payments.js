const router = require('express').Router();
const prisma = require('../lib/prisma');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { owned, wrap } = require('./marketplace');
const { fail } = require('../lib/workflow');
async function paymongo(path, body) {
  const key = process.env.PAYMONGO_SECRET_KEY || '';
  if (!key.startsWith('sk_test_')) throw fail('PayMongo test checkout is not configured. Set PAYMONGO_SECRET_KEY to a test secret key.', 503);
  let response;
  try { response = await fetch(`https://api.paymongo.com/v1/checkout_sessions${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify({ data: { attributes: body } }) } : {}), signal: AbortSignal.timeout(15000) }); } catch { throw fail('PayMongo could not be reached. Retry shortly.', 502); }
  if (!response.ok) throw fail('PayMongo rejected the request. Check test key and enabled payment methods.', 502);
  return (await response.json()).data;
}
async function reconcile(payment, session, db = prisma) {
  const paid = session.attributes.payments?.find(p => p.attributes.status === 'paid');
  if (paid) {
    if (session.attributes.livemode !== false || paid.attributes.livemode !== false || paid.attributes.currency !== 'PHP' || paid.attributes.amount !== Math.round(Number(payment.amount) * 100)) throw fail('Payment verification mismatch.', 409);
    return db.payment.update({ where: { id: payment.id }, data: { status: 'PAID', paidAt: payment.paidAt || new Date(), providerPaymentId: paid.id } });
  }
  return payment;
}
router.use(authenticateToken, requireRole('Customer'));
router.post('/:id/checkout', wrap(async (req, res) => {
  const r = await owned(req);
  if (r.customerId !== req.user.id || r.status !== 'COMPLETED' || r.outcome !== 'SUCCESSFUL' || Number(r.finalCost) <= 0) throw fail('Only confirmed successful repairs with a balance can be paid. No Fix, No Pay.', 409);
  // An advisory transaction lock prevents two browser tabs from creating separate sessions.
  const result = await prisma.$transaction(async db => {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${r.id}))`;
    let payment = await db.payment.upsert({ where: { repairRequestId: r.id }, update: {}, create: { repairRequestId: r.id, amount: r.finalCost } });
    if (payment.status === 'PAID') throw fail('This repair is already paid.', 409);
    if (payment.providerCheckoutId) {
      const session = await paymongo(`/${encodeURIComponent(payment.providerCheckoutId)}`);
      const verified = await reconcile(payment, session, db);
      if (verified.status === 'PAID') return { payment: verified };
      return { checkoutUrl: session.attributes.checkout_url };
    }
    const origin = process.env.CLIENT_URL || 'http://localhost:5173';
    const session = await paymongo('', { description: `FixIT repair ${r.id}`, reference_number: r.id, line_items: [{ currency: 'PHP', amount: Math.round(Number(r.finalCost) * 100), name: r.title, quantity: 1 }], payment_method_types: ['card', 'gcash'], success_url: `${origin}/?payment=returned`, cancel_url: `${origin}/?payment=cancelled`, show_line_items: true, send_email_receipt: false });
    await db.payment.update({ where: { id: payment.id }, data: { providerCheckoutId: session.id } });
    return { checkoutUrl: session.attributes.checkout_url };
  }, { timeout: 25000 });
  res.json({ data: result });
}));
router.post('/:id/verify', wrap(async (req, res) => {
  const r = await owned(req);
  if (!r.payment?.providerCheckoutId) throw fail('No checkout exists.', 404);
  const session = await paymongo(`/${encodeURIComponent(r.payment.providerCheckoutId)}`);
  res.json({ data: await reconcile(r.payment, session) });
}));
module.exports = router;
