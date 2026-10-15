const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectSession } = require('../src/lib/paymongo');
const payment = { providerCheckoutId: 'cs_test', repairRequestId: 'repair-test', amount: '500', currency: 'PHP', status: 'PENDING' };
const session = () => ({ id: 'cs_test', attributes: { livemode: false, reference_number: 'repair-test', status: 'active', payment_intent: { id: 'pi_test', attributes: {} }, payments: [] } });
const paid = () => ({ id: 'pay_test', attributes: { status: 'paid', amount: 50000, currency: 'PHP', livemode: false, payment_intent_id: 'pi_test' } });
test('PayMongo distinguishes pending, failed, expired and paid without trusting return URLs', () => {
  const s = session(); assert.equal(inspectSession(payment,s).checkoutState,'PENDING');
  s.attributes.payments = [{ attributes: { status: 'failed' } }]; assert.equal(inspectSession(payment,s).checkoutState,'FAILED');
  s.attributes.status = 'expired'; assert.equal(inspectSession(payment,s).checkoutState,'EXPIRED');
  s.attributes.payments = [paid()]; assert.equal(inspectSession(payment,s).checkoutState,'PAID');
});
test('PayMongo verification checks checkout identity, reference, test mode and payment identity', () => {
  for (const change of [s => { s.id = 'cs_other'; }, s => { s.attributes.reference_number = 'another-repair'; }, s => { s.attributes.livemode = true; }]) { const s = session(); change(s); assert.throws(() => inspectSession(payment,s), { status: 409 }); }
  for (const change of [p => { p.attributes.amount = 1; }, p => { p.attributes.currency = 'USD'; }, p => { p.attributes.livemode = true; }, p => { p.attributes.payment_intent_id = 'pi_other'; }, p => { p.id = ''; }]) { const s = session(), p = paid(); change(p); s.attributes.payments = [p]; assert.throws(() => inspectSession(payment,s), { status: 409 }); }
  const s = session(); s.attributes.payments = [paid(), paid()]; assert.throws(() => inspectSession(payment,s));
});
test('verified payment cannot be downgraded or replaced with a different payment identity', () => {
  assert.equal(inspectSession({ ...payment, status: 'PAID' },session()).checkoutState,'PAID');
  assert.equal(inspectSession({ ...payment, status: 'REFUNDED' },session()).checkoutState,'REFUNDED');
  const s = session(); s.attributes.payments = [paid()]; assert.throws(() => inspectSession({ ...payment, providerPaymentId: 'pay_other' },s));
});
