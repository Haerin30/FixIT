const test=require('node:test');
const assert=require('node:assert/strict');
const { scheduleDates,canPropose,delegationAllowed,priceCorrection }=require('../src/lib/repair-rules');
const { transition }=require('../src/lib/workflow');
const tech={id:'tech',role:'Technician'},customer={id:'customer',role:'Customer'},other={id:'other',role:'Technician'};
const repair=()=>({id:'repair',customerId:'customer',technicianProfile:{userId:'tech'},customerCanProposeSchedule:false,schedules:[],status:'ACCEPTED',priceVersion:1,finalCost:'1500',outcome:'SUCCESSFUL',payment:null});
test('technician controls schedule proposals and delegation is per repair',()=>{
  const r=repair();assert.doesNotThrow(()=>canPropose(r,tech));assert.throws(()=>canPropose(r,customer),{status:403});assert.throws(()=>canPropose(r,other),{status:403});
  assert.throws(()=>delegationAllowed(r,customer,true),{status:403});assert.doesNotThrow(()=>delegationAllowed(r,tech,true));
  r.customerCanProposeSchedule=true;assert.doesNotThrow(()=>canPropose(r,customer));assert.throws(()=>canPropose(r,tech),{status:409});
  r.schedules=[{status:'PROPOSED'}];assert.throws(()=>delegationAllowed(r,tech,false),{status:409});
  r.schedules=[{status:'CONFIRMED'}];assert.throws(()=>canPropose(r,customer),{status:409});assert.throws(()=>delegationAllowed(r,tech,false),{status:409});
  r.schedules=[];r.status='PENDING';assert.throws(()=>canPropose(r,tech),{status:409});
});
test('schedule date validation has specific messages and accepts Philippine timezone offsets',()=>{
  const now=new Date('2026-10-16T00:00:00Z');
  const valid={proposedStart:'2026-10-17T09:00:00+08:00',proposedEnd:'2026-10-17T10:00:00+08:00'};
  assert.equal(scheduleDates(valid,now).start.toISOString(),'2026-10-17T01:00:00.000Z');
  assert.throws(()=>scheduleDates({},now),/Select both/);
  assert.throws(()=>scheduleDates({...valid,proposedStart:'bad'},now),/Invalid date/);
  assert.throws(()=>scheduleDates({...valid,proposedStart:'2026-02-30T09:00:00+08:00'},now),/Invalid calendar/);
  assert.throws(()=>scheduleDates({...valid,proposedStart:'2026-10-15T09:00:00+08:00'},now),/future/);
  assert.throws(()=>scheduleDates({...valid,proposedEnd:valid.proposedStart},now),/later/);
  assert.throws(()=>scheduleDates({...valid,proposedEnd:'2026-10-18T10:00:00+08:00'},now),/24 hours/);
  assert.throws(()=>scheduleDates({...valid,proposedStart:'2026-10-17T09:00'},now),/timezone/);
});
test('price correction preserves history and forces new customer approval',()=>{
  const r={...repair(),status:'AWAITING_CUSTOMER_CONFIRMATION'};
  assert.deepEqual(priceCorrection(r,tech,{finalCost:1200,priceVersion:1}),{finalCost:1200,priceVersion:2,status:'AWAITING_CUSTOMER_CONFIRMATION'});
  assert.throws(()=>priceCorrection(r,customer,{finalCost:1200,priceVersion:1}),{status:403});
  assert.throws(()=>priceCorrection(r,other,{finalCost:1200,priceVersion:1}),{status:403});
  assert.throws(()=>priceCorrection(r,tech,{finalCost:1200,priceVersion:0}),{status:409});
  for(const value of [-1,1.001,NaN,Infinity,'1200'])assert.throws(()=>priceCorrection(r,tech,{finalCost:value,priceVersion:1}));
  assert.equal(priceCorrection({...r,status:'COMPLETED'},tech,{finalCost:1200,priceVersion:1}).status,'AWAITING_CUSTOMER_CONFIRMATION');
  for(const status of ['PENDING','FAILED','PAID','REFUNDED'])assert.throws(()=>priceCorrection({...r,payment:{status}},tech,{finalCost:1200,priceVersion:1}),{status:409});
  const corrected={...r,...priceCorrection(r,tech,{finalCost:1200,priceVersion:1})};
  assert.throws(()=>transition(corrected,customer,'confirm',undefined,1),{status:409});
  assert.equal(transition(corrected,customer,'confirm',undefined,2).status,'COMPLETED');
});
