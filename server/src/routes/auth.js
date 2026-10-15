
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const prisma = require("../lib/prisma");

const router = express.Router();

const TOKEN_EXPIRY = "1h";

// POST /api/auth/register
router.post("/register", async (req, res) => {
    try {
        const { fname, lname, email, password } = req.body;

        // 1. Validate required fields.
        if (
            typeof fname !== "string" ||
            typeof lname !== "string" ||
            typeof email !== "string" ||
            typeof password !== "string" ||
            !fname.trim() ||
            !lname.trim() ||
            !email.trim() ||
            !password
        ) {
            return res.status(400).json({
                success: false,
                message: "First name, last name, email, and password are required.",
            });
        }

        if (password.length < 8 || Buffer.byteLength(password, "utf8") > 72) {
            return res.status(400).json({
                success: false,
                message: "Password must be at least 8 characters and no more than 72 bytes.",
            });
        }

        const normalizedEmail = email.trim().toLowerCase();

        if (
            normalizedEmail.length > 254 ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
        ) {
            return res.status(400).json({
                success: false,
                message: "Please provide a valid email address.",
            });
        }

        if (fname.trim().length > 100 || lname.trim().length > 100) {
            return res.status(400).json({
                success: false,
                message: "Names must not exceed 100 characters.",
            });
        }

        // 2. Check whether the email is already registered.
        const existingUser = await prisma.user.findUnique({
            where: { email: normalizedEmail },
        });

        if (existingUser) {
            return res.status(409).json({
                success: false,
                message: "An account with this email already exists.",
            });
        }

        // 3. Hash the password before saving it.
        const passwordHash = await bcrypt.hash(password, 12);

        // 4. Always assign the Customer role on public registration.
        const customerRole = await prisma.role.findUnique({
            where: { name: "Customer" },
        });

        if (!customerRole) {
            return res.status(500).json({
                success: false,
                message: "Default customer role is not configured.",
            });
        }

        // 5. Create the account in the database.
        const user = await prisma.user.create({
            data: {
                fname: fname.trim(),
                lname: lname.trim(),
                email: normalizedEmail,
                passwordHash,
                roleId: customerRole.id,
            },
            select: {
                id: true,
                fname: true,
                lname: true,
                email: true,
                role: {
                    select: {
                        name: true,
                    },
                },
            },
        });

        // 6. Issue a signed access token.
        const token = jwt.sign(
            {
                role: user.role.name,
            },
            process.env.JWT_SECRET,
            {
                subject: user.id,
                expiresIn: TOKEN_EXPIRY,
                algorithm: "HS256",
            }
        );

        return res.status(201).json({
            success: true,
            message: "Account created successfully.",
            data: {
                user,
                token,
            },
        });
    } catch (error) {
        // Handle a duplicate email if simultaneous requests race.
        if (error.code === "P2002") {
            return res.status(409).json({
                success: false,
                message: "An account with this email already exists.",
            });
        }

        console.error("Registration error:", error);

        return res.status(500).json({
            success: false,
            message: "Registration failed due to a server error.",
        });
    }
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (
            typeof email !== "string" ||
            typeof password !== "string" ||
            !email.trim() ||
            !password
        ) {
            return res.status(400).json({
                success: false,
                message: "Email and password are required.",
            });
        }

        const normalizedEmail = email.trim().toLowerCase();

        const user = await prisma.user.findUnique({
            where: { email: normalizedEmail },
            include: {
                role: true,
            },
        });

        // Use the same response for unknown emails and wrong passwords.
        if (
            !user ||
            !(await bcrypt.compare(password, user.passwordHash))
        ) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password.",
            });
        }

        if (!user.isActive) {
            return res.status(403).json({
                success: false,
                message: "This account is inactive. Please contact support.",
            });
        }

        const token = jwt.sign(
            {
                role: user.role.name,
            },
            process.env.JWT_SECRET,
            {
                subject: user.id,
                expiresIn: TOKEN_EXPIRY,
                algorithm: "HS256",
            }
        );

        return res.json({
            success: true,
            message: "Login successful.",
            data: {
                user: {
                    id: user.id,
                    fname: user.fname,
                    lname: user.lname,
                    email: user.email,
                    role: user.role.name,
                },
                token,
            },
        });
    } catch (error) {
        console.error("Login error:", error);

        return res.status(500).json({
            success: false,
            message: "Login failed due to a server error.",
        });
    }
});

module.exports = router;
