const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
test('booking and message retry IDs prevent duplicate records and reject payload changes or outsiders', async t => {
  process.env.JWT_SECRET = 'isolated-retry-http-secret';
  const customer = '00000000-0000-4000-8000-000000000001', other = '00000000-0000-4000-8000-000000000002', profile = '00000000-0000-4000-8000-000000000003', requestId = '00000000-0000-4000-8000-000000000004', messageId = '00000000-0000-4000-8000-000000000005';
  let repair, message, bookings = 0, messages = 0;
  const db = {
    user: { findUnique: async ({ where }) => ({ id: where.id, isActive: true, role: { name: 'Customer' } }) },
    technicianProfile: { findFirst: async () => ({ id: profile }) },
    repairRequest: { findUnique: async () => repair, create: async ({ data }) => { bookings++; repair = { ...data, technicianProfile: { userId: 'technician' }, schedules: [] }; return repair; } },
    conversation: { upsert: async () => ({ id: 'conversation' }) },
    message: { findUnique: async () => message, create: async ({ data }) => { messages++; message = data; return message; } },
  };
  const key=require.resolve('../src/lib/prisma'); require.cache[key]={ id:key,filename:key,loaded:true,exports:db };
  const app=express(); app.use(express.json()); app.use('/api',require('../src/routes/marketplace').router); app.use((e,req,res,next) => res.status(e.status||500).json({ message:e.message }));
  const server=await new Promise(resolve => { const s=app.listen(0,'127.0.0.1',()=>resolve(s)); }); t.after(()=>new Promise(resolve=>server.close(resolve)));
  async function post(path,body,actor=customer,expected=201) { const response=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{ method:'POST',headers:{ 'Content-Type':'application/json',Authorization:`Bearer ${jwt.sign({},process.env.JWT_SECRET,{ subject:actor })}` },body:JSON.stringify(body) }); const json=await response.json(); assert.equal(response.status,expected,JSON.stringify(json)); return json.data; }
  const body={ requestId, technicianProfileId:profile,repairCategoryId:1,title:'Repair',description:'Problem',deviceType:'Laptop',serviceAddress:'Test address' };
  await post('/repairs',body); await post('/repairs',body); assert.equal(bookings,1);
  await post('/repairs',{ ...body,title:'Changed after a lost response' },customer,409);
  await post('/repairs',body,other,409); assert.equal(bookings,1);
  const path=`/repairs/${requestId}/messages`;
  await post(path,{ messageId,body:'Hello' }); await post(path,{ messageId,body:'Hello' }); assert.equal(messages,1);
  await post(path,{ messageId,body:'Different message' },customer,409);
  await post(path,{ messageId,body:'Hello' },other,403);
  await post(path,{ body:' ' },customer,400);
  await post(path,{ body:'x'.repeat(2001) },customer,400);
});
