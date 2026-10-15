const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
test('admin directories and audited moderation enforce RBAC without modifying payment history', async t => {
  process.env.JWT_SECRET = 'isolated-admin-test-secret';
  const admin = '00000000-0000-4000-8000-000000000001', customer = '00000000-0000-4000-8000-000000000002', tech = '00000000-0000-4000-8000-000000000003';
  const users = new Map([[admin,'Administrator'],[customer,'Customer'],[tech,'Technician']].map(([id,role]) => [id,{ id, fname: 'Test', lname: role, email: `${role}@example.invalid`, isActive: true, role: { name: role } }]));
  const audits = []; let search;
  const db = {
    user: { findUnique: async ({ where }) => users.get(where.id), findMany: async ({ where, select }) => { assert.equal(select.passwordHash,undefined); search = where; return [...users.values()]; }, count: async () => 3, update: async ({ where,data }) => { const u = { ...users.get(where.id), ...data }; users.set(u.id,u); return u; } },
    auditLog: { create: async ({ data }) => { audits.push(data); return data; } },
    repairRequest: { findMany: async () => [], count: async () => 0 },
    payment: { findMany: async () => [], count: async () => 0 },
    $transaction: async fn => fn(db),
  };
  const key = require.resolve('../src/lib/prisma'); require.cache[key] = { id: key, filename: key, loaded: true, exports: db };
  const app = express(); app.use(express.json()); app.use('/api/admin',require('../src/routes/admin')); app.use((req,res) => res.status(404).json({})); app.use((e,req,res,next) => res.status(e.status || 500).json({ message: e.message }));
  const server = await new Promise(resolve => { const s = app.listen(0,'127.0.0.1',() => resolve(s)); }); t.after(() => new Promise(resolve => server.close(resolve)));
  async function call(path, actor, body, expected=200, method=body?'PATCH':'GET') {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin${path}`, { method, headers: { 'Content-Type':'application/json', ...(actor ? { Authorization:`Bearer ${jwt.sign({},process.env.JWT_SECRET,{ subject: actor })}` } : {}) }, ...(body ? { body:JSON.stringify(body) } : {}) });
    const json=await response.json(); assert.equal(response.status,expected,JSON.stringify(json)); return json.data;
  }
  for (const route of ['/users','/repairs','/payments']) { await call(route,null,null,401); await call(route,customer,null,403); await call(route,tech,null,403); await call(route,admin); }
  for (const token of ['malformed-token', jwt.sign({}, 'wrong-signing-secret', { subject: admin }), jwt.sign({}, process.env.JWT_SECRET, { subject: admin, expiresIn: -1 }), jwt.sign({}, process.env.JWT_SECRET, { subject: 'invalid-subject' })]) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/users`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status,401);
  }
  await call('/users?q=Test&role=Technician&active=true',admin); assert.equal(search.role.name,'Technician'); assert.equal(search.isActive,true); assert.equal(search.OR[0].fname.mode,'insensitive');
  await call('/users?role=Owner',admin,null,400);
  await call(`/users/${customer}/active`,customer,{ isActive:false },403);
  await call(`/users/${admin}/active`,admin,{ isActive:false },409);
  await call(`/users/${tech}/active`,admin,{ isActive:'false' },400);
  await call(`/users/${tech}/active`,admin,{ isActive:false }); assert.equal(users.get(tech).isActive,false); assert.equal(audits[0].action,'ACCOUNT_DEACTIVATED');
  await call('/users',tech,null,401);
  await call(`/users/${tech}/active`,admin,{ isActive:true }); assert.equal(audits[1].action,'ACCOUNT_ACTIVATED');
  await call('/payments/arbitrary',admin,{ status:'PAID' },404);
});
