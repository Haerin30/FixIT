const { mailConfig } = require('./reset-mail');

function validateContainerEnv(env) {
  const fail = name => { throw new Error(`Invalid container configuration: ${name}. See docs/docker-deployment.md.`); };
  if (env.NODE_ENV !== 'production') fail('NODE_ENV');
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32 || env.JWT_SECRET.includes('REPLACE_')) fail('JWT_SECRET');
  let database, client;
  try { database = new URL(env.DATABASE_URL); } catch { fail('DATABASE_URL'); }
  if (!['postgres:', 'postgresql:'].includes(database.protocol)) fail('DATABASE_URL');
  try { client = new URL(env.CLIENT_URL); } catch { fail('CLIENT_URL'); }
  if (client.protocol !== 'https:' || client.pathname !== '/' || client.search || client.hash || client.username || client.password) fail('CLIENT_URL');
  if (!env.PAYMONGO_SECRET_KEY?.startsWith('sk_test_')) fail('PAYMONGO_SECRET_KEY (sandbox only)');
  try { mailConfig(env); } catch { fail('SMTP'); }
  if (/sandbox\.smtp\.mailtrap\.io|ethereal\.email|^(localhost|127\.0\.0\.1|mailpit)$/i.test(env.SMTP_HOST)) fail('SMTP_HOST (use a delivery provider, not a test inbox)');
}

function configureTrustedProxy(app, value) {
  if (!value) return;
  // Addresses/CIDRs only; never trust arbitrary clients or a hop count.
  const peers = value.split(',').map(peer => peer.trim());
  if (peers.some(peer => !peer || /^(true|false|\d+|\*)$/i.test(peer))) throw new Error('TRUST_PROXY must contain trusted proxy IP addresses or CIDRs.');
  app.set('trust proxy', peers);
}
module.exports = { validateContainerEnv, configureTrustedProxy };
