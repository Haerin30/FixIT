const { fail } = require('./workflow');

async function provider(path = '', attributes, method = attributes ? 'POST' : 'GET') {
  const key = process.env.PAYMONGO_SECRET_KEY || '';
  if (!key.startsWith('sk_test_')) throw fail('Sandbox checkout is unavailable. Configure a PayMongo test secret on the server.', 503);
  let response;
  try {
    response = await fetch(`https://api.paymongo.com/v1/checkout_sessions${path}`, {
      method, headers: { Authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}`, 'Content-Type': 'application/json' },
      ...(attributes ? { body: JSON.stringify({ data: { attributes } }) } : {}), signal: AbortSignal.timeout(15000),
    });
  } catch { throw fail('PayMongo could not be reached. Check your connection and try again. Your payment was not marked paid.', 502); }
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const codes = json?.errors?.map(e => String(e.code).replace(/[^a-zA-Z0-9_]/g, '').slice(0,60)).join(', ');
    throw fail(`PayMongo rejected this request${codes ? ` (${codes})` : ''}. Check the sandbox payment settings and retry.`, 502);
  }
  if (!json?.data?.id || !json.data.attributes) throw fail('PayMongo returned an invalid response. Please verify again before retrying checkout.', 502);
  return json.data;
}

function inspectSession(payment, session) {
  const a = session?.attributes;
  if (!a || session.id !== payment.providerCheckoutId || a.livemode !== false || a.reference_number !== payment.repairRequestId) throw fail('Checkout identity or test-mode verification failed. No payment state was changed.', 409);
  const paid = (a.payments || []).filter(p => p.attributes?.status === 'paid');
  if (paid.length > 1) throw fail('Unexpected multiple payments. Contact support before retrying.', 409);
  if (paid.length) {
    const p = paid[0], v = p.attributes;
    if (!/^pay_/.test(p.id || '') || v.livemode !== false || v.currency !== payment.currency || v.amount !== Math.round(Number(payment.amount) * 100) || !a.payment_intent?.id || v.payment_intent_id !== a.payment_intent.id || (payment.providerPaymentId && payment.providerPaymentId !== p.id)) throw fail('Payment amount, currency, or identity did not match the repair. No payment state was changed.', 409);
    return { checkoutState: payment.status === 'REFUNDED' ? 'REFUNDED' : 'PAID', paid: p };
  }
  if (payment.status === 'PAID') return { checkoutState: 'PAID' }; // Never downgrade a verified payment.
  if (payment.status === 'REFUNDED') return { checkoutState: 'REFUNDED' };
  if (a.status === 'expired') return { checkoutState: 'EXPIRED' };
  if (a.payments?.some(p => p.attributes?.status === 'failed') || a.payment_intent?.attributes?.last_payment_error) return { checkoutState: 'FAILED' };
  return { checkoutState: 'PENDING' };
}

async function reconcile(db, payment, session) {
  const result = inspectSession(payment, session);
  const status = ['PAID','REFUNDED'].includes(result.checkoutState) ? result.checkoutState : ['EXPIRED','FAILED'].includes(result.checkoutState) ? 'FAILED' : 'PENDING';
  const updated = await db.payment.update({ where: { id: payment.id }, data: {
    status, ...(result.paid ? { providerPaymentId: result.paid.id, paidAt: payment.paidAt || new Date() } : {}),
  } });
  return { ...updated, checkoutState: result.checkoutState };
}

async function recordAttempt(db, payment, actorId, action, checkoutState) {
  await db.auditLog.create({ data: { actorId, action, entityType: 'Payment', entityId: payment.id, details: { checkoutId: payment.providerCheckoutId, checkoutState, amount: String(payment.amount), currency: payment.currency } } });
}
module.exports = { provider, inspectSession, reconcile, recordAttempt };
