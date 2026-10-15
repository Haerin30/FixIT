const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const jwt=require('jsonwebtoken');
test('account ownership, conversation privacy, scheduling authority and price revisions are enforced over HTTP',async t=>{
  process.env.JWT_SECRET='isolated-account-scheduling-test';
  const customer='00000000-0000-4000-8000-000000000001',tech='00000000-0000-4000-8000-000000000002',other='00000000-0000-4000-8000-000000000003',id='00000000-0000-4000-8000-000000000004';
  const users=new Map([[customer,'Customer'],[tech,'Technician'],[other,'Customer']].map(([id,name])=>[id,{id,fname:'Test',lname:name,email:`${name}@example.invalid`,phone:null,createdAt:'2026-10-16T00:00:00Z',isActive:true,role:{name}}]));
  const r={id,customerId:customer,technicianProfile:{userId:tech,user:users.get(tech)},customer:users.get(customer),customerCanProposeSchedule:false,priceVersion:0,title:'QA repair',status:'ACCEPTED',outcome:null,finalCost:null,schedules:[],payment:null,conversation:null,createdAt:'2026-10-16T00:00:00Z'};
  const audits=[];let scheduleSequence=0;
  const db={
    user:{findUnique:async({where})=>users.get(where.id),update:async({where,data})=>{assert.equal(where.id,customer);const user={...users.get(where.id),...data};users.set(where.id,user);return user}},
    repairRequest:{findUnique:async()=>structuredClone(r),findMany:async({where})=>where.customerId===customer||where.technicianProfile?.userId===tech?[r]:[],count:async({where})=>where.customerId===customer||where.technicianProfile?.userId===tech?1:0,
      update:async({data})=>Object.assign(r,data),updateMany:async({where,data})=>{if(where.priceVersion!==r.priceVersion||where.status!==r.status)return{count:0};Object.assign(r,data);return{count:1}}},
    repairSchedule:{create:async({data})=>{const s={id:`00000000-0000-4000-8000-${String(++scheduleSequence).padStart(12,'0')}`,status:'PROPOSED',...data};r.schedules.push(s);return s},update:async({where,data})=>Object.assign(r.schedules.find(s=>s.id===where.id),data),updateMany:async({where,data})=>{for(const s of r.schedules)if(s.id!==where.id?.not&&where.status.in.includes(s.status))Object.assign(s,data);return{count:1}}},
    payment:{findUnique:async()=>r.payment},auditLog:{create:async({data})=>{audits.push(data);return data}},
    $transaction:async fn=>fn(db),$executeRaw:async()=>0,
  };
  const key=require.resolve('../src/lib/prisma');require.cache[key]={id:key,filename:key,loaded:true,exports:db};
  const app=express();app.use(express.json());app.use('/api/account',require('../src/routes/account'));app.use('/api',require('../src/routes/marketplace').router);app.use((e,req,res,next)=>res.status(e.status||500).json({message:e.message}));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});t.after(()=>new Promise(resolve=>server.close(resolve)));
  async function call(path,actor=customer,body,expected=200,method=body?'POST':'GET'){
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method,headers:{'Content-Type':'application/json',...(actor?{Authorization:`Bearer ${jwt.sign({},process.env.JWT_SECRET,{subject:actor})}`}:{})},...(body?{body:JSON.stringify(body)}:{})});const json=await response.json();assert.equal(response.status,expected,JSON.stringify(json));return json.data;
  }
  await call('/account',null,undefined,401);assert.equal((await call('/account')).id,customer);
  for(const key of ['role','roleId','passwordHash','email','id'])await call('/account',customer,{[key]:'forbidden'},400,'PATCH');
  await call('/account',customer,{fname:' Updated ',lname:'Customer',phone:'+63 912 345 6789'},200,'PATCH');assert.equal(users.get(customer).fname,'Updated');assert.equal(users.get(tech).fname,'Test');
  assert.equal((await call('/conversations')).conversations[0].repairId,id);assert.equal((await call('/conversations',other)).conversations.length,0);await call(`/repairs/${id}`,other,undefined,403);
  const proposal={proposedStart:new Date(Date.now()+86400000).toISOString(),proposedEnd:new Date(Date.now()+90000000).toISOString()};
  await call(`/repairs/${id}/schedules`,customer,proposal,403);
  await call(`/repairs/${id}/scheduling-permission`,customer,{customerCanProposeSchedule:true},403,'PATCH');
  await call(`/repairs/${id}/scheduling-permission`,tech,{customerCanProposeSchedule:true},200,'PATCH');
  const delegated=await call(`/repairs/${id}/schedules`,customer,proposal,201);
  await call(`/repairs/${id}/scheduling-permission`,tech,{customerCanProposeSchedule:false},409,'PATCH');
  await call(`/repairs/${id}/schedules/${delegated.id}/respond`,customer,{status:'CONFIRMED'},409);
  await call(`/repairs/${id}/schedules/${delegated.id}/respond`,tech,{status:'REJECTED'});
  await call(`/repairs/${id}/scheduling-permission`,tech,{customerCanProposeSchedule:false},200,'PATCH');
  const technicianProposal=await call(`/repairs/${id}/schedules`,tech,proposal,201);
  await call(`/repairs/${id}/schedules/${technicianProposal.id}/respond`,customer,{status:'CONFIRMED'});
  await call(`/repairs/${id}/scheduling-permission`,tech,{customerCanProposeSchedule:true},409,'PATCH');
  await call(`/repairs/${id}/action`,tech,{action:'start'});
  await call(`/repairs/${id}/action`,tech,{action:'finish',finalCost:1500});assert.equal(r.priceVersion,1);
  await call(`/repairs/${id}/final-price`,customer,{finalCost:1200,priceVersion:1},403,'PATCH');
  await call(`/repairs/${id}/final-price`,tech,{finalCost:1200,priceVersion:1},200,'PATCH');assert.equal(r.priceVersion,2);
  await call(`/repairs/${id}/action`,customer,{action:'confirm',priceVersion:1},409);
  await call(`/repairs/${id}/action`,customer,{action:'confirm',priceVersion:2});assert.equal(r.status,'COMPLETED');
  await call(`/repairs/${id}/final-price`,tech,{finalCost:1100,priceVersion:2},200,'PATCH');assert.equal(r.status,'AWAITING_CUSTOMER_CONFIRMATION');assert.equal(r.priceVersion,3);
  assert.ok(audits.some(a=>a.action==='FINAL_PRICE_CORRECTED'&&a.details.previousAmount==='1200'&&a.details.customerApprovalInvalidated));
  r.payment={status:'PENDING',providerCheckoutId:'cs_existing'};
  await call(`/repairs/${id}/final-price`,tech,{finalCost:1000,priceVersion:3},409,'PATCH');assert.equal(r.finalCost,1100);
});
