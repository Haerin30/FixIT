/**
 * tests/technician-profile.test.js
 *
 * Automated tests for the technician profile management routes.
 *
 * Run from the `server/` directory:
 *   node --test tests/technician-profile.test.js
 *
 * Scenario A  PUT /profile — Technician with no profile → 404
 *   In-process Express app.  A live-swappable Prisma proxy is injected via the
 *   module cache so that both `authenticateToken` (which does a user lookup)
 *   and the route handler (which does a profile lookup) see the same mock.
 *   No real database is contacted.  A real JWT is minted with the server's own
 *   JWT_SECRET so the signature verification inside authenticateToken passes.
 *
 * Scenario B  PUT /profile — No Authorization header → 401
 *   Hits the live dev server at localhost:5000.  No credentials are needed and
 *   no data is written.
 *
 * Scenario C  POST /profile — Customer token → 403
 *   Same in-process app as Scenario A.  The Prisma proxy is reconfigured to
 *   return a Customer-role user before the request is sent.
 *
 * Safety guarantees
 * ─────────────────
 * - No real user accounts are created, modified, or deleted.
 * - No passwords, secrets, or tokens are logged or written to disk.
 * - JWT_SECRET is read from .env at runtime and used only to sign short-lived
 *   test tokens; it is never printed.
 * - The Prisma proxy is a plain JS object in memory; the real PrismaClient is
 *   never instantiated by this test file.
 */

"use strict";

require("dotenv").config();          // loads server/.env → process.env.JWT_SECRET
const test    = require("node:test");
const assert  = require("node:assert/strict");
const http    = require("node:http");
const jwt     = require("jsonwebtoken");
const express = require("express");

// ─── constants ────────────────────────────────────────────────────────────────

const JWT_SECRET = process.env.JWT_SECRET || 'isolated-profile-test-secret';
process.env.JWT_SECRET = JWT_SECRET;

const TECH_ROLE    = "Technician";
const CUST_ROLE    = "Customer";

// Fake UUIDs — will never match real database rows
const FAKE_TECH_ID = "00000000-0000-4000-8000-000000000001";
const FAKE_CUST_ID = "00000000-0000-4000-8000-000000000002";

// ─── Live-swappable Prisma proxy ──────────────────────────────────────────────
// A single proxy object whose internal `_impl` property is replaced between
// tests.  Because the route module holds a reference to this object (not to
// `_impl`), swapping `_impl` changes behavior without re-requiring the module.

const prismaProxy = {
    _impl: null,               // set before each scenario

    get user()              { return this._impl.user; },
    get technicianProfile() { return this._impl.technicianProfile; },
    get repairCategory()    { return this._impl.repairCategory; },
    get serviceArea()       { return this._impl.serviceArea; },
    $transaction:           async (fn) => prismaProxy._impl.$transaction(fn),
};

// Build a mock implementation for a given role / profile state.
function makeMockImpl({ role, userId, hasProfile }) {
    return {
        user: {
            findUnique: async ({ where }) => {
                if (where.id === userId) {
                    return {
                        id:       userId,
                        fname:    "Test",
                        lname:    "User",
                        email:    "test@example.invalid",
                        isActive: true,
                        role:     { name: role },
                    };
                }
                return null;
            },
        },
        technicianProfile: {
            findUnique: async () => (hasProfile ? { id: "mock-profile-id" } : null),
        },
        // The Customer POST route reaches requireRole first and returns 403
        // before any Prisma call, but add stubs to avoid surprises.
        repairCategory: {
            findMany: async () => [],
        },
        serviceArea: {
            upsert: async () => ({ id: 1 }),
        },
        $transaction: async (fn) => fn(prismaProxy._impl),
    };
}

// ─── In-process app setup ─────────────────────────────────────────────────────
// Built once; all in-process scenarios share the same Express instance.

let inProcessPort = null;
let closeInProcessServer = null;

// The port promise resolves once the OS assigns a port.
const portReady = new Promise((resolve) => {
    // Inject the proxy into the module cache BEFORE requiring any app modules.
    const prismaKey = require.resolve("../src/lib/prisma");
    delete require.cache[prismaKey];
    require.cache[prismaKey] = {
        id:       prismaKey,
        filename: prismaKey,
        loaded:   true,
        exports:  prismaProxy,
        children: [],
        parent:   null,
        paths:    [],
    };

    // Require route + auth modules — they will capture prismaProxy.
    const technicianRoutes = require("../src/routes/technicians");

    const app = express();
    app.use(express.json());
    app.use("/api/technicians", technicianRoutes);

    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
        inProcessPort = server.address().port;
        server.unref();   // don't keep Node alive after tests finish
        resolve(inProcessPort);
    });

    // Explicitly close on demand (Scenario teardown).
    closeInProcessServer = () => new Promise((res) => server.close(res));
});

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Mint a short-lived JWT signed with the server's own secret. */
function mintToken(userId, role) {
    if (!JWT_SECRET) throw new Error("JWT_SECRET not found in .env");
    return jwt.sign({ role }, JWT_SECRET, {
        subject:   userId,
        expiresIn: "5m",
        algorithm: "HS256",
    });
}

/** Minimal HTTP client using only Node built-ins. Returns { status, body }. */
function httpRequest({ baseUrl, method, path, headers = {}, body }) {
    return new Promise((resolve, reject) => {
        const url     = new URL(path, baseUrl);
        const payload = body ? JSON.stringify(body) : null;

        const req = http.request(
            {
                hostname: url.hostname,
                port:     Number(url.port) || 80,
                path:     url.pathname,
                method,
                headers: {
                    "Content-Type": "application/json",
                    ...(payload
                        ? { "Content-Length": Buffer.byteLength(payload) }
                        : {}),
                    ...headers,
                },
            },
            (res) => {
                let raw = "";
                res.on("data", (c) => (raw += c));
                res.on("end", () => {
                    let json;
                    try   { json = JSON.parse(raw); }
                    catch { json = raw; }
                    resolve({ status: res.statusCode, body: json });
                });
            }
        );
        req.on("error", reject);
        if (payload) req.write(payload);
        req.end();
    });
}

/** Returns the in-process server port, waiting for it to be ready if needed. */
async function waitForPort() {
    return portReady;
}

// ─── Scenario A ───────────────────────────────────────────────────────────────
// PUT /api/technicians/profile — Technician with NO existing profile → 404

test("Scenario A: PUT /profile — Technician with no profile → 404", async () => {

    prismaProxy._impl = makeMockImpl({
        role:       TECH_ROLE,
        userId:     FAKE_TECH_ID,
        hasProfile: false,
    });

    const port  = await waitForPort();
    const token = mintToken(FAKE_TECH_ID, TECH_ROLE);

    const { status, body } = await httpRequest({
        baseUrl: `http://127.0.0.1:${port}`,
        method:  "PUT",
        path:    "/api/technicians/profile",
        headers: { Authorization: `Bearer ${token}` },
        body:    { bio: "Testing a missing profile." },
    });

    assert.equal(
        status, 404,
        `Expected 404, got ${status}. Body: ${JSON.stringify(body)}`
    );
    assert.equal(body.success, false, "body.success must be false");
    assert.ok(
        typeof body.message === "string" && body.message.length > 0,
        "Response must include a non-empty explanatory message"
    );
    assert.ok(
        body.message.toLowerCase().includes("profile") ||
        body.message.toLowerCase().includes("post"),
        `Message should mention 'profile' or 'POST'. Got: "${body.message}"`
    );
});

// ─── Scenario B ───────────────────────────────────────────────────────────────
// PUT /api/technicians/profile — No Authorization header → 401
// Hits the live dev server; no data is written.

test("Scenario B: PUT /profile — No Authorization header → 401", async () => {
    const { status, body } = await httpRequest({
        baseUrl: `http://127.0.0.1:${await waitForPort()}`,
        method:  "PUT",
        path:    "/api/technicians/profile",
        // deliberately no Authorization header
        body:    { bio: "No token test." },
    });

    assert.equal(
        status, 401,
        `Expected 401, got ${status}. Body: ${JSON.stringify(body)}`
    );
    assert.equal(body.success, false, "body.success must be false");
});

// ─── Scenario C ───────────────────────────────────────────────────────────────
// POST /api/technicians/profile — Customer token → 403
// Reconfigures the proxy to return a Customer-role user, then sends the request
// to the same in-process server.

test("Scenario C: POST /profile — Customer token → 403", async () => {
    prismaProxy._impl = makeMockImpl({
        role:       CUST_ROLE,
        userId:     FAKE_CUST_ID,
        hasProfile: false,
    });

    const port  = await waitForPort();
    const token = mintToken(FAKE_CUST_ID, CUST_ROLE);

    const { status, body } = await httpRequest({
        baseUrl: `http://127.0.0.1:${port}`,
        method:  "POST",
        path:    "/api/technicians/profile",
        headers: { Authorization: `Bearer ${token}` },
        body: {
            categoryIds:  [1],
            serviceAreas: [{ city: "Cebu City", province: "Cebu" }],
        },
    });

    assert.equal(
        status, 403,
        `Expected 403, got ${status}. Body: ${JSON.stringify(body)}`
    );
    assert.equal(body.success, false, "body.success must be false");
});
