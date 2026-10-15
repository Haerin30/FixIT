const test = require('node:test');
const assert = require('node:assert/strict');
const { transition } = require('../src/lib/workflow');
const tech = { id: 'tech', role: 'Technician' }, customer = { id: 'customer', role: 'Customer' };
const repair = status => ({ status, customerId: 'customer', technicianProfile: { userId: 'tech' }, schedules: [] });
test('only assigned technician can accept or reject pending repair', () => {
  assert.equal(transition(repair('PENDING'), tech, 'accept').status, 'ACCEPTED');
  assert.equal(transition(repair('PENDING'), tech, 'reject').status, 'REJECTED');
  assert.throws(() => transition(repair('PENDING'), customer, 'accept'));
  assert.throws(() => transition(repair('PENDING'), { id: 'stranger', role: 'Technician' }, 'accept'));
});
test('starting needs a confirmed schedule', () => {
  assert.throws(() => transition(repair('ACCEPTED'), tech, 'start'));
  assert.equal(transition({ ...repair('ACCEPTED'), schedules: [{ status: 'CONFIRMED' }] }, tech, 'start').status, 'IN_PROGRESS');
});
test('unsuccessful repair always has zero fee', () => assert.deepEqual(transition(repair('IN_PROGRESS'), tech, 'failed', 500), { status: 'FAILED', outcome: 'UNSUCCESSFUL', finalCost: 0 }));
test('successful repair validates amount and requires customer confirmation', () => {
  for (const cost of [-1, NaN, Infinity, '500', .001]) assert.throws(() => transition(repair('IN_PROGRESS'), tech, 'finish', cost));
  assert.equal(transition(repair('IN_PROGRESS'), tech, 'finish', 500).status, 'AWAITING_CUSTOMER_CONFIRMATION');
  assert.throws(() => transition(repair('AWAITING_CUSTOMER_CONFIRMATION'), tech, 'confirm'));
  assert.equal(transition(repair('AWAITING_CUSTOMER_CONFIRMATION'), customer, 'confirm', undefined, 0).status, 'COMPLETED');
});
test('closed repairs cannot restart and cancellation stops after work starts', () => {
  for (const state of ['COMPLETED', 'FAILED', 'REJECTED', 'CANCELLED']) assert.throws(() => transition(repair(state), tech, 'start'));
  assert.equal(transition(repair('ACCEPTED'), customer, 'cancel').status, 'CANCELLED');
  assert.throws(() => transition(repair('IN_PROGRESS'), customer, 'cancel'));
});
