
const jwt = require("jsonwebtoken");
const prisma = require("../lib/prisma");

async function authenticateToken(req, res, next) {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({
                success: false,
                message: "Authentication token is required.",
            });
        }

        const token = authHeader.slice("Bearer ".length);

        // Verify the token's signature and expiration.
        const decoded = jwt.verify(token, process.env.JWT_SECRET, {
            algorithms: ["HS256"],
        });

        if (typeof decoded.sub !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(decoded.sub)) return res.status(401).json({ success: false, message: 'Invalid authentication subject.' });

        // Fetch the current account and role from the database.
        const user = await prisma.user.findUnique({
            where: { id: decoded.sub },
            select: {
                id: true,
                fname: true,
                lname: true,
                email: true,
                isActive: true,
                role: {
                    select: {
                        name: true,
                    },
                },
            },
        });

        if (!user || !user.isActive) {
            return res.status(401).json({
                success: false,
                message: "Account is unavailable. Please log in again.",
            });
        }

        // Attach verified user information to the request.
        req.user = {
            id: user.id,
            fname: user.fname,
            lname: user.lname,
            email: user.email,
            role: user.role.name,
        };

        next();
    } catch (error) {
        if (
            error.name === "JsonWebTokenError" ||
            error.name === "TokenExpiredError" ||
            error.name === "NotBeforeError"
        ) {
            return res.status(401).json({
                success: false,
                message: "Invalid or expired token. Please log in again.",
            });
        }

        console.error("Authentication failed:", error.code || "INTERNAL_ERROR");

        return res.status(500).json({
            success: false,
            message: "Authentication failed due to a server error.",
        });
    }
}

function requireRole(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: "Authentication is required.",
            });
        }

        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: "You do not have permission to access this resource.",
            });
        }

        next();
    };
}

module.exports = {
    authenticateToken,
    requireRole,
};
