const express = require('express');
const prisma = require('../lib/prisma');
const { passwordResetService, takeLimit } = require('../lib/password-reset');
const { mailConfig, sendResetMail } = require('../lib/reset-mail');
const GENERIC = "If an account exists with that email, we'll send a password reset link.";

function resetRouter({ db = prisma, config = mailConfig, send = sendResetMail, limit = takeLimit } = {}) {
  const router = express.Router();
  let pending = 0;
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); res.set('Referrer-Policy', 'no-referrer'); next(); });
  const limited = res => res.set('Retry-After', '900').status(429).json({ success: false, message: 'Too many attempts. Please wait 15 minutes before trying again.' });
  router.post('/forgot-password', async (req, res) => {
    if (!await limit(db, 'forgot-ip', req.ip, 10)) return limited(res);
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ success: false, message: 'Please provide a valid email address.' });
    if (!await limit(db, 'forgot-email', email, 3)) return limited(res);
    let settings;
    try { settings = config(); } catch { return res.status(503).json({ success: false, message: 'Password reset email is not configured. Please contact support to configure SMTP and CLIENT_URL.' }); }
    if (pending >= 50) return res.status(503).json({ success: false, message: 'Password reset is busy. Please try again shortly.' });
    pending++;
    // Respond before account lookup or SMTP: recipient existence and mail latency cannot change the response.
    res.json({ success: true, message: GENERIC });
    setImmediate(async () => {
      try { await passwordResetService(db, (to, token) => send(settings, to, token)).issue(email); }
      catch { console.error('Password reset processing failed. Check database and SMTP availability.'); }
      finally { pending--; }
    });
  });
  router.post('/reset-password', async (req, res) => {
    if (!await limit(db, 'reset-ip', req.ip, 10)) return limited(res);
    try {
      await passwordResetService(db).redeem(req.body?.token, req.body?.password, req.body?.confirmPassword);
      res.json({ success: true, message: 'Password updated successfully.' });
    } catch (error) {
      res.status(error.status || 503).json({ success: false, message: error.status === 400 ? error.message : 'Password reset is unavailable. Please try again shortly.' });
    }
  });
  return router;
}
module.exports = { resetRouter, GENERIC };
