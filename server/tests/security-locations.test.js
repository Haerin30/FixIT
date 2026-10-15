const test = require('node:test');
const assert = require('node:assert/strict');
const { rateLimit } = require('../src/middleware/rate-limit');
test('authentication limit rejects excess attempts and recovers after the window', () => {
  let now = 0, accepted = 0, code, retry;
  const limit = rateLimit({ limit: 2, windowMs: 1000, now: () => now });
  const res = { set: (key,value) => { retry = value; }, status: value => { code = value; return res; }, json: () => {} };
  for (let i=0;i<3;i++) limit({ ip: 'one' },res,() => accepted++);
  assert.equal(accepted,2); assert.equal(code,429); assert.equal(retry,'1');
  now = 1001; limit({ ip: 'one' },res,() => accepted++); assert.equal(accepted,3);
});
test('PSGC requests are deduplicated, cached, and return stale data safely during outages', async t => {
  const fetch = global.fetch, now = Date.now; let time = 0, calls = 0, outage = false;
  global.fetch = async () => { calls++; if (outage) throw Error('offline'); return { ok: true, json: async () => [{ code: '001', name: 'City of Cebu', provinceCode: '072200000' }] }; };
  Date.now = () => time; t.after(() => { global.fetch = fetch; Date.now = now; });
  const { locations } = require('../src/lib/locations');
  const [a,b] = await Promise.all([locations(),locations()]); assert.equal(calls,1); assert.deepEqual(a,b); assert.equal(a.data[0].alias,'Cebu City');
  await locations(); assert.equal(calls,1);
  time = 86400001; outage = true; const stale = await locations(); assert.equal(stale.stale,true); assert.equal(stale.data[0].name,'City of Cebu');
  delete require.cache[require.resolve('../src/lib/locations')];
  await assert.rejects(require('../src/lib/locations').locations(), { status: 502 });
});
