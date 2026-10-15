const { fail } = require('./workflow');
function assignedTechnician(repair, user) {
  return user.role === 'Technician' && repair.technicianProfile?.userId === user.id;
}
function scheduleDates(body, now = new Date()) {
  if (!body.proposedStart || !body.proposedEnd) throw fail('Select both a start date/time and an end date/time.');
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
  if (typeof body.proposedStart !== 'string' || typeof body.proposedEnd !== 'string' || !iso.test(body.proposedStart) || !iso.test(body.proposedEnd)) throw fail('Invalid date/time format. Send ISO timestamps with a timezone.');
  for (const value of [body.proposedStart,body.proposedEnd]) {
    const local = new Date(value.replace(/(?:Z|[+-]\d{2}:\d{2})$/, 'Z'));
    if (!Number.isFinite(+local) || local.toISOString().slice(0,16) !== value.slice(0,16)) throw fail('Invalid calendar date or time. Choose a real date.');
  }
  const start = new Date(body.proposedStart), end = new Date(body.proposedEnd);
  if (!Number.isFinite(+start) || !Number.isFinite(+end)) throw fail('Invalid date/time. Select valid calendar dates.');
  if (start <= now) throw fail('The start time must be in the future (Philippine time, UTC+08:00).');
  if (end <= start) throw fail('The end time must be later than the start time.');
  if (end - start > 86400000) throw fail('A repair visit cannot last more than 24 hours. Choose an earlier end time.');
  return { start, end };
}
function canPropose(repair, user) {
  if (repair.status !== 'ACCEPTED') throw fail('Only accepted repairs support new schedule proposals.', 409);
  if (repair.schedules.some(s => s.status === 'CONFIRMED')) throw fail('A schedule is already confirmed. Scheduling permission cannot be changed.', 409);
  if (assignedTechnician(repair,user)) {
    if (repair.customerCanProposeSchedule) throw fail('Scheduling is delegated to the customer. Revoke delegation before proposing your own schedule.', 409);
    return;
  }
  if (user.role === 'Customer' && user.id === repair.customerId && repair.customerCanProposeSchedule) return;
  throw fail('Only the assigned technician may propose a schedule unless they delegate permission to the customer.', 403);
}
function delegationAllowed(repair, user, delegated) {
  if (!assignedTechnician(repair,user)) throw fail('Only the assigned technician may manage scheduling permission.',403);
  if (typeof delegated !== 'boolean') throw fail('Scheduling permission must be true or false.');
  if (repair.status !== 'ACCEPTED') throw fail('Scheduling permission can only be changed for an accepted repair.',409);
  if (repair.schedules.some(s => ['PROPOSED','CONFIRMED'].includes(s.status))) throw fail('Resolve the outstanding proposal first. Confirmed schedules and pending proposals are preserved.',409);
}
function validAmount(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 99999999.99 || Math.abs(value * 100 - Math.round(value * 100)) > .00001) throw fail('Enter a nonnegative PHP amount with no more than two decimal places (maximum 99,999,999.99).');
  return value;
}
function priceCorrection(repair, user, body) {
  if (!assignedTechnician(repair,user)) throw fail('Only the assigned technician may correct the final price.',403);
  if (!['AWAITING_CUSTOMER_CONFIRMATION','COMPLETED'].includes(repair.status) || repair.outcome !== 'SUCCESSFUL') throw fail('Only a successful repair awaiting confirmation or not yet checked out supports price correction.',409);
  if (repair.payment) throw fail('A payment or checkout record already exists. Its amount cannot be changed. Contact support before requesting a correction.',409);
  if (!Number.isInteger(body.priceVersion) || body.priceVersion !== (repair.priceVersion ?? 0)) throw fail('The price has changed. Refresh the repair before editing.',409);
  validAmount(body.finalCost);
  return { finalCost: body.finalCost, priceVersion: (repair.priceVersion ?? 0) + 1, status: 'AWAITING_CUSTOMER_CONFIRMATION' };
}
module.exports = { assignedTechnician, scheduleDates, canPropose, delegationAllowed, validAmount, priceCorrection };
