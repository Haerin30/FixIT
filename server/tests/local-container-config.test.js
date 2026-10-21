const test = require('node:test');
const assert = require('node:assert/strict');
const { validateLocalContainerEnv } = require('../src/lib/local-container-config');
const { validateContainerEnv } = require('../src/lib/container-config');
const { mailConfig, resetMessage } = require('../src/lib/reset-mail');

const local = {
  NODE_ENV: 'development', FIXIT_CONTAINER: 'false', CLIENT_URL: 'http://localhost:8080',
  DATABASE_URL: 'postgresql://fixture:fixture@example.invalid/fixit', JWT_SECRET: 'a'.repeat(40),
  PAYMONGO_SECRET_KEY: 'sk_test_isolated_fixture', SMTP_HOST: 'sandbox.smtp.mailtrap.io',
  SMTP_PORT: '587', SMTP_FROM: 'FixIT <reset@example.invalid>', SMTP_ALLOW_INSECURE: 'false',
};

test('local containers allow only the fixed localhost origin, sandbox SMTP and test payments', () => {
  assert.doesNotThrow(() => validateLocalContainerEnv(local));
  for (const changes of [
    { CLIENT_URL: 'https://fixit.example' }, { CLIENT_URL: 'http://0.0.0.0:8080' },
    { NODE_ENV: 'production' }, { FIXIT_CONTAINER: 'true' }, { SMTP_ALLOW_INSECURE: 'true' },
    { SMTP_HOST: 'smtp.delivery.example' }, { PAYMONGO_SECRET_KEY: 'sk_live_forbidden' }, { JWT_SECRET: '' },
  ]) assert.throws(() => validateLocalContainerEnv({ ...local, ...changes }), /Invalid LOCAL Docker configuration/);
  const config = mailConfig(local);
  assert.equal(config.options.requireTLS, true);
  assert.match(resetMessage(config, 'controlled@example.invalid', 'fixture-token').text, /http:\/\/localhost:8080\/reset-password#token=fixture-token/);
});

test('production validation still rejects HTTP and sandbox mail, even with the local flag set', () => {
  assert.throws(() => validateContainerEnv({ ...local, NODE_ENV: 'production', FIXIT_LOCAL_CONTAINER: 'true' }), /CLIENT_URL/);
  assert.throws(() => validateContainerEnv({ ...local, NODE_ENV: 'production', CLIENT_URL: 'https://fixit.example', FIXIT_LOCAL_CONTAINER: 'true' }), /SMTP_HOST/);
});
