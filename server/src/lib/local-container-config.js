const { mailConfig } = require('./reset-mail');

function validateLocalContainerEnv(env) {
  const fail = name => { throw new Error(`Invalid LOCAL Docker configuration: ${name}. See docs/docker-deployment.md.`); };
  if (env.NODE_ENV !== 'development' || env.FIXIT_CONTAINER !== 'false') fail('local development mode');
  if (env.CLIENT_URL !== 'http://localhost:8080') fail('CLIENT_URL must be http://localhost:8080');
  if (!env.DATABASE_URL || !env.JWT_SECRET) fail('DATABASE_URL and JWT_SECRET are required');
  if (env.PAYMONGO_SECRET_KEY && !env.PAYMONGO_SECRET_KEY.startsWith('sk_test_')) fail('PayMongo must remain in Sandbox');
  if (env.SMTP_HOST?.toLowerCase() !== 'sandbox.smtp.mailtrap.io') fail('use the Mailtrap Sandbox host for this local setup');
  try { mailConfig(env); } catch { fail('SMTP configuration'); }
  if (env.SMTP_ALLOW_INSECURE !== 'false') fail('SMTP TLS is required');
}

module.exports = { validateLocalContainerEnv };
