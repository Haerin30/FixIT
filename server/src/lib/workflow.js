const fail = (message, status = 400) => Object.assign(new Error(message), { status });
function transition(repair, actor, action, cost, expectedPriceVersion) {
  const customer = actor.role === 'Customer' && actor.id === repair.customerId;
  const technician = actor.role === 'Technician' && actor.id === repair.technicianProfile?.userId;
  if (customer && action === 'cancel' && ['PENDING', 'ACCEPTED'].includes(repair.status)) return { status: 'CANCELLED' };
  if (technician) {
    if (repair.status === 'PENDING' && ['accept', 'reject'].includes(action)) return { status: action === 'accept' ? 'ACCEPTED' : 'REJECTED' };
    if (repair.status === 'ACCEPTED' && action === 'start') {
      if (!repair.schedules?.some(s => s.status === 'CONFIRMED')) throw fail('Confirm a schedule before starting.');
      return { status: 'IN_PROGRESS' };
    }
    if (repair.status === 'IN_PROGRESS' && action === 'failed') return { status: 'FAILED', outcome: 'UNSUCCESSFUL', finalCost: 0 };
    if (repair.status === 'IN_PROGRESS' && action === 'finish') {
      if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0 || cost > 99999999.99 || Math.abs(cost * 100 - Math.round(cost * 100)) > .00001) throw fail('Enter a valid final cost with at most two decimal places.');
      return { status: 'AWAITING_CUSTOMER_CONFIRMATION', outcome: 'SUCCESSFUL', finalCost: cost, priceVersion: (repair.priceVersion ?? 0) + 1 };
    }
  }
  if (customer && action === 'confirm' && repair.status === 'AWAITING_CUSTOMER_CONFIRMATION') {
    if (!Number.isInteger(expectedPriceVersion) || expectedPriceVersion !== (repair.priceVersion ?? 0)) throw fail('The final price has changed. Refresh and confirm the latest amount.', 409);
    return { status: 'COMPLETED' };
  }
  throw fail('This action is not allowed for the current repair state.', 409);
}
module.exports = { fail, transition };
