const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { validateContainerEnv, configureTrustedProxy } = require('../src/lib/container-config');

test('container settings require HTTPS, private secrets, sandbox payments and real SMTP delivery', () => {
  const env = { NODE_ENV: 'production', JWT_SECRET: 'a'.repeat(40), DATABASE_URL: 'postgresql://test:test@example.invalid/fixit', CLIENT_URL: 'https://fixit.example', PAYMONGO_SECRET_KEY: 'sk_test_isolated_fixture', SMTP_HOST: 'smtp.example.invalid', SMTP_PORT: '587', SMTP_FROM: 'FixIT <reset@example.invalid>' };
  assert.doesNotThrow(() => validateContainerEnv(env));
  for (const change of [{ JWT_SECRET: '' }, { CLIENT_URL: 'http://localhost:5173' }, { CLIENT_URL: 'https://fixit.example/subpath' }, { DATABASE_URL: 'invalid' }, { PAYMONGO_SECRET_KEY: 'sk_live_forbidden' }, { SMTP_HOST: '' }, { SMTP_HOST: 'sandbox.smtp.mailtrap.io' }, { SMTP_HOST: 'smtp.ethereal.email' }]) {
    assert.throws(() => validateContainerEnv({ ...env, ...change }), /Invalid container configuration/);
  }
});

test('proxy trust accepts only the configured Nginx peer and rejects forged client forwarding', () => {
  const app = express(); configureTrustedProxy(app, '172.30.75.10');
  const trust = app.get('trust proxy fn');
  assert.equal(trust('172.30.75.10'), true);
  assert.equal(trust('203.0.113.10'), false);
  assert.equal(trust('172.30.75.20'), false);
  assert.throws(() => configureTrustedProxy(app, 'true'));
  assert.throws(() => configureTrustedProxy(app, '1'));
});
