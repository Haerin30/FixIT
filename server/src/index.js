
require("dotenv").config({ quiet: true });

const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 5000;
const prisma = require("./lib/prisma");
const authRoutes = require("./routes/auth");
const technicianRoutes = require("./routes/technicians");

const {
    authenticateToken,
    requireRole,
} = require("./middleware/auth");

app.use(
    cors({
        origin: process.env.CLIENT_URL || "http://localhost:5173",
    })
);

app.use(express.json({ limit: '32kb' }));
app.disable('x-powered-by');
app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    if (['POST','PUT','PATCH'].includes(req.method) && req.body === undefined) req.body = {};
    if (['POST','PUT','PATCH'].includes(req.method) && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))) return res.status(400).json({ success: false, message: 'Send a JSON object as the request body.' });
    next();
});
app.use('/api/admin', require('./routes/admin'));
app.use('/api/payments', require('./routes/payments'));


app.use("/api/technicians", technicianRoutes);

app.use("/api/auth", authRoutes);


app.get("/api/test-db", authenticateToken, requireRole("Administrator"), async (req, res) => {
    try {
        const [roles, categories] = await Promise.all([
            prisma.role.findMany(),
            prisma.repairCategory.findMany(),
        ]);

        res.json({
            success: true,
            message: "FixIT database connection successful",
            data: {
                roles,
                categories,
            },
        });
    } catch (error) {
        console.error("Database test failed:", error);

        res.status(500).json({
            success: false,
            message: "Could not retrieve database records",
        });
    }
});

app.get("/api/health", (req, res) => {
    res.json({
        success: true,
        message: "FixIT API is running",
    });
});

// Any authenticated user can access this route.
app.get("/api/protected", authenticateToken, (req, res) => {
    res.json({
        success: true,
        message: "You are authenticated!",
        user: req.user,
    });
});

// Only administrators can access this route.
app.get(
    "/api/admin-test",
    authenticateToken,
    requireRole("Administrator"),
    (req, res) => {
        res.json({
            success: true,
            message: "Administrator access granted.",
        });
    }
);

app.use('/api', require('./routes/marketplace').router);

app.use((req, res) => res.status(404).json({ success: false, message: 'API endpoint not found.' }));

app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.type === 'entity.parse.failed') return res.status(400).json({ success: false, message: 'Malformed JSON. Send a valid JSON object.' });
    const status = error.status || (['P2002', 'P2034'].includes(error.code) ? 409 : error.code === 'P2003' ? 400 : 500);
    res.status(status).json({ success: false, message: error.status || status < 500 ? (error.code ? 'Record conflict. Refresh and retry.' : error.message) : 'Service unavailable. Please retry shortly.' });
});
if (require.main === module && (!process.env.JWT_SECRET || !process.env.DATABASE_URL)) throw new Error('Configure DATABASE_URL and JWT_SECRET before starting the API.');
if (require.main === module) app.listen(PORT, () => {
    console.log(`FixIT API running on port ${PORT}`);
});
module.exports = app;
