
const express = require("express");
const prisma = require("../lib/prisma");
const { readProfile, readReviews, eligibleReview } = require("../lib/technician-profile");

const router = express.Router();

const {
    authenticateToken,
    requireRole,
} = require("../middleware/auth");

// ---------------------------------------------------------------------------
// Validation helper for profile body fields
// ---------------------------------------------------------------------------

/**
 * Validates and normalises the fields shared by both POST and PUT profile
 * routes.  Returns `{ errors, data }`.  `errors` is an array of human-readable
 * messages; `data` holds the sanitised values ready for Prisma.
 *
 * @param {object} body - Express request body.
 * @param {boolean} requireAll - When true every field is required (POST).
 *   When false only provided fields are validated (PUT).
 */
function validateProfileBody(body, requireAll) {
    const errors = [];
    const data = {};
    if (body.isAvailable !== undefined) {
        if (typeof body.isAvailable !== 'boolean') errors.push('isAvailable must be a boolean.');
        else data.isAvailable = body.isAvailable;
    }

    // bio (optional string, ≤ 5 000 chars)
    if (body.bio !== undefined) {
        if (typeof body.bio !== "string") {
            errors.push("bio must be a string.");
        } else if (body.bio.trim().length > 5000) {
            errors.push("bio must not exceed 5 000 characters.");
        } else {
            data.bio = body.bio.trim();
        }
    }

    // yearsExperience (integer 0–80)
    if (body.yearsExperience !== undefined) {
        const yoe = Number(body.yearsExperience);
        if (!Number.isInteger(yoe) || yoe < 0 || yoe > 80) {
            errors.push("yearsExperience must be an integer between 0 and 80.");
        } else {
            data.yearsExperience = yoe;
        }
    } else if (requireAll) {
        data.yearsExperience = 0;
    }

    // serviceDescription (optional string, ≤ 5 000 chars)
    if (body.serviceDescription !== undefined) {
        if (typeof body.serviceDescription !== "string") {
            errors.push("serviceDescription must be a string.");
        } else if (body.serviceDescription.trim().length > 5000) {
            errors.push(
                "serviceDescription must not exceed 5 000 characters."
            );
        } else {
            data.serviceDescription = body.serviceDescription.trim();
        }
    }

    // categoryIds (non-empty array of unique positive integers)
    if (body.categoryIds !== undefined) {
        if (
            !Array.isArray(body.categoryIds) ||
            body.categoryIds.length === 0
        ) {
            errors.push(
                "categoryIds must be a non-empty array of positive integers."
            );
        } else {
            const ids = body.categoryIds.map(Number);
            const allIntegers = ids.every(
                (n) => Number.isInteger(n) && n > 0
            );
            if (!allIntegers) {
                errors.push(
                    "Every value in categoryIds must be a positive integer."
                );
            } else if (new Set(ids).size !== ids.length) {
                errors.push("categoryIds must not contain duplicates.");
            } else {
                data.categoryIds = ids;
            }
        }
    } else if (requireAll) {
        errors.push(
            "categoryIds must be a non-empty array of positive integers."
        );
    }

    // serviceAreas (non-empty array of {city, province} objects)
    if (body.serviceAreas !== undefined) {
        if (
            !Array.isArray(body.serviceAreas) ||
            body.serviceAreas.length === 0
        ) {
            errors.push(
                "serviceAreas must be a non-empty array of {city, province} objects."
            );
        } else {
            const areas = [];
            let areaError = false;

            for (let i = 0; i < body.serviceAreas.length; i++) {
                const item = body.serviceAreas[i];

                if (
                    typeof item !== "object" ||
                    item === null ||
                    typeof item.city !== "string" ||
                    typeof item.province !== "string"
                ) {
                    errors.push(
                        `serviceAreas[${i}] must be an object with non-empty city and province strings.`
                    );
                    areaError = true;
                    break;
                }

                const city = item.city.trim();
                const province = item.province.trim();

                if (!city || !province) {
                    errors.push(
                        `serviceAreas[${i}] city and province must not be empty.`
                    );
                    areaError = true;
                    break;
                }

                if (city.length > 100 || province.length > 100) {
                    errors.push(
                        `serviceAreas[${i}] city and province must not exceed 100 characters.`
                    );
                    areaError = true;
                    break;
                }

                areas.push({ city, province });
            }

            if (!areaError) {
                // Detect duplicate {city, province} pairs in the request itself.
                const seen = new Set(
                    areas.map((a) => `${a.city.toLowerCase()}|${a.province.toLowerCase()}`)
                );
                if (seen.size !== areas.length) {
                    errors.push(
                        "serviceAreas must not contain duplicate city/province pairs."
                    );
                } else {
                    data.serviceAreas = areas;
                }
            }
        }
    } else if (requireAll) {
        errors.push(
            "serviceAreas must be a non-empty array of {city, province} objects."
        );
    }

    return { errors, data };
}

// ---------------------------------------------------------------------------
// POST /api/technicians/profile
// Create the authenticated technician's profile.
// ---------------------------------------------------------------------------
router.post(
    "/profile",
    authenticateToken,
    requireRole("Technician"),
    async (req, res) => {
        try {
            const { errors, data } = validateProfileBody(req.body, true);

            if (errors.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: "Validation failed.",
                    errors,
                });
            }

            // Confirm all supplied category IDs exist.
            const foundCategories = await prisma.repairCategory.findMany({
                where: { id: { in: data.categoryIds } },
                select: { id: true },
            });

            if (foundCategories.length !== data.categoryIds.length) {
                const foundIds = new Set(foundCategories.map((c) => c.id));
                const missing = data.categoryIds.filter(
                    (id) => !foundIds.has(id)
                );
                return res.status(400).json({
                    success: false,
                    message: "One or more repair category IDs do not exist.",
                    invalidIds: missing,
                });
            }

            // Reject if this technician already has a profile.
            const existing = await prisma.technicianProfile.findUnique({
                where: { userId: req.user.id },
                select: { id: true },
            });

            if (existing) {
                return res.status(409).json({
                    success: false,
                    message:
                        "A profile already exists for this technician account. Use PUT /api/technicians/profile to update it.",
                });
            }

            // Upsert every service area so we always have an ID to link.
            const serviceAreaRecords = await Promise.all(
                data.serviceAreas.map((area) =>
                    prisma.serviceArea.upsert({
                        where: {
                            city_province: {
                                city: area.city,
                                province: area.province,
                            },
                        },
                        create: { city: area.city, province: area.province },
                        update: {},
                        select: { id: true },
                    })
                )
            );

            // Create the profile, specialties, and service-area links atomically.
            const profile = await prisma.$transaction(async (tx) => {
                const created = await tx.technicianProfile.create({
                    data: {
                        userId: req.user.id,
                        bio: data.bio ?? null,
                        yearsExperience: data.yearsExperience,
                        serviceDescription: data.serviceDescription ?? null,
                        isAvailable: data.isAvailable ?? true,
                        specialties: {
                            create: data.categoryIds.map((catId) => ({
                                repairCategoryId: catId,
                                yearsExperience: 0,
                            })),
                        },
                        serviceAreas: {
                            create: serviceAreaRecords.map((area) => ({
                                serviceAreaId: area.id,
                            })),
                        },
                    },
                    select: {
                        id: true,
                        bio: true,
                        yearsExperience: true,
                        serviceDescription: true,
                        isAvailable: true,
                        specialties: {
                            select: {
                                repairCategory: {
                                    select: { id: true, name: true },
                                },
                            },
                        },
                        serviceAreas: {
                            select: {
                                serviceArea: {
                                    select: { city: true, province: true },
                                },
                            },
                        },
                    },
                });

                return created;
            });

            return res.status(201).json({
                success: true,
                message: "Technician profile created.",
                data: {
                    profile: {
                        ...profile,
                        specialties: profile.specialties.map((s) => ({
                            categoryId: s.repairCategory.id,
                            name: s.repairCategory.name,
                        })),
                        serviceAreas: profile.serviceAreas.map(
                            (s) => s.serviceArea
                        ),
                    },
                },
            });
        } catch (error) {
            console.error("Create technician profile error:", error);

            return res.status(500).json({
                success: false,
                message: "Could not create technician profile.",
            });
        }
    }
);

// ---------------------------------------------------------------------------
// PUT /api/technicians/profile
// Update the authenticated technician's existing profile.
// ---------------------------------------------------------------------------
router.put(
    "/profile",
    authenticateToken,
    requireRole("Technician"),
    async (req, res) => {
        try {
            const { errors, data } = validateProfileBody(req.body, false);

            if (errors.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: "Validation failed.",
                    errors,
                });
            }

            // Confirm the authenticated technician has a profile.
            const existingProfile = await prisma.technicianProfile.findUnique({
                where: { userId: req.user.id },
                select: { id: true },
            });

            if (!existingProfile) {
                return res.status(404).json({
                    success: false,
                    message:
                        "No profile found. Use POST /api/technicians/profile to create one first.",
                });
            }

            // If new category IDs were supplied, verify they all exist.
            if (data.categoryIds) {
                const foundCategories = await prisma.repairCategory.findMany({
                    where: { id: { in: data.categoryIds } },
                    select: { id: true },
                });

                if (foundCategories.length !== data.categoryIds.length) {
                    const foundIds = new Set(
                        foundCategories.map((c) => c.id)
                    );
                    const missing = data.categoryIds.filter(
                        (id) => !foundIds.has(id)
                    );
                    return res.status(400).json({
                        success: false,
                        message:
                            "One or more repair category IDs do not exist.",
                        invalidIds: missing,
                    });
                }
            }

            // Upsert service areas if provided.
            let serviceAreaRecords = null;
            if (data.serviceAreas) {
                serviceAreaRecords = await Promise.all(
                    data.serviceAreas.map((area) =>
                        prisma.serviceArea.upsert({
                            where: {
                                city_province: {
                                    city: area.city,
                                    province: area.province,
                                },
                            },
                            create: {
                                city: area.city,
                                province: area.province,
                            },
                            update: {},
                            select: { id: true },
                        })
                    )
                );
            }

            const profileId = existingProfile.id;

            // Build the scalar update payload (only changed fields).
            const profileUpdate = {};
            if (data.isAvailable !== undefined) profileUpdate.isAvailable = data.isAvailable;
            if (data.bio !== undefined) profileUpdate.bio = data.bio;
            if (data.yearsExperience !== undefined)
                profileUpdate.yearsExperience = data.yearsExperience;
            if (data.serviceDescription !== undefined)
                profileUpdate.serviceDescription = data.serviceDescription;

            // Perform all mutations inside a single transaction.
            const profile = await prisma.$transaction(async (tx) => {
                // Replace specialties if new categoryIds were given.
                if (data.categoryIds) {
                    await tx.technicianSpecialty.deleteMany({
                        where: { technicianProfileId: profileId },
                    });
                    await tx.technicianSpecialty.createMany({
                        data: data.categoryIds.map((catId) => ({
                            technicianProfileId: profileId,
                            repairCategoryId: catId,
                            yearsExperience: 0,
                        })),
                    });
                }

                // Replace service areas if new serviceAreas were given.
                if (serviceAreaRecords) {
                    await tx.technicianServiceArea.deleteMany({
                        where: { technicianProfileId: profileId },
                    });
                    await tx.technicianServiceArea.createMany({
                        data: serviceAreaRecords.map((area) => ({
                            technicianProfileId: profileId,
                            serviceAreaId: area.id,
                        })),
                    });
                }

                // Update scalars and return the full refreshed profile.
                return tx.technicianProfile.update({
                    where: { id: profileId },
                    data: profileUpdate,
                    select: {
                        id: true,
                        bio: true,
                        yearsExperience: true,
                        serviceDescription: true,
                        isAvailable: true,
                        specialties: {
                            select: {
                                repairCategory: {
                                    select: { id: true, name: true },
                                },
                            },
                        },
                        serviceAreas: {
                            select: {
                                serviceArea: {
                                    select: { city: true, province: true },
                                },
                            },
                        },
                    },
                });
            });

            return res.status(200).json({
                success: true,
                message: "Technician profile updated.",
                data: {
                    profile: {
                        ...profile,
                        specialties: profile.specialties.map((s) => ({
                            categoryId: s.repairCategory.id,
                            name: s.repairCategory.name,
                        })),
                        serviceAreas: profile.serviceAreas.map(
                            (s) => s.serviceArea
                        ),
                    },
                },
            });
        } catch (error) {
            console.error("Update technician profile error:", error);

            return res.status(500).json({
                success: false,
                message: "Could not update technician profile.",
            });
        }
    }
);

// ---------------------------------------------------------------------------
// Helpers used by the public GET routes below
// ---------------------------------------------------------------------------

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// GET /api/technicians
// Browse available technicians.
// Optional query parameters: category, city, province, page, limit.
router.get("/", async (req, res) => {
    try {
        const category =
            typeof req.query.category === "string"
                ? req.query.category.trim()
                : "";

        const city =
            typeof req.query.city === "string"
                ? req.query.city.trim()
                : "";

        const province =
            typeof req.query.province === "string"
                ? req.query.province.trim()
                : "";

        const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.page, 10) || 1));
        const requestedLimit =
            Number.parseInt(req.query.limit, 10) || 10;
        const limit = Math.min(50, Math.max(1, requestedLimit));
        const skip = (page - 1) * limit;

        const where = {
            isAvailable: true,
            user: {
                isActive: true,
            },
        };

        if (category) {
            where.specialties = {
                some: {
                    repairCategory: {
                        name: {
                            equals: category,
                            mode: "insensitive",
                        },
                    },
                },
            };
        }

        if (city || province) {
            where.serviceAreas = {
                some: {
                    serviceArea: {
                        ...(city
                            ? {
                                city: {
                                    equals: city,
                                    mode: "insensitive",
                                },
                            }
                            : {}),
                        ...(province
                            ? {
                                province: {
                                    equals: province,
                                    mode: "insensitive",
                                },
                            }
                            : {}),
                    },
                },
            };
        }

        const [profiles, total] = await Promise.all([
            prisma.technicianProfile.findMany({
                where,
                skip,
                take: limit,
                orderBy: [
                    { yearsExperience: "desc" },
                    { id: "asc" },
                ],
                select: {
                    id: true,
                    bio: true,
                    yearsExperience: true,
                    serviceDescription: true,
                    isAvailable: true,
                    user: {
                        select: {
                            fname: true,
                            lname: true,
                        },
                    },
                    specialties: {
                        select: {
                            yearsExperience: true,
                            repairCategory: {
                                select: {
                                    id: true,
                                    name: true,
                                },
                            },
                        },
                    },
                    serviceAreas: {
                        select: {
                            serviceArea: {
                                select: {
                                    city: true,
                                    province: true,
                                },
                            },
                        },
                    },
                },
            }),
            prisma.technicianProfile.count({ where }),
        ]);

        // Calculate average rating and review count for listed technicians.
        const profileIds = profiles.map((profile) => profile.id);

        const reviewGroups = profileIds.length
            ? await prisma.review.groupBy({
                by: ["technicianProfileId"],
                where: {
                    ...eligibleReview,
                    technicianProfileId: {
                        in: profileIds,
                    },
                },
                _avg: {
                    rating: true,
                },
                _count: {
                    _all: true,
                },
            })
            : [];

        const ratingsByTechnician = new Map(
            reviewGroups.map((group) => [
                group.technicianProfileId,
                {
                    averageRating: Number(
                        (group._avg.rating || 0).toFixed(2)
                    ),
                    reviewCount: group._count._all,
                },
            ])
        );

        const completedGroups = profileIds.length ? await prisma.repairRequest.groupBy({ by: ['technicianProfileId'], where: { technicianProfileId: { in: profileIds }, status: 'COMPLETED', outcome: 'SUCCESSFUL' }, _count: { _all: true } }) : [];
        const completedById = new Map(completedGroups.map(g => [g.technicianProfileId, g._count._all]));
        const technicians = profiles.map((profile) => ({
            completedRepairs: completedById.get(profile.id) || 0,
            ...profile,
            specialties: profile.specialties.map((item) => ({
                name: item.repairCategory.name,
                categoryId: item.repairCategory.id,
                yearsExperience: item.yearsExperience,
            })),
            serviceAreas: profile.serviceAreas.map(
                (item) => item.serviceArea
            ),
            rating: ratingsByTechnician.get(profile.id) || {
                averageRating: null,
                reviewCount: 0,
            },
        }));

        return res.json({
            success: true,
            data: {
                technicians,
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit),
                },
            },
        });
    } catch (error) {
        console.error("Browse technicians error:", error);

        return res.status(500).json({
            success: false,
            message: "Could not retrieve technicians.",
        });
    }
});

// Public detail remains visible when a technician pauses availability.
router.get('/:id/reviews', async (req, res, next) => {
    try {
        if (!UUID_PATTERN.test(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid technician profile ID.' });
        const exists = await prisma.technicianProfile.findFirst({ where: { id: req.params.id, user: { isActive: true } }, select: { id: true } });
        if (!exists) return res.status(404).json({ success: false, message: 'Technician not found.' });
        const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.page, 10) || 1));
        res.json({ data: await readReviews(req.params.id, page) });
    } catch (error) { next(error); }
});
router.get('/:id', async (req, res, next) => {
    try {
        if (!UUID_PATTERN.test(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid technician profile ID.' });
        const technician = await readProfile({ id: req.params.id });
        if (!technician) return res.status(404).json({ success: false, message: 'Technician not found.' });
        res.json({ success: true, data: { technician } });
    } catch (error) { next(error); }
});
module.exports = router;
