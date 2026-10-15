# FixIT computer repair marketplace

React 19 / Vite client, Express 5 REST API, Prisma 6, and PostgreSQL. Work is on `feature/marketplace-deadline`. Existing schema and migration history are preserved; no database reset is needed.

## Run locally

Requires Node.js 22.12+ (verified on Node 24), npm, and PostgreSQL reachable through `DATABASE_URL`.

1. Install dependencies: `npm --prefix server install` and `npm --prefix client install`.
2. For a new checkout, copy `server/.env.example` to `server/.env`, then enter your configuration. Do not overwrite an existing `.env`.
3. From `server/`, run `npm run db:generate`. For a new database, run `npm run db:migrate` and `npm run db:seed`. These apply versioned migrations and upsert roles/categories; never run `prisma migrate reset` against the shared database. The current connected database is already migrated and seeded.
4. From the repository root, run `npm run dev:server` in one terminal and `npm run dev:client` in another.
5. Open http://localhost:5173. API: http://localhost:5000/api/health.

The development client proxies `/api` to Express. `npm run build` builds `client/dist`; deploy that static bundle with `/api` reverse-proxied to Express, or configure `VITE_API_URL` at build time and set `CLIENT_URL` to the frontend origin. `vite preview` does not provide the development proxy.

## Environment

| Variable | Location | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `server/.env` | PostgreSQL connection URL; use your existing connection, including required SSL parameters. |
| `JWT_SECRET` | `server/.env` | Long random server-only JWT signing secret. Tokens expire after one hour. |
| `PORT` | `server/.env` | Express port, default `5000`. |
| `CLIENT_URL` | `server/.env` | Exact client origin for CORS and PayMongo return URLs; default `http://localhost:5173`. |
| `PAYMONGO_SECRET_KEY` | `server/.env` | PayMongo **test secret** beginning `sk_test_`. Live keys are rejected. Restart Express after changing this value. |
| `VITE_API_URL` | optional `client/.env` | Public API base URL ending in `/api`. Omit for local development proxy. Never put secrets in `VITE_` variables. |

`.env` files are ignored by Git. Never paste credentials into source, screenshots, issue comments, or chat.

## Demo workflow

Three available demo technicians can be added with `npm run db:seed:demo` from `server/`. This additive command preserves existing accounts and can be rerun without duplication. Accounts: `alex.tech@fixit.example` (Cebu City; laptop/upgrades/recovery), `bea.tech@fixit.example` (Mandaue City; desktop/software/malware), and `carlo.tech@fixit.example` (Lapu-Lapu City; networking/printers/laptop). Their shared generated demo password is stored locally in Git-ignored `server/.env.demo` as `FIXIT_DEMO_PASSWORD`; use its value in the regular sign-in form. These are explicitly labeled demo profiles, without fabricated reviews.

1. Join as a technician. New technician accounts are unavailable until their profile is published. Set biography, specialties, experience, city/province, and check **Available for requests**.
2. Sign out and join as a customer (or use a separate browser session). Browse/filter technicians and open a profile to request repair. A request must match one of that technician's specialties.
3. Technician accepts or rejects the request. Either participant can propose a future schedule. The other participant must confirm it; a person cannot confirm their own proposal. Confirming a replacement cancels the other active schedules.
4. Technician starts a repair after a schedule is confirmed. Mark unsuccessful to close it with a zero fee, or submit a successful outcome and final PHP amount for customer confirmation.
5. Customer confirms success before payment is enabled. Use **Open test checkout**, complete PayMongo's hosted test flow, return to **My repairs**, select the repair, and use **Verify payment**. Return URL parameters never mark a repair paid.
6. Customer can leave one review per successfully completed repair after confirming the outcome. Both participants can exchange messages, which update automatically about every four seconds.

Customers can cancel requests before work starts. Administrator accounts are not available through public signup. An existing trusted Administrator account sees the administrator dashboard; role assignment must be performed by a trusted database operator. No default administrator password is created.

## Integrations

**PayMongo:** server-side hosted checkout creation and retrieval, using [PayMongo's Checkout Session API](https://docs.paymongo.com/reference/create_checkout_sessions) and [resource format](https://docs.paymongo.com/reference/checkout-session-resource). Prices come from the confirmed repair, converted to centavos. Existing sessions are reused under a PostgreSQL advisory lock. Verification checks a paid payment's test-mode flag, currency, and amount. Duplicate payment attempts and payment for unsuccessful/unconfirmed repairs are blocked. Card and GCash must be enabled for the test merchant. No card data passes through FixIT.

**Public REST API:** `/api/locations` retrieves Philippine city/municipality choices from the [public PSGC API](https://psgc.gitlab.io/api/), caches responses for 24 hours, and feeds the city suggestions. Requests time out after ten seconds. Manual city entry remains available if the provider fails. No customer address is sent to the location provider.

## API

JSON responses use `{ data: ... }` for successful marketplace operations and `{ success: false, message }` for errors. Mutations generally require JSON bodies. Authentication uses `Authorization: Bearer <token>`; current active user/role is checked in PostgreSQL on each protected request.

| Method and route (under `/api`) | Access / body |
| --- | --- |
| `POST /auth/register` | Public; `fname,lname,email,password,role` (`Customer` or `Technician` only). |
| `POST /auth/login` | Public; `email,password`. |
| `GET /auth/me` | Current authenticated user. |
| `GET /categories`, `GET /locations` | Public lookup data. |
| `GET /technicians` | Public; optional `category,city,province,page,limit`. |
| `GET /technicians/:id` | Public profile, rating, and recent reviews. |
| `GET /profile` | Technician's own full profile. |
| `POST /technicians/profile`, `PUT /technicians/profile` | Technician only; profile fields, `categoryIds`, `serviceAreas:[{city,province}]`, `isAvailable`. |
| `GET /repairs` | Own customer/assigned-technician requests, newest 100. |
| `POST /repairs` | Customer; `technicianProfileId,repairCategoryId,title,description,deviceType,deviceModel?,serviceAddress`. |
| `POST /repairs/:id/action` | Participant; `action`: `accept,reject,cancel,start,finish,failed,confirm`; successful finish also requires numeric `finalCost`. |
| `POST /repairs/:id/schedules` | Participant; ISO `proposedStart,proposedEnd`. |
| `POST /repairs/:id/schedules/:scheduleId/respond` | Other participant; `status`: `CONFIRMED` or `REJECTED`. |
| `GET /repairs/:id/messages`, `POST /repairs/:id/messages` | Participants only; send `{body}`. |
| `POST /repairs/:id/reviews` | Owning customer; integer `rating` 1–5 and `comment`. One review per successfully completed repair; failed or unconfirmed repairs are ineligible. |
| `POST /payments/:id/checkout` | Owning customer; server-priced confirmed successful repair only. |
| `POST /payments/:id/verify` | Owning customer; verifies persisted checkout with PayMongo. |
| `GET /admin/summary` | Administrator only; account/technician/repair totals, paid total, status breakdown. |

## Verification

- `npm test`: nineteen isolated backend authorization and repair-state tests, no live server/database required.
- `npm run test:integration`: real PostgreSQL/HTTP workflow tests. Creates random `example.invalid` users and repairs, then removes only the test records identified during that run. Does not reset the database. PayMongo paid-state simulations run only in the isolated in-memory test suite; the PostgreSQL integration run never inserts simulated PAID payments. The PSGC call is live.
- From `server/`, `npm run test:paymongo`: creates, retrieves, and expires a real PHP 100 **test** checkout using your configured key. Does not make a payment or print credentials/checkout URLs.
- From `server/`, `npm run test:integration:paymongo`: runs the entire repair lifecycle, creates a real hosted test checkout through the application payment endpoint, verifies its persisted pending status, expires it, then continues the remaining real database workflow checks. No payment is made.
- `npm run db:check`: prints configuration presence and checks roles without printing credentials.
- `npm run lint`, `npm run build`: client static analysis and production build.
- From `server/`, `npx prisma validate` and `npx prisma migrate status`: schema validation and read-only migration check.

Verified in this session: PostgreSQL is connected; the existing migration is applied; both signup/login roles, technician browsing/profile updates, acceptance/rejection/cancellation, two-party schedules, status changes, zero-cost failed repairs, participant message access, one-review restriction, admin authorization, public location API, and mocked payment verification pass. The complete repair-to-PayMongo checkout flow created a real test checkout, persisted its session, verified pending status, and expired the checkout successfully. Client build/lint and eleven isolated backend tests pass.

## Remaining limits

- A completed hosted payment has not been exercised in a browser. Test checkout creation/retrieval is verified; paid/unpaid/mismatched amounts are verified against mocked provider responses.
- Payment reconciliation uses automatic polling in the payment panel and **Verify payment**; no PayMongo webhook or background reconciliation worker is configured.
- Browser tooling was unavailable in this environment, so visual/mobile layout and browser interaction tests remain manual.
- Messaging polls automatically every four seconds; conversations show the latest 100 messages. No attachments or push notifications.
- Admin management supports audited account activation/deactivation; payments remain read-only. Password reset, email verification, abuse/rate controls, disputes, and production payment rollout remain future work.
- No deployment or Git push was performed. All work remains on the local feature branch.

## Profile and review UX update

Technicians now open their complete public-facing profile by default. A separate Edit Profile screen preserves multiple service areas and updates the displayed profile after saving. Owner and customer views reuse TechnicianProfile, Avatar, Rating, and marketplace card components. Profiles include biography, category-based skills, services, real review statistics, and successful completed-repair counts. Initials avatars are provided; photo uploads are not included.

Ratings and review feeds include only reviews attached to customer-confirmed COMPLETED/SUCCESSFUL repairs. Existing data is preserved, including historical reviews attached to other repair states; those ineligible reviews are excluded from public ratings and feedback. The unique repairRequestId constraint and serializable review creation prevent duplicate submissions. No schema migration is required.

GET /profile now returns the same normalized profile data as GET /technicians/:id, including user, specialties, serviceAreas, rating, completedRepairs, reviews, and reviewPagination. GET /technicians/:id/reviews?page=1 pages feedback ten at a time. Paused profiles remain viewable by their owners and by direct public profile URLs; booking is disabled while unavailable.

Profile details refresh after saves, reviews, profile navigation, and browser focus. Marketplace cards refresh after reviews and when returning to the marketplace. Styling includes responsive statistic cards, review panels, SVG icons, fractional stars, focus indicators, skip navigation, loading states, accessible feedback, and reduced-motion support.

Validation: npm --prefix server test runs 19 isolated backend tests, including HTTP rating/profile/review authorization checks. npm --prefix client test verifies rendered public/owner profiles, empty ratings, feedback escaping, and the separate editor. npm --prefix server run test:profiles runs read-only HTTP/PostgreSQL comparisons against existing accounts; it creates, updates, and deletes no records. Client lint and production build also pass. Browser visual/interaction verification remains manual because no browser surface is available.

## Final QA release

See [DEMO.md](DEMO.md) for the full customer/technician/admin walkthrough, safe admin provisioning, test commands, and manual hosted-payment requirements. See [FINAL_QA_REPORT.md](FINAL_QA_REPORT.md) for the final evidence and remaining limitations.

Payment endpoints now include POST /payments/:id/cancel. PayMongo-confirmed expired sessions can be safely replaced; active sessions are reused. Each session creation/replacement/cancellation is preserved in AuditLog. Verification checks session ID, repair reference, PHP amount, test mode and payment intent/payment IDs. No redirect URL or admin mutation can mark a payment paid.

Admin endpoints (Administrator only): GET /admin/users?q=&role=&active=&page=, PATCH /admin/users/:id/active with a boolean isActive, GET /admin/technicians/:id, GET /admin/repairs?status=&page=, and GET /admin/payments?status=&page=. Mutations preserve history and create audit events; self-deactivation and administrator moderation are rejected.

Booking requests support an optional UUID requestId; messages support an optional UUID messageId. Retries with the same identity and unchanged payload return the original record rather than creating duplicates. The frontend retains retry identifiers after connection failures.

Authentication endpoints are throttled to 30 requests per IP per 15 minutes in the single-process deployment. JWT subjects and current active account roles are validated server-side. Request bodies are limited to 32 KiB, malformed JSON is handled without echoing its contents, and the database diagnostic endpoint requires an administrator.
