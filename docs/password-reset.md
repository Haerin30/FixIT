# FixIT password recovery

Customers, Technicians and Administrators use the same email ownership flow. Resetting updates only `User.passwordHash`, `sessionVersion`, Prisma's `updatedAt`, and reset security metadata. IDs, roles, email, names, phone, active status and all marketplace relationships remain intact. An inactive user can change their password but still cannot log in.

## Files

- `server/prisma/schema.prisma` and `migrations/20261022000000_password_reset/migration.sql`: additive session version, hashed reset tokens and persistent rate counters. New tables have RLS enabled and public/anonymous/authenticated Data API access revoked; the server database role must own these tables or have appropriate server-only privileges.
- `server/src/lib/password-reset.js`: token issuance, transactional redemption and shared PostgreSQL counters.
- `server/src/lib/reset-mail.js`: configurable Nodemailer transport and branded email.
- `server/src/routes/password-reset.js`, `routes/auth.js`, `middleware/auth.js`: reset endpoints and JWT revocation.
- `client/src/components/PasswordRecovery.jsx`, `password-reset-entry.js`, `main.jsx`, `App.jsx`, `index.html`: dedicated forms, login navigation and fragment removal.
- `server/.env.example`, server package/lock files: mail configuration and dependency.
- `server/tests/password-reset.test.js`, `reset-smtp.test.js`, `server/scripts/test-password-reset.js`, `client/tests/password-recovery.test.mjs`: HTTP, browser, SMTP and real PostgreSQL checks.

## Configure and run locally

1. Install dependencies with `npm --prefix server ci` and `npm --prefix client ci` (`npm.cmd` in PowerShell if script execution is disabled).
2. Put private SMTP settings in `server/.env`, using `server/.env.example` as a reference. No credentials belong in frontend environment variables.
3. When ready to apply the feature to the intended database, stop the API, back up the database, review `DATABASE_URL`, then run `npm --prefix server run db:migrate` and `npm --prefix server run db:generate`. Migration deployment is additive; never use `migrate reset` or `db push --force-reset`. Restart the API after generation. On Windows an active API process may lock the generated Prisma query-engine DLL; stop that process before generating.
4. Run `npm run dev:server` and `npm run dev:client` in separate terminals.
5. Open Login → Forgot Password, enter the existing account's email, and submit. Check the controlled mailbox, open the link, enter matching new passwords, then choose Back to Login and sign in with the new password. Do not create a replacement user or edit their records.

The repository migration has been tested in an isolated local database. It has **not** been applied to the configured Supabase/application database.

## Receive email safely during development

Use your private Mailtrap/Ethereal SMTP inbox credentials, or run Mailpit locally bound to loopback (SMTP port 1025, mailbox UI port 8025). For a local Mailpit sandbox, set:

```dotenv
CLIENT_URL=http://localhost:5173
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=FixIT <no-reply@example.invalid>
SMTP_ALLOW_INSECURE=true
```

Open your local Mailpit inbox at `http://127.0.0.1:8025` to receive and inspect the message. Mailpit must already be installed/running; these settings alone do not start it. Use only accounts/mailboxes you control. The automated SMTP test creates its own loopback capture server and never sends mail to the Internet.

For a hosted private sandbox, use its host, port, username and password; keep `SMTP_ALLOW_INSECURE=false`. Use `SMTP_SECURE=true` on port 465, or `false` with STARTTLS on port 587. Production requires `NODE_ENV=production`, an HTTPS `CLIENT_URL`, and encrypted SMTP. The transport follows [Nodemailer's SMTP options](https://nodemailer.com/smtp). No live SMTP credentials were added to this repository.

Missing or invalid SMTP/CLIENT_URL configuration returns an explicit 503 setup message for every valid email. The usual success response is deliberately conditional: "If an account exists with that email, we'll send a password reset link." It does not assert delivery. Provider failures are logged with a fixed message containing no recipient, token, URL or credentials, and the affected token is invalidated.

## Security and operations

- Tokens have 256 bits of randomness; only SHA-256 hashes are stored. Expiry is exactly 30 minutes from issuance. Passwords require at least eight Unicode characters and at most 72 UTF-8 bytes, and use bcrypt with 12 rounds.
- PostgreSQL row locks serialize resets for one user. Conditional consumption, password update, session-version increment and invalidation of all other outstanding tokens happen in one transaction. Failed transactions roll back token consumption.
- New JWTs carry `sv`; legacy JWTs without it count as version zero and remain usable only until the first reset. Every authenticated request compares that version against the current database value. No automatic login follows a reset.
- Requests are limited to 10 forgot requests per IP and 3 per normalized email per 15 minutes; reset attempts are limited to 10 per IP per 15 minutes. Counters are atomic and shared across server instances. Unknown emails consume the same counters. Do not broadly trust client-supplied forwarding headers. If deploying behind a proxy, configure Express `trust proxy` for only the actual trusted proxy/network; otherwise limits intentionally use the socket peer IP.
- Reset links use only trusted `CLIENT_URL`. Their token is a URL fragment, never a query parameter. It is removed with `replaceState` before React renders; no token goes into local/session storage. The reset screen mounts independently of marketplace resources, and the HTML uses `no-referrer`. A page reload after removal requires opening the email link again. Configure SPA fallback so `/reset-password` serves `index.html`.
- Keep API and frontend HTTPS in deployment. Do not log request bodies on auth endpoints, full reset URLs, mail bodies, or browser analytics on the recovery screen. Configure the static host's reset route with `Cache-Control: no-store` and `Referrer-Policy: no-referrer`; API responses already send these headers.
- Email processing runs asynchronously after the generic response and before any recipient lookup. There are at most 50 outstanding mail tasks per process. This avoids account enumeration through SMTP latency. Tasks are in memory, so a process crash can lose pending mail; users can request another link after the limit window. A durable encrypted email queue is a future reliability improvement. Monitor the fixed processing-failure log; SMTP acceptance does not guarantee inbox placement.
- Periodically delete expired reset-token and rate-counter rows using a server-only maintenance job. No cleanup of application/account records is required. Do not weaken RLS to expose security tables through the Supabase Data API; see [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Verification

```text
npm test
npm --prefix client test
npm run lint
npm run build
cd server
npx prisma validate
```

For real PostgreSQL integration, use a **dedicated migrated test database**, set `TEST_DATABASE_URL` in the test process environment, then run `npm --prefix server run test:integration:reset`. This script does not read the application `.env` as a fallback. It creates random `.invalid` test accounts and related fixtures, verifies concurrency, rollback, expiry, account preservation, inactive status and shared rate limits, then removes only its own fixtures. If the main Prisma engine is locked, `RESET_TEST_CLIENT` can point to an independently generated test client. The existing `npm run test:integration` smoke suite uses `DATABASE_URL`; override it with the test database before running.

Real provider inbox delivery, deployment proxy settings and production HTTPS/static-host headers require verification in the chosen hosting environment. No push, merge or deployment is part of this implementation.

### Implementation verification results

- Server suite: 30 tests passed, including HTTP login/session revocation and a private loopback SMTP delivery test.
- Client suite: 7 tests passed, including Forgot Password navigation, mismatch/byte validation, show/hide, loading, success and URL sanitization. Existing Vite test servers reported harmless HMR port conflicts; assertions passed.
- Lint, production build and Prisma schema validation passed.
- All three Prisma migrations deployed successfully into a newly initialized temporary local PostgreSQL 17 cluster. The password-reset database integration passed same-token and different-token races, transactional rollback, token expiry, all three roles, inactive account preservation, related-record preservation and concurrent rate limits.
- The existing `npm run test:integration` smoke suite passed against that isolated cluster. The initial sandbox run could not reach the public locations service; the network-enabled retry passed.
- Default Prisma client generation encountered a Windows lock on the existing query-engine DLL. An independent client generated successfully and was used for real database integration. Stop the running API and regenerate the normal client before enabling this feature locally.
- The application `.env` has no SMTP provider configured. Real inbox placement and production hosting behavior remain unverified; the existing application database has not been migrated.
