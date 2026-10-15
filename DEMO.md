# FixIT classroom demonstration

## Start

From the repository root, install dependencies if needed:

```powershell
npm --prefix server ci
npm --prefix client ci
```

Keep the existing `server/.env`. For a new checkout, copy `server/.env.example` to `server/.env` and fill in `DATABASE_URL`, `JWT_SECRET`, `CLIENT_URL`, `PORT`, and `PAYMONGO_SECRET_KEY`. The PayMongo key must be a test key. Do not share its value or put secrets in `VITE_` variables.

For a new database only, run `npm run db:generate`, `npm run db:migrate`, and `npm run db:seed` from `server/`. Do not reset the existing Supabase database. No new migration is required by the final QA changes.

Open two terminals at the repository root:

```powershell
# Terminal 1
npm run dev:server
```

```powershell
# Terminal 2
npm run dev:client
```

Open http://localhost:5173. Use separate normal/private browser sessions for the customer and technician. Backend changes require a restart when using `npm start`; `npm run dev:server` watches files automatically.

## Accounts

Existing demonstration technicians remain intact. If needed, run `npm run db:seed:demo` from `server/`; this preserves existing accounts and does not seed reviews or payments. Generated demo credentials stay in Git-ignored `server/.env.demo`. Do not commit or display that file during the presentation.

Create a separate customer account through registration. Do not use personal passwords for classroom accounts.

For a trusted administrator, register a separate Customer account, then run the following **locally as the trusted repository/database operator**, replacing the placeholder with that existing account's email:

```powershell
cd server
node scripts/provision-admin.js --email <trusted-account-email> --confirm
```

This changes the existing account's role, records an operator audit event, and does not create or print a password. Do not elevate a technician account or use public signup to request an Administrator role. Sign out and back in with the account's existing credentials. No administrator is provisioned automatically.

## Full customer and technician sequence

1. Technician: register, open **My profile**, choose **Edit Profile**, add a biography, experience, specializations, service descriptions, and service areas. Enable availability and save. The public profile appears immediately.
2. Customer: register or sign in, filter the marketplace by specialization/city, and open the technician's profile. Confirm real statistics and the empty review state for a new technician.
3. Customer: submit a repair request with a matching category, device details, problem description, and service address.
4. Technician: open **My repairs** and accept the request. Repairs update automatically about every ten seconds, or use Refresh.
5. Technician: propose a future start/end in Philippine time. Customer confirms or rejects it. Alternatively, the technician explicitly delegates scheduling to the customer; the customer proposes and the technician responds. A participant cannot confirm their own proposal.
6. Both: open **Messages**, or use **Message Technician/Customer** on the repair card, and send messages in the selected repair conversation. Messages persist in PostgreSQL and update automatically about every four seconds. Disconnect/reconnect to see the offline state and automatic retry; drafts remain in the form.
7. Technician: start the repair after a schedule is confirmed, then submit a successful result and final fee.
8. Customer: inspect the result and confirm the successful repair and fee. This enables payment. For a separate unsuccessful demo, mark a different repair unsuccessful: its fee becomes zero and checkout/reviews remain unavailable.
9. Customer: select **Open test checkout**. Use only PayMongo's official sandbox test details. The backend calculates the amount from the confirmed repair.
10. Return to FixIT and open the same repair. Its payment panel checks the provider automatically, or use **Verify payment**. A redirect parameter never marks a payment paid.
11. Cancellation/retry demonstration: cancel an unpaid checkout in FixIT, confirm the action, and observe the provider-confirmed cancellation. A new checkout is allowed only after PayMongo has expired the previous one. Attempt history is retained in the audit log.
12. Customer: submit one honest review of the successfully completed demonstration repair. The review is stored, ratings update, and duplicate submissions are refused. Do not prepopulate invented reviews.
13. Technician: return to **My profile** to see updated statistics and feedback. Statistics also refresh on browser focus.

**MANUAL VERIFICATION REQUIRED:** completing the hosted sandbox payment, including PayMongo's card/GCash interaction, is not established by automated checkout creation/retrieval tests. Confirm the provider's verified PAID result before claiming the hosted-payment step passed. Never use live payment credentials or real card data for the demonstration.

Official sandbox and hosted-checkout guidance: https://docs.paymongo.com/docs/payment-channels-hosted-checkout and https://docs.paymongo.com/reference/checkout-session-resource.

## Administrator sequence

1. Sign in using the separately provisioned trusted account.
2. Open **Dashboard**. Inspect account, technician, repair, and verified-payment summaries.
3. Use **Users** to search by name/email and filter role/active status. Use **Technicians** to inspect profiles, including paused/deactivated accounts.
4. Deactivate a disposable demonstration account after confirming the action. Its active token is rejected on its next protected request. Reactivate it to restore access. History is preserved. Self-deactivation and administrator-to-administrator moderation are blocked.
5. Use **Repairs** to monitor lifecycle states and **Payments** to view immutable provider references and transaction states. No endpoint permits an administrator to manually mark a payment PAID.

## Verification commands

```powershell
npm test
npm --prefix client test
npm run lint
npm run build
npm --prefix server run db:check
```

From `server/`:

```powershell
npx prisma validate
npx prisma migrate status
npm run test:profiles
npm run test:integration:paymongo
npm run test:paymongo
```

The profile check is read-only. Integration checks generate uniquely identified test users/repairs, exercise the actual REST API and PostgreSQL, then remove only those generated records. Reviews used by integration checks are explicitly identified QA fixtures and removed. Mocked paid-payment tests run in isolated process memory and do not insert simulated PAID rows into Supabase. Real sandbox checks create/retrieve/expire unpaid checkouts without making a payment.

## Operational limits

- Messaging uses automatic polling, not Socket.IO. The conversation shows the latest 100 messages. Browser reload does not preserve unsent drafts.
- Payments are reconciled by the customer's payment panel or Verify payment; no provider webhook or background worker is installed. The administrator view shows the last verified stored payment state.
- Profile pictures use initials avatars; no file-upload subsystem was added.
- PSGC city suggestions are cached for 24 hours, share concurrent requests, time out after ten seconds, and use stale cached data during outages. Users can always enter city/province manually. Provider city aliases help match local city naming.
- Authentication throttling is per server process/IP. A multi-instance deployment needs a shared limiter and deliberately configured trusted proxy addresses.
- Email verification, password reset, refunds/disputes, and production payment rollout are outside this classroom release.
- Desktop/mobile browser interaction, keyboard walkthrough, and hosted payment must be manually verified if browser automation is unavailable.
- GitHub Actions performs isolated lint/build/test checks without production credentials; it does not run Supabase/PayMongo integration tests.

## Account, inbox and price-correction update

See [ACCOUNT_MESSAGING_SCHEDULING_UPDATE.md](ACCOUNT_MESSAGING_SCHEDULING_UPDATE.md) for the new account dropdown, separate personal/public profiles, dedicated Messages tab, technician-controlled scheduling delegation, explicit Philippine times, and revision-bound final-price correction walkthrough. The new additive migration must be applied before running this branch. Any existing checkout/payment currently locks price corrections, pending clarification of the truncated business rule.
