const prisma = require('./prisma');

// One eligibility filter for listing ratings, profile ratings, and review feeds.
const eligibleReview = { repairRequest: { status: 'COMPLETED', outcome: 'SUCCESSFUL' } };
const profileSelect = {
  id: true, bio: true, yearsExperience: true, serviceDescription: true,
  isAvailable: true, updatedAt: true,
  user: { select: { id: true, fname: true, lname: true } },
  specialties: { select: { yearsExperience: true, repairCategory: { select: { id: true, name: true } } } },
  serviceAreas: { select: { serviceArea: { select: { city: true, province: true } } } },
};

async function readReviews(id, page = 1) {
  const where = { technicianProfileId: id, ...eligibleReview };
  const [reviews, total] = await Promise.all([
    prisma.review.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * 10, take: 10,
      select: { id: true, rating: true, comment: true, createdAt: true, customer: { select: { fname: true, lname: true } } } }),
    prisma.review.count({ where }),
  ]);
  return { reviews: reviews.map(({ customer, ...review }) => ({ ...review, customerName: `${customer.fname} ${customer.lname}` })), pagination: { page, total, totalPages: Math.ceil(total / 10) } };
}

async function readProfile(where) {
  const profile = await prisma.technicianProfile.findFirst({ where: { ...where, user: { isActive: true } }, select: profileSelect });
  if (!profile) return null;
  const [rating, completedRepairs, feed] = await Promise.all([
    prisma.review.aggregate({ where: { technicianProfileId: profile.id, ...eligibleReview }, _avg: { rating: true }, _count: { _all: true } }),
    prisma.repairRequest.count({ where: { technicianProfileId: profile.id, status: 'COMPLETED', outcome: 'SUCCESSFUL' } }),
    readReviews(profile.id),
  ]);
  return {
    ...profile,
    specialties: profile.specialties.map(s => ({ categoryId: s.repairCategory.id, name: s.repairCategory.name, yearsExperience: s.yearsExperience })),
    serviceAreas: profile.serviceAreas.map(a => a.serviceArea),
    rating: { averageRating: rating._count._all ? Number(rating._avg.rating.toFixed(2)) : null, reviewCount: rating._count._all },
    completedRepairs, reviews: feed.reviews, reviewPagination: feed.pagination,
  };
}
module.exports = { readProfile, readReviews, eligibleReview };
