// Creates a PHP 100 hosted checkout in PayMongo TEST mode, retrieves it, then expires it.
// Does not create a charge or print credentials or checkout URLs.
require('dotenv').config({ quiet: true });
async function main() {
  const key = process.env.PAYMONGO_SECRET_KEY || '';
  if (!key.startsWith('sk_test_')) throw new Error('A PayMongo sk_test_ secret key is required.');
  const headers = { Authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}`, 'Content-Type': 'application/json' };
  async function call(path, attributes, method = 'GET') {
    const response = await fetch(`https://api.paymongo.com/v1/checkout_sessions${path}`, { method, headers, ...(attributes ? { body: JSON.stringify({ data: { attributes } }) } : {}), signal: AbortSignal.timeout(20000) });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      const codes = result.errors?.map(e => e.code).filter(Boolean).join(', ') || 'provider_error';
      throw new Error(`PayMongo HTTP ${response.status}: ${codes}`);
    }
    return (await response.json()).data;
  }
  let session;
  try {
    const origin = process.env.CLIENT_URL || 'http://localhost:5173';
    session = await call('', { description: 'FixIT integration verification (test only)', line_items: [{ amount: 10000, currency: 'PHP', name: 'FixIT checkout test', quantity: 1 }], payment_method_types: ['card', 'gcash'], success_url: `${origin}/?payment=returned`, cancel_url: `${origin}/?payment=cancelled`, send_email_receipt: false, show_line_items: true }, 'POST');
    if (session.attributes.livemode !== false) throw new Error('Provider did not confirm test mode.');
    const retrieved = await call(`/${encodeURIComponent(session.id)}`);
    if (retrieved.id !== session.id || !retrieved.attributes.checkout_url?.startsWith('https://checkout.paymongo.com/')) throw new Error('Checkout response validation failed.');
    console.log('PASS: real PayMongo test key, hosted checkout creation, checkout URL, and server-side retrieval. No payment made.');
  } finally {
    if (session?.id) {
      try { await call(`/${encodeURIComponent(session.id)}/expire`, undefined, 'POST'); console.log('PASS: verification checkout expired.'); }
      catch (e) { console.log(`Checkout expiration unavailable: ${e.message}. The unused test checkout may remain in PayMongo.`); }
    }
  }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
