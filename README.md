# FixIT computer repair marketplace

FixIT connects customers with computer repair technicians. It supports technician profiles, repair requests, scheduling, messages, final-price approval, reviews, administrator tools, and PayMongo test checkout.

The project uses React 19 and Vite in `client/`, Express 5 in `server/`, and Prisma 6 with PostgreSQL. The root `package.json` forwards commands to these two applications; it is not an npm workspace.

## Windows PowerShell setup

### 1. Install prerequisites and clone

Install Git for Windows, Node.js **22.13 or later within Node 22** (the major version used by CI), and PostgreSQL, or obtain access to a team development PostgreSQL database. The committed client dependencies require at least Node 22.13 when using Node 22. Reopen PowerShell after installation.

```powershell
git --version
node --version
npm.cmd --version

git clone https://github.com/Haerin30/FixIT.git
Set-Location .\FixIT
```

The examples use `npm.cmd` so PowerShell does not need to run the `npm.ps1` wrapper or change its execution policy. Use `npx.cmd` for the same reason.

### 2. Install the client and server dependencies

Run from the repository root:

```powershell
npm.cmd ci --prefix server
npm.cmd ci --prefix client
```

Both applications have committed lockfiles. A root-only `npm install` does not install their dependencies.

### 3. Create your local server configuration

Run from the repository root. This preserves an existing local configuration:

```powershell
if (-not (Test-Path .\server\.env)) {
    Copy-Item .\server\.env.example .\server\.env
}
notepad.exe .\server\.env
```

Replace the database username/password placeholders with your development database connection. Use the provider's required SSL parameters for a hosted database, and URL-encode special characters in connection credentials. Keep the configuration private.

Generate a random JWT secret locally, then paste the output into `JWT_SECRET` in `server/.env`:

```powershell
$secretBytes = New-Object byte[] 32
$secretGenerator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try {
    $secretGenerator.GetBytes($secretBytes)
    [Convert]::ToBase64String($secretBytes)
} finally {
    $secretGenerator.Dispose()
}
```

Do not paste this output into chat, screenshots, commits, or the example file. Leave `PAYMONGO_SECRET_KEY` empty until you need payment testing. No client environment file is required for the default local setup.

### 4. Prepare the development database

For a local PostgreSQL installation, create an empty database named `fixit` using pgAdmin or the SQL Shell before migrating. For a team database, confirm the correct development connection and coordinate migrations with the database owner.

From the repository root:

```powershell
Push-Location .\server
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run db:seed
npm.cmd run db:check
npx.cmd prisma migrate status
Pop-Location
```

Run each command only after the previous one succeeds. `db:generate` creates Prisma Client; `db:migrate` applies pending committed migrations with `prisma migrate deploy`; `db:seed` upserts the three roles and repair categories. Seeding does not create login accounts. Existing migrations include the scheduling and price-version fields.

Use these commands for an existing development database too, after coordinating with its owner. This README cannot establish whether your database is already migrated. Do not reset a shared database or delete migration history.

### 5. Start both applications

Open two PowerShell terminals, each at the cloned repository root.

Terminal 1 — API:

```powershell
npm.cmd run dev:server
```

Terminal 2 — frontend:

```powershell
npm.cmd run dev:client
```

Open **http://localhost:5173**. In another terminal, verify the API:

```powershell
Invoke-RestMethod -Uri http://localhost:5000/api/health
```

The response should contain `success: true` and `FixIT API is running`. This endpoint checks the HTTP server; use `npm.cmd run db:check` separately to check PostgreSQL. Stop each development server with Ctrl+C.

Register separate Customer and Technician accounts through the UI. A technician must complete their profile, specialties, and service areas to be useful in the marketplace. There is no default administrator login.

## Environment reference

| Variable | File | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `server/.env` | Required PostgreSQL URL used by Prisma and database scripts. |
| `JWT_SECRET` | `server/.env` | Required private signing secret. Generate a random value; tokens expire after one hour. |
| `PORT` | `server/.env` | API port; default `5000`. |
| `CLIENT_URL` | `server/.env` | Exact frontend origin, without a trailing slash; used for CORS and checkout return URLs. Default `http://localhost:5173`. |
| `PAYMONGO_SECRET_KEY` | `server/.env` | Optional PayMongo test secret. The API accepts only keys beginning with `sk_test_`. Missing configuration disables hosted checkout. |
| `VITE_API_URL` | optional `client/.env` | Public API base URL ending in `/api`, without a trailing slash. Leave unset/empty for the development proxy. |

Restart Express after editing `server/.env`. Restart Vite after editing client environment variables; rebuild for production changes. Every `VITE_*` variable is public browser configuration: never put database, JWT, or PayMongo secrets there.

The development proxy in `client/vite.config.js` forwards `/api` to `http://localhost:5000`. If you change `PORT`, update that proxy or set `VITE_API_URL` to the new API origin plus `/api`. If the frontend uses another origin, update `CLIENT_URL` too.

## Commands and checks

Run these from the repository root after installing dependencies:

```powershell
npm.cmd test
npm.cmd --prefix client test
npm.cmd run lint
npm.cmd run build
```

The backend tests use isolated fixtures/mocks; the client tests use Node's test runner. The root `test` command runs only the backend suite. CI runs both suites, lint, the client build, and Prisma schema validation on Node 22.

Database-related checks:

```powershell
npm.cmd run db:check
Push-Location .\server
npx.cmd prisma validate
npx.cmd prisma migrate status
npm.cmd run test:profiles
Pop-Location
```

`db:check` queries roles; `test:profiles` compares existing profiles through a temporary local HTTP server and PostgreSQL without changing records. A fresh database with no profiles cannot exercise existing-profile comparisons.

Optional integration tests use the configured development database and a temporary HTTP server; a separately running API is unnecessary:

```powershell
npm.cmd run test:integration
```

This creates test users and repairs and attempts to remove the records created by that run. It also calls the public location service. Use a disposable development database; interrupted runs can leave test records.

For PayMongo test mode, privately configure `PAYMONGO_SECRET_KEY`, then optionally run:

```powershell
npm.cmd --prefix server run test:paymongo
npm.cmd --prefix server run test:integration:paymongo
```

These contact PayMongo to create/retrieve/expire test checkout sessions; they do not complete a payment. Card and GCash must be enabled for the test merchant. Browser payment completion is a separate manual check. Payment status is reconciled through polling/verification; no webhook worker is configured.

## Optional demo and administrator setup

`npm.cmd --prefix server run db:seed:demo` adds three demo technicians and stores their generated local password in the ignored `server/.env.demo` file. Existing accounts are preserved. Keep that file private; do not copy its contents into the README or commit it.

A trusted database operator can promote an existing active non-technician account after the Administrator role has been seeded. First register a separate account, then run from the repository root, replacing the example email with that account's email:

```powershell
Push-Location .\server
node .\scripts\provision-admin.js --email "trusted-account@example.invalid" --confirm
Pop-Location
```

This changes the account's role and writes an audit record. It does not create or print a password. Coordinate administrator access with the group.

## Troubleshooting

- **API refuses to start:** fill in `DATABASE_URL` and `JWT_SECRET` in `server/.env`; run through the documented root scripts or from `server/` so dotenv finds the file.
- **Database connection fails:** ensure PostgreSQL is running, the database exists, the URL is correct, and any provider SSL/network requirements are met. Use `db:check` without sharing connection values.
- **Missing tables, columns, or roles:** apply `db:migrate`, run `db:seed`, and regenerate Prisma Client as shown above.
- **Frontend cannot reach the API:** start both terminals and check the health URL. The default Vite proxy expects port 5000.
- **Vite chooses a different port:** free port 5173 or set `CLIENT_URL` to the exact origin Vite reports and restart Express.
- **Checkout unavailable:** use a private PayMongo test secret and restart Express. Live keys are rejected.
- **PowerShell blocks npm:** use the `npm.cmd` / `npx.cmd` commands above.

## Build and deployment

`npm.cmd run build` produces `client/dist/`. Express starts with `npm.cmd --prefix server start`. The build is only the frontend; Express does not serve that output. Host the static files with `/api` reverse-proxied to Express, or set `VITE_API_URL` at build time and configure `CLIENT_URL` for the deployed frontend. The `vite preview` command does not provide the configured development proxy.

## Repository and collaboration

- `client/`: React UI, API helper, Vite configuration, and frontend tests.
- `server/src/`: Express routes, middleware, and business rules.
- `server/prisma/`: PostgreSQL schema, committed migrations, and reference-data seed.
- `server/scripts/`: database, integration, demo, and administrator tools.
- [.github/workflows/quality.yml](.github/workflows/quality.yml): automated checks.
- [DEMO.md](DEMO.md): detailed demonstration walkthrough.
- [ACCOUNT_MESSAGING_SCHEDULING_UPDATE.md](ACCOUNT_MESSAGING_SCHEDULING_UPDATE.md): account, messaging, scheduling, and pricing details.
- [FINAL_QA_REPORT.md](FINAL_QA_REPORT.md): historical QA evidence and limitations; it is not proof of checks on your current machine.

Create a feature branch for your work and open a pull request into `main`. Review `git status` and the staged diff before committing. The root `.gitignore` excludes local environment files (including `.env.demo`), dependencies, build output, coverage, and logs while allowing `.env.example` templates. Ignore rules do not remove already tracked secrets; never stage real credentials. If a credential was exposed, revoke/rotate it with the provider and coordinate repository cleanup.
