const nodemailer = require('nodemailer');

function mailConfig(env = process.env) {
  const url = new URL(env.CLIENT_URL || 'invalid:');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== 'https:' && !(env.NODE_ENV !== 'production' && local && url.protocol === 'http:')) ||
      !env.SMTP_HOST || !env.SMTP_FROM || !/^[^\r\n]+$/.test(env.SMTP_FROM)) throw new Error('RESET_MAIL_CONFIGURATION');
  const port = Number(env.SMTP_PORT || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASS)) throw new Error('RESET_MAIL_CONFIGURATION');
  return { url, from: env.SMTP_FROM, options: {
    host: env.SMTP_HOST, port, secure: env.SMTP_SECURE === 'true',
    requireTLS: env.NODE_ENV === 'production' || env.SMTP_ALLOW_INSECURE !== 'true',
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true,
  } };
}
function resetMessage(config, email, token) {
  const link = new URL('reset-password', config.url.href.endsWith('/') ? config.url : `${config.url.href}/`);
  link.hash = new URLSearchParams({ token }).toString();
  const safe = link.href.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
  return { from: config.from, to: email, subject: 'Reset your FixIT password',
    text: `FixIT\nReset your password: ${link.href}\nThis single-use link expires in 30 minutes. If you did not request this, you can ignore this email.`,
    html: `<h1>FixIT</h1><p>Reset your password securely.</p><p><a href="${safe}">Reset Password</a></p><p>This single-use link expires in 30 minutes.</p><p>If you did not request this, you can ignore this email.</p>`,
  };
}
async function sendResetMail(config, email, token) {
  const transport = nodemailer.createTransport(config.options);
  try {
    const result = await transport.sendMail(resetMessage(config, email, token));
    if (!result.accepted?.length) throw new Error('RESET_MAIL_REJECTED');
  } finally { transport.close(); }
}
module.exports = { mailConfig, resetMessage, sendResetMail };
