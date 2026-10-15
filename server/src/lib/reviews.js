const { fail } = require('./workflow');
function validateReview(repair, customerId, body) {
  if (repair.customerId !== customerId || repair.status !== 'COMPLETED' || repair.outcome !== 'SUCCESSFUL' || !repair.technicianProfileId) throw fail('Only the customer of a successfully completed repair can leave a review.', 409);
  if (repair.review) throw fail('You have already reviewed this repair.', 409);
  if (!Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5) throw fail('Choose a rating from 1 to 5 stars.');
  if (typeof body.comment !== 'string' || !body.comment.trim() || body.comment.length > 2000) throw fail('Write feedback between 1 and 2,000 characters.');
  return { repairRequestId: repair.id, customerId, technicianProfileId: repair.technicianProfileId, rating: body.rating, comment: body.comment.trim() };
}
module.exports = { validateReview };
