# FixIT Docker deployment preparation

This is a deployment plan and container configuration, not a deployed application. Do not publish images, provision a host, change DNS, apply migrations to Supabase, or configure live credentials until the hosting environment is selected and approved. PayMongo remains in Sandbox even when the application runs with `NODE_ENV=production`.

Password recovery and the initial production Docker configuration are already included in `main` through PRs #5 and #7. The local Docker setup is a separate follow-up change targeting `main`. No merge or public deployment is performed by this preparation work.

## Local Docker on Windows / Docker Desktop

Use the standalone **`compose.local.yaml`** for local testing. It uses the existing Supabase database and Mailtrap Sandbox settings in `server/.env`, without changing that file. It has no database or migration service. Do **not** combine it with production `compose.yaml` using multiple `-f` arguments. Both files use the `fixit` project name so switching configurations recreates only the same two FixIT services; do not run both modes simultaneously.

```powershell
# Needed only if this terminal has not picked up Docker Desktop's PATH yet.
$env:PATH = 'C:\Program Files\Docker\Docker\resources\bin;' + $env:PATH
docker compose -f compose.local.yaml config --quiet
docker compose -f compose.local.yaml build
docker compose -f compose.local.yaml up -d --no-build --wait --wait-timeout 90 server client
docker compose -f compose.local.yaml ps
curl.exe --fail http://localhost:8080/
curl.exe --fail http://localhost:8080/api/health
docker compose -f compose.local.yaml logs --tail 30 server client
```

Open **http://localhost:8080**. The local backend sets `CLIENT_URL=http://localhost:8080`, `NODE_ENV=development`, and the existing `FIXIT_CONTAINER=false` switch; only production-specific startup validation is disabled. A separate `FIXIT_LOCAL_CONTAINER=true` guard requires that exact localhost URL, development mode, Mailtrap's `sandbox.smtp.mailtrap.io` host, encrypted SMTP, and PayMongo test credentials if configured. Normal authentication, token expiry/single-use rules, session revocation and rate limits still apply. The production validator is unchanged and still rejects HTTP and sandbox delivery for deployment.

Local safeguards: the frontend port is fixed to **127.0.0.1:8080**, the backend has no published port, and a local-only Nginx config rejects public-domain Host headers. Nginx ignores caller-supplied forwarding headers. Do not expose this setup through a public reverse proxy, tunnel or a modified port binding. Use the separate production configuration for an approved public deployment.

The local Compose file and `client/nginx.local.conf` contain no secrets or machine-specific credentials and can be reviewed in Git. The Nginx file is mounted read-only and excluded from the client image build context. All existing secrets are injected from the ignored `server/.env` only at runtime. Optional machine-specific `/compose.local.override.yaml` is ignored by Git; never put credentials in the shareable template. Use `config --quiet`, not expanded Compose output, which can reveal resolved environment values.

Mailtrap Sandbox captures reset messages in its private **Email Testing** inbox instead of delivering them to real users. A manually requested reset will generate a localhost link. Opening that link and submitting a new password **changes the existing account password and revokes its sessions**; do this only for an account whose password you intend to change. Startup verification does not require resetting any account. Ordinary non-Docker development remains `npm run dev:server` / `npm run dev:client`, using the unchanged development environment file and Vite port 5173.

There is no automatic migration or seeding. If database/schema checks fail, stop and review the database and approved migration plan. Do not reset or reseed Supabase to fix Docker startup. To stop only this local stack, use `docker compose -f compose.local.yaml stop server client`.

## Recommended host and sizing

Recommend a **Hetzner Cloud Ubuntu 24.04 LTS VM in Singapore**, initially 2 vCPU, 4 GB RAM and at least 25 GB disk. This is an operational recommendation for the current two-service application, not a load-tested capacity guarantee. Choose a region close to the existing Supabase database if its location differs. Hetzner documents [Singapore availability](https://docs.hetzner.com/cloud/general/locations/) and [SMTP port restrictions](https://docs.hetzner.com/cloud/servers/faq/): use an external delivery provider on port **587 with STARTTLS**, since ports 25 and 465 are blocked by default.

Requirements: Linux amd64, Docker Engine with Compose v2, host-level Caddy, a domain, SSH key access, security updates, log monitoring, enough RAM to build Vite/Prisma, and Supabase backups/PITR appropriate to the project plan. Allow inbound 80/443, restrict SSH to administrators, and do not expose 5000 or 8080 publicly. Allow outbound HTTPS, Supabase database access and SMTP 587. No local PostgreSQL container or data volume is created.

## Architecture and safety boundaries

```text
Browser -- HTTPS --> host Caddy -- 127.0.0.1:8080 --> Nginx client container
                                                     /api --> private server:5000
                                                                  |--> existing Supabase
                                                                  |--> PayMongo Sandbox
                                                                  |--> production SMTP provider
```

- `client/Dockerfile`: Node 22 build stage; Nginx serves static React output as an unprivileged user. `/api` stays same-origin, and `/reset-password` and `/forgot-password` fall back to the SPA. Reset URLs carry tokens in fragments, which are removed before rendering.
- `server/Dockerfile`: Node 22 / Debian Bookworm with OpenSSL and CA certificates in both build and runtime stages. Prisma 6 generates its Linux client during the build, never copying Windows engines. Runtime excludes development dependencies. The separate `migration` target retains the Prisma CLI.
- Docker context allowlists exclude `.env`, credentials, private keys, logs, local `node_modules`, and generated output. Neither image accepts secret build arguments. All secret values are supplied at runtime.
- Both application containers run without root, with read-only filesystems, temporary `/tmp`, dropped capabilities, restart policies and health checks. The private bridge permits outbound connections but publishes no backend port. The `tools` profile prevents migration startup during normal `up`.
- The fixed network `172.30.75.0/24` allows narrowly scoped proxy trust. Nginx trusts only the host gateway `172.30.75.1`, overwrites the forwarded client IP, and Express trusts only Nginx `172.30.75.10`. If this subnet conflicts with another network, update **compose.yaml, client/nginx.conf and TRUST_PROXY together**. Do not set `trust proxy=true`, publish the backend port, or trust all forwarding headers.
- Application startup rejects HTTP `CLIENT_URL`, short/placeholder JWT secrets, live PayMongo keys, missing SMTP configuration and known test-only inbox hosts. Health checks are process liveness checks; they do not prove database connectivity or email delivery.

## Runtime configuration

Create private files outside the checkout, for example `/etc/fixit/runtime.env` and `/etc/fixit/migrations.env`, readable only by the deployment administrator (`chmod 600`). Supply values through the host's secret manager or secure editor; never paste them into Git, build arguments, tickets, logs or PRs. Compose `env_file` supplies runtime variables; users with Docker administrator access can inspect container environments. Use an appropriate protected host/secret manager and limit that access. Do not paste expanded `docker compose config` output; use `config --quiet`.

| Name | Purpose |
| --- | --- |
| `DATABASE_URL` | Existing Supabase PostgreSQL connection, URL-encoded password and provider-required TLS options. Use the approved Prisma connection string; session pooler is suitable when direct IPv6 connectivity is unavailable. |
| `JWT_SECRET` | Private high-entropy secret, at least 32 characters; keep stable across ordinary updates. |
| `CLIENT_URL` | Exact public HTTPS origin, e.g. `https://fixit.example.com`, with no path, query or credentials. Used for reset and checkout return URLs. |
| `PAYMONGO_SECRET_KEY` | Only the account's `sk_test_…` secret; never a live key. |
| `SMTP_HOST`, `SMTP_PORT` | Real delivery provider, preferably port 587 on the recommended host. |
| `SMTP_SECURE` | `false` for STARTTLS on 587; `true` for implicit TLS on 465 only where outbound access is permitted. |
| `SMTP_USER`, `SMTP_PASS` | Provider SMTP credentials. |
| `SMTP_FROM` | Verified sender, e.g. `FixIT <accounts@your-approved-domain>`. |
| `NODE_ENV`, `PORT` | Forced to `production`, `5000` by Compose. |
| `FIXIT_CONTAINER`, `TRUST_PROXY`, `SMTP_ALLOW_INSECURE` | Forced by Compose to enable validation, trust only Nginx, and require SMTP TLS. |

Production email must use a provider that delivers to actual registered inboxes, such as an approved transactional SMTP service with a verified sender/domain. **Mailtrap Sandbox, Ethereal and Mailpit do not deliver real-user recovery emails.** Mailtrap Email Sending is a separate delivery product; sandbox credentials are not interchangeable. Before enabling recovery, verify SPF/DKIM and the provider's sender/domain approval, configure DMARC as appropriate, and test delivery to an inbox you control. Do not disable TLS verification. Passwords are never emailed.

The migration env file needs only `DATABASE_URL`, using the existing database's direct or session-mode connection, **not a transaction pooler**. Consult [Supabase's Prisma connection guidance](https://supabase.com/docs/guides/database/prisma) for the project's connection options. Do not create another database, reseed existing accounts, or change their IDs.

Compose operator variables are non-secret:

```sh
export FIXIT_ENV_FILE=/etc/fixit/runtime.env
export FIXIT_MIGRATION_ENV_FILE=/etc/fixit/migrations.env
export FIXIT_IMAGE_TAG=$(git rev-parse --short HEAD)
export FIXIT_HTTP_PORT=8080
```

For local HTTP/Mailtrap testing use the standalone local configuration documented above. The production configuration still requires an HTTPS origin and a real delivery SMTP provider. No production credentials are required merely to build images. Compose still needs its referenced env files to exist when parsing configuration.

## Build, inspect and start (after approval)

```sh
docker compose config --quiet
docker compose --profile tools build --pull
docker compose --profile tools run --rm migrate ./node_modules/.bin/prisma migrate status
# After backup, migration review and approval:
docker compose --profile tools run --rm migrate
docker compose up -d --no-build server client
docker compose ps
curl --fail http://127.0.0.1:8080/healthz
curl --fail http://127.0.0.1:8080/api/health
curl --fail --head http://127.0.0.1:8080/reset-password
```

`docker compose build` also builds the two application images without the migration target. Direct builds, requiring no env file:

```sh
docker build --target runtime -t fixit-client:review ./client
docker build --target runtime -t fixit-server:review ./server
docker build --target migration -t fixit-migrate:review ./server
```

No command above pushes images. Base tags track Node 22 / Nginx updates; before an approved release, record the built image IDs and consider pinning verified base-image digests. Keep previous release images locally for rollback. Avoid pruning them until the release is accepted.

## HTTPS and reverse proxy

After the host/domain decision is approved, point DNS to the chosen host and install Caddy as a host service. A proposed Caddyfile is:

```caddyfile
fixit.example.com {
    reverse_proxy 127.0.0.1:8080
    header Referrer-Policy "no-referrer"
    header X-Content-Type-Options "nosniff"
}
```

Replace the example hostname with the approved domain, set the matching HTTPS `CLIENT_URL`, validate the Caddy config and reload Caddy. Caddy manages certificates and HTTPS redirects when DNS and ports 80/443 are ready. Its [reverse proxy defaults](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) set forwarding headers; do not configure trust for arbitrary client proxies. If a CDN is introduced later, explicitly review the complete proxy trust chain before launch. Nginx's access log omits queries and request bodies; keep auth headers, mail bodies and recovery URLs out of monitoring logs.

Confirm externally that HTTP redirects to HTTPS, the certificate is valid, `/reset-password` renders the app, and reset responses have `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. Do not infer public success from a successful loopback curl.

## Database migration procedure

1. Confirm the exact existing Supabase project/database and backup/restore plan; review pending SQL in `server/prisma/migrations` and `prisma migrate status`.
2. Build the matching release's migration image. Run one migration task using the dedicated migration env file. Never run migrations during image build or from every API replica.
3. Use only `prisma migrate deploy` (the migration service's default command). Never use `migrate reset`, `db push --force-reset`, seed/demo scripts or destructive SQL against existing data.
4. The recovery migration adds `User.sessionVersion` and two security tables. It does not recreate users or modify repair, message or payment records. Server credentials must have the appropriate private database privileges; the new security tables are not exposed via anonymous/authenticated Supabase Data API roles.
5. Confirm migration status, then start the new application images and run the verification below. If the database was created outside Prisma migration history, stop and review a baseline plan; do not reset it.

## Verify before accepting a release

- **Health:** both containers healthy; Nginx `/healthz`, proxied `/api/health` and public HTTPS accessible. Confirm the backend is not reachable on a host/public port. Log in and load real data to verify database/schema access beyond liveness.
- **Login:** controlled Customer, Technician and Administrator accounts work; bad passwords fail; inactive accounts remain denied.
- **Recovery:** use an existing controlled account; known and unknown emails receive identical generic responses. Receive the real email, check the HTTPS host and 30-minute notice, open the link, confirm its fragment is removed, reject mismatched passwords, reset successfully and log in again. Confirm old passwords, old sessions, reused/expired/incorrect tokens fail. Verify rate limits work per client IP through both proxies and forged `X-Forwarded-For` cannot bypass them.
- **Preservation:** record the user's ID, role/status, repair IDs, message history and payment IDs/statuses before reset and compare afterward. Never recreate the user.
- **Repairs and messaging:** with controlled accounts, create a labelled QA repair, accept it, confirm a schedule, send messages in both directions, and verify conversation ownership. Avoid changing unrelated real requests.
- **PayMongo Sandbox:** confirm `sk_test_` configuration, perform the approved sandbox checkout on a controlled eligible repair using PayMongo test instruments, verify amount/currency and test-mode payment state, test cancel/retry, and verify no duplicate charge or payment record. Do not use real card details. The automated payment suite simulates provider responses; it does not prove live sandbox connectivity.
- **Regression:** run `npm test`, `npm --prefix client test`, `npm run lint`, `npm run build`, Prisma validation, and reset integration against a separate test database. Never aim fixture/seed scripts at the production database.

## Updates and rollback

Fetch the reviewed release commit without force-pushing or rewriting shared history. Record the current commit and image IDs/tags, check out the approved new commit, choose its tag, build, review/migrate only additive compatible changes, and run `docker compose up -d --no-build server client`. Verify all health and functional checks. Configure monitoring: Compose restarts crashed processes, but an unhealthy status alone does not restart a running container.

To roll back application code, check out the previous approved commit, set `FIXIT_IMAGE_TAG` to its retained image tag and run `docker compose up -d --no-build --pull never server client`. Do not reverse additive migrations, delete database records, run `down -v`, or restore a backup as an ordinary code rollback. **Rollback candidates must include session-version validation (password-recovery commit `c11c630` or later)**; older auth code would undermine reset-triggered JWT revocation. Review any incompatible future migration separately with a tested restore/forward-fix plan.

Pending recovery emails are in memory and can be lost during a restart; users can request another link after the rate window. Monitor fixed SMTP failure messages and verify delivery after updates. A durable encrypted delivery queue remains a future reliability improvement.

## Local Docker verification

Docker Desktop Engine 29.9.1 / Compose v5.6.0 are now available on the Windows workstation. The local backend image built successfully, and both containers reached healthy status. Nginx runtime syntax passed. The frontend, `/api/health`, `/healthz`, `/forgot-password` and `/reset-password` returned HTTP 200 via localhost:8080; a public-domain Host header returned 403. Linux Prisma connected to the existing Supabase database in a read-only transaction, and the session-version/reset security schema was present. Mailtrap SMTP authentication succeeded with TLS without sending an email. Image metadata contained no credential environment keys, and `/app/.env` was absent from the running server.

Regression: 34 backend tests and 7 frontend tests passed, along with lint, Vite production build and Prisma validation. A separate temporary non-Docker Express/Vite smoke check passed for the development page, React module and API proxy. No migrations, seeding, password changes, payment requests or production email were performed. Public HTTPS deployment and actual checkout/email-reset completion remain separate acceptance checks; this result establishes **local readiness**, not public deployment readiness.

Read-only aggregate snapshots taken during verification showed identical row counts and content fingerprints afterward for `User`, `RepairRequest`, `Message` and `Payment`. No record contents or credentials were printed. The local source/configuration scan found no environment secret values, and the production Compose, production validator and production Nginx configuration remained unchanged.
