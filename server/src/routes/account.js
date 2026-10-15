const router = require('express').Router();
const prisma = require('../lib/prisma');
const { authenticateToken } = require('../middleware/auth');
const { fail } = require('../lib/workflow');
const select = { id: true, fname: true, lname: true, email: true, phone: true, createdAt: true, role: { select: { name: true } } };
const wrap = fn => async (req,res,next) => { try { await fn(req,res); } catch(e) { next(e); } };
router.use(authenticateToken);
router.get('/', wrap(async (req,res) => {
  const account = await prisma.user.findUnique({ where: { id: req.user.id }, select });
  res.json({ data: { ...account, role: account.role.name } });
}));
router.patch('/', wrap(async (req,res) => {
  const body = req.body || {};
  if (Object.keys(body).some(key => !['fname','lname','phone'].includes(key))) throw fail('Only first name, last name, and phone number can be edited here. Email and role are read-only.');
  const data = {};
  for (const key of ['fname','lname']) {
    if (body[key] !== undefined) {
      if (typeof body[key] !== 'string' || !body[key].trim() || body[key].trim().length > 100) throw fail(`${key === 'fname' ? 'First' : 'Last'} name must contain 1 to 100 characters.`);
      data[key] = body[key].trim();
    }
  }
  if (body.phone !== undefined) {
    if (typeof body.phone !== 'string' || body.phone.length > 30 || (body.phone.trim() && (!/^\+?[0-9 ()-]{7,30}$/.test(body.phone.trim()) || body.phone.replace(/\D/g,'').length < 7 || body.phone.replace(/\D/g,'').length > 15))) throw fail('Enter a valid phone number (7 to 30 characters), or leave it blank.');
    data.phone = body.phone.trim() || null;
  }
  if (!Object.keys(data).length) throw fail('Provide account fields to update.');
  const account = await prisma.user.update({ where: { id: req.user.id }, data, select });
  res.json({ data: { ...account, role: account.role.name } });
}));
module.exports = router;
